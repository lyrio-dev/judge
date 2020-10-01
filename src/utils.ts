import fs from "fs";
import crypto from "crypto";
import { join, normalize } from "path";

import config from "./config";
import * as fsNative from "./fsNative";

export interface MappedPath {
  outside: string;
  inside: string;
}

// A useful wrapper for path.join()

export function safelyJoinPath(basePath: MappedPath, ...paths: string[]): MappedPath;
export function safelyJoinPath(basePath: string, ...paths: string[]): string;

/**
 * Safely join paths. Ensure the joined path won't escape the base path.
 */
export function safelyJoinPath(basePath: MappedPath | string, ...paths: string[]) {
  // eslint-disable-next-line no-shadow
  function doSafelyJoin(basePath: string, paths: string[]) {
    // path.normalize ensures the `../`s is on the left side of the result path
    const childPath = normalize(join(...paths));
    if (childPath.startsWith(".."))
      throw new Error(
        `Invalid path join: ${JSON.stringify(
          {
            basePath,
            paths
          },
          null,
          2
        )}`
      );

    return join(basePath, childPath);
  }

  if (typeof basePath === "string") return doSafelyJoin(basePath, paths);
  return {
    inside: doSafelyJoin(basePath.inside, paths),
    outside: doSafelyJoin(basePath.outside, paths)
  };
}

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

export function hashData(data: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  const promise = new Promise<string>((resolve, reject) => {
    hash.on("error", reject);
    hash.on("finish", () => resolve(hash.digest("hex")));
  });

  hash.end(data);

  return promise;
}
