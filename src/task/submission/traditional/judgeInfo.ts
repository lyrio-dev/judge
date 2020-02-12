import objectHash = require("object-hash");
import toposort = require("toposort");
import validFilename = require("valid-filename");

import { SubmissionTask } from "@/task/submission";
import { SubmissionContentTraditional, TestcaseResultTraditional } from ".";

export interface TestcaseConfig {
  inputFilename?: string;
  outputFilename?: string;

  // If one of these is null,
  // the one's default of the subtask if exists, or of problem is used
  timeLimit?: number;
  memoryLimit?: number;

  // The weight of this testcase in the subtask,
  // which should add up to 100 for all testcases of this subtask
  // Auto if not set
  percentagePoints?: number;
}

export interface JudgeInfoTraditional {
  /*
   * The default time / memory limit
   * One is ignored in a subtask if the it defined its own default
   */
  timeLimit?: number;
  memoryLimit?: number;

  /*
   * Be null if not using file IO
   */
  fileIo?: {
    inputFilename: string;
    outputFilename: string;
  };

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
    percentagePoints?: number;

    // The IDs of subtasks this subtask depends
    // A subtask will be skipped if one of it dependencies fails
    dependencies?: number[];
  }[];
}

export async function validateJudgeInfo(
  task: SubmissionTask<JudgeInfoTraditional, SubmissionContentTraditional, TestcaseResultTraditional>
): Promise<void> {
  function validateLimit(limit: number) {
    if (!limit || (typeof limit === "number" && limit > 0)) return;
    throw `Invalid limit value: ${limit}`;
  }

  function validatePercentagePoints(percentagePoints: number) {
    if (!percentagePoints || (typeof percentagePoints === "number" && percentagePoints > 0 && percentagePoints <= 100))
      return;
    throw `Invalid percentage points: ${percentagePoints}`;
  }

  function validateIoFilename(filename: string) {
    if (validFilename(filename)) return;
    throw `Invalid filename: ${filename};`;
  }

  function validateFilename(filename: string) {
    if (filename in task.extraInfo.testData) return;
    throw `No such file in testdata: ${filename}`;
  }

  function validatePercentagePointsSum(objects: { percentagePoints?: number }[]) {
    const sum = objects.reduce(
      (s, object) =>
        typeof object.percentagePoints === "number" && object.percentagePoints > 0 ? s + object.percentagePoints : s,
      0
    );
    if (sum <= 100) return;
    throw `Sum of percentage points = ${sum}, which is > 100`;
  }

  const judgeInfo = task.extraInfo.judgeInfo;
  validateLimit(judgeInfo.timeLimit);
  validateLimit(judgeInfo.memoryLimit);
  if (judgeInfo.fileIo) {
    if (typeof judgeInfo.fileIo.inputFilename !== "string") throw "fileIo.inputFilename should be string";
    if (typeof judgeInfo.fileIo.outputFilename !== "string") throw "fileIo.outputFilename should be string";
    validateIoFilename(judgeInfo.fileIo.inputFilename);
    validateIoFilename(judgeInfo.fileIo.outputFilename);
  }
  if (!Array.isArray(judgeInfo.subtasks) || judgeInfo.subtasks.length === 0) throw "subtasks should be non-empty array";

  // [A, B] means B depends on A
  const edges: [number, number][] = [];
  for (const i in judgeInfo.subtasks) {
    const subtask = judgeInfo.subtasks[i];

    validateLimit(subtask.timeLimit);
    validateLimit(subtask.memoryLimit);
    if (!["Sum", "GroupMin", "GroupMul"].includes(subtask.scoringType)) {
      throw `subtask.scoringType should be one of 'Sum', 'GroupMin' or 'GroupMul'`;
    }
    validatePercentagePoints(subtask.percentagePoints);
    if (subtask.dependencies && !Array.isArray(subtask.dependencies)) throw `subtask.dependencies should be array`;
    if (Array.isArray(subtask.dependencies)) {
      for (const dependency of subtask.dependencies) {
        if (typeof dependency !== "number" || dependency < 0 || dependency >= judgeInfo.subtasks.length)
          throw `Invalid dependency index ${dependency} for subtask ${i}`;
        edges.push([dependency, Number(i)]);
      }
    }

    if (!Array.isArray(subtask.testcases) || subtask.testcases.length === 0)
      throw `subtask.testcases should be non-empty array`;

    for (const j in subtask.testcases) {
      const testcase = subtask.testcases[j];

      validateFilename(testcase.inputFilename);
      validateFilename(testcase.outputFilename);
      validateLimit(testcase.timeLimit);
      validateLimit(testcase.memoryLimit);
      validatePercentagePoints(testcase.percentagePoints);

      const realTimeLimit = testcase.timeLimit || subtask.timeLimit || judgeInfo.timeLimit;
      const realMemoryLimit = testcase.memoryLimit || subtask.memoryLimit || judgeInfo.memoryLimit;
      if (!realTimeLimit) throw `No time limit for testcase ${j} in subtask ${i}`;
      if (!realMemoryLimit) throw `No memory limit for testcase ${j} in subtask ${i}`;
    }
    validatePercentagePointsSum(subtask.testcases);
  }
  validatePercentagePointsSum(judgeInfo.subtasks);

  try {
    toposort.array(
      judgeInfo.subtasks.map((subtask, i) => i),
      edges
    );
  } catch (e) {
    throw `Cyclical subtask dependency`;
  }
}

export function getSubtaskCount(judgeInfo: JudgeInfoTraditional) {
  return judgeInfo.subtasks.length;
}

export function getTestcaseCountOfSubtask(judgeInfo: JudgeInfoTraditional, subtaskIndex: number) {
  return judgeInfo.subtasks[subtaskIndex].testcases.length;
}

export function hashTestcase(judgeInfo: JudgeInfoTraditional, subtaskIndex: number, testcaseIndex: number) {
  return objectHash({
    inputFilename: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].inputFilename,
    outputFilename: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].outputFilename,
    memoryLimit: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].memoryLimit || 0,
    timeLimit: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].timeLimit || 0
  });
}
