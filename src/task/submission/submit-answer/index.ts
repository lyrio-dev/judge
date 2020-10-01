import fs from "fs";

import { v4 as uuid } from "uuid";

import { SubmissionTask, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import config from "@/config";
import { safelyJoinPath, readFileOmitted } from "@/utils";
import { getFile } from "@/file";
import { ConfigurationError } from "@/error";
import { runBuiltinChecker } from "@/checkers/builtin";
import { runCustomChecker, validateCustomChecker } from "@/checkers/custom";
import * as fsNative from "@/fsNative";

import { JudgeInfoSubmitAnswer, TestcaseConfig } from "./judgeInfo";

import { runCommonTask } from "../common";
import { SubmissionFileUnzipResult } from "../submissionFile";

export * from "./judgeInfo";

// For subtasks and testcasese
export enum TestcaseStatusSubmitAnswer {
  FileError = "FileError",
  OutputLimitExceeded = "OutputLimitExceeded",

  PartiallyCorrect = "PartiallyCorrect",
  WrongAnswer = "WrongAnswer",
  Accepted = "Accepted",

  JudgementFailed = "JudgementFailed"
}

export interface TestcaseResultSubmitAnswer {
  testcaseInfo: {
    inputFile: string;
    outputFile: string;
    userOutputFilename: string;
  };
  status: TestcaseStatusSubmitAnswer;
  score: number;
  input?: string;
  output?: string;
  userOutput?: string;
  userOutputLength?: number;
  checkerMessage?: string;
  systemMessage?: string;
}

export interface SubmissionContentSubmitAnswer {}

export type ExtraParametersSubmitAnswer = [SubmissionFileUnzipResult, CompileResultSuccess];

/**
 * Run a subtask testcase or sample testcase.
 *
 * @param sampleId If not null, it's a sample testcase.
 * @param subtaskIndex If not null, it's a subtask testcase.
 */
async function runTestcase(
  task: SubmissionTask<
    JudgeInfoSubmitAnswer,
    SubmissionContentSubmitAnswer,
    TestcaseResultSubmitAnswer,
    ExtraParametersSubmitAnswer
  >,
  judgeInfo: JudgeInfoSubmitAnswer,
  sampleId: number,
  sample: ProblemSample,
  subtaskIndex: number,
  testcaseIndex: number,
  testcase: TestcaseConfig,
  extraParameters: ExtraParametersSubmitAnswer,
  taskWorkingDirectory: string
): Promise<TestcaseResultSubmitAnswer> {
  const [unzipResult, customCheckerCompileResult] = extraParameters;

  const userOutputFilename = testcase.userOutputFilename || testcase.outputFile;

  const result: TestcaseResultSubmitAnswer = {
    testcaseInfo: {
      inputFile: testcase.inputFile,
      outputFile: testcase.outputFile,
      userOutputFilename
    },
    status: null,
    score: 0
  };

  result.input =
    testcase.inputFile &&
    (await readFileOmitted(getFile(task.extraInfo.testData[testcase.inputFile]), config.limit.dataDisplay));
  result.output = await readFileOmitted(
    getFile(task.extraInfo.testData[testcase.outputFile]),
    config.limit.dataDisplay
  );

  const fileUnzipResult = unzipResult.status[userOutputFilename];
  if (fileUnzipResult && fileUnzipResult.sizeExceededLimit) {
    result.status = TestcaseStatusSubmitAnswer.OutputLimitExceeded;
  } else if (!fileUnzipResult?.success) {
    result.status = TestcaseStatusSubmitAnswer.FileError;
  } else {
    const workingDirectory = {
      outside: safelyJoinPath(taskWorkingDirectory, "working"),
      inside: SANDBOX_INSIDE_PATH_WORKING
    };

    const tempDirectory = safelyJoinPath(taskWorkingDirectory, "temp");

    await Promise.all([fsNative.ensureDir(workingDirectory.outside), fsNative.ensureDir(tempDirectory)]);

    const inputFile = safelyJoinPath(workingDirectory, uuid());
    if (testcase.inputFile)
      await fsNative.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);
    else await fs.promises.writeFile(inputFile.outside, "");

    const answerFile = safelyJoinPath(workingDirectory, uuid());
    await fsNative.copy(getFile(task.extraInfo.testData[testcase.outputFile]), answerFile.outside);

    const outputFile = safelyJoinPath(workingDirectory, uuid());
    await fsNative.copy(fileUnzipResult.path, outputFile.outside);

    result.userOutput = await readFileOmitted(outputFile.outside, config.limit.dataDisplayForSubmitAnswer);
    result.userOutputLength = (await fs.promises.stat(outputFile.outside)).size;

    const checkerResult =
      judgeInfo.checker.type === "custom"
        ? await runCustomChecker(
            task.taskId,
            judgeInfo.checker,
            judgeInfo.checker.timeLimit,
            judgeInfo.checker.memoryLimit,
            customCheckerCompileResult,
            inputFile,
            outputFile,
            answerFile,
            null,
            workingDirectory,
            tempDirectory
          )
        : await runBuiltinChecker(outputFile.outside, answerFile.outside, judgeInfo.checker);

    // Return string means checker error
    if (typeof checkerResult === "string") {
      result.status = TestcaseStatusSubmitAnswer.JudgementFailed;
      result.score = 0;
      result.systemMessage = checkerResult;
    } else {
      if (checkerResult.score == null) result.status = TestcaseStatusSubmitAnswer.JudgementFailed;
      result.checkerMessage = checkerResult.checkerMessage;
      result.score = checkerResult.score || 0;
    }

    if (result.status !== TestcaseStatusSubmitAnswer.JudgementFailed) {
      if (result.score === 100) {
        result.status = TestcaseStatusSubmitAnswer.Accepted;
      } else if (result.score === 0) {
        result.status = TestcaseStatusSubmitAnswer.WrongAnswer;
      } else {
        result.status = TestcaseStatusSubmitAnswer.PartiallyCorrect;
      }
    }
  }

  return result;
}

export async function runTask(
  task: SubmissionTask<
    JudgeInfoSubmitAnswer,
    SubmissionContentSubmitAnswer,
    TestcaseResultSubmitAnswer,
    ExtraParametersSubmitAnswer
  >
) {
  const { judgeInfo } = task.extraInfo;

  const wantedFiles = judgeInfo.subtasks
    .map(subtask => subtask.testcases.map(testcase => testcase.userOutputFilename || testcase.outputFile))
    .flat();
  let unzipResult: SubmissionFileUnzipResult;

  let customCheckerCompileResult: CompileResultSuccess;

  // Wait until
  // 1. The submission file is downloaded
  // 2. The custom check is compiled
  await Promise.all([
    (async () => {
      await task.file.waitForDownload();
      unzipResult = await task.file.unzip(wantedFiles);
      task.events.compiling(); // Show "Compiling" status after file is downloaded
    })(),
    (async () => {
      if (judgeInfo.checker.type === "custom") {
        validateCustomChecker(judgeInfo.checker);

        const compileResult = await compile({
          language: judgeInfo.checker.language,
          code: await fs.promises.readFile(getFile(task.extraInfo.testData[judgeInfo.checker.filename]), "utf-8"),
          compileAndRunOptions: judgeInfo.checker.compileAndRunOptions
        });

        if (!(compileResult instanceof CompileResultSuccess)) {
          throw new ConfigurationError(`Failed to compile custom checker:\n\n${compileResult.message}`);
        }

        customCheckerCompileResult = compileResult;
      }
    })()
  ]);

  try {
    await runCommonTask({
      task,
      extraParameters: [unzipResult, customCheckerCompileResult],
      onTestcase: runTestcase
    });
  } finally {
    if (customCheckerCompileResult) await customCheckerCompileResult.dereference();
  }
}
