# SYZOJ NG Judge

[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg?style=flat-square)](http://commitizen.github.io/cz-cli/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

The judge client of next-generation SYZOJ.

# Features
* Download files from server automatically.
* Run multiple tasks of multiple submissions in the same time.
* Cache compiled binary files to save judging time.
* Security and resources limitting powered by [simple-sandbox](https://github.com/t123yh/simple-sandbox).

These features are on the plan:

* Custom graders
* Other types of problem (SubmitAnswer, Interaction, ...)
* Other forms of task (Hack, CustomTest, ...)
* Other languages

# Deploying
You need a Linux system with:

* Kernel booted with `cgroup_enable=memory swapaccount=1`.
* A C++ 17 compiler (e.g. `g++-8` or `clang++-8`).
* A sandbox [rootfs](#Sandbox-Rootfs).

Clone the git repo:

```bash
$ git clone git@github.com:syzoj/syzoj-ng-judge.git
$ cd syzoj-ng-judge
```

Install the dependency `libfmt-dev`. On Ubuntu:

```bash
$ apt install libfmt-dev
```

You may need to specify `CXX` environment variable to build with your C++ 17 compiler:

```bash
$ export CXX=g++-8
$ yarn
$ cp config-example.json config.json
```

Add a judge client to your SYZOJ NG server with `/api/judgeClient/addJudgeClient` and copy the `key` in the response.

Create a copy of the config file, then edit it:

```json5
{
  // The server url without "/api"
  "serverUrl": "http://syzoj-ng.test/",
  // The key of this judge client from SYZOJ NG server
  "key": "40uXJPXzuO2Ha41iuh8Pjw1h0ahvP9i/zJk7Rtn/",
  // The path to store files downloaded from server, will be created if not exists
  "dataStore": "/root/judge/data",
  // The path to store compiled binaries, will be created if not exists
  // WILL be emptied on each start
  "binaryCacheStore": "/root/judge/cache",
  // The max size of the path above
  // Note that it's "soft limit", if a binary is disposed from the cache but currently using
  // it will not be deleted before releasing and new binaries will still added
  "binaryCacheMaxSize": 536870912,
  // The number of judge tasks consuming in the same time (a judge task is something like a submission)
  "taskConsumingThreads": 2,
  // The number of files downloading in the same time
  "maxConcurrentDownloads": 10,
  // The number of run tasks in the same time (a run task is something like compiling code or running a testcase)
  // Each run task need a separated working directory
  // It's recommended to ues unique tmpfs mount point for each task to have better output size limiting and performance
  "maxConcurrentTasks": 3,
  "taskWorkingDirectories": [
    "/root/judge/1",
    "/root/judge/2",
    "/root/judge/3"
  ],
  "sandbox": {
    // The sandbox rootfs (see the "Sandbox Rootfs" section of README)
    "rootfs": "/opt/sandbox-test/rootfs",
    // The user to use in the sandbox
    // Do NOT modify it unless you know what you're doing
    "user": "nobody",
    // The hostname inside the sandbox. Leave null to use the same as the outside hostname
    "hostname": "sandbox",
    // The environment variables for the sandbox
    // Do NOT modify it unless you know what you're doing
    "environments": [
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "HOME=/tmp"
    ]
  },
  "limit": {
    // The max bytes of compiler message to display to the user, the remaining will be omitted
    "compilerMessage": 524288,
    // The max output size of user program, the user will get a OutputLimitExceeded if exceeds
    // Note that it's done with checking the output files' size so
    // the user program can still write a large file to occupy the disk size
    // if you're not using size limited tmpfs for task working directories
    "outputSize": 104857600,
    // The max bytes of user's output file and testdata to display to the user, the remaining will be omitted
    "dataDisplay": 128,
    // The max bytes of user's stderr output to display to the user, the remaining will be omitted
    "stderrDisplay": 5120
  }
}
```

Start it with:

```
$ SYZOJ_NG_JUDGE_CONFIG_FILE=./config.json yarn start
```

# Parallel Judging
You can run multiple judge clients with different key on multiple machines.

You don't need (and are not expected) to run multiple instances of judge client on the same machine (except for testing purpose). Use `taskConsumingThreads` and `maxConcurrentTasks` options if you want to do parallel judging on one machine.

If you run multiple judge clients on the same machine for some testing purpose, make sure you specfied different `dataStore`, `binaryCacheStore` and `taskWorkingDirectories` for them.

NEVER run multiple judge clients with the same `key` -- thay will conflit and none of them can consume tasks at all.

# Sandbox Rootfs
The use of sandbox rootfs is aimed to isolate the access of user programs (and compiles) from the main system, to prevent some sensitive information to be stolen by user.

The sandbox rootfs has nothing special compared to any other Linux rootfs. Currently there's no official build of rootfs to download. You can use our old [sandbox-rootfs-181202](https://github.com/syzoj/sandbox-rootfs/releases/tag/181202) for the old [judge-v3](https://github.com/syzoj/judge-v3) or just bootstrap your own rootfs with tools like `debootstrap` or `pacstrap`. Just make sure the compilers inside works.

The sandbox rootfs won't be modified by compilers or user programs. But some mount points in `/sandbox` inside the rootfs will be created automatically by the sandbox.
