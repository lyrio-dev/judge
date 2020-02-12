import { validateSync, IsIn } from "class-validator";
import { plainToClass } from "class-transformer";

import { LanguageConfig } from ".";

class LanguageOptionsCpp {
  @IsIn(["g++", "clang++"])
  compiler: string;

  @IsIn(["c++03", "c++11", "c++14", "c++17"])
  std: string;

  @IsIn(["0", "1", "2", "3", "fast"])
  O: string;

  @IsIn(["64", "32", "x32"])
  m: string;
}

export const languageConfig: LanguageConfig<LanguageOptionsCpp> = {
  name: "cpp",
  validateLanguageOptions: languageOptions => validateSync(plainToClass(LanguageOptionsCpp, languageOptions)),
  getMetaOptions: languageOptions => ({
    sourceFilename: "main.cpp",
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB, enough unless someone initlizes globals badly
  }),
  compile: (sourcePathInside, binaryDirectoryInside, languageOptions) => ({
    executable: languageOptions.compiler === "g++" ? "/usr/bin/g++" : "/usr/bin/clang++",
    parameters: [
      sourcePathInside,
      "-o",
      `${binaryDirectoryInside}/a.out`,
      `-std=${languageOptions.std}`,
      `-O${languageOptions.O}`,
      "-fdiagnostics-color=always",
      "-DONLINE_JUDGE",
      `-m${languageOptions.m}` // TODO: ignore this option on non-x86 platform
    ],
    time: 5000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 10,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: (
    binaryDirectoryInside,
    workingDirectoryInside,
    languageOptions,
    time,
    memory,
    stdinFile,
    stdoutFile,
    stderrFile
  ) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters: [],
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
