import onSubmission from "./submission";

export enum TaskType {
  Submission = "Submission"
  // CustomTest = "CustomTest",
  // Hack = "Hack"
}

export interface TaskMeta {
  id: number;
  type: TaskType;
}

export type Task<TaskExtraInfo, Progress> = TaskMeta & {
  uuid: string;
  // The priority is not important for judge clients
  // It's handled by the judge queue on the server
  priority: number;
  extraInfo: TaskExtraInfo;
  reportProgressRaw: (progress: Progress) => void;
};

export type TaskHandler<T> = (task: Task<T, unknown>) => Promise<void>;

const taskHandlers: Record<TaskType, TaskHandler<unknown>> = {
  [TaskType.Submission]: onSubmission
};

export default async function taskHandler(task: Task<unknown, unknown>) {
  await taskHandlers[task.type](task);
}
