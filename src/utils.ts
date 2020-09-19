import fs from "fs";

import config from "./config";
import * as fsNative from "./fsNative";

export async function setSandboxUserPermission(path: string, writeAccess: boolean): Promise<void> {
  await fsNative.chmodown(path, {
    mode: 0o755,
    owner: writeAccess ? config.sandbox.user : 0,
    group: writeAccess ? true : 0
  });
}

export async function ensureDirectoryEmpty(path: string): Promise<void> {
  await fsNative.ensureDir(path);
  await fsNative.emptyDir(path);
}

export function ensureDirectoryEmptySync(path: string) {
  fsNative.ensureDirSync(path);
  fsNative.emptyDirSync(path);
}

/**
 * Read a file's first at most `lengthLimit` bytes, ignoring the remaining bytes.
 */
export async function readFileLimited(filePath: string, lengthLimit: number): Promise<string> {
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(filePath, "r");
    const actualSize = (await file.stat()).size;
    const buf = Buffer.allocUnsafe(Math.min(actualSize, lengthLimit));
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    const ret = buf.toString("utf8", 0, bytesRead);
    return ret;
  } catch (e) {
    return "";
  } finally {
    await file.close();
  }
}

/**
 * Read a file's first at most `lengthLimit` bytes, and add `\n<n bytes omitted>` message if there're
 * more bytes remaining.
 */
export async function readFileOmitted(filePath: string, lengthLimit: number): Promise<string> {
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(filePath, "r");
    const actualSize = (await file.stat()).size;
    const buf = Buffer.allocUnsafe(Math.min(actualSize, lengthLimit));
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    let ret = buf.toString("utf8", 0, bytesRead);
    if (bytesRead < actualSize) {
      const omitted = actualSize - bytesRead;
      ret += `\n<${omitted} byte${omitted !== 1 ? "s" : ""} omitted>`;
    }
    return ret;
  } catch (e) {
    return "";
  } finally {
    await file.close();
  }
}

export function stringToOmited(str: string, lengthLimit: number) {
  if (str.length <= lengthLimit) return str;

  const omitted = str.length - lengthLimit;
  return `${str.substr(0, lengthLimit)}\n<${omitted} byte${omitted !== 1 ? "s" : ""} omitted>`;
}
