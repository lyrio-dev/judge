import { LanguageConfig } from ".";

interface CompileAndRunOptionsRust {
  version: string;
  optimize: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsRust> = {
  name: "rust",
  getMetaOptions: () => ({
    sourceFilename: "main.rs",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "rustc",
    parameters: [
      "-o",
      `${binaryDirectoryInside}/a.out`,
      `--edition=${compileAndRunOptions.version}`,
      `-Copt-level=${compileAndRunOptions.optimize}`,
      "--color=always",
      "--cfg",
      "ONLINE_JUDGE",
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
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
