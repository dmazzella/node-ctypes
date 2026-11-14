---
title: Getting started
---

# Getting started

## Installation

```bash
npm install node-ctypes
```

node-ctypes requires Node.js 24 or later. The npm package includes a prebuilt
binary for each platform below, so installing it needs no C++ compiler. The
[Quick start](../README.md#quick-start) shows a first program.

## Supported platforms

| Operating system     | x64 | ARM64 | Minimum version |
| -------------------- | --- | ----- | --------------- |
| Windows              | ✅  | ✅    |                 |
| macOS                | ✅  | ✅    | macOS 13.5      |
| Linux, glibc         | ✅  | ✅    | glibc 2.28      |
| Linux, musl (Alpine) | ✅  | ✅    |                 |

Each binary is built and tested on its own platform by the continuous
integration: the whole test suite runs with Node 24, normally and without
external buffers (as in Electron), and the Python ctypes reference tests run
with CPython 3.14 on Windows, macOS and Linux glibc. The suite runs again with
Node 26 on Windows x64, macOS ARM64 and Linux x64, which also runs the
references with CPython 3.15.

All these targets are 64-bit and have a single C calling convention. `WinDLL`,
`WINFUNCTYPE` and the `stdcall`, `fastcall` and `thiscall` options are
accepted, so code written for Windows APIs runs unchanged, and they use that
convention.

## Building from source

Requires Node.js >= 24, CMake >= 3.15, and a C++20 compiler and standard library.
libffi is built from its git submodule (`third-party/libffi`): clone with
`git clone --recursive`, or run `git submodule update --init` in an existing
checkout. Then, from the source checkout:

```bash
npm install
npm run build
```

[Building, testing and internals](contributing.md) covers the tests, the
benchmarks and the native code.

## Next steps

- [Libraries and functions](functions.md): loading libraries, declaring and calling functions
- [Types](types.md): the C types and their JavaScript values
- [Structures, unions and arrays](structures.md)
- [Pointers and memory](memory.md)
- [Callbacks](callbacks.md)
- [Asynchronous calls](async.md)
- [Errors and results](errors.md)
- [Coming from Koffi](from-koffi.md)
