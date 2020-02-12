import { Task } from "@/task";
import { ensureFiles } from "@/file";
import winston = require("winston");

import * as Traditional from "./traditional";
import { ConfigurationError } from "@/error";

enum ProblemType {
  TRADITIONAL = "TRADITIONAL"
}

export interface SubmissionExtraInfo<JudgeInfo, SubmissionContent> {
  problemType: ProblemType;
  judgeInfo: JudgeInfo;
  testData: Record<string, string>; // filename -> uuid
  submissionContent: SubmissionContent;
}

export enum SubmissionProgressType {
  Preparing,
  Compiling,
  Running,
  Finished
}

export enum SubmissionStatus {
  Pending = "Pending",

  ConfigurationError = "ConfigurationError",
  SystemError = "SystemError",

  CompilationError = "CompilationError",

  FileError = "FileError",
  RuntimeError = "RuntimeError",
  TimeLimitExceeded = "TimeLimitExceeded",
  MemoryLimitExceeded = "MemoryLimitExceeded",
  OutputLimitExceeded = "OutputLimitExceeded",
  InvalidInteraction = "InvalidInteraction",

  PartiallyCorrect = "PartiallyCorrect",
  WrongAnswer = "WrongAnswer",
  Accepted = "Accepted",

  JudgementFailed = "JudgementFailed"
}

export interface SubmissionProgress<TestcaseResult> {
  progressType: SubmissionProgressType;

  // Only valid when finished
  status?: SubmissionStatus;
  score?: number;

  compile?: {
    success: boolean;
    message: string;
  };

  systemMessage?: string;

  // testcaseHash = hash(IF, OF, ML, TL) for traditional
  // ->
  // result
  testcaseResult?: Record<string, TestcaseResult>;
  subtasks?: {
    score: number;
    testcases: {
      // If !waiting && !running && !testcaseHash, it's "Skipped"
      waiting?: boolean;
      running?: boolean;
      testcaseHash?: string;
    }[];
  }[];
}

export interface SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>
  extends Task<SubmissionExtraInfo<JudgeInfo, SubmissionContent>, SubmissionProgress<TestcaseResult>> {
  reportProgress: {
    compiling(): void;
    compiled(compile: { success: boolean; message: string }): void;
    startedRunning(): void;
    testcaseRunning(subtaskIndex: number, testcaseIndex: number): void;
    testcaseFinished(subtaskIndex: number, testcaseIndex: number, result: TestcaseResult): void;
    subtaskScoreUpdated(subtaskIndex: number, newScore: number): void;
    finished(status: SubmissionStatus, score: number): void;
  };
}

export interface SubmissionHandler<JudgeInfo, SubmissionContent, TestcaseResult> {
  validateJudgeInfo: (task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>) => Promise<void>;
  getSubtaskCount: (judgeInfo: JudgeInfo) => number;
  getTestcaseCountOfSubtask: (judgeInfo: JudgeInfo, subtaskIndex: number) => number;
  hashTestcase: (judgeInfo: JudgeInfo, subtaskIndex: number, testcaseIndex: number) => string;

  runTask: (task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>) => Promise<void>;
}

const problemTypeHandlers: Record<ProblemType, SubmissionHandler<unknown, unknown, unknown>> = {
  [ProblemType.TRADITIONAL]: Traditional
};

export default async function onSubmission(task: SubmissionTask<unknown, unknown, unknown>): Promise<void> {
  try {
    if (!(task.extraInfo.problemType in ProblemType)) {
      throw new ConfigurationError(`Unsupported problem type: ${task.extraInfo.problemType}`);
    }

    task.reportProgressRaw({
      progressType: SubmissionProgressType.Preparing
    });

    const requiredFiles = Object.values(task.extraInfo.testData);
    await ensureFiles(requiredFiles);

    const problemTypeHandler = problemTypeHandlers[task.extraInfo.problemType];
    try {
      await problemTypeHandler.validateJudgeInfo(task);
    } catch (e) {
      if (typeof e === "string") throw new ConfigurationError(`Invalid judge info: ${e}`);
      else throw e;
    }

    const judgeInfo = task.extraInfo.judgeInfo;

    const progress: SubmissionProgress<unknown> = {
      progressType: null
    };

    let finished = false;
    task.reportProgress = {
      compiling() {
        if (finished) return;
        task.reportProgressRaw({
          progressType: SubmissionProgressType.Compiling
        });
      },
      compiled(compile) {
        if (finished) return;
        progress.compile = compile;
      },
      startedRunning() {
        if (finished) return;
        progress.progressType = SubmissionProgressType.Running;
        progress.testcaseResult = {};
        progress.subtasks = [...new Array(problemTypeHandler.getSubtaskCount(judgeInfo)).keys()].map(subtaskIndex => ({
          score: null,
          testcases: [...new Array(problemTypeHandler.getTestcaseCountOfSubtask(judgeInfo, subtaskIndex)).keys()].map(
            () => ({
              waiting: true
            })
          )
        }));
        task.reportProgressRaw(progress);
      },
      testcaseRunning(subtaskIndex: number, testcaseIndex: number) {
        if (finished) return;
        delete progress.subtasks[subtaskIndex].testcases[testcaseIndex].waiting;
        progress.subtasks[subtaskIndex].testcases[testcaseIndex].running = true;
        task.reportProgressRaw(progress);
      },
      testcaseFinished(subtaskIndex: number, testcaseIndex: number, result: unknown) {
        if (finished) return;
        delete progress.subtasks[subtaskIndex].testcases[testcaseIndex].waiting;
        delete progress.subtasks[subtaskIndex].testcases[testcaseIndex].running;
        if (result) {
          // If not "Skipped"
          const testcaseHash = problemTypeHandler.hashTestcase(judgeInfo, subtaskIndex, testcaseIndex);
          progress.subtasks[subtaskIndex].testcases[testcaseIndex].testcaseHash = testcaseHash;
          progress.testcaseResult[testcaseHash] = result;
        }
        task.reportProgressRaw(progress);
      },
      subtaskScoreUpdated(subtaskIndex: number, newScore: number) {
        if (finished) return;
        progress.subtasks[subtaskIndex].score = newScore;
        task.reportProgressRaw(progress);
      },
      finished(status: SubmissionStatus, score: number) {
        if (finished) return;
        finished = true;
        progress.progressType = SubmissionProgressType.Finished;
        progress.status = status;
        progress.score = score;
        task.reportProgressRaw(progress);
      }
    };

    await problemTypeHandlers[task.extraInfo.problemType].runTask(task);
  } catch (e) {
    const isConfigurationError = e instanceof ConfigurationError;
    task.reportProgressRaw({
      progressType: SubmissionProgressType.Finished,
      status: isConfigurationError ? SubmissionStatus.ConfigurationError : SubmissionStatus.SystemError,
      systemMessage: e.message
    });
    winston.error(`${isConfigurationError ? "ConfigurationError" : "Error"} on submission ${task.id}, ${e.stack}`);
  }
}
