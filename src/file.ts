import fs from "fs";
import crypto from "crypto";

import Queue from "promise-queue";
import winston from "winston";
import LRUCache from "lru-cache";

import config from "./config";
import rpc from "./rpc";
import * as fsNative from "./fsNative";
import { download, safelyJoinPath } from "./utils";

const downloadingFiles: Map<string, Promise<void>> = new Map();
const queue = new Queue(config.maxConcurrentDownloads, Infinity);

async function fileExists(fileUuid: string): Promise<boolean> {
  return await fsNative.exists(safelyJoinPath(config.dataStore, fileUuid));
}

async function downloadFile(url: string, fileUuid: string) {
  winston.info(`Downloading file ${fileUuid} from server`);
  const tempDir = safelyJoinPath(config.dataStore, "temp");
  await fsNative.ensureDir(tempDir);

  const tempFilename = safelyJoinPath(tempDir, fileUuid);

  await download(url, tempFilename, `testdata file ${fileUuid}`);

  const persistFilename = safelyJoinPath(config.dataStore, fileUuid);
  await fs.promises.rename(tempFilename, persistFilename);
}

export async function ensureFiles(fileUuids: string[]) {
  fileUuids = Array.from(new Set(fileUuids));

  const nonExists: string[] = [];
  await Promise.all(
    fileUuids.map(async fileUuid => {
      if (!(await fileExists(fileUuid))) nonExists.push(fileUuid);
    })
  );

  winston.verbose(`ensureFiles: ${fileUuids.length - nonExists.length} files already exists`);
  winston.verbose(`ensureFiles: ${nonExists.length} files to download`);

  if (nonExists.length === 0) return null;

  const alreadyDownloading: Promise<void>[] = nonExists.map(fileUuid => downloadingFiles.get(fileUuid)).filter(x => x);
  const notDownloading: string[] = nonExists.filter(fileUuid => !downloadingFiles.has(fileUuid));

  winston.verbose(`ensureFiles: ${alreadyDownloading.length} files already downloading`);

  let newDownloading: Promise<void>[] = [];
  if (notDownloading.length === 0) {
    winston.verbose(`ensureFiles: no files to request`);
  } else {
    winston.verbose(`ensureFiles: requesting ${notDownloading.length} files`);

    const fetchFiles = rpc.requestFiles(notDownloading);
    newDownloading = notDownloading.map((fileUuid, i) => {
      const promise = queue
        .add(async () => {
          const urlList = await fetchFiles;
          await downloadFile(urlList[i], fileUuid);
        })
        .finally(() => downloadingFiles.delete(fileUuid));

      downloadingFiles.set(fileUuid, promise);
      return promise;
    });
  }

  return await Promise.all([...alreadyDownloading, ...newDownloading]);
}

export function getFile(fileUuid: string) {
  return safelyJoinPath(config.dataStore, fileUuid);
}

/**
 * We use SHA256 to distinguish different input/output files for a testcase
 * It's cached in a LRU cache.
 */
const fileHashCache = new LRUCache<string, Promise<string>>({
  // One file's SHA256 cache costs very little, so we can cache very much results.
  max: 1024 * 1024
});

const emptyDataHash = crypto.createHash("sha256").update("").digest("hex");
export async function getFileHash(fileUuid: string) {
  if (!fileUuid) return emptyDataHash;

  if (fileHashCache.has(fileUuid)) return await fileHashCache.get(fileUuid);

  const promise = new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");

    const file = fs.createReadStream(getFile(fileUuid));
    file.pipe(hash);

    file.on("error", reject);
    hash.on("error", reject);

    hash.on("finish", () => resolve(hash.digest("hex")));
  });

  fileHashCache.set(fileUuid, promise);

  return await promise;
}
