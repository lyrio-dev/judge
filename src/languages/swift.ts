import { LanguageConfig } from ".";

interface CompileAndRunOptionsSwift {
  version: string;
  optimize: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsSwift> = {
  name: "swift",
  getMetaOptions: () => ({
    sourceFilename: "main.swift",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "swiftc",
    parameters: [
      "-o",
      `${binaryDirectoryInside}/a.out`,
      "-swift-version",
      compileAndRunOptions.version,
      `-${compileAndRunOptions.optimize}`,
      "-color-diagnostics",
      "-print-educational-notes",
      "-DONLINE_JUDGE",
      sourcePathInside
    ],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 30,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters,
    process: 5,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
