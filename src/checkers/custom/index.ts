import { SandboxResult } from "simple-sandbox";

import { runSandbox, SANDBOX_INSIDE_PATH_BINARY } from "@/sandbox";
import { CompileResultSuccess } from "@/compile";
import getLanguage from "@/languages";
import { ConfigurationError } from "@/error";
import { MappedPath } from "@/utils";

import { CheckerResult, CheckerTypeCustom } from "..";

export interface CustomChecker {
  /**
   * A function to validate the checker's config, e.g. a testlib checker could only be written in the cpp language.
   * @returns The error message, will trigger a Confi
   */
  validate?(checker: CheckerTypeCustom): string;

  runChecker(
    checker: CheckerTypeCustom,
    inputFile: MappedPath,
    outputFile: MappedPath,
    answerFile: MappedPath,
    code: string,
    workingDirectory: MappedPath,
    runSandboxForCustomChecker: (
      stdin: string,
      stdout: string,
      stderr: string,
      parameters?: string[]
    ) => Promise<SandboxResult>
  ): Promise<CheckerResult | string>;
}

/* eslint-disable @typescript-eslint/no-var-requires */
const customCheckerInterfaces: Record<string, CustomChecker> = {
  testlib: require("./testlib").checker,
  legacy: require("./legacy").checker,
  lemon: require("./lemon").checker,
  hustoj: require("./hustoj").checker,
  qduoj: require("./qduoj").checker,
  domjudge: require("./domjudge").checker
};
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * This is called BEFORE compiling the checker to detect some problems that will cause the
 * successfully compiled checker's not usable.
 *
 * e.g. a testlib checker could only be written in the cpp language.
 */
export function validateCustomChecker(checker: CheckerTypeCustom) {
  if (customCheckerInterfaces[checker.interface].validate) {
    const error = customCheckerInterfaces[checker.interface].validate(checker);
    if (error) throw new ConfigurationError(`Invalid custom checker config: ${error}`);
  }
}

export async function runCustomChecker(
  taskId: string,
  checker: CheckerTypeCustom,
  timeLimit: number,
  memoryLimit: number,
  checkerCompileResult: CompileResultSuccess,
  inputFile: MappedPath,
  outputFile: MappedPath,
  answerFile: MappedPath,
  code: string,
  workingDirectory: MappedPath,
  tempDirectory: string
) {
  return await customCheckerInterfaces[checker.interface].runChecker(
    checker,
    inputFile,
    outputFile,
    answerFile,
    code,
    workingDirectory,
    async (stdin, stdout, stderr, parameters) =>
      await runSandbox({
        taskId,
        parameters: {
          ...getLanguage(checker.language).run(
            SANDBOX_INSIDE_PATH_BINARY,
            workingDirectory.inside,
            checker.compileAndRunOptions,
            timeLimit,
            memoryLimit,
            stdin,
            stdout,
            stderr,
            parameters
          ),
          time: timeLimit,
          memory: memoryLimit * 1024 * 1024,
          workingDirectory: workingDirectory.inside
        },
        tempDirectory,
        extraMounts: [
          {
            mappedPath: {
              outside: checkerCompileResult.binaryDirectory,
              inside: SANDBOX_INSIDE_PATH_BINARY
            },
            readOnly: true
          },
          {
            mappedPath: workingDirectory,
            readOnly: false
          }
        ]
      })
  );
}
