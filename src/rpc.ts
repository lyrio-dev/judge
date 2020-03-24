import SocketIO = require("socket.io-client");
import winston = require("winston");
import lodashDebounce = require("lodash.debounce");

import config from "./config";
import { Task } from "./task";
import taskHandler from "./task";
import getSystemInfo from "./systemInfo";

export class RPC {
  private socket: SocketIOClient.Socket;
  private ready: boolean = false;

  constructor() {}

  connect() {
    winston.info("Trying to connect to the server...");

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
    }

    this.socket = SocketIO(config.serverUrl + "judge", {
      path: "/api/socket",
      reconnection: true,
      transports: ["websocket"],
      query: {
        key: config.key
      }
    });

    this.socket.on("connect", () => {
      winston.info("Successfully connected to the server, awaiting authorization");
    });

    this.socket.on("disconnect", () => {
      this.ready = false;
      winston.error("Disconnected from server");

      this.connect();
    });

    this.socket.on("ready", async (name: string) => {
      winston.info(`Successfully authorized as ${name}`);
      this.ready = true;
      this.socket.emit("systemInfo", await getSystemInfo());
    });

    this.socket.on("authenticationFailed", () => {
      winston.error("Failed to authentication to server, please check your key");
      process.exit(1);
    });
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
    while (true) {
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

      // Debounce the onProgress function so we won't send progress too fast to the server
      task.reportProgressRaw = lodashDebounce(async (progress: unknown) => {
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
      await taskHandler(task);

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
