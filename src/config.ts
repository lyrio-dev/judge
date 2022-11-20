import { execFileSync } from "child_process";
import { resolve } from "path";
import os from "os";
import fs from "fs";

import { plainToClass, Type } from "class-transformer";
import {
  validateSync,
  IsString,
  IsInt,
  IsPositive,
  IsBase64,
  Length,
  ValidateNested,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsObject
} from "class-validator";
import winston from "winston";
import yaml from "js-yaml";

import { ensureDirectoryEmptySync } from "./utils";
import * as fsNative from "./fsNative";

winston.add(
  new winston.transports.Console({
    level: process.env.LYRIO_JUDGE_LOG_LEVEL || "info",
    format: winston.format.combine(winston.format.cli())
  })
);

export class SandboxConfig {
  @IsString()
  rootfs: string;

  @IsString()
  @IsOptional()
  hostname: string;

  @IsString()
  user: string;

  @IsObject()
  environments: Record<string, string>;
}

export class CpuAffinityConfig {
  @IsInt({ each: true })
  @IsOptional()
  compiler?: number[];

  @IsInt({ each: true })
  @IsOptional()
  userProgram?: number[];

  @IsInt({ each: true })
  @IsOptional()
  interactor?: number[];

  @IsInt({ each: true })
  @IsOptional()
  checker?: number[];
}

export class Config {
  @IsString()
  serverUrl: string;

  @IsString()
  @IsOptional()
  downloadEndpointOverride?: string;

  @IsBase64()
  @Length(40)
  @IsString()
  key: string;

  @IsString()
  dataStore: string;

  @IsString()
  binaryCacheStore: string;

  @IsInt()
  binaryCacheMaxSize: number;

  @IsPositive()
  @IsInt()
  taskConsumingThreads: number;

  @IsPositive()
  @IsInt()
  maxConcurrentDownloads: number;

  @IsPositive()
  @IsInt()
  maxConcurrentTasks: number;

  @IsString({ each: true })
  @ArrayMinSize(1)
  @IsArray()
  taskWorkingDirectories: string[];

  @IsPositive()
  @IsInt()
  rpcTimeout: number;

  @IsPositive()
  @IsInt()
  downloadTimeout: number;

  @IsPositive()
  @IsInt()
  downloadRetry: number;

  @ValidateNested()
  @Type(() => SandboxConfig)
  sandbox: SandboxConfig;

  @ValidateNested()
  @Type(() => CpuAffinityConfig)
  @IsOptional()
  cpuAffinity: CpuAffinityConfig;
}

const filePath = process.env.LYRIO_JUDGE_CONFIG_FILE;
if (!filePath) {
  winston.error("Please specify configuration file with environment variable LYRIO_JUDGE_CONFIG_FILE");
  process.exit(1);
}

const parsedConfig = yaml.load(fs.readFileSync(filePath).toString("utf-8"));
const config = plainToClass(Config, parsedConfig);
const errors = validateSync(config);
if (errors.length > 0) {
  winston.error(`Couldn't parse config file: ${JSON.stringify(errors, null, 2)}`);
  process.exit(1);
}

// Check config (errors)
if (new Set(config.taskWorkingDirectories.map(path => resolve(path))).size !== config.taskWorkingDirectories.length) {
  winston.error(`Duplicated paths in config.taskWorkingDirectories, please check the config file.`);
  process.exit(1);
}

// Create directories
for (const dir of config.taskWorkingDirectories) {
  checkTaskWorkingDirectory(dir);
}

fsNative.ensureDirSync(config.dataStore);
ensureDirectoryEmptySync(config.binaryCacheStore);

// Check config (warnings)
if (config.taskConsumingThreads > 3) {
  winston.warn(
    `config.taskConsumingThreads = ${config.taskConsumingThreads} is too large. Please consider running more judge clients on more machines.`
  );
}

if (config.maxConcurrentDownloads > 20) {
  winston.warn(
    `config.maxConcurrentDownloads = ${config.maxConcurrentDownloads}. Too large value may cause network problems.`
  );
}

const cpuCount = os.cpus().length;
if (config.maxConcurrentTasks > cpuCount) {
  winston.warn(
    `config.maxConcurrentTasks = ${config.maxConcurrentTasks}, which is lerger than the number of CPU cores (= ${cpuCount}). The timing of judge tasks will be much more unstable.`
  );
}

if (config.taskWorkingDirectories.length < config.maxConcurrentTasks) {
  winston.warn(
    `Length of config.taskWorkingDirectories (= ${config.taskWorkingDirectories.length}) < config.maxConcurrentTasks (= ${config.maxConcurrentDownloads}). Max concurrent tasks will be ${config.taskWorkingDirectories.length}.`
  );
}

for (const dir of config.taskWorkingDirectories) {
  ensureDirectoryEmptySync(dir);
}

// Some config are from server
interface ServerSideConfig {
  limit: {
    compilerMessage: number;
    outputSize: number;
    dataDisplay: number;
    dataDisplayForSubmitAnswer: number;
    stderrDisplay: number;
  };
}

function checkTaskWorkingDirectory(path: string) {
  try {
    execFileSync("findmnt", [path, "-t", "tmpfs"]);
  } catch (e) {
    if (e.errno === "ENOENT") return; // "findmnt" command not found, ignore it
    winston.warn(
      `Task working directory ${path} does NOT seem to be a tmpfs mount point. Use unique tmpfs mount point for each task to have better output size limiting and performance.`
    );
  }
}

export const serverSideConfig = {} as ServerSideConfig;
// Some of the config items are configured in server
export function updateServerSideConfig(newServerSideConfig: unknown) {
  Object.assign(serverSideConfig, newServerSideConfig);

  if (config.binaryCacheMaxSize < serverSideConfig.limit.outputSize) {
    winston.error(
      `config.binaryCacheMaxSize (= ${config.binaryCacheMaxSize}) < serverSideConfig.limit.outputSize (= ${serverSideConfig.limit.outputSize}). The compile result maybe unable to be handled.`
    );
    process.exit(1);
  }

  function checkLimitTooLarge(limit: string, maxRecommendedValue: number) {
    const value: number = serverSideConfig.limit[limit];
    if (value > maxRecommendedValue) {
      winston.warn(
        `serverSideConfig.limit.${limit} (= ${value}) is too large. This will significantly increase the server database's size.`
      );
    }
  }
  checkLimitTooLarge("compilerMessage", 1 * 1024 * 1024); // 1 MiB
  checkLimitTooLarge("dataDisplay", 1024); // 1 KiB
  checkLimitTooLarge("stderrDisplay", 10240); // 10 KiB
}

export default config;
