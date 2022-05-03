import fs from "fs";

import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { startSandbox, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import getLanguage from "@/languages";
import { serverSideConfig } from "@/config";
import { safelyJoinPath, MappedPath, merge } from "@/utils";
import {
  readFileOmitted,
  stringToOmited,
  OmittableString,
  prependOmittableString,
  isOmittableString
} from "@/omittableString";
import { getFile } from "@/file";
import { ConfigurationError } from "@/error";
import { createPipe, createSharedMemory, Disposer } from "@/posixUtils";
import { parseTestlibMessage } from "@/checkers";
import * as fsNative from "@/fsNative";

import { JudgeInfoInteraction, TestcaseConfig } from "./judgeInfo";

import { runCommonTask, getExtraSourceFiles } from "../common";

export * from "./judgeInfo";

// For subtasks and testcasese
export enum TestcaseStatusInteraction {
  RuntimeError = "RuntimeError",
  TimeLimitExceeded = "TimeLimitExceeded",
  MemoryLimitExceeded = "MemoryLimitExceeded",
  OutputLimitExceeded = "OutputLimitExceeded",

  PartiallyCorrect = "PartiallyCorrect",
  WrongAnswer = "WrongAnswer",
  Accepted = "Accepted",

  JudgementFailed = "JudgementFailed"
}

export interface TestcaseResultInteraction {
  testcaseInfo: {
    timeLimit: number;
    memoryLimit: number;
    inputFile: string;
  };
  status: TestcaseStatusInteraction;
  score: number;
  time?: number;
  memory?: number;
  input?: OmittableString;
  userError?: OmittableString;
  interactorMessage?: OmittableString;
  systemMessage?: OmittableString;
}

export interface SubmissionContentInteraction {
  language: string;
  code: string;
  compileAndRunOptions: unknown;
  skipSamples?: boolean;
}

export type ExtraParametersInteraction = [CompileResultSuccess, CompileResultSuccess];

/**
 * Run a subtask testcase or sample testcase.
 *
 * @param sampleId If not null, it's a sample testcase.
 * @param subtaskIndex If not null, it's a subtask testcase.
 */
async function runTestcase(
  task: SubmissionTask<
    JudgeInfoInteraction,
    SubmissionContentInteraction,
    TestcaseResultInteraction,
    ExtraParametersInteraction
  >,
  judgeInfo: JudgeInfoInteraction,
  sampleId: number,
  sample: ProblemSample,
  subtaskIndex: number,
  testcaseIndex: number,
  testcase: TestcaseConfig,
  extraParameters: ExtraParametersInteraction,
  taskWorkingDirectory: string,
  disposer: Disposer
): Promise<TestcaseResultInteraction> {
  const [compileResult, interactorCompileResult] = extraParameters;

  const isSample = sampleId != null;

  const timeLimit = isSample ? judgeInfo.timeLimit : testcase.timeLimit;
  const memoryLimit = isSample ? judgeInfo.memoryLimit : testcase.memoryLimit;

  const result: TestcaseResultInteraction = {
    testcaseInfo: {
      timeLimit,
      memoryLimit,
      inputFile: isSample ? null : testcase.inputFile
    },
    status: null,
    score: 0
  };

  const userBinaryDirectory: MappedPath = {
    outside: compileResult.binaryDirectory,
    inside: SANDBOX_INSIDE_PATH_BINARY
  };
  const interactorBinaryDirectory: MappedPath = {
    outside: interactorCompileResult.binaryDirectory,
    inside: SANDBOX_INSIDE_PATH_BINARY
  };
  const workingDirectory = {
    outside: safelyJoinPath(taskWorkingDirectory, "working"),
    inside: SANDBOX_INSIDE_PATH_WORKING
  };

  const tempDirectoryOutside = safelyJoinPath(taskWorkingDirectory, "temp");

  await Promise.all([fsNative.ensureDir(workingDirectory.outside), fsNative.ensureDir(tempDirectoryOutside)]);

  const inputFile = safelyJoinPath(workingDirectory, uuid());
  if (isSample) await fs.promises.writeFile(inputFile.outside, sample.inputData);
  else await fsNative.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);

  const userStderrFile = safelyJoinPath(workingDirectory, uuid());
  const userLanguageConfig = getLanguage(task.extraInfo.submissionContent.language);
  const interactorStderrFile = safelyJoinPath(workingDirectory, uuid());
  const interactorLanguageConfig = getLanguage(judgeInfo.interactor.language);

  const pipeUserToInteractor = createPipe(disposer);
  const pipeInteractorToUser = createPipe(disposer);
  const sharedMemory =
    judgeInfo.interactor.interface === "shm"
      ? createSharedMemory(judgeInfo.interactor.sharedMemorySize * 1024 * 1024, disposer)
      : null;

  const environments = {
    INTERACTOR_INTERFACE: judgeInfo.interactor.interface,
    INTERACTOR_SHARED_MEMORY_FD: String(sharedMemory ? sharedMemory.fd : -1)
  };

  const userRunConfig = userLanguageConfig.run({
    binaryDirectoryInside: userBinaryDirectory.inside,
    workingDirectoryInside: workingDirectory.inside,
    compileAndRunOptions: task.extraInfo.submissionContent.compileAndRunOptions,
    time: timeLimit,
    memory: memoryLimit,
    stdinFile: pipeInteractorToUser.read,
    stdoutFile: pipeUserToInteractor.write,
    stderrFile: userStderrFile.inside,
    parameters: [],
    compileResultExtraInfo: compileResult.extraInfo
  });
  const userSandbox = await startSandbox(task.taskId, {
    ...userRunConfig,
    time: timeLimit,
    memory: memoryLimit * 1024 * 1024,
    workingDirectory: workingDirectory.inside,
    tempDirectoryOutside,
    extraMounts: [
      {
        mappedPath: userBinaryDirectory,
        readOnly: true
      },
      {
        mappedPath: workingDirectory,
        readOnly: false
      }
    ],
    preservedFileDescriptors: [pipeInteractorToUser.read, pipeUserToInteractor.write, sharedMemory],
    environments: merge(userRunConfig.environments, environments)
  });

  // By default use the testcase's time limit.
  const interactorTimeLimit = Math.max(timeLimit, judgeInfo.interactor.timeLimit || timeLimit);
  const interactorMemoryLimit = judgeInfo.interactor.memoryLimit || judgeInfo.memoryLimit;
  const interactorRunConfig = interactorLanguageConfig.run({
    binaryDirectoryInside: interactorBinaryDirectory.inside,
    workingDirectoryInside: workingDirectory.inside,
    compileAndRunOptions: task.extraInfo.submissionContent.compileAndRunOptions,
    time: interactorTimeLimit,
    memory: interactorMemoryLimit,
    stdinFile: pipeUserToInteractor.read,
    stdoutFile: pipeInteractorToUser.write,
    stderrFile: interactorStderrFile.inside,
    parameters: [inputFile.inside, "/dev/null"],
    compileResultExtraInfo: interactorCompileResult.extraInfo
  });
  const interactorSandbox = await startSandbox(task.taskId, {
    ...interactorRunConfig,
    time: interactorTimeLimit,
    memory: interactorMemoryLimit * 1024 * 1024,
    workingDirectory: workingDirectory.inside,
    tempDirectoryOutside,
    extraMounts: [
      {
        mappedPath: interactorBinaryDirectory,
        readOnly: true
      },
      {
        mappedPath: workingDirectory,
        readOnly: false
      }
    ],
    preservedFileDescriptors: [pipeUserToInteractor.read, pipeInteractorToUser.write, sharedMemory],
    environments: merge(interactorRunConfig.environments, environments)
  });

  const interactorSandboxResult = await interactorSandbox.waitForStop();
  userSandbox.stop();
  const userSandboxResult = await userSandbox.waitForStop();

  const MESSAGE_LENGTH_LIMIT = 256;
  const interactorMessage = await readFileOmitted(interactorStderrFile.outside, MESSAGE_LENGTH_LIMIT);

  if (
    userSandboxResult.status === SandboxStatus.TimeLimitExceeded ||
    interactorSandboxResult.status === SandboxStatus.TimeLimitExceeded
  )
    result.status = TestcaseStatusInteraction.TimeLimitExceeded;
  else if (interactorSandboxResult.status !== SandboxStatus.OK) {
    result.status = TestcaseStatusInteraction.JudgementFailed;
    result.systemMessage = `Interactor encountered a ${SandboxStatus[interactorSandboxResult.status]}`;
    result.interactorMessage = interactorMessage;
  } else if (userSandboxResult.status === SandboxStatus.OutputLimitExceeded)
    result.status = TestcaseStatusInteraction.OutputLimitExceeded;
  else if (userSandboxResult.status === SandboxStatus.MemoryLimitExceeded)
    result.status = TestcaseStatusInteraction.MemoryLimitExceeded;
  else if (userSandboxResult.status === SandboxStatus.RuntimeError) {
    result.status = TestcaseStatusInteraction.RuntimeError;
    result.systemMessage = `Exit code: ${userSandboxResult.code}`;
  } else if (userSandboxResult.status === SandboxStatus.Unknown)
    throw new Error(`Corrupt sandbox result: ${JSON.stringify(userSandboxResult)}`);

  result.input = isSample
    ? stringToOmited(sample.inputData, serverSideConfig.limit.dataDisplay)
    : await readFileOmitted(getFile(task.extraInfo.testData[testcase.inputFile]), serverSideConfig.limit.dataDisplay);
  result.userError = await readFileOmitted(userStderrFile.outside, serverSideConfig.limit.stderrDisplay);
  result.time = userSandboxResult.time / 1e6;
  result.memory = userSandboxResult.memory / 1024;

  // Interactor and user program exited normally
  if (!result.status) {
    const interactorResult = parseTestlibMessage(interactorMessage);
    if (isOmittableString(interactorResult)) {
      result.status = TestcaseStatusInteraction.JudgementFailed;
      result.score = 0;
      result.systemMessage = interactorResult;
    } else {
      if (interactorResult.score == null) result.status = TestcaseStatusInteraction.JudgementFailed;
      result.interactorMessage = interactorResult.checkerMessage;
      result.score = interactorResult.score || 0;
    }

    if (result.status !== TestcaseStatusInteraction.JudgementFailed) {
      if (result.score === 100) {
        result.status = TestcaseStatusInteraction.Accepted;
      } else if (result.score === 0) {
        result.status = TestcaseStatusInteraction.WrongAnswer;
      } else {
        result.status = TestcaseStatusInteraction.PartiallyCorrect;
      }
    }
  } else result.score = 0;

  return result;
}

export async function runTask(
  task: SubmissionTask<
    JudgeInfoInteraction,
    SubmissionContentInteraction,
    TestcaseResultInteraction,
    ExtraParametersInteraction
  >
) {
  const { judgeInfo } = task.extraInfo;

  task.events.compiling();

  const interactorCompileResult = await compile({
    language: judgeInfo.interactor.language,
    code: await fs.promises.readFile(getFile(task.extraInfo.testData[judgeInfo.interactor.filename]), "utf-8"),
    compileAndRunOptions: judgeInfo.interactor.compileAndRunOptions
  });

  if (!(interactorCompileResult instanceof CompileResultSuccess)) {
    throw new ConfigurationError(
      prependOmittableString("Failed to compile interactor:\n\n", interactorCompileResult.message, true)
    );
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
    if (interactorCompileResult) await interactorCompileResult.dereference();
    return;
  }

  try {
    await runCommonTask({
      task,
      extraParameters: [compileResult, interactorCompileResult],
      onTestcase: runTestcase
    });
  } finally {
    await compileResult.dereference();
    if (interactorCompileResult) await interactorCompileResult.dereference();
  }
}
