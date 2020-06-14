import fs = require("fs-extra");
import { v4 as uuid } from "uuid";
import winston = require("winston");
import { SandboxStatus } from "simple-sandbox";

import { SubmissionTask, SubmissionStatus, ProblemSample } from "@/task/submission";
import { compile, CompileResultSuccess } from "@/compile";
import { JudgeInfoInteraction, TestcaseConfig } from "./judgeInfo";
import { runTaskQueued } from "@/taskQueue";
import { startSandbox, joinPath, MappedPath, SANDBOX_INSIDE_PATH_BINARY, SANDBOX_INSIDE_PATH_WORKING } from "@/sandbox";
import getLanguage from "@/languages";
import config from "@/config";
import { readFileOmitted, stringToOmited } from "@/utils";
import { getFile } from "@/file";
import { ConfigurationError } from "@/error";
import { runCommonTask } from "../common";
import { createPipe, createSharedMemory } from "@/posixUtils";
import { parseTestlibMessage } from "@/checkers";

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
    inputFilename: string;
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
  task: SubmissionTask<JudgeInfoInteraction, SubmissionContentInteraction, TestcaseResultInteraction>,
  judgeInfo: JudgeInfoInteraction,
  sampleId: number,
  sample: ProblemSample,
  subtaskIndex: number,
  testcaseIndex: number,
  testcase: TestcaseConfig,
  [compileResult, interactorCompileResult]: [CompileResultSuccess, CompileResultSuccess]
): Promise<TestcaseResultInteraction> {
  return await runTaskQueued(async (taskWorkingDirectory, disposer) => {
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

    const result: TestcaseResultInteraction = {
      testcaseInfo: {
        timeLimit: timeLimit,
        memoryLimit: memoryLimit,
        inputFilename: isSample ? null : testcase.inputFile
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

    await Promise.all([fs.ensureDir(workingDirectory.outside), fs.ensureDir(tempDirectory)]);

    const inputFile = joinPath(workingDirectory, uuid());
    if (isSample) await fs.writeFile(inputFile.outside, sample.inputData);
    else await fs.copy(getFile(task.extraInfo.testData[testcase.inputFile]), inputFile.outside);

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
          task.extraInfo.submissionContent.languageOptions,
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

    const interactorSandbox = await startSandbox({
      taskId: task.taskId,
      parameters: {
        ...interactorLanguageConfig.run(
          interactorBinaryDirectory.inside,
          workingDirectory.inside,
          task.extraInfo.submissionContent.languageOptions,
          timeLimit,
          config.limit.customCheckerMemory,
          pipeUserToInteractor.read,
          pipeInteractorToUser.write,
          interactorStderrFile.inside,
          [inputFile.inside, "/dev/null"]
        ),
        time: timeLimit,
        memory: config.limit.customCheckerMemory * 1024 * 1024,
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
      result.systemMessage = "Exit code: " + userSandboxResult.code;
    } else if (userSandboxResult.status === SandboxStatus.Unknown)
      throw new Error("Corrupt sandbox result: " + JSON.stringify(userSandboxResult));

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
  task: SubmissionTask<JudgeInfoInteraction, SubmissionContentInteraction, TestcaseResultInteraction>
) {
  const judgeInfo = task.extraInfo.judgeInfo;

  task.reportProgress.compiling();

  const interactorCompileResult = await compile({
    language: judgeInfo.interactor.language,
    code: await fs.readFile(getFile(task.extraInfo.testData[judgeInfo.interactor.filename]), "utf-8"),
    languageOptions: judgeInfo.interactor.languageOptions
  });

  if (!(interactorCompileResult instanceof CompileResultSuccess)) {
    throw new ConfigurationError(`Failed to compile interactor:\n\n${interactorCompileResult.message}`);
  }

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
    if (interactorCompileResult) interactorCompileResult.dereference();
    return;
  }

  try {
    await runCommonTask({
      task,
      compileResults: [compileResult, interactorCompileResult],
      onTestcase: runTestcase
    });
  } finally {
    compileResult.dereference();
    if (interactorCompileResult) interactorCompileResult.dereference();
  }
}
