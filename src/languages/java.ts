import fs from "fs";
import path from "path";

import { LanguageConfig } from ".";

interface CompileAndRunOptionsJava {}

// This script renames the source file to the expected name (if necessary) automatically
// The result file's name with ".class" suffix removed will be written to stdout (the extra info file)
// So we execute "javac -classpath /binary/directory/inside extraInfoFileContent"
const compileScript = fs.readFileSync(path.resolve(__dirname, "compile-java.sh"), "utf-8");

export const languageConfig: LanguageConfig<CompileAndRunOptionsJava> = {
  name: "java",
  getMetaOptions: () => ({
    sourceFilename: "Main.java",
    binarySizeLimit: 5 * 1024 * 1024 // 5 MiB
  }),
  compile: ({ sourcePathInside, binaryDirectoryInside }) => ({
    script: compileScript,
    parameters: [sourcePathInside, binaryDirectoryInside],
    time: 20000,
    memory: 1024 * 1024 * 1024 * 2,
    process: 30,
    stdout: `${binaryDirectoryInside}/classname.txt`,
    stderr: `${binaryDirectoryInside}/message.txt`,
    messageFile: "message.txt",
    extraInfoFile: "classname.txt",
    workingDirectory: binaryDirectoryInside
  }),
  run: ({ binaryDirectoryInside, stdinFile, stdoutFile, stderrFile, parameters, compileResultExtraInfo }) => ({
    executable: "java",
    parameters: ["-classpath", binaryDirectoryInside, compileResultExtraInfo, ...(parameters || [])],
    process: 20,
    stdin: stdinFile,
    stdout: stdoutFile,
    stderr: stderrFile
  })
};
