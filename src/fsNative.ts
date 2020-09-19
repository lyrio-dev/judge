import bindings from "bindings";

const fsNative = bindings("fs_native");

/* eslint-disable */
// Native exceptions have no callback stacks. Make a new error object with the stack.
function wrap(func: Function, async: boolean): any {
  return async
    ? async (...args: any[]) => {
        try {
          return await func(...args);
        } catch (e) {
          throw new Error(e.message);
        }
      }
    : (...args: any[]) => {
        try {
          return func(...args);
        } catch (e) {
          throw new Error(e.message);
        }
      };
}
/* eslint-enable */

export const remove: (path: string) => Promise<void> = wrap(fsNative.remove, true);
export const removeSync: (path: string) => void = wrap(fsNative.removeSync, false);

export const copy: (src: string, dst: string) => Promise<void> = wrap(fsNative.copy, true);
export const copySync: (src: string, dst: string) => void = wrap(fsNative.copySync, false);

export const exists: (path: string) => Promise<boolean> = wrap(fsNative.exists, true);
export const existsSync: (path: string) => boolean = wrap(fsNative.existsSync, false);

export const ensureDir: (path: string) => Promise<void> = wrap(fsNative.ensureDir, true);
export const ensureDirSync: (path: string) => void = wrap(fsNative.ensureDirSync, false);

export const emptyDir: (path: string) => Promise<void> = wrap(fsNative.emptyDir, true);
export const emptyDirSync: (path: string) => void = wrap(fsNative.emptyDirSync, false);

export const calcSize: (path: string) => Promise<number> = wrap(fsNative.calcSize, true);
export const calcSizeSync: (path: string) => number = wrap(fsNative.calcSizeSync, false);

export interface ChmodownOptions {
  mode?: number;
  owner?: string | number;

  /**
   * If it's `true`, it means to use the gid of the `owner` option.
   */
  group?: string | number | boolean;
}

export const chmodown: (path: string, options: ChmodownOptions) => Promise<void> = wrap(fsNative.chmodown, true);
export const chmodownSync: (path: string, options: ChmodownOptions) => void = wrap(fsNative.chmodownSync, false);
