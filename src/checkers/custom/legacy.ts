import fs from "fs";

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
    const stdoutFile = safelyJoinPath(workingDirectory, uuid());
    const stderrFile = safelyJoinPath(workingDirectory, uuid());

    await Promise.all([
      fs.promises.rename(outputFile.outside, safelyJoinPath(workingDirectory.outside, "user_out")),
      fs.promises.rename(inputFile.outside, safelyJoinPath(workingDirectory.outside, "input")),
      fs.promises.rename(answerFile.outside, safelyJoinPath(workingDirectory.outside, "answer")),
      fs.promises.writeFile(safelyJoinPath(workingDirectory.outside, "code"), code || "")
    ]);

    const sandboxResult = await runSandboxForCustomChecker(null, stdoutFile.inside, stderrFile.inside);

    if (sandboxResult.status !== SandboxStatus.OK) {
      return `Custom checker encountered a ${SandboxStatus[sandboxResult.status]}`;
    }

    const SCORE_LENGTH_LIMIT = 10;
    const scoreText = await readFileLimited(stdoutFile.outside, SCORE_LENGTH_LIMIT);
    if (!scoreText) return "Legacy checker returned empty score";

    const score = parseInt(scoreText, 10);
    if (!(score >= 0 && score <= 100)) return `Legacy checker returned an invalid score: ${scoreText || "(empty)"}`;

    const MESSAGE_LENGTH_LIMIT = 256;
    const message = await readFileOmitted(stderrFile.outside, MESSAGE_LENGTH_LIMIT);

    return {
      score,
      checkerMessage: message
    };
  }
};
