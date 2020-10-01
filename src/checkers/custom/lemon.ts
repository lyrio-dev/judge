import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { safelyJoinPath, readFileLimited, readFileOmitted } from "@/utils";

import { CustomChecker } from ".";

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
    const scoreFile = safelyJoinPath(workingDirectory, uuid());
    const messageFile = safelyJoinPath(workingDirectory, uuid());

    const sandboxResult = await runSandboxForCustomChecker(null, null, null, [
      inputFile.inside,
      outputFile.inside,
      answerFile.inside,
      "100",
      scoreFile.inside,
      messageFile.inside
    ]);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    const SCORE_LENGTH_LIMIT = 10;
    const scoreText = await readFileLimited(scoreFile.outside, SCORE_LENGTH_LIMIT);
    if (!scoreText) return "Lemon checker returned empty score";

    const score = parseInt(scoreText, 10);
    if (!(score >= 0 && score <= 100)) return `Lemon checker returned an invalid score: ${scoreText || "(empty)"}`;

    const MESSAGE_LENGTH_LIMIT = 256;
    const message = await readFileOmitted(messageFile.outside, MESSAGE_LENGTH_LIMIT);

    return {
      score,
      checkerMessage: message
    };
  }
};
