import fs from "fs-extra";

import posix from "posix";
import klaw from "klaw";

import config from "./config";

export async function setDirectoryPermission(dirName: string, writeAccess: boolean): Promise<void> {
  const user = posix.getpwnam(config.sandbox.user);
  const operations: Promise<void>[] = [];
  return await new Promise((res, rej) => {
    klaw(dirName)
      .on("data", item => {
        operations.push(
          (async () => {
            const { path } = item;
            await fs.chmod(path, 0o755);
            if (writeAccess) {
              await fs.chown(path, user.uid, user.gid);
            } else {
              await fs.chown(path, process.getuid(), process.getgid());
            }
          })()
        );
      })
      .on("end", () => {
        Promise.all(operations).then(() => res(), rej);
      });
  });
}

export async function ensureDirectoryEmpty(path: string): Promise<void> {
  await fs.ensureDir(path);
  await fs.emptyDir(path);
}

export function ensureDirectoryEmptySync(path: string) {
  fs.ensureDirSync(path);
  fs.emptyDirSync(path);
}

/**
 * Read a file's first at most `lengthLimit` bytes, ignoring the remaining bytes.
 */
export async function readFileLimited(filePath: string, lengthLimit: number): Promise<string> {
  let file = -1;
  try {
    file = await fs.open(filePath, "r");
    const actualSize = (await fs.stat(filePath)).size;
    const buf = Buffer.allocUnsafe(Math.min(actualSize, lengthLimit));
    const { bytesRead } = await fs.read(file, buf, 0, buf.length, 0);
    const ret = buf.toString("utf8", 0, bytesRead);
    return ret;
  } catch (e) {
    return "";
  } finally {
    if (file !== -1) {
      await fs.close(file);
    }
  }
}

/**
 * Read a file's first at most `lengthLimit` bytes, and add `\n<n bytes omitted>` message if there're
 * more bytes remaining.
 */
export async function readFileOmitted(filePath: string, lengthLimit: number): Promise<string> {
  let file = -1;
  try {
    file = await fs.open(filePath, "r");
    const actualSize = (await fs.stat(filePath)).size;
    const buf = Buffer.allocUnsafe(Math.min(actualSize, lengthLimit));
    const { bytesRead } = await fs.read(file, buf, 0, buf.length, 0);
    let ret = buf.toString("utf8", 0, bytesRead);
    if (bytesRead < actualSize) {
      const omitted = actualSize - bytesRead;
      ret += `\n<${omitted} byte${omitted !== 1 ? "s" : ""} omitted>`;
    }
    return ret;
  } catch (e) {
    return "";
  } finally {
    if (file !== -1) {
      await fs.close(file);
    }
  }
}

export function stringToOmited(str: string, lengthLimit: number) {
  if (str.length <= lengthLimit) return str;

  const omitted = str.length - lengthLimit;
  return `${str.substr(0, lengthLimit)}\n<${omitted} byte${omitted !== 1 ? "s" : ""} omitted>`;
}
