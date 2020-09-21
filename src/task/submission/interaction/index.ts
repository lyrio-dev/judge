import fs from "fs";

import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { startSandbox, joinPath, MappedPath, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import getLanguage from "@/languages";
import config from "@/config";
import { readFileOmitted, stringToOmited } from "@/utils";
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
  input?: string;
  userError?: string;
  interactorMessage?: string;
  systemMessage?: string;
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
    outside: joinPath(taskWorkingDirectory, "working"),
    inside: SANDBOX_INSIDE_PATH_WORKING
  };

  const tempDirectory = joinPath(taskWorkingDirectory, "temp");

  await Promise.all([fsNative.ensureDir(workingDirectory.outside), fsNative.ensureDir(tempDirectory)]);

  const inputFile = joinPath(workingDirectory, uuid());
  if (isSample) await fs.promises.writeFile(inputFile.outside, sample.inputData);
  else await fsNative.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);

  const userStderrFile = joinPath(workingDirectory, uuid());
  const userLanguageConfig = getLanguage(task.extraInfo.submissionContent.language);
  const interactorStderrFile = joinPath(workingDirectory, uuid());
  const interactorLanguageConfig = getLanguage(judgeInfo.interactor.language);

  const pipeUserToInteractor = createPipe(disposer);
  const pipeInteractorToUser = createPipe(disposer);
  const sharedMemory =
    judgeInfo.interactor.interface === "shm"
      ? createSharedMemory(judgeInfo.interactor.sharedMemorySize * 1024 * 1024, disposer)
      : null;

  const userSandbox = await startSandbox({
    taskId: task.taskId,
    parameters: {
      ...userLanguageConfig.run(
        userBinaryDirectory.inside,
        workingDirectory.inside,
        task.extraInfo.submissionContent.compileAndRunOptions,
        timeLimit,
        memoryLimit,
        pipeInteractorToUser.read,
        pipeUserToInteractor.write,
        userStderrFile.inside
      ),
      time: timeLimit,
      memory: memoryLimit * 1024 * 1024,
      workingDirectory: workingDirectory.inside,
      environments: [
        `INTERACTOR_INTERFACE=${judgeInfo.interactor.interface}`,
        `INTERACTOR_SHARED_MEMORY_FD=${sharedMemory ? sharedMemory.fd : -1}`
      ]
    },
    tempDirectory,
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
    preservedFileDescriptors: [pipeInteractorToUser.read, pipeUserToInteractor.write, sharedMemory]
  });

  // By default use the testcase's time limit.
  const interactorTimeLimit = Math.max(timeLimit, judgeInfo.interactor.timeLimit || timeLimit);
  const interactorMemoryLimit = judgeInfo.interactor.memoryLimit || judgeInfo.memoryLimit;
  const interactorSandbox = await startSandbox({
    taskId: task.taskId,
    parameters: {
      ...interactorLanguageConfig.run(
        interactorBinaryDirectory.inside,
        workingDirectory.inside,
        task.extraInfo.submissionContent.compileAndRunOptions,
        interactorTimeLimit,
        interactorMemoryLimit,
        pipeUserToInteractor.read,
        pipeInteractorToUser.write,
        interactorStderrFile.inside,
        [inputFile.inside, "/dev/null"]
      ),
      time: interactorTimeLimit,
      memory: interactorMemoryLimit * 1024 * 1024,
      workingDirectory: workingDirectory.inside,
      environments: [
        `INTERACTOR_INTERFACE=${judgeInfo.interactor.interface}`,
        `INTERACTOR_SHARED_MEMORY_FD=${sharedMemory ? sharedMemory.fd : -1}`
      ]
    },
    tempDirectory,
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
    preservedFileDescriptors: [pipeUserToInteractor.read, pipeInteractorToUser.write, sharedMemory]
  });

  const interactorSandboxResult = await interactorSandbox.waitForStop();
  userSandbox.stop();
  const userSandboxResult = await userSandbox.waitForStop();

  const MESSAGE_LENGTH_LIMIT = 256;
  const interactorMessage = await readFileOmitted(interactorStderrFile.outside, MESSAGE_LENGTH_LIMIT);

  if (interactorSandboxResult.status !== SandboxStatus.OK) {
    result.status = TestcaseStatusInteraction.JudgementFailed;
    result.systemMessage = `Interactor encountered a ${SandboxStatus[interactorSandboxResult.status]}`;
    result.interactorMessage = interactorMessage;
  } else if (userSandboxResult.status === SandboxStatus.OutputLimitExceeded)
    result.status = TestcaseStatusInteraction.OutputLimitExceeded;
  else if (userSandboxResult.status === SandboxStatus.TimeLimitExceeded)
    result.status = TestcaseStatusInteraction.TimeLimitExceeded;
  else if (userSandboxResult.status === SandboxStatus.MemoryLimitExceeded)
    result.status = TestcaseStatusInteraction.MemoryLimitExceeded;
  else if (userSandboxResult.status === SandboxStatus.RuntimeError) {
    result.status = TestcaseStatusInteraction.RuntimeError;
    result.systemMessage = `Exit code: ${userSandboxResult.code}`;
  } else if (userSandboxResult.status === SandboxStatus.Unknown)
    throw new Error(`Corrupt sandbox result: ${JSON.stringify(userSandboxResult)}`);

  result.input = isSample
    ? stringToOmited(sample.inputData, config.limit.dataDisplay)
    : await readFileOmitted(getFile(task.extraInfo.testData[testcase.inputFile]), config.limit.dataDisplay);
  result.userError = await readFileOmitted(userStderrFile.outside, config.limit.stderrDisplay);
  result.time = userSandboxResult.time / 1e6;
  result.memory = userSandboxResult.memory / 1024;

  // Interactor and user program exited normally
  if (!result.status) {
    const interactorResult = parseTestlibMessage(interactorMessage);
    if (typeof interactorResult === "string") {
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
    throw new ConfigurationError(`Failed to compile interactor:\n\n${interactorCompileResult.message}`);
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
