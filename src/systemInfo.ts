import os from "os";

import systeminformation from "systeminformation";

export interface SystemInfo {
  // e.g. Ubuntu 18.04.2 LTS
  os: string;

  // e.g. Linux 4.15.0-76-generic
  kernel: string;

  // e.g. x64
  arch: string;

  cpu: {
    // e.g. Common KVM processor @ 4x 3.59GHz
    model: string;

    // e.g. fpu vme de pse...
    flags: string;

    // e.g. { L1d: 32768, L1i: 32768, L2: 262144, L3: 6291456 }
    cache: Record<string, string>;
  };

  memory: {
    // e.g. 8062784
    size: number;

    // e.g. SODIMM DDR3 1600MHz
    description: string;
  };

  // languageName => compilers
  // TODO: Use a manually generated yaml file in sandbox rootfs to get compilers' versions
  languages: Record<
    string,
    {
      name: string;
      version: string;
    }[]
  >;

  extraInfo: string;
}

let cachedResult: SystemInfo;

export default async function getSystemInfo(): Promise<SystemInfo> {
  if (cachedResult) return cachedResult;

  const [osInfo, cpu, cpuFlags, mem, memLayout] = await Promise.all([
    systeminformation.osInfo(),
    systeminformation.cpu(),
    systeminformation.cpuFlags(),
    systeminformation.mem(),
    systeminformation.memLayout()
  ]);

  const memory =
    memLayout.reduce((max, val) => (max.size > val.size ? max : val), memLayout[0]) || ({} as typeof memLayout[0]);

  const cpuCores = [cpu.physicalCores, cpu.cores].find(x => Number.isSafeInteger(x));

  // eslint-disable-next-line no-return-assign
  return (cachedResult = {
    os: osInfo.distro + (osInfo.release === "unknown" ? "" : ` ${osInfo.release}`),
    kernel: `${os.type().split("_").join(" ")} ${os.release()}`,
    arch: osInfo.arch,
    cpu: {
      model: [cpu.manufacturer, cpu.brand, "@", cpuCores && `${cpuCores}x`, `${cpu.speedMax || cpu.speed}GHz`]
        .filter(x => x)
        .join(" "),
      flags: cpuFlags,
      cache: Object.fromEntries(
        Object.entries(cpu.cache)
          .filter(([, size]) => size)
          .map(([cache, size]) => [cache.replace("l", "L"), size])
      )
    },
    memory: {
      size: mem.total / 1024,
      description: [memory.formFactor, memory.type, memory.clockSpeed && `${memory.clockSpeed}MHz`]
        .filter(x => x)
        .join(" ")
    },
    languages: {},
    extraInfo: ""
  });
}
