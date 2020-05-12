import { SandboxStatus } from "simple-sandbox";

import { CustomChecker } from ".";

export const checker: CustomChecker = {
  async runChecker(checker, inputFile, outputFile, answerFile, code, workingDirectory, runSandboxForCustomChecker) {
    const sandboxResult = await runSandboxForCustomChecker(null, null, null, [
      inputFile.inside,
      answerFile.inside,
      outputFile.inside
    ]);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    return {
      score: sandboxResult.code === 0 ? 100 : 0
    };
  }
};
