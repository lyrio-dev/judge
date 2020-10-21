import { OmittableString, omittableStringToString, prependOmittableString } from "@/omittableString";

// integers: check the equivalent of each integer in user's output and answer
export interface CheckerTypeIntegers {
  type: "integers";
}

// floats:   check each float in user's output and answer
//           allow output with relative or absolute error not exceeding [floats.precision].
export interface CheckerTypeFloats {
  type: "floats";
  precision: number;
}

// lines:    check the equivalent of text in each line (separated by "\n"), maybe case-insensitive
//           any space characters (space, \t, \r) in the end of a line will be ignored
//           any empty lines in the end of file will be ignored
export interface CheckerTypeLines {
  type: "lines";
  caseSensitive: boolean;
}

// binary:   check if the user's output and answer files are equal in binary
export interface CheckerTypeBinary {
  type: "binary";
}

// custom:   use a custom program to check the user's output
export interface CheckerTypeCustom {
  type: "custom";
  interface: string;
  language: string;
  compileAndRunOptions: unknown;
  filename: string;
  timeLimit?: number;
  memoryLimit?: number;
}

export type Checker =
  | CheckerTypeIntegers
  | CheckerTypeFloats
  | CheckerTypeLines
  | CheckerTypeBinary
  | CheckerTypeCustom;

export interface CheckerResult {
  /**
   * `score == null` means JudgementFailed.
   */
  score?: number;
  checkerMessage?: OmittableString;
}

export function parseTestlibMessage(message: OmittableString): CheckerResult | OmittableString {
  const friendlyMessage = message || "(empty)";
  const messagePlain = omittableStringToString(message);

  if (messagePlain.startsWith("ok")) {
    return {
      score: 100,
      checkerMessage: message
    };
  } else if (messagePlain.startsWith("wrong answer") || messagePlain.startsWith("wrong output format")) {
    return {
      score: 0,
      checkerMessage: message
    };
  } else if (messagePlain.startsWith("points")) {
    const match = messagePlain.match(/^points (\d+)/);
    if (!match) return prependOmittableString("Couldn't parse testlib's message: ", friendlyMessage);
    const score = parseInt(match[1], 10);
    if (!(score >= 0 && score <= 100))
      return prependOmittableString(`Got invalid score ${match[1]} from testlib's message: `, friendlyMessage);
    return {
      score,
      checkerMessage: message
    };
  } else if (messagePlain.startsWith("partially correct")) {
    const match = messagePlain.match(/^partially correct \((\d+)\)/);
    if (!match) return prependOmittableString("Couldn't parse testlib's message: ", friendlyMessage);
    const score = parseInt(match[1], 10);
    if (!(score >= 0 && score <= 200))
      return prependOmittableString(`Got invalid score ${match[1]} from testlib's message: `, friendlyMessage);
    return {
      score: Math.floor(score / 2),
      checkerMessage: message
    };
  } else if (messagePlain.startsWith("FAIL")) {
    return {
      checkerMessage: message
    };
  } else {
    return prependOmittableString("Couldn't parse testlib's message: ", friendlyMessage);
  }
}

export function getCheckerMeta<JudgeInfo extends { timeLimit?: number; memoryLimit?: number; checker: Checker }>(
  judgeInfo: JudgeInfo
): Checker {
  const { checker } = judgeInfo;

  if (checker.type !== "custom") return checker;

  return {
    ...checker,
    filename: null,
    timeLimit: checker.timeLimit || judgeInfo.timeLimit,
    memoryLimit: checker.memoryLimit || judgeInfo.memoryLimit
  };
}
