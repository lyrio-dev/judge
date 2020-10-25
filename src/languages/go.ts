import { LanguageConfig } from ".";

interface CompileAndRunOptionsGo {
  version: string;
}

export const languageConfig: LanguageConfig<CompileAndRunOptionsGo> = {
  name: "go",
  getMetaOptions: () => ({
    sourceFilename: "main.go",
    binarySizeLimit: 10 * 1024 * 1024 // 10 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside }) => ({
    executable: "go",
    parameters: ["build", "-o", `${binaryDirectoryInside}/a.out`, sourcePathInside],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 50,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside,
    environments: {
      GOCACHE: "/tmp"
    }
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: `${binaryDirectoryInside}/a.out`,
    parameters,
    process: 20,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
