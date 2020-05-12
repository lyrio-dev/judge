import { LanguageConfig } from ".";

interface LanguageOptionsCpp {
  compiler: string;
  std: string;
  O: string;
  m: string;
}

export const languageConfig: LanguageConfig<LanguageOptionsCpp> = {
  name: "cpp",
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
    time: 10000,
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
    stderrFile,
    parameters
  ) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters: parameters,
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
