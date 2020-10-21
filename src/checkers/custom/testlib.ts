import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { safelyJoinPath } from "@/utils";
import { readFileOmitted } from "@/omittableString";

import { CustomChecker } from ".";
import { parseTestlibMessage } from "..";

export const checker: CustomChecker = {
  validate(checkerConfig) {
    if (checkerConfig.language !== "cpp") return "testlib checkers must be written in C++";
    return null;
  },

  async runChecker(
    checkerConfig,
    inputFile,
    outputFile,
    answerFile,
    code,
    workingDirectory,
    runSandboxForCustomChecker
  ) {
    const stderrFile = safelyJoinPath(workingDirectory, uuid());
    const sandboxResult = await runSandboxForCustomChecker(null, null, stderrFile.inside, [
      inputFile.inside,
      outputFile.inside,
      answerFile.inside
    ]);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    const MESSAGE_LENGTH_LIMIT = 256;
    const message = await readFileOmitted(stderrFile.outside, MESSAGE_LENGTH_LIMIT);

    return parseTestlibMessage(message);
  }
};
