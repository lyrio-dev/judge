import objectHash = require("object-hash");
import toposort = require("toposort");
import validFilename = require("valid-filename");

import { SubmissionTask, ProblemSample } from "@/task/submission";
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

export async function validateTestcases(
  task: SubmissionTask<JudgeInfoTraditional, SubmissionContentTraditional, TestcaseResultTraditional>
): Promise<void> {
  const { judgeInfo, testData } = task.extraInfo;
  if (judgeInfo.subtasks.length === 0) throw "No testcases.";
  judgeInfo.subtasks.forEach((subtask, i) =>
    subtask.testcases.forEach(({ inputFilename, outputFilename }, j) => {
      if (!(inputFilename in testData))
        throw `Input file ${inputFilename} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
      if (!(outputFilename in testData))
        throw `Output file ${outputFilename} referenced by subtask ${i + 1}'s testcase ${j + 1} doesn't exist.`;
    })
  );
}

export function getSubtaskCount(judgeInfo: JudgeInfoTraditional) {
  return judgeInfo.subtasks.length;
}

export function getTestcaseCountOfSubtask(judgeInfo: JudgeInfoTraditional, subtaskIndex: number) {
  return judgeInfo.subtasks[subtaskIndex].testcases.length;
}

export function hashSampleTestcase(judgeInfo: JudgeInfoTraditional, sample: ProblemSample) {
  return objectHash({
    inputData: sample.inputData,
    outputData: sample.outputData,
    timeLimit: judgeInfo.timeLimit,
    memoryLimit: judgeInfo.memoryLimit
  });
}

export function hashTestcase(judgeInfo: JudgeInfoTraditional, subtaskIndex: number, testcaseIndex: number) {
  return objectHash({
    inputFilename: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].inputFilename,
    outputFilename: judgeInfo.subtasks[subtaskIndex].testcases[testcaseIndex].outputFilename,
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
