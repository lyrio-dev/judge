import { LanguageConfig } from ".";

interface CompileAndRunOptionsPascal {
  optimize: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsPascal> = {
  name: "pascal",
  getMetaOptions: () => ({
    sourceFilename: "main.pas",
    binarySizeLimit: 5 * 1024 * 1024
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    executable: "fpc",
    parameters: ["-vw", `-FE${binaryDirectoryInside}`, `-O${compileAndRunOptions.optimize}`, sourcePathInside],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 20,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: `${binaryDirectoryInside}/main`,
    parameters,
    process: 1,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
