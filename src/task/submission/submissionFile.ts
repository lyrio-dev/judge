import fs from "fs";
import { tmpdir } from "os";

import Axios from "axios";
import winston from "winston";

import unzipper from "unzipper";

import config from "@/config";
import { safelyJoinPath, ensureDirectoryEmpty } from "@/utils";
import * as fsNative from "@/fsNative";

export interface SubmissionFileInfo {
  uuid: string;
  url: string;
}

export interface SubmissionFileUnzipResult {
  path: string;
  status: Record<
    string,
    {
      path?: string;
      success?: boolean;
      sizeExceededLimit?: boolean;
    }
  >;
}

export class SubmissionFile {
  readonly path: string;

  readonly unzippedPath: string;

  private readonly downloadPromise: Promise<void>;

  private disposed: boolean;

  constructor(fileInfo: SubmissionFileInfo) {
    // It's fine to use the uuid as filename since every submission has a different file uuid
    this.path = safelyJoinPath(tmpdir(), fileInfo.uuid);
    this.unzippedPath = safelyJoinPath(tmpdir(), `${fileInfo.uuid}_unzipped`);

    // eslint-disable-next-line no-async-promise-executor
    this.downloadPromise = new Promise(async (resolve, reject) => {
      const response = await Axios({
        url: fileInfo.url,
        responseType: "stream"
      });

      if (this.disposed) {
        resolve();
        return;
      }

      const fileStream = fs.createWriteStream(this.path);

      response.data.pipe(fileStream);

      fileStream.on("finish", resolve);
      fileStream.on("error", reject);

      winston.verbose(`SubmissionFile: start downloading file ${fileInfo.uuid}`);
    });
  }

  async waitForDownload() {
    return await this.downloadPromise;
  }

  async unzip(wantedFiles: string[]) {
    await ensureDirectoryEmpty(this.unzippedPath);

    winston.verbose(`SubmissionFile.unzip: start unzipping file ${this.path}`);

    const writeFilePromises: Promise<void>[] = [];
    const result: SubmissionFileUnzipResult = { path: this.unzippedPath, status: {} };

    // The unzipper library is poorly typed
    await fs
      .createReadStream(this.path)
      .pipe(unzipper.Parse())
      .on("entry", (entry: unzipper.Entry) => {
        if (entry.type === "File" && wantedFiles.includes(entry.path)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((entry.vars as any).uncompressedSize <= config.limit.outputSize) {
            // Unzip this file
            writeFilePromises.push(
              new Promise((resolve, reject) => {
                try {
                  entry.pipe(fs.createWriteStream(safelyJoinPath(this.unzippedPath, entry.path))).on("finish", () => {
                    result.status[entry.path] = { success: true, path: safelyJoinPath(this.unzippedPath, entry.path) };
                    resolve();
                  });
                  entry.on("error", reject);
                } catch (e) {
                  reject(e);
                }
              })
            );

            return;
          } else {
            // Size exceeded the limit
            result.status[entry.path] = { sizeExceededLimit: true };
          }
        }

        // Ignore this file
        entry.autodrain();
      })
      .promise();

    winston.verbose(`SubmissionFile.unzip: awaiting writing unzipped files of ${this.path}`);

    await Promise.all(writeFilePromises);

    winston.verbose(`SubmissionFile.unzip: unzipped ${this.path}`);

    return result;
  }

  dispose() {
    this.disposed = true;

    // No need to await
    fsNative.remove(this.path);
    fsNative.remove(this.unzippedPath);
  }
}
