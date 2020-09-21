import fs from "fs";

import { SandboxStatus } from "simple-sandbox";
import objectHash from "object-hash";
import LruCache from "lru-cache";
import winston from "winston";
import { v4 as uuid } from "uuid";

import getLanguage, { LanguageConfig } from "./languages";
import { ensureDirectoryEmpty, readFileOmitted } from "./utils";
import {
  ExecuteParameters,
  runSandbox,
  SANDBOX_INSIDE_PATH_SOURCE,
  SANDBOX_INSIDE_PATH_BINARY,
  MappedPath,
  joinPath
} from "./sandbox";
import config from "./config";
import { runTaskQueued } from "./taskQueue";
import { getFile, getFileHash } from "./file";
import * as fsNative from "./fsNative";

export interface CompileParameters extends ExecuteParameters {
  time: number; // Time limit
  memory: number; // Memory limit
  messageFile?: string; // The file contains the message to display for user
  workingDirectory: string; // The working directory for the compiler or script
}

export interface CompileTask {
  language: string;
  code: string;
  compileAndRunOptions: unknown;
  extraSourceFiles?: Record<string, string>;
}

async function hashCompileTask(compileTask: CompileTask): Promise<string> {
  return objectHash({
    language: compileTask.language,
    code: compileTask.code,
    compileAndRunOptions: compileTask.compileAndRunOptions,
    extraSourceFiles:
      compileTask.extraSourceFiles &&
      (await Promise.all(
        Object.entries(compileTask.extraSourceFiles).map(async ([filename, fileUuid]) => [
          filename,
          await getFileHash(fileUuid)
        ])
      ))
  });
}

export interface CompileResult {
  compileTaskHash: string;
  success: boolean;
  message: string;
}

// These class implements reference count to prevent a compile result being deleted
// from the disk during using
export class CompileResultSuccess implements CompileResult {
  public readonly success: true = true;

  constructor(
    public readonly compileTaskHash: string,
    public readonly message: string,
    public readonly binaryDirectory: string,
    public readonly binaryDirectorySize: number
  ) {}

  // The referenceCount is initially zero, the result must be referenced at least once
  // Then when dereferenced to zero it will be deleted from the disk
  private referenceCount: number = 0;

  public reference() {
    this.referenceCount++;
    return this;
  }

  public async dereference() {
    if (--this.referenceCount === 0) {
      await fsNative.remove(this.binaryDirectory);
    }
  }

  async copyTo(newBinaryDirectory: string) {
    this.reference();
    await fsNative.copy(this.binaryDirectory, newBinaryDirectory);
    await this.dereference();
    return new CompileResultSuccess(this.compileTaskHash, this.message, newBinaryDirectory, this.binaryDirectorySize);
  }
}

// Why NOT using the task hash as the directory name? Because there'll be a race condition
// If a compile result is disposed from the cache, but still have at least one reference
// e.g. referenced by a judge task which have not finished copying the binary files to its working directory
// Another cache set operation with the same task will overwrite the files (and may cause the judge task using a corrupted file)
// Use a random uuid as the key instead to prevent this
class CompileResultCache {
  private readonly lruCache = new LruCache<string, CompileResultSuccess>({
    max: config.binaryCacheMaxSize,
    length: result => result.binaryDirectorySize,
    dispose: (compileTaskHash, result) => {
      winston.verbose(`dispose() from compile result cache: ${compileTaskHash}`);
      setImmediate(() => {
        // It's safe NOT to await it..
        result.dereference().catch(e => winston.error(`Failed to remove compile result on evicting cache: ${e.stack}`));
      });
    }
  });

  // The set()/get()'s returned result is reference()-ed
  // and must be dereference()-ed

  public get(compileTaskHash: string): CompileResultSuccess {
    if (this.lruCache.has(compileTaskHash)) return this.lruCache.get(compileTaskHash).reference();
    return null;
  }

  // set() should not be called twice with the same compileTaskHash in the same time
  // i.e. call another time with the same compileTaskHash before the previous finished
  public async set(compileTaskHash: string, result: CompileResultSuccess): Promise<CompileResultSuccess> {
    if (this.lruCache.has(compileTaskHash)) return this.lruCache.get(compileTaskHash).reference();

    const newCompileResult = await result.copyTo(joinPath(config.binaryCacheStore, uuid()));
    newCompileResult.reference();
    this.lruCache.set(compileTaskHash, newCompileResult);
    return newCompileResult.reference();
  }
}

interface PendingCompileTask {
  resultConsumers: ((compileResult: CompileResult) => void)[];
  promise: Promise<void>;
}

// If there're multiple calls to compile() with the same compileTask, it's to prevent the task to be compiled multiple times
// compileTaskHash -> Promise of task
const pendingCompileTasks: Map<string, PendingCompileTask> = new Map();
const compileResultCache = new CompileResultCache();

export async function compile(compileTask: CompileTask): Promise<CompileResult> {
  const languageConfig = getLanguage(compileTask.language);

  const compileTaskHash = await hashCompileTask(compileTask);

  const cachedResult = compileResultCache.get(compileTaskHash);
  if (cachedResult) {
    winston.verbose(`Use cached compile reslt for ${compileTaskHash}`);
    return cachedResult;
  }

  let pendingCompileTask = pendingCompileTasks.get(compileTaskHash);
  if (!pendingCompileTask) {
    // Use a array of functions to ensure every calls to compile() of this task could get
    // a valid CompileResultSuccess object (with positive referenceCount)
    // I don't think "await promise" is guaranteed to return in a synchronous flow after the promise resolved
    const resultConsumers = [];
    pendingCompileTasks.set(
      compileTaskHash,
      (pendingCompileTask = {
        resultConsumers,
        promise: runTaskQueued(async taskWorkingDirectory => {
          // The compileResult is already reference()-ed
          const compileResult = await doCompile(compileTask, compileTaskHash, languageConfig, taskWorkingDirectory);
          winston.verbose(`Compile result: ${JSON.stringify(compileResult)}`);

          for (const resultConsumer of resultConsumers)
            resultConsumer(compileResult instanceof CompileResultSuccess ? compileResult.reference() : compileResult);

          if (compileResult instanceof CompileResultSuccess) await compileResult.dereference();
        }).finally(() => pendingCompileTasks.delete(compileTaskHash))
      })
    );
  }

  let result: CompileResult;
  pendingCompileTask.resultConsumers.push(r => {
    result = r;
  });
  await pendingCompileTask.promise;

  return result;
}

// Return reference()-ed result if success
async function doCompile(
  compileTask: CompileTask,
  compileTaskHash: string,
  languageConfig: LanguageConfig<unknown>,
  taskWorkingDirectory: string
): Promise<CompileResult> {
  const { sourceFilename, binarySizeLimit } = languageConfig.getMetaOptions(compileTask.compileAndRunOptions);

  const sourceDirectory: MappedPath = {
    outside: joinPath(taskWorkingDirectory, "source"),
    inside: SANDBOX_INSIDE_PATH_SOURCE
  };
  const binaryDirectory: MappedPath = {
    outside: joinPath(taskWorkingDirectory, "working"),
    inside: SANDBOX_INSIDE_PATH_BINARY
  };

  const tempDirectory = joinPath(taskWorkingDirectory, "temp");

  await Promise.all([
    ensureDirectoryEmpty(sourceDirectory.outside),
    ensureDirectoryEmpty(binaryDirectory.outside),
    ensureDirectoryEmpty(tempDirectory)
  ]);

  await Promise.all(
    Object.entries(compileTask.extraSourceFiles || {}).map(([dst, src]) =>
      fs.promises.copyFile(getFile(src), joinPath(sourceDirectory.outside, dst))
    )
  );

  const sourceFile = joinPath(sourceDirectory, sourceFilename);
  await fs.promises.writeFile(sourceFile.outside, compileTask.code);

  const executeParameters = languageConfig.compile(
    sourceFile.inside,
    binaryDirectory.inside,
    compileTask.compileAndRunOptions
  );
  const sandboxResult = await runSandbox({
    taskId: null,
    parameters: executeParameters,
    tempDirectory,
    extraMounts: [
      {
        mappedPath: sourceDirectory,
        readOnly: true
      },
      {
        mappedPath: binaryDirectory,
        readOnly: false
      }
    ]
  });

  const messageFile = joinPath(binaryDirectory, executeParameters.messageFile);
  const message = (await readFileOmitted(messageFile.outside, config.limit.compilerMessage)) || "";
  await fsNative.remove(messageFile.outside);

  if (sandboxResult.status === SandboxStatus.OK) {
    if (sandboxResult.code === 0) {
      const binaryDirectorySize = await fsNative.calcSize(binaryDirectory.outside);
      if (binaryDirectorySize > binarySizeLimit) {
        return {
          compileTaskHash,
          success: false,
          message: `The source code compiled to ${binaryDirectorySize} bytes, exceeding the size limit.\n\n${message}`.trim()
        };
      } else if (binaryDirectorySize > config.binaryCacheMaxSize) {
        return {
          compileTaskHash,
          success: false,
          message: `The source code compiled to ${binaryDirectorySize} bytes, exceeding the limit of cache storage.\n\n${message}`.trim()
        };
      } else {
        // We must done copying it to the cache before returning
        // Since the initial compile result's directory is NOT preserved after returning to the task queue
        return await compileResultCache.set(
          compileTaskHash,
          new CompileResultSuccess(compileTaskHash, message, binaryDirectory.outside, binaryDirectorySize)
        );
      }
    } else {
      return {
        compileTaskHash,
        success: false,
        message
      };
    }
  } else {
    return {
      compileTaskHash,
      success: false,
      message: `A ${SandboxStatus[sandboxResult.status]} encountered while compiling the code.\n\n${message}`.trim()
    };
  }
}
