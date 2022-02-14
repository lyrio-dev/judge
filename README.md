# Lyrio Judge

[![Build Status](https://img.shields.io/github/workflow/status/lyrio-dev/judge/CI?style=flat-square)](https://github.com/lyrio-dev/judge/actions?query=workflow%3ACI)
[![Dependencies](https://img.shields.io/david/lyrio-dev/judge?style=flat-square)](https://david-dm.org/lyrio-dev/judge)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg?style=flat-square)](http://commitizen.github.io/cz-cli/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![License](https://img.shields.io/github/license/lyrio-dev/judge?style=flat-square)](LICENSE)

The judge service of Lyrio.

# Features
* Download files from server automatically.
* Run multiple tasks of multiple submissions in the same time.
* Cache compiled binary files to save judging time.
* Custom checkers with multiple interfaces for Traditional problems.
* Interaction problems with stdio or shared memory interaction interface.
* Security and resources limitting powered by [simple-sandbox](https://github.com/t123yh/simple-sandbox).
* Support multiple languages common or uncommon in competitive programming.

These features are on the plan:

* Other types of problem (Communication, ...)
* Other forms of task (Hack, CustomTest, ...)

# Deploying
You need a Linux system with:

* Kernel booted with `cgroup_enable=memory swapaccount=1`.
* A C++ 17 compiler (e.g. `g++-8` or `clang++-8`).
* A sandbox [rootfs](#Sandbox-Rootfs).

Clone the git repo (`--recursive` is required for git submodules):

```bash
$ git clone git@github.com:lyrio-dev/judge.git lyrio-judge --recursive
$ cd lyrio-judge
```

Install the dependency `libfmt-dev`. On Ubuntu:

```bash
$ apt install libfmt-dev
```

You may need to specify `CXX` environment variable to build with your C++ 17 compiler:

```bash
$ export CXX=g++-8
$ yarn
$ cp config-example.yaml config.yaml
```

Add a judge client to your Lyrio backend server with `/api/judgeClient/addJudgeClient` and copy the `key` in the response.

Create a copy of the config file, then edit it:

```yaml
// The server url without "/api"
serverUrl: http://lyrio.test/
// The key of this judge client from Lyrio backend server
key: 40uXJPXzuO2Ha41iuh8Pjw1h0ahvP9i/zJk7Rtn/
// The path to store files downloaded from server, will be created if not exists
dataStore: /root/judge/data
// The path to store compiled binaries, will be created if not exists
// WILL be emptied on each start
binaryCacheStore: /root/judge/cache
// The max size of the path above
// Note that it's "soft limit", if a binary is disposed from the cache but currently using
// it will not be deleted before releasing and new binaries will still added
binaryCacheMaxSize: 536870912
// The number of judge tasks consuming in the same time (a judge task is something like a submission)
taskConsumingThreads: 2
// The number of files downloading in the same time
maxConcurrentDownloads: 10
// The number of run tasks in the same time (a run task is something like compiling code or running a testcase)
// Each run task need a separated working directory
// It's recommended to ues unique tmpfs mount point for each task to have better output size limiting and performance
maxConcurrentTasks: 3
// The timeout for RPC operations with server
rpcTimeout: 20000
// The timeout of downloading a file from testdata or user-uploaded answer
downloadTimeout: 20000
// The maximum times of retrying after a download failure (including timeout)
downloadRetry: 3
taskWorkingDirectories:
  - /root/judge/1
  - /root/judge/2
  - /root/judge/3
sandbox:
  // The sandbox rootfs (see the "Sandbox RootFS" section of README)
  rootfs: /opt/rootfs-ng
  // The user to use in the sandbox
  // Do NOT modify it unless you know what you're doing
  user: sandbox
  // The hostname inside the sandbox. Leave null to use the same as the outside hostname
  hostname: null
  // The environment variables for the sandbox
  // Do NOT modify it unless you know what you're doing
  environments:
    PATH: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    HOME: /sandbox
    LC_ALL: en_US.UTF-8
```

Start it with:

```
$ LYRIO_JUDGE_CONFIG_FILE=./config.yaml yarn start
```

# Parallel Judging
You can run multiple judge clients with different key on multiple machines.

You don't need (and are not expected) to run multiple instances of judge client on the same machine (except for testing purpose). Use `taskConsumingThreads` and `maxConcurrentTasks` options if you want to do parallel judging on one machine.

If you run multiple judge clients on the same machine for some testing purpose, make sure you specfied different `dataStore`, `binaryCacheStore` and `taskWorkingDirectories` for them.

NEVER run multiple judge clients with the same `key` -- thay will conflit and none of them can consume tasks at all.

# Sandbox RootFS
The use of sandbox rootfs is aimed to isolate the access of user programs (and compiles) from the main system, to prevent some sensitive information to be stolen by user.

You may download the official [sandbox-rootfs](https://github.com/lyrio-dev/sandbox-rootfs) directly from release or bootstrap it by yourself. You can also build a custom rootfs with your favorite disto.
