import fs from "fs";

export type OmittableString =
  | string
  | {
      data: string;
      omittedLength: number;
    };

export async function readFileOmitted(filePath: string, lengthLimit: number): Promise<OmittableString> {
  let file: fs.promises.FileHandle;
  try {
    try {
      file = await fs.promises.open(filePath, "r");
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw e;
    }

    const fullLength = (await file.stat()).size;
    const buffer = Buffer.allocUnsafe(Math.min(fullLength, lengthLimit));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const data = buffer.toString("utf8");
    if (bytesRead < fullLength)
      return {
        data,
        omittedLength: fullLength - bytesRead
      };
    else return data;
  } finally {
    if (file) await file.close();
  }
}

export function stringToOmited(str: string, lengthLimit: number): OmittableString {
  if (str.length <= lengthLimit) return str;

  const omitted = str.length - lengthLimit;
  return {
    data: str.substr(0, lengthLimit),
    omittedLength: omitted
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isOmittableString(object: any): object is OmittableString {
  return (
    typeof object === "string" ||
    ("data" in object &&
      typeof object.data === "string" &&
      "omittedLength" in object &&
      typeof object.omittedLength === "number")
  );
}

export function omittableStringToString(omittableString: OmittableString) {
  return typeof omittableString === "string" ? omittableString : omittableString.data;
}

export function prependOmittableString(str: string, omittableString: OmittableString, trim = false): OmittableString {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const trimString = (str: string) => (trim ? str.trim() : str);
  return typeof omittableString === "string"
    ? trimString(str + omittableString)
    : {
        data: trimString(str + omittableString.data),
        omittedLength: omittableString.omittedLength
      };
}
