import { LanguageConfig } from ".";

interface CompileAndRunOptionsCpp {
  compiler: string;
  std: string;
  O: string;
  m: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsCpp> = {
  name: "cpp",
  getMetaOptions: () => ({
    sourceFilename: "main.cpp",
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB, enough unless someone initlizes globals badly
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: compileAndRunOptions.compiler === "g++" ? "g++" : "clang++",
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
      compileAndRunOptions.compiler === "clang++" && compileAndRunOptions.m === "64" ? "-stdlib=libc++" : null,
      `-m${compileAndRunOptions.m}`,
      "-march=native",
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
