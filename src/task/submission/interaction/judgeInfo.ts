import objectHash = require("object-hash");

import { SubmissionTask, ProblemSample } from "@/task/submission";
import { SubmissionContentInteraction, TestcaseResultInteraction } from ".";
import { validateJudgeInfoSubtasks, validateJudgeInfoExtraSourceFiles } from "../common";

export interface TestcaseConfig {
  inputFile?: string;

  // If one of these is null,
  // the one's default of the subtask if exists, or of problem is used
  timeLimit?: number;
  memoryLimit?: number;

  // The weight of this testcase in the subtask,
  // which should add up to 100 for all testcases of this subtask
  // Auto if not set
  points?: number;
}

export interface JudgeInfoInteraction {
  /*
   * The default time / memory limit
   * One is ignored in a subtask if the it defined its own default
   */
  timeLimit?: number;
  memoryLimit?: number;

  /*
   * If ture, samples in statement will be run before all subtasks
   * If a submission failed on samples, all subtasks will be skipped
   */
  runSamples?: boolean;

  /*
   * There could be multiple subtasks in a problem
   * Each subtask contains some testcases
   */
  subtasks: {
    /*
     * The default time / memory limit
     * One is ignored in a testcase if the it defined its own default
     */
    timeLimit?: number;
    memoryLimit?: number;

    testcases: TestcaseConfig[];

    // Refer to https://cms.readthedocs.io/en/v1.4/Task%20types.html
    scoringType: "Sum" | "GroupMin" | "GroupMul";

    // The weight of this subtask in the problem,
    // which should add up to 100 for all subtasks of this problem
    // Auto if not set
    points?: number;

    // The IDs of subtasks this subtask depends
    // A subtask will be skipped if one of it dependencies fails
    dependencies?: number[];
  }[];

  interactor: {
    interface: "stdio" | "shm";
    sharedMemorySize?: number;
    language: string;
    languageOptions: unknown;
    filename: string;
  };

  // The map of files to be copied to the source code directory when compileing for each code language
  extraSourceFiles?: Partial<Record<string, Record<string, string>>>;
}

export async function validateJudgeInfo(
  task: SubmissionTask<JudgeInfoInteraction, SubmissionContentInteraction, TestcaseResultInteraction>
): Promise<void> {
  const { judgeInfo, testData } = task.extraInfo;

  validateJudgeInfoSubtasks(judgeInfo, testData, false);

  if (!judgeInfo.interactor) throw `Interactor not configured.`;
  if (!(judgeInfo.interactor.filename in testData)) throw `Interactor ${judgeInfo.interactor.filename} doesn't exist.`;

  validateJudgeInfoExtraSourceFiles(judgeInfo, testData);
}

export function hashSampleTestcase(judgeInfo: JudgeInfoInteraction, sample: ProblemSample) {
  return objectHash({
    inputData: sample.inputData,
    timeLimit: judgeInfo.timeLimit,
    memoryLimit: judgeInfo.memoryLimit
  });
}

export function hashTestcase(judgeInfo: JudgeInfoInteraction, subtaskIndex: number, testcaseIndex: number) {
  return objectHash({
    inputFile: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].inputFile,
    timeLimit:
      judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].timeLimit ||
      judgeInfo.subtasks[subtaskIndex].timeLimit ||
      judgeInfo.timeLimit,
    memoryLimit:
      judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].memoryLimit ||
      judgeInfo.subtasks[subtaskIndex].memoryLimit ||
      judgeInfo.memoryLimit
  });
}
