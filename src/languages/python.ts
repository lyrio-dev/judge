import fs from "fs";
import path from "path";

import { LanguageConfig } from ".";

interface CompileAndRunOptionsPython {
  version: string;
}

const sourceFilename = "main.py";

// This script copies the source file to the binary directory and compile it to bytecode
const compileScript = fs.readFileSync(path.resolve(__dirname, "compile-python.sh"), "utf-8");

export const languageConfig: LanguageConfig<CompileAndRunOptionsPython> = {
  name: "python",
  getMetaOptions: () => ({
    sourceFilename,
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB
  }),
  compile: ({ sourceDirectoryInside, binaryDirectoryInside, compileAndRunOptions }) => ({
    script: compileScript,
    parameters: [`python${compileAndRunOptions.version}`, sourceDirectoryInside, binaryDirectoryInside],
    time: 10000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 20,
    stdout: `${binaryDirectoryInside}/message.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, compileAndRunOptions, stdinFile, stdoutFile, stderrFile, parameters }) => ({
    executable: `python${compileAndRunOptions.version}`,
    parameters: [`${binaryDirectoryInside}/${sourceFilename}`, ...(parameters || [])],
    process: 20,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
