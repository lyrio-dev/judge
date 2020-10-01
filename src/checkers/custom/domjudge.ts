import { SandboxStatus } from "simple-sandbox";

import { safelyJoinPath, readFileOmitted } from "@/utils";

import { CustomChecker } from ".";

enum DomjudgeCheckerReturnCode {
  AC = 42,
  WA = 43
}

export const checker: CustomChecker = {
  async runChecker(
    checkerConfig,
    inputFile,
    outputFile,
    answerFile,
    code,
    workingDirectory,
    runSandboxForCustomChecker
  ) {
    const sandboxResult = await runSandboxForCustomChecker(outputFile.inside, null, null, [
      inputFile.inside,
      answerFile.inside,
      workingDirectory.inside
    ]);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    const MESSAGE_LENGTH_LIMIT = 256;
    const message = await readFileOmitted(
      safelyJoinPath(workingDirectory.outside, "judgemessage.txt"),
      MESSAGE_LENGTH_LIMIT
    );

    if (!(sandboxResult.code in DomjudgeCheckerReturnCode)) {
      return `DOMjudge checker exited with an error return code: ${sandboxResult.code}.\n${message}`;
    }

    return {
      score: sandboxResult.code === DomjudgeCheckerReturnCode.AC ? 100 : 0,
      checkerMessage: message
    };
  }
};
