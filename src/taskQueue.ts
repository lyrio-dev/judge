import Queue = require("promise-queue");

import config from "./config";
import { ensureDirectoryEmpty } from "./utils";
import { Disposer } from "./posixUtils";

const availableWorkingDirectories = config.taskWorkingDirectories;
const queue = new Queue(Math.min(availableWorkingDirectories.length, config.maxConcurrentTasks));

/**
 * We have limited working directories for tasks, so we couldn't run too many tasks in the same time.
 *
 * This function accepts a task that requires a working directory, and execute the task when a working
 * directory is available.
 *
 * A `Disposer` is passed to task callback to ensure any POSIX resources could be disposed safely even if
 * there're exceptions.
 */
export async function runTaskQueued<T>(task: (taskWorkingDirectory: string, disposer?: Disposer) => Promise<T>) {
  return queue.add(async () => {
    const taskWorkingDirectory = availableWorkingDirectories.pop();
    const disposer = new Disposer();
    try {
      await ensureDirectoryEmpty(taskWorkingDirectory);
      return await task(taskWorkingDirectory, disposer);
    } finally {
      availableWorkingDirectories.push(taskWorkingDirectory);
      disposer.dispose();
    }
  });
}
