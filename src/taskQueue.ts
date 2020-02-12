import Queue = require("promise-queue");

import config from "./config";
import { ensureDirectoryEmpty } from "./utils";

const availableWorkingDirectories = config.taskWorkingDirectories;
const queue = new Queue(Math.min(availableWorkingDirectories.length, config.maxConcurrentTasks));

// We have limited working directories for tasks, so we couldn't run too many tasks in the same time
// This function accepts a task that requires a working directory, and execute the task when a working
// directory is available
export async function runTaskQueued<T>(task: (taskWorkingDirectory: string) => Promise<T>) {
  return queue.add(async () => {
    const taskWorkingDirectory = availableWorkingDirectories.pop();
    try {
      await ensureDirectoryEmpty(taskWorkingDirectory);
      return await task(taskWorkingDirectory);
    } finally {
      availableWorkingDirectories.push(taskWorkingDirectory);
    }
  });
}
