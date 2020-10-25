import { LanguageConfig } from ".";

interface CompileAndRunOptionsKotlin {
  version: string;
  platform: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsKotlin> = {
  name: "kotlin",
  getMetaOptions: () => ({
    sourceFilename: "Main.kt",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "kotlinc",
    parameters: [
      sourcePathInside,
      "-Dkotlin.colors.enabled=true",
      "-d",
      binaryDirectoryInside,
      "-language-version",
      compileAndRunOptions.version
    ],
    time: 20000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 30,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: "kotlin",
    parameters: ["-classpath", binaryDirectoryInside, "MainKt", ...(parameters || [])],
    process: 20,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
