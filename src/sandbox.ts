import fs from "fs";

import * as Sandbox from "simple-sandbox";

import config from "./config";
import { MappedPath, safelyJoinPath, setSandboxUserPermission } from "./utils";
import rpc from "./rpc";
import { CanceledError } from "./error";
import { FileDescriptor } from "./posixUtils";
import * as fsNative from "./fsNative";

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
  stdin?: string | FileDescriptor; // The file the standard input being redirect to
  stdout?: string | FileDescriptor; // The file the standard output being redirect to
  stderr?: string | FileDescriptor; // The file the standard error being redirect to
}

export interface FullExecuteParameters extends ExecuteParameters {
  time: number; // Time limit
  memory: number; // Memory limit
  workingDirectory: string; // The working directory for the compiler or script
  environments?: string[]; // Environment veriables
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
export async function startSandbox({
  taskId,
  parameters,
  tempDirectory,
  extraMounts,
  preservedFileDescriptors
}: {
  taskId: string;
  parameters: FullExecuteParameters;
  tempDirectory: string;
  extraMounts: SandboxMountDirectory[];
  preservedFileDescriptors?: FileDescriptor[];
}) {
  if (taskId) rpc.ensureNotCanceled(taskId);

  let executable: string;
  if (parameters.executable) executable = parameters.executable;
  else {
    executable = "/tmp/script.sh";
    await fs.promises.writeFile(safelyJoinPath(tempDirectory, "script.sh"), parameters.script, {
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
    await Promise.all(
      extraMounts.map(mount => fsNative.ensureDir(safelyJoinPath(config.sandbox.rootfs, mount.mappedPath.inside)))
    ),
    // TODO: Use something like bindfs to set owner for the mount point instead
    await Promise.all(extraMounts.map(mount => setSandboxUserPermission(mount.mappedPath.outside, !mount.readOnly)))
  ]);

  if (taskId) rpc.ensureNotCanceled(taskId);

  (preservedFileDescriptors || []).forEach(fd => fd && fd.setCloseOnExec(false));

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
    executable,
    stdin: typeof parameters.stdin === "object" ? (parameters.stdin || {}).fd : parameters.stdin,
    stdout: typeof parameters.stdout === "object" ? (parameters.stdout || {}).fd : parameters.stdout,
    stderr: typeof parameters.stderr === "object" ? (parameters.stderr || {}).fd : parameters.stderr,
    user: config.sandbox.user,
    cgroup: "",
    parameters: [executable, ...(parameters.parameters || []).filter(x => x != null)],
    environments: config.sandbox.environments.concat(parameters.environments || []),
    workingDirectory: parameters.workingDirectory,
    stackSize: parameters.stackSize || parameters.memory
  };

  const sandbox = Sandbox.startSandbox(sandboxParameter);

  (preservedFileDescriptors || []).forEach(fd => fd && fd.setCloseOnExec(true));

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
export async function runSandbox({
  taskId,
  parameters,
  tempDirectory,
  extraMounts,
  preservedFileDescriptors
}: {
  taskId: string;
  parameters: FullExecuteParameters;
  tempDirectory: string;
  extraMounts: SandboxMountDirectory[];
  preservedFileDescriptors?: FileDescriptor[];
}) {
  const sandbox = await startSandbox({ taskId, parameters, tempDirectory, extraMounts, preservedFileDescriptors });
  return await sandbox.waitForStop();
}
