import * as Sandbox from "simple-sandbox";
import { v4 as uuid } from "uuid";
import * as fs from "fs-extra";
import { join } from "path";

import config from "./config";
import { setDirectoryPermission } from "./utils";
import rpc from "./rpc";
import { CanceledError } from "./error";
import { SandboxResult, SandboxStatus } from "simple-sandbox";

export interface MappedPath {
  outside: string;
  inside: string;
}

// A useful wrapper for path.join()

export function joinPath(basePath: MappedPath, ...paths: string[]): MappedPath;
export function joinPath(basePath: string, ...paths: string[]): string;

export function joinPath(basePath: MappedPath | string, ...paths: string[]) {
  if (typeof basePath === "string") return join.apply(this, [basePath, ...paths]);
  return {
    inside: join.apply(this, [basePath.inside, ...paths]),
    outside: join.apply(this, [basePath.outside, ...paths])
  };
}

export interface ExecuteParameters {
  // If `executable` is passed, it will be the file to execute
  executable?: string;
  // If `script` is passed, it will be written to a file and the file becomes the `executable`
  // The compiler / user program should be executed by the script
  // Note that the script itself, if not executed the compiler / user program via exec syscall, will be
  // also calcuated to the process limit
  script?: string;

  parameters: string[]; // Will be prepend with the executable (or written script path) as argv
  stackSize?: number; // Stack size limit, by default equals to the memory limit
  // Note that for some language runtimes a too large stack size could cause issues
  process: number; // The maximum process the executable can create (in the same time), including threads
  stdin?: string; // The file the standard input being redirect to
  stdout?: string; // The file the standard output being redirect to
  stderr?: string; // The file the standard error being redirect to
}

export interface FullExecuteParameters extends ExecuteParameters {
  time: number; // Time limit
  memory: number; // Memory limit
  workingDirectory: string; // The working directory for the compiler or script
}

export interface SandboxMountDirectory {
  mappedPath: MappedPath;
  readOnly: boolean;
}

export const SANDBOX_INSIDE_PATH_BINARY = "/sandbox/binary";
export const SANDBOX_INSIDE_PATH_WORKING = "/sandbox/working";
export const SANDBOX_INSIDE_PATH_SOURCE = "/sandbox/source";

/**
 * @param taskId If not null, it is used to determine if and be notified when the current is canceled.
 */
export async function runSandbox(
  taskId: string,
  parameters: FullExecuteParameters,
  tempDirectory: string,
  extraMounts: SandboxMountDirectory[]
) {
  if (taskId) rpc.ensureNotCanceled(taskId);

  let executable: string;
  if (parameters.executable) executable = parameters.executable;
  else {
    executable = "/tmp/script.sh";
    await fs.writeFile(join(tempDirectory, "script.sh"), parameters.script, {
      mode: 0o755
    });
  }

  extraMounts = extraMounts.concat([
    {
      mappedPath: {
        outside: tempDirectory,
        inside: "/tmp"
      },
      readOnly: false
    }
  ]);

  await Promise.all([
    // Create the mount points in the sandbox rootfs
    await Promise.all(extraMounts.map(mount => fs.ensureDir(join(config.sandbox.rootfs, mount.mappedPath.inside)))),
    // TODO: Use something like bindfs to set owner for the mount point instead
    await Promise.all(extraMounts.map(mount => setDirectoryPermission(mount.mappedPath.outside, !mount.readOnly)))
  ]);

  const sandboxParameter: Sandbox.SandboxParameter = {
    time: parameters.time,
    memory: parameters.memory,
    process: parameters.process,
    chroot: config.sandbox.rootfs,
    hostname: config.sandbox.hostname,
    mounts: extraMounts.map(mount => ({
      src: mount.mappedPath.outside,
      dst: mount.mappedPath.inside,
      limit: mount.readOnly ? 0 : -1
    })),
    redirectBeforeChroot: false,
    mountProc: true,
    executable: executable,
    stdin: parameters.stdin,
    stdout: parameters.stdout,
    stderr: parameters.stderr,
    user: config.sandbox.user,
    cgroup: uuid(),
    parameters: [executable, ...(parameters.parameters || []).filter(x => x != null)],
    environments: config.sandbox.environments,
    workingDirectory: parameters.workingDirectory,
    stackSize: parameters.stackSize || parameters.memory
  };

  if (taskId) rpc.ensureNotCanceled(taskId);

  const sandbox = Sandbox.startSandbox(sandboxParameter);

  if (taskId) {
    return new Promise<SandboxResult>(async (resolve, reject) => {
      const off = rpc.onCancel(taskId, () => {
        sandbox.stop();
      });

      try {
        const result = await sandbox.waitForStop();
        off();
        if (result.status === SandboxStatus.Cancelled) reject(new CanceledError());
        else resolve(result);
      } catch (e) {
        off();
        reject(e);
      }
    });
  } else return await sandbox.waitForStop();
}
