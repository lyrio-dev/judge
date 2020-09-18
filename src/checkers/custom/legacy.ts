import fs from "fs-extra";

import { v4 as uuid } from "uuid";
import { SandboxStatus } from "simple-sandbox";

import { joinPath } from "@/sandbox";

import { readFileLimited, readFileOmitted } from "@/utils";

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
    const stdoutFile = joinPath(workingDirectory, uuid());
    const stderrFile = joinPath(workingDirectory, uuid());

    await Promise.all([
      fs.rename(inputFile.outside, joinPath(workingDirectory.outside, "input")),
      fs.rename(outputFile.outside, joinPath(workingDirectory.outside, "user_out")),
      fs.rename(answerFile.outside, joinPath(workingDirectory.outside, "answer")),
      fs.writeFile(joinPath(workingDirectory.outside, "code"), code || "")
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
