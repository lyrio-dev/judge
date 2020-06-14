import bindings = require("bindings");

const posixUtils = bindings("posix");

/**
 * A list of dispose functions. Functions can be added to be executed when "dispose" is called.
 */
export class Disposer {
  private disposeFunctions: (() => void)[] = [];

  add(disposeFunction: () => void) {
    this.disposeFunctions.push(disposeFunction);
  }

  dispose() {
    this.disposeFunctions.forEach(f => f());
    this.disposeFunctions = [];
  }
}

export class FileDescriptor {
  constructor(public fd: number, private disposer: Disposer) {
    this.setCloseOnExec(true);
    disposer.add(() => this.close());
  }

  /**
   * Set or clear `O_CLOEXEC` flag on the file descriptor.
   */
  setCloseOnExec(closeOnExec: boolean) {
    posixUtils.fcntl_set_cloexec(this.fd, closeOnExec);
  }

  close() {
    posixUtils.close(this.fd);
  }
}

export interface Pipe {
  read: FileDescriptor;
  write: FileDescriptor;
}

export function createPipe(disposer: Disposer): Pipe {
  const pipe = posixUtils.pipe();
  return {
    read: new FileDescriptor(pipe.read, disposer),
    write: new FileDescriptor(pipe.write, disposer)
  };
}

export function createSharedMemory(size: number, disposer: Disposer): FileDescriptor {
  const fd: number = posixUtils.memfd_create("SharedMemory", 0);
  posixUtils.ftruncate(fd, size);
  return new FileDescriptor(fd, disposer);
}
