import fs from "fs";

import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { runSandbox, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import getLanguage from "@/languages";
import config from "@/config";
import { safelyJoinPath, MappedPath } from "@/utils";
import {
  isOmittableString,
  OmittableString,
  prependOmittableString,
  readFileOmitted,
  stringToOmited
} from "@/omittableString";
import { getFile } from "@/file";
import { ConfigurationError } from "@/error";
import { runBuiltinChecker } from "@/checkers/builtin";
import { runCustomChecker, validateCustomChecker } from "@/checkers/custom";
import * as fsNative from "@/fsNative";

import { JudgeInfoTraditional, TestcaseConfig } from "./judgeInfo";

import { runCommonTask, getExtraSourceFiles } from "../common";

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
    inputFile: string;
    outputFile: string;
  };
  status: TestcaseStatusTraditional;
  score: number;
  time?: number;
  memory?: number;
  input?: OmittableString;
  output?: OmittableString;
  userOutput?: OmittableString;
  userError?: OmittableString;
  checkerMessage?: OmittableString;
  systemMessage?: OmittableString;
}

export interface SubmissionContentTraditional {
  language: string;
  code: string;
  compileAndRunOptions: unknown;
  skipSamples?: boolean;
}

export type ExtraParametersTraditional = [CompileResultSuccess, CompileResultSuccess];

/**
 * Run a subtask testcase or sample testcase.
 *
 * @param sampleId If not null, it's a sample testcase.
 * @param subtaskIndex If not null, it's a subtask testcase.
 */
async function runTestcase(
  task: SubmissionTask<
    JudgeInfoTraditional,
    SubmissionContentTraditional,
    TestcaseResultTraditional,
    ExtraParametersTraditional
  >,
  judgeInfo: JudgeInfoTraditional,
  sampleId: number,
  sample: ProblemSample,
  subtaskIndex: number,
  testcaseIndex: number,
  testcase: TestcaseConfig,
  extraParameters: ExtraParametersTraditional,
  taskWorkingDirectory: string
): Promise<TestcaseResultTraditional> {
  const [compileResult, customCheckerCompileResult] = extraParameters;

  const isSample = sampleId != null;

  const timeLimit = isSample ? judgeInfo.timeLimit : testcase.timeLimit;
  const memoryLimit = isSample ? judgeInfo.memoryLimit : testcase.memoryLimit;

  const result: TestcaseResultTraditional = {
    testcaseInfo: {
      timeLimit,
      memoryLimit,
      inputFile: isSample ? null : testcase.inputFile,
      outputFile: isSample ? null : testcase.outputFile
    },
    status: null,
    score: 0
  };

  const binaryDirectory: MappedPath = {
    outside: compileResult.binaryDirectory,
    inside: SANDBOX_INSIDE_PATH_BINARY
  };
  const workingDirectory = {
    outside: safelyJoinPath(taskWorkingDirectory, "working"),
    inside: SANDBOX_INSIDE_PATH_WORKING
  };

  const tempDirectoryOutside = safelyJoinPath(taskWorkingDirectory, "temp");

  await Promise.all([fsNative.ensureDirSync(workingDirectory.outside), fsNative.ensureDir(tempDirectoryOutside)]);

  const inputFile = safelyJoinPath(workingDirectory, judgeInfo.fileIo ? judgeInfo.fileIo.inputFilename : uuid());

  const writeInputFile = () => {
    if (isSample) return fs.promises.writeFile(inputFile.outside, sample.inputData);
    else return fsNative.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);
  };
  await writeInputFile();

  const outputFile = safelyJoinPath(workingDirectory, judgeInfo.fileIo ? judgeInfo.fileIo.outputFilename : uuid());
  const stderrFile = safelyJoinPath(workingDirectory, uuid());

  const languageConfig = getLanguage(task.extraInfo.submissionContent.language);
  const sandboxResult = await runSandbox(task.taskId, {
    ...languageConfig.run({
      binaryDirectoryInside: binaryDirectory.inside,
      workingDirectoryInside: workingDirectory.inside,
      compileAndRunOptions: task.extraInfo.submissionContent.compileAndRunOptions,
      time: timeLimit,
      memory: memoryLimit,
      stdinFile: judgeInfo.fileIo ? null : inputFile.inside,
      stdoutFile: judgeInfo.fileIo ? null : outputFile.inside,
      stderrFile: stderrFile.inside,
      parameters: [],
      compileResultExtraInfo: compileResult.extraInfo
    }),
    time: timeLimit,
    memory: memoryLimit * 1024 * 1024,
    workingDirectory: workingDirectory.inside,
    tempDirectoryOutside,
    extraMounts: [
      {
        mappedPath: binaryDirectory,
        readOnly: true
      },
      {
        mappedPath: workingDirectory,
        readOnly: false
      }
    ]
  });

  const workingDirectorySize = await fsNative.calcSize(workingDirectory.outside);
  const inputFileSize = await fsNative.calcSize(inputFile.outside);
  if (workingDirectorySize - inputFileSize > config.limit.outputSize) {
    result.status = TestcaseStatusTraditional.OutputLimitExceeded;
  } else if (sandboxResult.status === SandboxStatus.TimeLimitExceeded) {
    result.status = TestcaseStatusTraditional.TimeLimitExceeded;
  } else if (sandboxResult.status === SandboxStatus.MemoryLimitExceeded) {
    result.status = TestcaseStatusTraditional.MemoryLimitExceeded;
  } else if (sandboxResult.status === SandboxStatus.RuntimeError) {
    result.status = TestcaseStatusTraditional.RuntimeError;
    result.systemMessage = `Exit code: ${sandboxResult.code}`;
  } else if (sandboxResult.status !== SandboxStatus.OK) {
    throw new Error(`Corrupt sandbox result: ${JSON.stringify(sandboxResult)}`);
  } else if (!(await fsNative.exists(outputFile.outside))) {
    result.status = TestcaseStatusTraditional.FileError;
  }

  result.input = isSample
    ? stringToOmited(sample.inputData, config.limit.dataDisplay)
    : await readFileOmitted(getFile(task.extraInfo.testData[testcase.inputFile]), config.limit.dataDisplay);
  result.output = isSample
    ? stringToOmited(sample.outputData, config.limit.dataDisplay)
    : await readFileOmitted(getFile(task.extraInfo.testData[testcase.outputFile]), config.limit.dataDisplay);
  result.userOutput = await readFileOmitted(outputFile.outside, config.limit.dataDisplay);
  result.userError = await readFileOmitted(stderrFile.outside, config.limit.stderrDisplay);
  result.time = sandboxResult.time / 1e6;
  result.memory = sandboxResult.memory / 1024;

  // Finished running user's program, now run checker
  if (!result.status) {
    // The input file may be modified by user's program
    await writeInputFile();

    const answerFile = safelyJoinPath(workingDirectory, uuid());

    if (isSample) await fs.promises.writeFile(answerFile.outside, sample.outputData);
    else await fsNative.copy(getFile(task.extraInfo.testData[testcase.outputFile]), answerFile.outside);

    const checkerResult =
      judgeInfo.checker.type === "custom"
        ? await runCustomChecker(
            task.taskId,
            judgeInfo.checker,
            judgeInfo.checker.timeLimit || judgeInfo.timeLimit,
            judgeInfo.checker.memoryLimit || judgeInfo.memoryLimit,
            customCheckerCompileResult,
            inputFile,
            outputFile,
            answerFile,
            task.extraInfo.submissionContent.code,
            workingDirectory,
            tempDirectoryOutside
          )
        : await runBuiltinChecker(outputFile.outside, answerFile.outside, judgeInfo.checker);

    // Return string means checker error
    if (isOmittableString(checkerResult)) {
      result.status = TestcaseStatusTraditional.JudgementFailed;
      result.score = 0;
      result.systemMessage = checkerResult;
    } else {
      if (checkerResult.score == null) result.status = TestcaseStatusTraditional.JudgementFailed;
      result.checkerMessage = checkerResult.checkerMessage;
      result.score = checkerResult.score || 0;
    }

    if (result.status !== TestcaseStatusTraditional.JudgementFailed) {
      if (result.score === 100) {
        result.status = TestcaseStatusTraditional.Accepted;
      } else if (result.score === 0) {
        result.status = TestcaseStatusTraditional.WrongAnswer;
      } else {
        result.status = TestcaseStatusTraditional.PartiallyCorrect;
      }
    }
  } else result.score = 0;

  return result;
}

export async function runTask(
  task: SubmissionTask<
    JudgeInfoTraditional,
    SubmissionContentTraditional,
    TestcaseResultTraditional,
    ExtraParametersTraditional
  >
) {
  const { judgeInfo } = task.extraInfo;

  task.events.compiling();

  let customCheckerCompileResult: CompileResultSuccess;
  if (judgeInfo.checker.type === "custom") {
    validateCustomChecker(judgeInfo.checker);

    const compileResult = await compile({
      language: judgeInfo.checker.language,
      code: await fs.promises.readFile(getFile(task.extraInfo.testData[judgeInfo.checker.filename]), "utf-8"),
      compileAndRunOptions: judgeInfo.checker.compileAndRunOptions
    });

    if (!(compileResult instanceof CompileResultSuccess)) {
      throw new ConfigurationError(
        prependOmittableString("Failed to compile custom checker:\n\n", compileResult.message, true)
      );
    }

    customCheckerCompileResult = compileResult;
  }

  const compileResult = await compile({
    language: task.extraInfo.submissionContent.language,
    code: task.extraInfo.submissionContent.code,
    compileAndRunOptions: task.extraInfo.submissionContent.compileAndRunOptions,
    extraSourceFiles: getExtraSourceFiles(judgeInfo, task.extraInfo.testData, task.extraInfo.submissionContent.language)
  });

  task.events.compiled({
    success: compileResult.success,
    message: compileResult.message
  });

  if (!(compileResult instanceof CompileResultSuccess)) {
    task.events.finished(SubmissionStatus.CompilationError, 0);
    if (customCheckerCompileResult) await customCheckerCompileResult.dereference();
    return;
  }

  try {
    await runCommonTask({
      task,
      extraParameters: [compileResult, customCheckerCompileResult],
      onTestcase: runTestcase
    });
  } finally {
    await compileResult.dereference();
    if (customCheckerCompileResult) await customCheckerCompileResult.dereference();
  }
}
