import fs from "fs-extra";

import { v4 as uuid } from "uuid";
import du from "du";
import winston from "winston";
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";

import { runTaskQueued } from "@/taskQueue";
import { runSandbox, joinPath, MappedPath, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import getLanguage from "@/languages";
import config from "@/config";
import { readFileOmitted, stringToOmited } from "@/utils";
import { getFile } from "@/file";
import { ConfigurationError } from "@/error";
import { runBuiltinChecker } from "@/checkers/builtin";
import { runCustomChecker, validateCustomChecker } from "@/checkers/custom";

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
  input?: string;
  output?: string;
  userOutput?: string;
  userError?: string;
  checkerMessage?: string;
  systemMessage?: string;
}

export interface SubmissionContentTraditional {
  language: string;
  code: string;
  languageOptions: unknown;
  skipSamples?: boolean;
}

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
  [compileResult, customCheckerCompileResult]: [CompileResultSuccess, CompileResultSuccess]
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
      outside: joinPath(taskWorkingDirectory, "working"),
      inside: SANDBOX_INSIDE_PATH_WORKING
    };

    const tempDirectory = joinPath(taskWorkingDirectory, "temp");

    await Promise.all([fs.ensureDir(workingDirectory.outside), fs.ensureDir(tempDirectory)]);

    const inputFile = joinPath(workingDirectory, judgeInfo.fileIo ? judgeInfo.fileIo.inputFilename : uuid());

    const writeInputFile = async () => {
      if (isSample) await fs.writeFile(inputFile.outside, sample.inputData);
      else await fs.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);
    };
    await writeInputFile();

    const outputFile = joinPath(workingDirectory, judgeInfo.fileIo ? judgeInfo.fileIo.outputFilename : uuid());
    const stderrFile = joinPath(workingDirectory, uuid());

    const languageConfig = getLanguage(task.extraInfo.submissionContent.language);
    const sandboxResult = await runSandbox({
      taskId: task.taskId,
      parameters: {
        ...languageConfig.run(
          binaryDirectory.inside,
          workingDirectory.inside,
          task.extraInfo.submissionContent.languageOptions,
          timeLimit,
          memoryLimit,
          judgeInfo.fileIo ? null : inputFile.inside,
          judgeInfo.fileIo ? null : outputFile.inside,
          stderrFile.inside
        ),
        time: timeLimit,
        memory: memoryLimit * 1024 * 1024,
        workingDirectory: workingDirectory.inside
      },
      tempDirectory,
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

    const workingDirectorySize = await du(workingDirectory.outside);
    const inputFileSize = await du(inputFile.outside);
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
    } else if (!(await fs.pathExists(outputFile.outside))) {
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

      const answerFile = joinPath(workingDirectory, uuid());

      if (isSample) await fs.writeFile(answerFile.outside, sample.outputData);
      else await fs.copy(getFile(task.extraInfo.testData[testcase.outputFile]), answerFile.outside);

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
              tempDirectory
            )
          : await runBuiltinChecker(outputFile.outside, answerFile.outside, judgeInfo.checker);

      // Return string means checker error
      if (typeof checkerResult === "string") {
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
  const { judgeInfo } = task.extraInfo;

  task.reportProgress.compiling();

  let customCheckerCompileResult: CompileResultSuccess;
  if (judgeInfo.checker.type === "custom") {
    validateCustomChecker(judgeInfo.checker);

    const compileResult = await compile({
      language: judgeInfo.checker.language,
      code: await fs.readFile(getFile(task.extraInfo.testData[judgeInfo.checker.filename]), "utf-8"),
      languageOptions: judgeInfo.checker.languageOptions
    });

    if (!(compileResult instanceof CompileResultSuccess)) {
      throw new ConfigurationError(`Failed to compile custom checker:\n\n${compileResult.message}`);
    }

    customCheckerCompileResult = compileResult;
  }

  const compileResult = await compile({
    language: task.extraInfo.submissionContent.language,
    code: task.extraInfo.submissionContent.code,
    languageOptions: task.extraInfo.submissionContent.languageOptions,
    extraSourceFiles: getExtraSourceFiles(judgeInfo, task.extraInfo.testData, task.extraInfo.submissionContent.language)
  });

  task.reportProgress.compiled({
    success: compileResult.success,
    message: compileResult.message
  });

  if (!(compileResult instanceof CompileResultSuccess)) {
    task.reportProgress.finished(SubmissionStatus.CompilationError, 0);
    if (customCheckerCompileResult) customCheckerCompileResult.dereference();
    return;
  }

  try {
    await runCommonTask({
      task,
      extraParameters: [compileResult, customCheckerCompileResult],
      onTestcase: runTestcase
    });
  } finally {
    compileResult.dereference();
    if (customCheckerCompileResult) customCheckerCompileResult.dereference();
  }
}
