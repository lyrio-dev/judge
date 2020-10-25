import { LanguageConfig } from ".";

interface CompileAndRunOptionsCSharp {
  version: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsCSharp> = {
  name: "csharp",
  getMetaOptions: () => ({
    sourceFilename: "Main.cs",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "csc",
    parameters: [
      "-nologo",
      `-langversion:${compileAndRunOptions.version}`,
      `-out:${binaryDirectoryInside}/Main.exe`,
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
    executable: "mono",
    parameters: [`${binaryDirectoryInside}/Main.exe`, ...(parameters || [])],
    process: 10,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
