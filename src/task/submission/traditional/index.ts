import toposort = require("toposort");
import { join } from "path";
import fs = require("fs-extra");
import uuid = require("uuid/v4");
import du = require("du");
import winston = require("winston");
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { JudgeInfoTraditional, TestcaseConfig } from "./judgeInfo";
import { runTaskQueued } from "@/taskQueue";
import { runSandbox } from "@/sandbox";
import getLanguage from "@/languages";
import config from "@/config";
import { readFileOmitted, stringToOmited } from "@/utils";
import { getFile } from "@/file";

export * from "./judgeInfo";

// For subtasks and testcasese
export enum TestcaseStatusTraditional {
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

export interface TestcaseResultTraditional {
  testcaseInfo: {
    timeLimit: number;
    memoryLimit: number;
    inputFilename: string;
    outputFilename: string;
  };
  status: TestcaseStatusTraditional;
  score: number;
  time?: number;
  memory?: number;
  input?: string;
  output?: string;
  userOutput?: string;
  userError?: string;
  graderMessage?: string;
  systemMessage?: string;
}

export interface SubmissionContentTraditional {
  language: string;
  code: string;
  languageOptions: unknown;
  skipSamples?: boolean;
}

function getSubtaskOrder(judgeInfo: JudgeInfoTraditional) {
  return toposort.array(
    [...judgeInfo.subtasks.keys()],
    judgeInfo.subtasks.reduce<[number, number][]>(
      (edges, subtask, i) => edges.concat((subtask.dependencies || []).map(dependency => [dependency, i])),
      []
    )
  );
}

const SANDBOX_INSIDE_PATH_BINARY = "/sandbox/binary";
const SANDBOX_INSIDE_PATH_WORKING = "/sandbox/working";

/**
 * Run a subtask testcase or sample testcase.
 *
 * @param sampleId If not null, it's a sample testcase.
 * @param subtaskIndex If not null, it's a subtask testcase.
 */
async function runTestcase(
  task: SubmissionTask<JudgeInfoTraditional, SubmissionContentTraditional, TestcaseResultTraditional>,
  judgeInfo: JudgeInfoTraditional,
  sampleId: number,
  sample: ProblemSample,
  subtaskIndex: number,
  testcaseIndex: number,
  testcase: TestcaseConfig,
  compileResult: CompileResultSuccess
): Promise<TestcaseResultTraditional> {
  return await runTaskQueued(async (taskWorkingDirectory: string) => {
    const isSample = sampleId != null;

    const timeLimit = isSample ? judgeInfo.timeLimit : testcase.timeLimit;
    const memoryLimit = isSample ? judgeInfo.memoryLimit : testcase.memoryLimit;

    if (isSample) {
      winston.verbose(`Running sample testcase ${sampleId}`);
      task.reportProgress.sampleTestcaseRunning(sampleId);
    } else {
      winston.verbose(`Running testcase ${subtaskIndex}.${testcaseIndex}`);
      task.reportProgress.testcaseRunning(subtaskIndex, testcaseIndex);
    }

    const result: TestcaseResultTraditional = {
      testcaseInfo: {
        timeLimit: timeLimit,
        memoryLimit: memoryLimit,
        inputFilename: isSample ? null : testcase.inputFilename,
        outputFilename: isSample ? null : testcase.outputFilename
      },
      status: null,
      score: 0
    };

    const binaryDirectory = compileResult.binaryDirectory;
    const workingDirectory = join(taskWorkingDirectory, "working");
    const tempDirectory = join(taskWorkingDirectory, "temp");

    await Promise.all([fs.ensureDir(workingDirectory), fs.ensureDir(tempDirectory)]);

    const binaryDirectoryInside = SANDBOX_INSIDE_PATH_BINARY;
    const workingDirectoryInside = SANDBOX_INSIDE_PATH_WORKING;

    const inputFilename = judgeInfo.fileIo ? judgeInfo.fileIo.inputFilename : uuid();
    const inputFilePath = join(workingDirectory, inputFilename);
    const inputFilePathInside = join(workingDirectoryInside, inputFilename);

    if (isSample) await fs.writeFile(inputFilePath, sample.inputData);
    else await fs.copy(getFile(task.extraInfo.testData[testcase.inputFilename]), inputFilePath);

    const outputFilename = judgeInfo.fileIo ? judgeInfo.fileIo.outputFilename : uuid();
    const outputFilePath = join(workingDirectory, outputFilename);
    const outputFilePathInside = join(workingDirectoryInside, outputFilename);

    const stderrFilename = uuid();
    const stderrFilePath = join(workingDirectory, stderrFilename);
    const stderrFilePathInside = join(workingDirectoryInside, stderrFilename);

    const languageConfig = getLanguage(task.extraInfo.submissionContent.language);
    const sandboxResult = await runSandbox(
      task.taskId,
      {
        ...languageConfig.run(
          binaryDirectoryInside,
          workingDirectoryInside,
          task.extraInfo.submissionContent.languageOptions,
          timeLimit,
          memoryLimit,
          judgeInfo.fileIo ? null : inputFilePathInside,
          judgeInfo.fileIo ? null : outputFilePathInside,
          stderrFilePathInside
        ),
        time: timeLimit,
        memory: memoryLimit * 1024 * 1024,
        workingDirectory: workingDirectoryInside
      },
      tempDirectory,
      [
        {
          outsidePath: binaryDirectory,
          insidePath: binaryDirectoryInside,
          readOnly: true
        },
        {
          outsidePath: workingDirectory,
          insidePath: workingDirectoryInside,
          readOnly: false
        }
      ]
    );

    const workingDirectorySize = await du(workingDirectory);
    const inputFileSize = await du(inputFilePath);
    if (workingDirectorySize - inputFileSize > config.limit.outputSize) {
      result.status = TestcaseStatusTraditional.OutputLimitExceeded;
    } else if (sandboxResult.status === SandboxStatus.TimeLimitExceeded) {
      result.status = TestcaseStatusTraditional.TimeLimitExceeded;
    } else if (sandboxResult.status === SandboxStatus.MemoryLimitExceeded) {
      result.status = TestcaseStatusTraditional.MemoryLimitExceeded;
    } else if (sandboxResult.status === SandboxStatus.RuntimeError) {
      result.status = TestcaseStatusTraditional.RuntimeError;
      result.systemMessage = "Exit code: " + sandboxResult.code;
    } else if (sandboxResult.status !== SandboxStatus.OK) {
      throw new Error("Corrupt sandbox result: " + JSON.stringify(sandboxResult));
    } else if (!(await fs.pathExists(outputFilePath))) {
      result.status = TestcaseStatusTraditional.FileError;
    }

    result.input = isSample
      ? stringToOmited(sample.inputData, config.limit.dataDisplay)
      : await readFileOmitted(getFile(task.extraInfo.testData[testcase.inputFilename]), config.limit.dataDisplay);
    result.output = isSample
      ? stringToOmited(sample.outputData, config.limit.dataDisplay)
      : await readFileOmitted(getFile(task.extraInfo.testData[testcase.outputFilename]), config.limit.dataDisplay);
    result.userOutput = await readFileOmitted(outputFilePath, config.limit.dataDisplay);
    result.userError = await readFileOmitted(stderrFilePath, config.limit.stderrDisplay);
    result.time = sandboxResult.time / 1e6;
    result.memory = sandboxResult.memory / 1024;

    // Finished running, now grade
    if (!result.status) {
      const answerFilename = uuid();
      const answerFilePath = join(workingDirectory, answerFilename);
      const answerFilePathInside = join(workingDirectoryInside, answerFilename);

      if (isSample) await fs.writeFile(answerFilePath, sample.outputData);
      else await fs.copy(getFile(task.extraInfo.testData[testcase.outputFilename]), answerFilePath);

      // const graderOutputFilename = uuid();
      // const graderOutputFilePath = join(workingDirectory, graderOutputFilename);
      // const graderOutputFilePathInside = join(workingDirectoryInside, graderOutputFilename);

      // TODO: custom grader
      const graderSandboxResult = await runSandbox(
        task.taskId,
        {
          executable: "/usr/bin/diff",
          time: 5000,
          memory: 1024 * 1024 * 1024,
          parameters: ["-Bbq", outputFilePathInside, answerFilePathInside],
          process: 1,
          // stdout: graderOutputFilePathInside,
          workingDirectory: workingDirectoryInside
        },
        tempDirectory,
        [
          {
            outsidePath: workingDirectory,
            insidePath: workingDirectoryInside,
            readOnly: false
          }
        ]
      );
      if (graderSandboxResult.status !== SandboxStatus.OK) {
        result.status = TestcaseStatusTraditional.JudgementFailed;
        result.systemMessage = `Grader encountered a ${SandboxStatus[graderSandboxResult.status]}`;
      } else if (graderSandboxResult.code === 0) {
        result.status = TestcaseStatusTraditional.Accepted;
        result.score = 100;
      } else {
        result.status = TestcaseStatusTraditional.WrongAnswer;
      }
    }

    if (isSample) {
      task.reportProgress.sampleTestcaseFinished(sampleId, sample, result);
      winston.verbose(`Finished testcase ${subtaskIndex}.${testcaseIndex}: ${JSON.stringify(result)}`);
    } else {
      task.reportProgress.testcaseFinished(subtaskIndex, testcaseIndex, result);
      winston.verbose(`Finished sample testcase ${sampleId}: ${JSON.stringify(result)}`);
    }

    return result;
  });
}

export async function runTask(
  task: SubmissionTask<JudgeInfoTraditional, SubmissionContentTraditional, TestcaseResultTraditional>
) {
  task.reportProgress.compiling();

  const compileResult = await compile({
    language: task.extraInfo.submissionContent.language,
    code: task.extraInfo.submissionContent.code,
    languageOptions: task.extraInfo.submissionContent.languageOptions
  });

  task.reportProgress.compiled({
    success: compileResult.success,
    message: compileResult.message
  });

  if (!(compileResult instanceof CompileResultSuccess)) {
    task.reportProgress.finished(SubmissionStatus.CompilationError, 0);
    return;
  }

  try {
    const judgeInfo = task.extraInfo.judgeInfo;
    const samples = task.extraInfo.samples;

    const sumSpecfiedPercentagePointsForSubtasks = judgeInfo.subtasks
      .map(testcase => testcase.percentagePoints)
      .filter(x => x != null)
      .reduce((s, x) => s + x, 0);
    const countUnspecfiedPercentagePointsForSubtasks = judgeInfo.subtasks.filter(
      testcase => testcase.percentagePoints == null
    ).length;
    const defaultPercentagePointsForSubtasks =
      (100 - sumSpecfiedPercentagePointsForSubtasks) / countUnspecfiedPercentagePointsForSubtasks;

    const subtaskFullScores = judgeInfo.subtasks.map(subtask =>
      subtask.percentagePoints != null ? subtask.percentagePoints : defaultPercentagePointsForSubtasks
    );

    const runSamples = judgeInfo.runSamples && samples && !task.extraInfo.submissionContent.skipSamples ? true : false;
    task.reportProgress.startedRunning(runSamples && samples.length, subtaskFullScores);

    let firstNonAcceptedStatus: TestcaseStatusTraditional = null;

    // Run samples first
    let samplesFailed = false;
    if (runSamples) {
      for (const i in samples) {
        if (samplesFailed) {
          task.reportProgress.sampleTestcaseFinished(Number(i), samples[i], null);
          continue;
        }

        const result = await runTestcase(task, judgeInfo, Number(i), samples[i], null, null, null, compileResult);
        if (result.status !== TestcaseStatusTraditional.Accepted) {
          samplesFailed = true;
          firstNonAcceptedStatus = result.status;
        }
      }
    }

    const subtaskOrder = getSubtaskOrder(judgeInfo);
    const subtaskScores: number[] = new Array(subtaskOrder.length);
    let totalScore = 0;
    for (const subtaskIndex of subtaskOrder) {
      const subtask = judgeInfo.subtasks[subtaskIndex];

      // If samples failed, skip all subtasks
      // If any of a subtask's dependencies failed, skip it
      if (
        samplesFailed ||
        (Array.isArray(subtask.dependencies) && subtask.dependencies.some(i => Math.round(subtaskScores[i]) === 0))
      ) {
        // Skip
        task.reportProgress.subtaskScoreUpdated(subtaskIndex, 0);
        for (const i in subtask.testcases) {
          task.reportProgress.testcaseFinished(subtaskIndex, Number(i), null);
        }
        continue;
      }

      const sumSpecfiedPercentagePointsForTestcases = subtask.testcases
        .map(testcase => testcase.percentagePoints)
        .filter(x => x != null)
        .reduce((s, x) => s + x, 0);
      const countUnspecfiedPercentagePointsForTestcases = subtask.testcases.filter(
        testcase => testcase.percentagePoints == null
      ).length;
      const defaultPercentagePointsForTestcases =
        (100 - sumSpecfiedPercentagePointsForTestcases) / countUnspecfiedPercentagePointsForTestcases;

      const normalizedTestcases = subtask.testcases.map(testcase => ({
        ...testcase,
        percentagePoints:
          testcase.percentagePoints == null ? defaultPercentagePointsForTestcases : testcase.percentagePoints,
        timeLimit: testcase.timeLimit || subtask.timeLimit || judgeInfo.timeLimit,
        memoryLimit: testcase.memoryLimit || subtask.memoryLimit || judgeInfo.memoryLimit
      }));

      let subtaskScore = 0;
      if (subtask.scoringType !== "Sum") subtaskScore = 100;

      let results: TestcaseResultTraditional[];
      if (subtask.scoringType === "Sum") {
        results = await Promise.all(
          normalizedTestcases.map(async (testcase, i) => {
            const result = await runTestcase(
              task,
              judgeInfo,
              null,
              null,
              subtaskIndex,
              Number(i),
              testcase,
              compileResult
            );
            subtaskScore += (result.score * normalizedTestcases[i].percentagePoints) / 100;
            task.reportProgress.subtaskScoreUpdated(subtaskIndex, subtaskScore);
            return result;
          })
        );
      } else {
        results = [];
        for (const i in normalizedTestcases) {
          const testcase = normalizedTestcases[i];

          if (Math.round(subtaskScore) === 0) {
            task.reportProgress.testcaseFinished(subtaskIndex, Number(i), null);
          } else {
            const result = await runTestcase(
              task,
              judgeInfo,
              null,
              null,
              subtaskIndex,
              Number(i),
              testcase,
              compileResult
            );
            if (subtask.scoringType === "GroupMin") subtaskScore = Math.min(subtaskScore, result.score);
            else subtaskScore = (subtaskScore * result.score) / 100;
            task.reportProgress.subtaskScoreUpdated(subtaskIndex, subtaskScore);
            results.push(result);
          }
        }
      }

      if (firstNonAcceptedStatus === null) {
        for (const result of results) {
          if (result.status != TestcaseStatusTraditional.Accepted) {
            firstNonAcceptedStatus = result.status;
            break;
          }
        }
      }

      subtaskScores[subtaskIndex] = subtaskScore;
      totalScore += (subtaskScore * subtaskFullScores[subtaskIndex]) / 100;
    }

    const roundedScore = totalScore > 100 ? 100 : Math.round(totalScore);
    if (firstNonAcceptedStatus === null && roundedScore !== 100) {
      // This shouldn't happen
      throw new Error("Couldn't determine submission result status");
    } else if (firstNonAcceptedStatus === null) {
      task.reportProgress.finished(SubmissionStatus.Accepted, roundedScore);
    } else {
      task.reportProgress.finished((firstNonAcceptedStatus as unknown) as SubmissionStatus, roundedScore);
    }
  } finally {
    compileResult.dereference();
  }
}
