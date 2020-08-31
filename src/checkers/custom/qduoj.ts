import { SandboxStatus } from "simple-sandbox";

import { joinPath } from "@/sandbox";
import { readFileOmitted } from "@/utils";

import { CustomChecker } from ".";

enum QduOjCheckerReturnCode {
  AC = 0,
  WA = 1,
  ERROR = 255
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
    const messageFile = joinPath(workingDirectory, "message.txt");

    const sandboxResult = await runSandboxForCustomChecker(inputFile.inside, null, messageFile.inside, [
      inputFile.inside,
      outputFile.inside
    ]);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    const MESSAGE_LENGTH_LIMIT = 256;
    const message = await readFileOmitted(messageFile.outside, MESSAGE_LENGTH_LIMIT);

    if (!(sandboxResult.code in QduOjCheckerReturnCode)) {
      return `QDUOJ checker exited with an unrecognized return code: ${sandboxResult.code}.\n${message}`;
    } else if (sandboxResult.code === QduOjCheckerReturnCode.ERROR) {
      return `QDUOJ checker exited with error: ${message || "(empty)"}`;
    }

    return {
      score: sandboxResult.code === QduOjCheckerReturnCode.AC ? 100 : 0,
      checkerMessage: message
    };
  }
};
