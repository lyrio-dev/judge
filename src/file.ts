import * as fs from "fs-extra";
import { join } from "path";

import axios from "axios";
import Queue from "promise-queue";
import winston from "winston";

import config from "./config";
import rpc from "./rpc";

const downloadingFiles: Map<string, Promise<void>> = new Map();
const queue = new Queue(config.maxConcurrentDownloads, Infinity);

async function fileExists(fileUuid: string): Promise<boolean> {
  return await fs.pathExists(join(config.dataStore, fileUuid));
}

// TODO: check download speed
async function downloadFile(url: string, fileUuid: string) {
  winston.info(`Downloading file ${fileUuid} from server`);
  const tempDir = join(config.dataStore, "temp");
  await fs.ensureDir(tempDir);

  const tempFilename = join(tempDir, fileUuid);
  const fileStream = fs.createWriteStream(join(tempDir, fileUuid));

  const response = await axios({
    url,
    responseType: "stream"
  });

  response.data.pipe(fileStream);

  await new Promise((resolve, reject) => {
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
  });

  const persistFilename = join(config.dataStore, fileUuid);
  await fs.move(tempFilename, persistFilename);
}

export async function ensureFiles(fileUuids: string[]) {
  fileUuids = Array.from(new Set(fileUuids));

  const nonExists: string[] = [];
  for (const fileUuid of fileUuids) {
    if (!(await fileExists(fileUuid))) nonExists.push(fileUuid);
  }

  winston.verbose(`ensureFiles: ${fileUuids.length - nonExists.length} files already exists`);
  winston.verbose(`ensureFiles: ${nonExists.length} files to download`);

  if (nonExists.length === 0) return null;

  const alreadyDownloading: Promise<void>[] = nonExists.map(fileUuid => downloadingFiles.get(fileUuid)).filter(x => x);
  const notDownloading: string[] = nonExists.filter(fileUuid => !downloadingFiles.has(fileUuid));

  winston.verbose(
    `ensureFiles: ${alreadyDownloading.length} files already downloading, requesting ${notDownloading.length} files`
  );

  const fetchFiles = rpc.requestFiles(notDownloading);
  const newDownloading = notDownloading.map((fileUuid, i) => {
    const promise = queue
      .add(async () => {
        const urlList = await fetchFiles;
        await downloadFile(urlList[i], fileUuid);
      })
      .finally(() => downloadingFiles.delete(fileUuid));

    downloadingFiles.set(fileUuid, promise);
    return promise;
  });

  return await Promise.all([...alreadyDownloading, ...newDownloading]);
}

export function getFile(fileUuid: string) {
  return join(config.dataStore, fileUuid);
}
