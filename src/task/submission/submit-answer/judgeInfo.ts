import objectHash from "object-hash";

import { SubmissionTask, ProblemSample } from "@/task/submission";

import { Checker } from "@/checkers";

import { SubmissionContentSubmitAnswer, TestcaseResultSubmitAnswer } from ".";
import { validateJudgeInfoSubtasks } from "../common";

export interface TestcaseConfig {
  // Input files are optional for judging
  inputFile?: string;
  outputFile: string;

  // By default, user's output filename is equal to output filename
  userOutputFilename?: string;

  // The weight of this testcase in the subtask,
  // which should add up to 100 for all testcases of this subtask
  // Auto if not set
  points?: number;
}

export interface JudgeInfoSubmitAnswer {
  /*
   * There could be multiple subtasks in a problem
   * Each subtask contains some testcases
   */
  subtasks: {
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

  checker: Checker;
}

/* eslint-disable no-throw-literal */
export async function validateJudgeInfo(
  task: SubmissionTask<JudgeInfoSubmitAnswer, SubmissionContentSubmitAnswer, TestcaseResultSubmitAnswer>
): Promise<void> {
  const { judgeInfo, testData } = task.extraInfo;

  validateJudgeInfoSubtasks(judgeInfo, testData, "optional", true);

  if (judgeInfo.checker.type === "custom" && !(judgeInfo.checker.filename in testData))
    throw `Custom checker ${judgeInfo.checker.filename} doesn't exist.`;
}
/* eslint-enable no-throw-literal */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hashSampleTestcase(judgeInfo: JudgeInfoSubmitAnswer, sample: ProblemSample): never {
  throw new Error("Submit answer submissions should not run samples.");
}

export function hashTestcase(judgeInfo: JudgeInfoSubmitAnswer, subtaskIndex: number, testcaseIndex: number) {
  const testcase = judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex];

  return objectHash({
    inputFile: testcase.inputFile,
    outputFile: testcase.outputFile,
    userOutputFilename: testcase.userOutputFilename || testcase.outputFile
  });
}
