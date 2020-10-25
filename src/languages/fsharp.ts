import { LanguageConfig } from ".";

interface CompileAndRunOptionsFSharp {}

export const languageConfig: LanguageConfig<CompileAndRunOptionsFSharp> = {
  name: "fsharp",
  getMetaOptions: () => ({
    sourceFilename: "Main.fs",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside }) => ({
    executable: "fsharpc",
    parameters: ["--nologo", `--out:${binaryDirectoryInside}/Main.exe`, sourcePathInside],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 20,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: "mono",
    parameters: [`${binaryDirectoryInside}/Main.exe`, ...(parameters || [])],
    process: 10,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
