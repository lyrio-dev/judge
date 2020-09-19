import winston from "winston";

import { Task } from "@/task";
import { ensureFiles } from "@/file";
import { ConfigurationError, CanceledError } from "@/error";

import { SubmissionFile, SubmissionFileInfo } from "./submissionFile";

import * as Traditional from "./traditional";
import * as Interaction from "./interaction";
import * as SubmitAnswer from "./submit-answer";

enum ProblemType {
  TRADITIONAL = "TRADITIONAL",
  INTERACTION = "INTERACTION",
  SUBMIT_ANSWER = "SUBMIT_ANSWER"
}

export interface ProblemSample {
  inputData: string;
  outputData: string;
}

export interface SubmissionExtraInfo<JudgeInfo, SubmissionContent> {
  problemType: ProblemType;
  judgeInfo: JudgeInfo;
  samples?: ProblemSample[];
  testData: Record<string, string>; // filename -> uuid
  submissionContent: SubmissionContent;
  file?: SubmissionFileInfo;
}

export enum SubmissionProgressType {
  Preparing = "Preparing",
  Compiling = "Compiling",
  Running = "Running",
  Finished = "Finished"
}

export enum SubmissionStatus {
  Pending = "Pending",

  // eslint-disable-next-line no-shadow
  ConfigurationError = "ConfigurationError",
  SystemError = "SystemError",
  Canceled = "Canceled",

  CompilationError = "CompilationError",

  FileError = "FileError",
  RuntimeError = "RuntimeError",
  TimeLimitExceeded = "TimeLimitExceeded",
  MemoryLimitExceeded = "MemoryLimitExceeded",
  OutputLimitExceeded = "OutputLimitExceeded",

  PartiallyCorrect = "PartiallyCorrect",
  WrongAnswer = "WrongAnswer",
  Accepted = "Accepted",

  JudgementFailed = "JudgementFailed"
}

interface TestcaseProgressReference {
  // If !waiting && !running && !testcaseHash, it's "Skipped"
  waiting?: boolean;
  running?: boolean;
  testcaseHash?: string;
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

  // testcaseHash = hash(IF, OF, TL, ML) for traditional
  //                hash(ID, OD, TL, ML) for samples
  // ->
  // result
  testcaseResult?: Record<string, TestcaseResult>;
  samples?: TestcaseProgressReference[];
  subtasks?: {
    score: number;
    fullScore: number;
    testcases: TestcaseProgressReference[];
  }[];
}

export interface SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>
  extends Task<SubmissionExtraInfo<JudgeInfo, SubmissionContent>, SubmissionProgress<TestcaseResult>> {
  reportProgress: {
    compiling(): void;
    compiled(compile: { success: boolean; message: string }): void;
    startedRunning(samplesCount: number, subtaskFullScores: number[]): void;
    sampleTestcaseRunning(sampleId: number): void;
    sampleTestcaseFinished(sampleId: number, sample: ProblemSample, result: TestcaseResult): void;
    testcaseRunning(subtaskIndex: number, testcaseIndex: number): void;
    testcaseFinished(subtaskIndex: number, testcaseIndex: number, result: TestcaseResult): void;
    subtaskScoreUpdated(subtaskIndex: number, newScore: number): void;
    finished(status: SubmissionStatus, score: number): void;
  };

  // The file submitted by the user, will be automatically downloaded, only for some problem types.
  file?: SubmissionFile;
}

export interface SubmissionHandler<JudgeInfo, SubmissionContent, TestcaseResult> {
  validateJudgeInfo: (task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>) => Promise<void>;
  hashTestcase: (judgeInfo: JudgeInfo, subtaskIndex: number, testcaseIndex: number) => string;
  hashSampleTestcase: (judgeInfo: JudgeInfo, sample: ProblemSample) => string;

  runTask: (task: SubmissionTask<JudgeInfo, SubmissionContent, TestcaseResult>) => Promise<void>;
}

const problemTypeHandlers: Record<ProblemType, SubmissionHandler<unknown, unknown, unknown>> = {
  [ProblemType.TRADITIONAL]: Traditional,
  [ProblemType.INTERACTION]: Interaction,
  [ProblemType.SUBMIT_ANSWER]: SubmitAnswer
};

// Common problem types' judge info has a "subtasks" array below.
interface JudgeInfoCommon {
  subtasks?: {
    testcases?: unknown[];
  }[];
}

function getSubtaskCount(judgeInfo: JudgeInfoCommon) {
  if (judgeInfo.subtasks) return judgeInfo.subtasks.length;
  return 1; // Non-common type
}

function getTestcaseCountOfSubtask(judgeInfo: JudgeInfoCommon, subtaskIndex: number) {
  if (judgeInfo.subtasks) return judgeInfo.subtasks[subtaskIndex].testcases.length;
  return 1; // Non-common type
}

export default async function onSubmission(task: SubmissionTask<unknown, unknown, unknown>): Promise<void> {
  try {
    if (!(task.extraInfo.problemType in ProblemType)) {
      throw new ConfigurationError(`Unsupported problem type: ${task.extraInfo.problemType}`);
    }

    task.reportProgressRaw({
      progressType: SubmissionProgressType.Preparing
    });

    // Download testdata files
    const requiredFiles = Object.values(task.extraInfo.testData);
    await ensureFiles(requiredFiles);

    // Downlaod submission file
    if (task.extraInfo.file) {
      task.file = new SubmissionFile(task.extraInfo.file);
    }

    const problemTypeHandler = problemTypeHandlers[task.extraInfo.problemType];
    try {
      await problemTypeHandler.validateJudgeInfo(task);
    } catch (e) {
      if (typeof e === "string") throw new ConfigurationError(e);
      else throw e;
    }

    const { judgeInfo } = task.extraInfo;

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
      startedRunning(samplesCount: number, subtaskFullScores: number[]) {
        if (finished) return;
        progress.progressType = SubmissionProgressType.Running;
        progress.testcaseResult = {};
        if (samplesCount) {
          progress.samples = [...new Array(samplesCount)].map(() => ({
            waiting: true
          }));
        }
        progress.subtasks = [...new Array(getSubtaskCount(judgeInfo)).keys()].map(subtaskIndex => ({
          score: null,
          fullScore: subtaskFullScores[subtaskIndex],
          testcases: [...new Array(getTestcaseCountOfSubtask(judgeInfo, subtaskIndex)).keys()].map(() => ({
            waiting: true
          }))
        }));
        task.reportProgressRaw(progress);
      },
      sampleTestcaseRunning(sampleId: number) {
        if (finished) return;
        delete progress.samples[sampleId].waiting;
        progress.samples[sampleId].running = true;
        task.reportProgressRaw(progress);
      },
      sampleTestcaseFinished(sampleId: number, sample: ProblemSample, result: unknown) {
        if (finished) return;
        delete progress.samples[sampleId].waiting;
        delete progress.samples[sampleId].running;
        if (result) {
          // If not "Skipped"
          const testcaseHash = problemTypeHandler.hashSampleTestcase(judgeInfo, sample);
          progress.samples[sampleId].testcaseHash = testcaseHash;
          progress.testcaseResult[testcaseHash] = result;
        }
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
        progress.subtasks[subtaskIndex].score = (newScore * progress.subtasks[subtaskIndex].fullScore) / 100;
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
    const isCanceled = e instanceof CanceledError;
    if (isCanceled) {
      // A canceled submission doesn't need futher reports
      throw e;
    }

    const isConfigurationError = e instanceof ConfigurationError;
    task.reportProgressRaw({
      progressType: SubmissionProgressType.Finished,
      status: isConfigurationError ? SubmissionStatus.ConfigurationError : SubmissionStatus.SystemError,
      systemMessage: e.stack
    });
    if (!isConfigurationError) winston.error(`Error on submission task ${task.taskId}, ${e.stack}`);
  } finally {
    // Remove downloaded submission file
    if (task.file) task.file.dispose();
  }
}
