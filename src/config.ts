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
  IsNumber
} from "class-validator";
import winston from "winston";
import yaml from "js-yaml";

import { ensureDirectoryEmptySync } from "./utils";
import * as fsNative from "./fsNative";

winston.add(
  new winston.transports.Console({
    level: process.env.SYZOJ_NG_JUDGE_LOG_LEVEL || "info",
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

  @IsString({ each: true })
  @IsArray()
  environments: string[];
}

export class LimitConfig {
  @IsNumber()
  @IsPositive()
  compilerMessage: number;

  @IsNumber()
  @IsPositive()
  outputSize: number;

  @IsNumber()
  @IsPositive()
  dataDisplay: number;

  @IsNumber()
  @IsPositive()
  dataDisplayForSubmitAnswer: number;

  @IsNumber()
  @IsPositive()
  stderrDisplay: number;
}

export class Config {
  @IsString()
  serverUrl: string;

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

  @ValidateNested()
  @Type(() => SandboxConfig)
  sandbox: SandboxConfig;

  @ValidateNested()
  @Type(() => LimitConfig)
  limit: LimitConfig;
}

const filePath = process.env.SYZOJ_NG_JUDGE_CONFIG_FILE;
if (!filePath) {
  winston.error("Please specify configuration file with environment variable SYZOJ_NG_JUDGE_CONFIG_FILE");
  process.exit(1);
}

const parsedConfig = yaml.safeLoad(fs.readFileSync(filePath).toString("utf-8"));
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

if (config.binaryCacheMaxSize < config.limit.outputSize) {
  winston.error(
    `config.binaryCacheMaxSize (= ${config.binaryCacheMaxSize}) < config.limit.outputSize (= ${config.limit.outputSize}). The compile result maybe unable to be handled.`
  );
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

function checkLimitTooLarge(limit: string, maxRecommendedValue: number) {
  const value: number = config.limit[limit];
  if (value > maxRecommendedValue) {
    winston.warn(
      `config.limit.${limit} (= ${value}) is too large. This will significantly increase the server database's size.`
    );
  }
}
checkLimitTooLarge("compilerMessage", 1 * 1024 * 1024); // 1 MiB
checkLimitTooLarge("dataDisplay", 1024); // 1 KiB
checkLimitTooLarge("stderrDisplay", 10240); // 10 KiB

export default config;
