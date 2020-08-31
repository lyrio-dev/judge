import { CompileParameters } from "@/compile";
import { RunParameters } from "@/run";
import { FileDescriptor } from "@/posixUtils";

export interface LanguageConfig<T> {
  // The name of the langauge e.g. "cpp"
  name: string;

  getMetaOptions: (
    languageOptions: T
  ) => {
    // The user submitted source file will be named with the name e.g. "main.cpp"
    sourceFilename: string;
    // The maximum binary size allowed (for the entire binary directory), will report a CompileError on exceeding
    binarySizeLimit: number;
  };

  // Return the options for running the compiler in the sandbox
  compile: (
    sourcePathInside: string, // The path of the saved source code file
    binaryDirectoryInside: string, // The directory for the compiled binary file
    languageOptions: T // Custom options passed by user
  ) => CompileParameters;

  // Return the options for running the compiled program in the sandbox
  run: (
    binaryDirectoryInside: string, // The directory of the compiled binary
    workingDirectoryInside: string, // The working directory for the user's program, also for the input / output files
    languageOptions: T, // Custom options passed by user
    time: number, // The time limit by the problem
    memory: number, // The memory limit by the problem
    stdinFile?: string | FileDescriptor,
    stdoutFile?: string | FileDescriptor,
    stderrFile?: string | FileDescriptor,
    parameters?: string[] // The parameters passed by command line, mainly used by custom checkers
  ) => RunParameters;
}

/* eslint-disable import/no-dynamic-require */
/* eslint-disable @typescript-eslint/no-var-requires */
const langauges: Record<string, LanguageConfig<unknown>> = Object.fromEntries(
  (["cpp"].map(name => require(`./${name}`).languageConfig) as LanguageConfig<unknown>[]).map(language => [
    language.name,
    language
  ])
);
/* eslint-enable import/no-dynamic-require */
/* eslint-enable @typescript-eslint/no-var-requires */

export default function getLanguage(language: string) {
  const languageConfig = langauges[language];
  if (!languageConfig) {
    throw new Error(`Unsupported code language: ${language}`);
  }
  return languageConfig;
}
