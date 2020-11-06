import fs from "fs";
import crypto from "crypto";
import { join, normalize } from "path";

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
  // eslint-disable-next-line @typescript-eslint/no-shadow
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

export function hashData(data: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  const promise = new Promise<string>((resolve, reject) => {
    hash.on("error", reject);
    hash.on("finish", () => resolve(hash.digest("hex")));
  });

  hash.end(data);

  return promise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Key = keyof any;
export type OverridableRecord<K extends Key, V> = Record<K, V | ((oldValue: V) => V)>;

export function merge<K extends Key, V>(
  baseRecord: OverridableRecord<K, V>,
  overrideRecord: OverridableRecord<K, V>
): OverridableRecord<K, V>;

export function merge<K extends Key, V>(
  baseRecord: Record<string, V>,
  overrideRecord: OverridableRecord<K, V>
): Record<string, V>;

export function merge<K extends Key, V>(baseRecord: OverridableRecord<K, V>, overrideRecord: OverridableRecord<K, V>) {
  if (!overrideRecord) return baseRecord;

  const result: OverridableRecord<K, V> = { ...baseRecord };
  Reflect.ownKeys(overrideRecord).forEach(key => {
    const valueOrReducer = overrideRecord[key];
    if (typeof valueOrReducer === "function") {
      const oldValueOrReducer = result[key];
      if (typeof oldValueOrReducer === "function")
        result[key] = (olderValue: V) => valueOrReducer(oldValueOrReducer(olderValue));
      else result[key] = valueOrReducer;
    } else result[key] = valueOrReducer;
  });
  return result;
}
