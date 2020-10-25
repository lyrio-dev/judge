import { LanguageConfig } from ".";

interface CompileAndRunOptionsHaskell {
  version: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsHaskell> = {
  name: "haskell",
  getMetaOptions: () => ({
    sourceFilename: "main.hs",
    binarySizeLimit: 5 * 1024 * 1024
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "ghc",
    parameters: [
      sourcePathInside,
      "-outputdir",
      binaryDirectoryInside,
      "-o",
      `${binaryDirectoryInside}/a.out`,
      `-XHaskell${compileAndRunOptions.version}`,
      `-O2`,
      "-dynamic",
      "-fdiagnostics-color=always",
      "-v0"
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
    process: 10,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
