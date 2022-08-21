import * as Sandbox from "simple-sandbox";

import config from "./config";
import { MappedPath, safelyJoinPath, OverridableRecord, merge } from "./utils";
import rpc from "./rpc";
import { CanceledError } from "./error";
import { FileDescriptor } from "./posixUtils";
import * as fsNative from "./fsNative";

export enum CpuAffinityStrategy {
  Compiler = "Compiler",
  UserProgram = "UserProgram",
  Interactor = "Interactor",
  Checker = "Checker"
}

/**
 * `TaskIndependentSandboxConfig` doesn't contain `time`, `memory` and `workingDirectory` property.
 *
 * It's used for language's run config since some config of one language is common and task independent.
 *
 * @note Remember to use `merge` if you want to override environments from this config.
 */
export interface TaskIndependentSandboxConfig {
  /**
   * If `executable` is passed, it will be the file to execute
   */
  executable?: string;
  /**
   * If `script` is passed, it will be written to a file and the file becomes the `executable`
   * The compiler / user program should be executed by the script
   * Note that the script itself, if not executed the compiler / user program via exec syscall, will be
   * also calcuated to the process limit
   */
  script?: string;

  /**
   * Will be prepend with the executable (or written script path) as argv
   */
  parameters: string[];
  /**
   * Stack size limit, by default equals to the memory limit
   * Note that for some language runtimes a too large stack size could cause issues
   */
  stackSize?: number;
  /**
   * The maximum process the executable can create (in the same time), including threads
   */
  process: number;
  /**
   * The file the standard input being redirect to
   */
  stdin?: string | FileDescriptor;
  /**
   * The file the standard output being redirect to
   */
  stdout?: string | FileDescriptor;
  /**
   * The file the standard error being redirect to
   */
  stderr?: string | FileDescriptor;

  /**
   * The being overrided environment variables
   */
  environments?: OverridableRecord<string, string>;
}

/**
 * `SandboxConfigBase` doesn't contain `tempDirectoryOutside`, `extraMounts` and `cpuAffinity` property.
 *
 * It's used for compilation config since we use common mounting config and CPU affinity for all languages.
 */
export interface SandboxConfigBase extends TaskIndependentSandboxConfig {
  time: number;
  memory: number;
  /**
   * The working directory for the process
   */
  workingDirectory: string;

  /**
   * The list of file descriptors to be preserved after `exec`
   */
  preservedFileDescriptors?: FileDescriptor[];
}

export interface SandboxConfig extends SandboxConfigBase {
  /**
   * The directory path outside the sandbox being mounted to `/tmp` inside sandbox
   */
  tempDirectoryOutside: string;

  /**
   * Extra mounts other than temp directory
   */
  extraMounts: SandboxMountDirectory[];

  /**
   * Pin the task to specfic CPU cores (starting from 0, defined in config)
   */
  cpuAffinity: CpuAffinityStrategy;
}

export interface SandboxMountDirectory {
  mappedPath: MappedPath;
  readOnly: boolean;
}

export const SANDBOX_INSIDE_PATH_BINARY = "/sandbox/binary";
export const SANDBOX_INSIDE_PATH_WORKING = "/sandbox/working";
export const SANDBOX_INSIDE_PATH_SOURCE = "/sandbox/source";

const sandboxUser = Sandbox.getUidAndGidInSandbox(config.sandbox.rootfs, config.sandbox.user);
async function setSandboxUserPermission(path: string, writeAccess: boolean): Promise<void> {
  await fsNative.chmodown(path, {
    mode: 0o755,
    owner: writeAccess ? sandboxUser.uid : 0,
    group: writeAccess ? sandboxUser.gid : 0
  });
}

function resolveSandboxCpuAffinity(strategy: CpuAffinityStrategy): number[] {
  const map = {
    [CpuAffinityStrategy.Compiler]: config.cpuAffinity?.compiler,
    [CpuAffinityStrategy.UserProgram]: config.cpuAffinity?.userProgram,
    [CpuAffinityStrategy.Interactor]: config.cpuAffinity?.interactor,
    [CpuAffinityStrategy.Checker]: config.cpuAffinity?.checker
  };

  if (!(strategy in map)) {
    throw new Error(`Unknown CPU affinity strategy: ${strategy}`);
  }

  return map[strategy];
}

/**
 * @param taskId If not null, it is used to determine if and be notified when the current is canceled.
 */
export async function startSandbox(taskId: string, sandboxConfig: SandboxConfig) {
  if (taskId) rpc.ensureNotCanceled(taskId);

  let executable: string;
  let parametersPrepend: string[];
  if (sandboxConfig.executable) {
    executable = sandboxConfig.executable;
    parametersPrepend = [executable];
  } else {
    executable = "/bin/bash";
    parametersPrepend = [executable, "-c", sandboxConfig.script, "script.sh"];
  }

  const mounts = sandboxConfig.extraMounts.concat([
    {
      mappedPath: {
        outside: sandboxConfig.tempDirectoryOutside,
        inside: "/tmp"
      },
      readOnly: false
    }
  ]);

  await Promise.all([
    // Create the mount points in the sandbox rootfs
    await Promise.all(
      mounts.map(mount => fsNative.ensureDir(safelyJoinPath(config.sandbox.rootfs, mount.mappedPath.inside)))
    ),
    // TODO: Use something like bindfs to set owner for the mount point instead
    await Promise.all(mounts.map(mount => setSandboxUserPermission(mount.mappedPath.outside, !mount.readOnly)))
  ]);

  if (taskId) rpc.ensureNotCanceled(taskId);

  const preservedFileDescriptors = sandboxConfig.preservedFileDescriptors || [];
  preservedFileDescriptors.forEach(fd => fd && fd.setCloseOnExec(false));

  const environments = merge(config.sandbox.environments, sandboxConfig.environments);

  const sandboxParameter: Sandbox.SandboxParameter = {
    time: sandboxConfig.time,
    memory: sandboxConfig.memory,
    process: sandboxConfig.process,
    chroot: config.sandbox.rootfs,
    hostname: config.sandbox.hostname,
    mounts: mounts.map(mount => ({
      src: mount.mappedPath.outside,
      dst: mount.mappedPath.inside,
      limit: mount.readOnly ? 0 : -1
    })),
    redirectBeforeChroot: false,
    mountProc: true,
    executable,
    stdin: typeof sandboxConfig.stdin === "object" ? (sandboxConfig.stdin || {}).fd : sandboxConfig.stdin,
    stdout: typeof sandboxConfig.stdout === "object" ? (sandboxConfig.stdout || {}).fd : sandboxConfig.stdout,
    stderr: typeof sandboxConfig.stderr === "object" ? (sandboxConfig.stderr || {}).fd : sandboxConfig.stderr,
    user: sandboxUser,
    cgroup: "",
    parameters: [...parametersPrepend, ...(sandboxConfig.parameters || []).filter(x => x != null)],
    environments: Object.entries(environments).map(([key, value]) => `${key}=${value}`),
    workingDirectory: sandboxConfig.workingDirectory,
    stackSize: sandboxConfig.stackSize || sandboxConfig.memory,
    cpuAffinity: resolveSandboxCpuAffinity(sandboxConfig.cpuAffinity)
  };

  const sandbox = Sandbox.startSandbox(sandboxParameter);

  preservedFileDescriptors.forEach(fd => fd && fd.setCloseOnExec(true));

  const resultPromise = taskId
    ? // eslint-disable-next-line no-async-promise-executor
      new Promise<Sandbox.SandboxResult>(async (resolve, reject) => {
        const off = rpc.onCancel(taskId, () => {
          sandbox.stop();
        });

        try {
          const result = await sandbox.waitForStop();
          off();
          if (rpc.isCanceled(taskId)) reject(new CanceledError());
          else resolve(result);
        } catch (e) {
          off();
          reject(e);
        }
      })
    : sandbox.waitForStop();

  return {
    waitForStop: () => resultPromise,
    stop: () => sandbox.stop()
  };
}

/**
 * @param taskId If not null, it is used to determine if and be notified when the current is canceled.
 */
export async function runSandbox(taskId: string, sandboxConfig: SandboxConfig) {
  const sandbox = await startSandbox(taskId, sandboxConfig);
  return await sandbox.waitForStop();
}
