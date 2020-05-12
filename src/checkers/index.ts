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
  languageOptions: unknown;
  filename: string;
}

export type Checker =
  | CheckerTypeIntegers
  | CheckerTypeFloats
  | CheckerTypeLines
  | CheckerTypeBinary
  | CheckerTypeCustom;

export interface CheckerResult {
  score: number;
  checkerMessage?: string;
}

export function parseTestlibMessage(message: string): CheckerResult | string {
  const friendlyMessage = message ? message : "(empty)";

  if (message.startsWith("ok")) {
    return {
      score: 100,
      checkerMessage: message
    };
  } else if (message.startsWith("wrong answer") || message.startsWith("wrong output format")) {
    return {
      score: 0,
      checkerMessage: message
    };
  } else if (message.startsWith("points")) {
    const match = message.match(/^points (\d+)/);
    if (!match) return `Couldn't parse testlib's message: ${friendlyMessage}`;
    const score = parseInt(match[1]);
    if (!(score >= 0 && score <= 100))
      return `Got invalid score ${match[1]} from testlib's message: ${friendlyMessage}`;
    return {
      score,
      checkerMessage: message
    };
  } else if (message.startsWith("partially correct")) {
    const match = message.match(/^partially correct \((\d+)\)/);
    if (!match) return `Couldn't parse testlib's message: ${friendlyMessage}`;
    const score = parseInt(match[1]);
    if (!(score >= 0 && score <= 200))
      return `Got invalid score ${match[1]} from testlib's message: ${friendlyMessage}`;
    return {
      score: Math.floor(score / 2),
      checkerMessage: message
    };
  } else if (message.startsWith("FAIL")) {
    return message;
  } else {
    return `Couldn't parse testlib's message: ${friendlyMessage}`;
  }
}
