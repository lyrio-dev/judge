import posix = require("posix");
import fs = require("fs-extra");
import klaw = require("klaw");

import config from "./config";

export async function setDirectoryPermission(dirName: string, writeAccess: boolean): Promise<void> {
  const user = posix.getpwnam(config.sandbox.user);
  const operations: Promise<void>[] = [];
  return await new Promise((res, rej) => {
    klaw(dirName)
      .on("data", item => {
        operations.push(
          (async () => {
            const path = item.path;
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

export async function readFileOmitted(filePath: string, lengthLimit: number): Promise<string> {
  let file = -1;
  try {
    file = await fs.open(filePath, "r");
    const actualSize = (await fs.stat(filePath)).size;
    const buf = Buffer.allocUnsafe(Math.min(actualSize, lengthLimit));
    const bytesRead = (await fs.read(file, buf, 0, buf.length, 0)).bytesRead;
    let ret = buf.toString("utf8", 0, bytesRead);
    if (bytesRead < actualSize) {
      const omitted = actualSize - bytesRead;
      ret += `\n<${omitted} byte${omitted != 1 ? "s" : ""} omitted>`;
    }
    return ret;
  } catch (e) {
    return null;
  } finally {
    if (file != -1) {
      await fs.close(file);
    }
  }
}

export function stringToOmited(str: string, lengthLimit: number) {
  if (str.length <= lengthLimit) return str;

  const omitted = str.length - lengthLimit;
  return str.substr(0, lengthLimit) + `\n<${omitted} byte${omitted != 1 ? "s" : ""} omitted>`;
}
