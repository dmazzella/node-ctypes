---
title: Guides
children:
  - ./getting-started.md
  - ./functions.md
  - ./types.md
  - ./structures.md
  - ./memory.md
  - ./callbacks.md
  - ./async.md
  - ./errors.md
  - ./windows.md
  - ./typescript.md
  - ./python.md
  - ./from-koffi.md
  - ./performance.md
  - ./contributing.md
---

# Guides

- [Getting started](getting-started.md) — installation, supported platforms, building from source
- [Libraries and functions](functions.md) — loading libraries, declaring and calling functions, adapters
- [Types](types.md) — the C types, their sizes and JavaScript values, scalar subclasses
- [Structures, unions and arrays](structures.md) — layouts, bit fields, packing, byte order
- [Pointers and memory](memory.md) — pointers, `cast`, shared buffers, native memory, Electron
- [Callbacks](callbacks.md) — C calling JavaScript, also from other threads
- [Asynchronous calls](async.md) — `callAsync` and the `Executor`
- [Errors and results](errors.md) — `errno`, `GetLastError`, `errcheck`, output parameters
- [Windows API](windows.md) — `wintypes`
- [TypeScript](typescript.md) — typed signatures and structures
- [Python ctypes parity](python.md) — supported behavior, differences, migrating from 1.x
- [Coming from Koffi](from-koffi.md) — the Koffi API mapped to node-ctypes
- [Performance](performance.md) — comparisons with Koffi and how to run them
- [Building, testing and internals](contributing.md) — tests, native backends, release validation

The [examples](../examples/README.md) are complete programs built on these APIs.
