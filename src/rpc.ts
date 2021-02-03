import SocketIO from "socket.io-client";
import winston from "winston";
import lodashDebounce from "lodash.debounce";
import SocketIOParser from "socket.io-msgpack-parser";

import config, { updateServerSideConfig } from "./config";
import taskHandler, { Task } from "./task";

import getSystemInfo from "./systemInfo";
import { CanceledError } from "./error";

export class RPC {
  // eslint-disable-next-line no-undef
  private socket: SocketIOClient.Socket;

  private ready: boolean = false;

  /**
   * For each task:
   * * Functions to stop all the sandboxes and reject sandbox promises with CanceledErrors
   *   if the task is running sandboxes
   * * Otherwise a empty set
   */
  private pendingTaskCancelCallback: Map<string, Set<() => void>> = new Map();

  connect() {
    winston.info("Trying to connect to the server...");

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
    }

    let { serverUrl } = config;
    while (serverUrl.endsWith("/")) serverUrl = serverUrl.slice(0, -1);
    this.socket = SocketIO(`${serverUrl}/judge`, {
      path: "/api/socket",
      reconnection: true,
      transports: ["websocket"],
      query: {
        key: config.key
      },
      ...{
        parser: SocketIOParser
      }
    });

    this.socket.on("connect", () => {
      winston.info("Successfully connected to the server, awaiting authorization");
    });

    this.socket.on("disconnect", () => {
      this.ready = false;
      winston.error("Disconnected from server");
      this.cancelAllTasks();
      this.connect();
    });

    this.socket.on("ready", async (name: string, serverSideConfig: unknown) => {
      winston.info(`Successfully authorized as ${name}`);
      updateServerSideConfig(serverSideConfig);
      this.ready = true;
      this.socket.emit("systemInfo", await getSystemInfo());
    });

    this.socket.on("cancel", (taskId: string) => this.cancelTask(taskId));

    this.socket.on("authenticationFailed", () => {
      winston.error("Failed to authentication to server, please check your key");
      process.exit(1);
    });
  }

  onCancel(taskId: string, callback: () => void): () => void {
    const callbacks = this.pendingTaskCancelCallback.get(taskId);
    if (!callbacks) {
      // Already canceled
      callback();
      return () => null;
    }
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  }

  private cancelTask(taskId: string) {
    winston.info(`Canceling task ${taskId}`);
    const callbacks = this.pendingTaskCancelCallback.get(taskId);
    if (callbacks) {
      // No such task or already canceled
      this.pendingTaskCancelCallback.delete(taskId);
      callbacks.forEach(f => f());
    }
  }

  private cancelAllTasks() {
    this.pendingTaskCancelCallback.forEach((callbacks, taskId) => {
      winston.info(`Canceling task ${taskId} since connection lost`);
      callbacks.forEach(f => f());
    });
  }

  isCanceled(taskId: string) {
    return !this.pendingTaskCancelCallback.has(taskId);
  }

  ensureNotCanceled(taskId: string) {
    if (this.isCanceled(taskId)) {
      winston.info(`Task ${taskId} canceled`);
      throw new CanceledError();
    }
  }

  async ensureReady() {
    if (this.ready) return;
    while (
      !(await new Promise(resolve => {
        const onReady = () => {
          this.socket.off("disconnect", onDisconnect);
          resolve(true);
        };
        const onDisconnect = () => {
          this.socket.off("ready", onReady);
          resolve(false);
        };
        this.socket.once("ready", onReady);
        this.socket.once("disconnect", onDisconnect);
      }))
    );
  }

  async requestFiles(fileUuids: string[]) {
    winston.info(`Requesting for ${fileUuids.length} files from server`);

    await this.ensureReady();

    const urlsOrDisconnect = await new Promise<string[]>(resolve => {
      const onDisconnect = () => {
        winston.error("Connection lost while fetching files");
        resolve(null);
      };

      this.socket.on("disconnect", onDisconnect);

      this.socket.emit("requestFiles", fileUuids, (urls: string[]) => {
        this.socket.off("disconnect", onDisconnect);
        resolve(urls);
      });
    });

    if (!urlsOrDisconnect) {
      throw new Error(`Failed to fetch ${fileUuids.length} files, connection lost`);
    }

    return urlsOrDisconnect;
  }

  async startTaskConsumerThread(threadId: number) {
    for (;;) {
      await this.ensureReady();

      this.socket.emit("consumeTask", threadId);
      winston.info(`[Thread ${threadId}] Consuming task`);

      const currentConnection = this.socket.id;

      const taskOrDisconnect = await new Promise<{ task: Task<unknown, unknown>; ack: () => void }>(resolve => {
        const onTask = (threadIdOfTask: number, task: Task<unknown, unknown>, ack: () => void) => {
          if (threadIdOfTask !== threadId) return;
          this.socket.off("task", onTask);
          this.socket.off("disconnect", onDisconnect);
          resolve({ task, ack });
        };

        const onDisconnect = () => {
          winston.error(`[Thread ${threadId}] Connection lost while consuming task`);
          this.socket.off("task", onTask);
          resolve(null);
        };

        // If the socket disconnects, we must emit another consumeTask
        this.socket.on("task", onTask);
        this.socket.once("disconnect", onDisconnect);
      });

      if (!taskOrDisconnect) {
        // Disconnected
        continue;
      }

      const { task, ack } = taskOrDisconnect;
      const taskInfo = `{ taskId: ${task.taskId}, type: ${task.type} }`;
      winston.info(`[Thread ${threadId}] Got task: ${taskInfo}`);

      let canceled = false;
      this.pendingTaskCancelCallback.set(
        task.taskId,
        new Set([
          () => {
            canceled = true;
          }
        ])
      );

      // Debounce the onProgress function so we won't send progress too fast to the server
      const reportProgress = lodashDebounce(async (progress: unknown) => {
        await this.ensureReady();
        if (this.socket.id !== currentConnection) {
          winston.warn(`Ignoring progress reporting for task ${taskInfo} since reconnected`);
          return;
        }

        winston.verbose(`[Thread ${threadId}] Reporting progress for task ${taskInfo}`);
        this.socket.emit("progress", {
          taskMeta: {
            taskId: task.taskId,
            type: task.type
          },
          progress
        });
      }, 100);
      task.reportProgressRaw = (progress: unknown) => {
        if (canceled) throw new CanceledError();
        reportProgress(progress);
      };

      try {
        await taskHandler(task);
      } catch (e) {
        if (!(e instanceof CanceledError)) {
          winston.error(`Unexpected error caught from taskHandler: ${e}`);
        }
      }

      this.pendingTaskCancelCallback.delete(task.taskId);

      // If the connection fails, don't attempt to emit ack
      if (!this.ready) {
        winston.error(
          `[Thread ${threadId}] Connection lost while processing task ${taskInfo}, the task couldn't be acknowledged`
        );
      } else if (this.ready && this.socket.id !== currentConnection) {
        winston.error(
          `[Thread ${threadId}] Reconnected while processing task ${taskInfo}, the task couldn't be acknowledged`
        );
      } else {
        ack();
        winston.info(`[Thread ${threadId}] Sent ack for finished task ${taskInfo}`);
      }
    }
  }
}

export default new RPC();
