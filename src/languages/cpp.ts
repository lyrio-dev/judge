import { LanguageConfig } from ".";

interface CompileAndRunOptionsCpp {
  compiler: string;
  std: string;
  O: string;
  m: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsCpp> = {
  name: "cpp",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getMetaOptions: compileAndRunOptions => ({
    sourceFilename: "main.cpp",
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB, enough unless someone initlizes globals badly
  }),
  compile: (sourcePathInside, binaryDirectoryInside, compileAndRunOptions) => ({
    executable: compileAndRunOptions.compiler === "g++" ? "/usr/bin/g++" : "/usr/bin/clang++",
    parameters: [
      sourcePathInside,
      "-o",
      `${binaryDirectoryInside}/a.out`,
      `-std=${compileAndRunOptions.std}`,
      `-O${compileAndRunOptions.O}`,
      "-fdiagnostics-color=always",
      "-DONLINE_JUDGE",
      `-m${compileAndRunOptions.m}` // TODO: ignore this option on non-x86 platform
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
    compileAndRunOptions,
    time,
    memory,
    stdinFile,
    stdoutFile,
    stderrFile,
    parameters
  ) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters,
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
