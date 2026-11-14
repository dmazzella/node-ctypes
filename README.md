# node-ctypes

[![npm version](https://img.shields.io/npm/v/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![npm downloads](https://img.shields.io/npm/dm/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![Build](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml/badge.svg)](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Python ctypes for Node.js.** A foreign function interface built with C++20,
[node-addon-api](https://github.com/nodejs/node-addon-api) and
[libffi](https://github.com/libffi/libffi).
If you know Python ctypes, you already know node-ctypes.

## Support

Development help is welcome: issues, pull requests and discussions are all appreciated.

> [!TIP]
> If you find **node-ctypes** useful, consider :star: this project
> and why not ... [Buy me a coffee](https://www.buymeacoffee.com/damianomazp) :smile:

---

## Quick start

```bash
npm install node-ctypes
```

Prebuilt binaries ship for Windows, macOS 13.5+ and Linux (glibc 2.28+ or musl /
Alpine), on x64 and ARM64 — wherever Node 24 runs.

```javascript
import { CDLL, Structure, c_int32, c_size_t, c_char_p } from "node-ctypes";

// 1. Load a shared library
const libc = new CDLL(process.platform === "win32" ? "msvcrt" : null);

// 2. Declare a function signature
const strlen = libc.strlen;
strlen.argtypes = [c_char_p];
strlen.restype = c_size_t;
console.log(strlen("hello")); // 5n

// 3. Declare a struct
class Point extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
  ];
}
const p = new Point(3, 4);
console.log(p.x, p.y); // 3 4
```

To build from source, see [Getting started](guides/getting-started.md#building-from-source).

## Supported platforms

| Operating system     | x64 | ARM64 | Minimum version |
| -------------------- | --- | ----- | --------------- |
| Windows              | ✅  | ✅    |                 |
| macOS                | ✅  | ✅    | macOS 13.5      |
| Linux, glibc         | ✅  | ✅    | glibc 2.28      |
| Linux, musl (Alpine) | ✅  | ✅    |                 |

Node.js 24 or later. Details, testing and building from source are in
[Getting started](guides/getting-started.md).

---

## Guides

- [Getting started](guides/getting-started.md) — installation, supported platforms, building from source
- [Libraries and functions](guides/functions.md) — loading libraries, declaring and calling functions, adapters
- [Types](guides/types.md) — the C types, their sizes and JavaScript values, scalar subclasses
- [Structures, unions and arrays](guides/structures.md) — layouts, bit fields, packing, byte order
- [Pointers and memory](guides/memory.md) — pointers, `cast`, shared buffers, native memory, Electron
- [Callbacks](guides/callbacks.md) — C calling JavaScript, also from other threads
- [Asynchronous calls](guides/async.md) — `callAsync` and the `Executor`
- [Errors and results](guides/errors.md) — `errno`, `GetLastError`, `errcheck`, output parameters
- [Windows API](guides/windows.md) — `wintypes`
- [TypeScript](guides/typescript.md) — typed signatures and structures
- [Python ctypes parity](guides/python.md) — supported behavior, differences, migrating from 1.x
- [Coming from Koffi](guides/from-koffi.md) — the Koffi API mapped to node-ctypes
- [Performance](guides/performance.md) — comparisons with Koffi and how to run them
- [Building, testing and internals](guides/contributing.md) — tests, native backends, release validation

---

## Examples

Each example in `examples/` has its own README; see the [index](examples/README.md).

- [Electron + React](examples/cross-platform/electron-app/README.md) — a native system clock through a sandboxed preload bridge, synchronized C-memory views and a packaged ASAR application
- [Embedded Python](examples/cross-platform/python/README.md) — CPython through its C API: code, modules, callbacks, JavaScript objects by reference, shared memory, threads, asyncio and cancellation (Windows, macOS, Linux)
- [Smart card (PC/SC)](examples/cross-platform/smartcard/README.md) — `winscard` on Windows, `PCSC.framework` on macOS, `libpcsclite` on Linux
- [Cryptoki (PKCS #11)](examples/cross-platform/cryptoki/README.md) — complete 3.2 declarations with 2.20–3.2 dispatch and a standalone SoftHSM demo: temporary token, login, RSA, ECDSA, AES and SHA-256
- [Accessibility](examples/macos/accessibility/README.md) — macOS UI automation with the Accessibility API
- [COM automation](examples/windows/com/README.md) — shell shortcuts (`IShellLinkW`) and Active Directory (`IDirectorySearch`)
- [Controls](examples/windows/controls/README.md) — a small Win32 application with the common controls
- [LDAP](examples/windows/ldap/README.md) — LDAPv3 paged search (`wldap32`)
- [Registry](examples/windows/registry/README.md) — `setValue` / `getValue` / `openKey` / `deleteKey`
- [System tray](examples/windows/tray/README.md) — tray icon + popup menu

---

## License

MIT. Built with [libffi](https://github.com/libffi/libffi),
[node-addon-api](https://github.com/nodejs/node-addon-api), and
[cmake-js](https://github.com/cmake-js/cmake-js).
