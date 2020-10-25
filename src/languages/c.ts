import { LanguageConfig } from ".";

interface CompileAndRunOptionsC {
  compiler: string;
  std: string;
  O: string;
  m: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsC> = {
  name: "c",
  getMetaOptions: () => ({
    sourceFilename: "main.c",
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB, enough unless someone initlizes globals badly
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: compileAndRunOptions.compiler === "gcc" ? "gcc" : "clang",
    parameters: [
      "-o",
      `${binaryDirectoryInside}/a.out`,
      `-std=${compileAndRunOptions.std}`,
      `-O${compileAndRunOptions.O}`,
      "-fdiagnostics-color=always",
      "-DONLINE_JUDGE",
      "-Wall",
      "-Wextra",
      "-Wno-unused-result",
      `-m${compileAndRunOptions.m}`,
      sourcePathInside
    ],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 20,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters,
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
