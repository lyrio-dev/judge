import { promisify } from "util";

import bindings from "bindings";

import { OmittableString } from "@/omittableString";

import { Checker, CheckerResult, parseTestlibMessage } from ".";

const native = bindings("builtin_checkers");
const nativeRunBuiltinChecker = promisify(native.runBuiltinChecker);

export async function runBuiltinChecker(
  outputFilePath: string,
  answerFilePath: string,
  checker: Checker
): Promise<CheckerResult | OmittableString> {
  const message = await nativeRunBuiltinChecker(outputFilePath, answerFilePath, checker);
  return parseTestlibMessage(message);
}
