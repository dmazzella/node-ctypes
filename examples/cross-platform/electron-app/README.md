---
title: Electron + React
---

# node-ctypes + Electron + React

A real native system-clock example, not a browser mock.

The Electron main process calls `clock_gettime(CLOCK_REALTIME)` on macOS/Linux
or `GetSystemTimePreciseAsFileTime` on Windows. It also calls the native process-ID
function and checks that it agrees with the Electron main process.

Each refresh:

1. Allocates C memory with `malloc` and clears it.
2. Creates a typed `Structure.from_address` view **before** the native clock writes.
3. Calls the operating system through a correctly declared native signature.
4. Reads the updated fields and raw bytes, including when external buffers are unavailable.
5. Converts BigInt timestamps to strings for IPC and releases the allocation with `free`.

The UI shows the clock result, raw C-memory bytes, native/main PID, runtime
versions and the automatically detected external-buffer policy.
A read starts immediately, then every second unless the previous read is still
pending. The timer is cleared when the view unmounts.

## System memory panel

Below the clock, a panel samples the operating system every second and charts
the memory in use over the last 60 seconds with
[Apache ECharts](https://echarts.apache.org/) (only the line chart, axes,
tooltip and canvas renderer are bundled). It also shows the available and total
memory and the uptime. Each value comes from a native
call made in the main process by
[electron/native-system.ts](./electron/native-system.ts):

| Platform | Memory                                                                                    | Uptime                                              |
| -------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Windows  | `GlobalMemoryStatusEx` fills `MEMORYSTATUSEX` (its `dwLength` is set first)               | `GetTickCount64`                                    |
| macOS    | `host_statistics64(HOST_VM_INFO64)` fills `vm_statistics64`; `sysctlbyname("hw.memsize")` | `sysctlbyname("kern.boottime")`, a `struct timeval` |
| Linux    | `sysinfo` fills `struct sysinfo`                                                          | `sysinfo`                                           |

It shows structures filled by the operating system (fixed-width and
platform-sized integers, 64-bit values as BigInt), in/out size arguments, and
errors from `GetLastError` / `errno`. "Available" is what each API reports:
`ullAvailPhys` on Windows; free, inactive and speculative pages on macOS; free
memory plus buffers on Linux, where `sysinfo` does not report the page cache.

## Processor panel

Next to the memory, a panel shows the usage of each logical processor and the
total, sampled every second
([electron/native-cpu.ts](./electron/native-cpu.ts)). No API returns a
percentage directly: the operating systems count the time each processor spent
busy and idle, and the usage is the busy share between two readings.

| Platform | Native calls                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | PDH (`pdh.dll`): a query opened at startup (`PdhOpenQueryW`, `PdhAddEnglishCounterW("\\Processor Information(*)\\% Processor Utility")`), then `PdhCollectQueryData` and `PdhGetFormattedCounterArrayW` every second; `PdhCloseQuery` on quit |
| macOS    | `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`: per-processor ticks in an array the kernel allocates, freed with `vm_deallocate`                                                                                                              |
| Linux    | No system call exposes these counters: `/proc/stat`, read with `fopen`/`fread`/`fclose`                                                                                                                                                       |

The Windows side shows an opaque handle kept between calls, wide strings, the
"call once for the size, then again" pattern (`PDH_MORE_DATA`), an array of
`PDH_FMT_COUNTERVALUE_ITEM_W` with an anonymous `Union` and names pointing into
the same buffer, and `PDH_STATUS` errors formatted from `pdh.dll`'s messages.
The English counter path works on every Windows language. Opening the query
takes a few hundred milliseconds, once, while PDH loads its providers.

In node-ctypes, `libc.close` and `libc.read` are the library object's own
methods, not the C functions: the Linux reader uses C stdio instead. Results of
`wintypes.DWORD` and `wintypes.LONG` are BigInt.

## Run

Build node-ctypes for the current operating system and architecture first.
From the repository root:

```sh
npm install
npm run build
cd examples/cross-platform/electron-app
npm install
npm run dev
```

The dependency is `node-ctypes: file:../../..`, so development uses this checkout,
not a separately published npm version.

Other commands from this directory:

```sh
npm run lint
npm run build:app            # TypeScript + main/preload/React bundles
npm run build -- --dir       # packaged application directory, without an installer
npm run build               # platform installer
```

On macOS, an unsigned local packaging check can disable signing-identity
discovery without reading a personal signing certificate:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build -- --dir
```

Do not start Electron with `ELECTRON_RUN_AS_NODE=1`; that runs its binary as Node
rather than as a desktop application. `npm run preview` is Vite's browser-only
preview and does not provide the native bridge.

## Process boundary

- [electron/native-runtime.ts](./electron/native-runtime.ts) reads the versions
  and the native process ID once, at startup;
  [electron/native-clock.ts](./electron/native-clock.ts) reads the clock,
  [electron/native-system.ts](./electron/native-system.ts) the memory and
  [electron/native-cpu.ts](./electron/native-cpu.ts) the processors, every
  second. They own all DLL handles, signatures, allocations and native-memory
  views, declared as in Python ctypes (`argtypes`, `restype`, `errcheck`).
- [electron/main.ts](./electron/main.ts) exposes one read-only IPC operation for
  each and checks the sender. Native libraries are closed when the application
  quits.
- [electron/preload.ts](./electron/preload.ts) exposes only the typed
  `window.nativeRuntime.read()`, `window.nativeClock.read()`,
  `window.nativeSystem.read()` and `window.nativeCpu.read()` operations, not a
  generic IPC or FFI interface.
- [src/App.tsx](./src/App.tsx) receives serializable data. It has no Node access.

The renderer has `nodeIntegration: false`, `contextIsolation: true` and
`sandbox: true`. The preload is a bundled CommonJS file so it also works in the
sandbox. No renderer Node polyfill is required.

Errors are reported explicitly; an ordinary browser displays an unavailable
bridge error instead of fabricated native results. There is no forced mirror
environment variable: node-ctypes detects Electron's buffer capabilities.

## Packaging the local dependency

node-ctypes is externalized from the Vite main-process bundle. Electron-builder
copies only its package metadata, JavaScript and relevant licenses into ASAR, and puts this
checkout's compiled addon at:

```text
Contents/Resources/                         # resources/ on Windows/Linux
  app.asar
  app.asar.unpacked/node_modules/node-ctypes/build/Release/ctypes.node
```

The native loader already supports this layout. The full repository, tests and
example's own dependencies are not recursively packaged.

`npmRebuild` is disabled because node-ctypes uses node-addon-api's stable
Node-API ABI: it does not need an Electron-specific `node-gyp` rebuild.
The binary still must match the target operating system and architecture.
Build this local example on the target platform; copying a macOS ARM64 binary
into an x64/Windows/Linux package is not cross-compilation. Other native
dependencies added later may have different rebuild requirements.

## Validation

On macOS ARM64, the example was exercised with:

- node-ctypes **2.5.0**
- Electron **45.0.0**, using Node **24.22.0**
- external buffers **disabled automatically**, synchronized native-memory mirrors active

Both the built application and the packaged ASAR application were launched in
real Electron. The packaged application was moved outside the checkout for the
check, preventing a fallback to the development dependency.

Each mode passed 100 repeated native reads, exact raw-byte/timestamp comparison,
native/main PID comparison, automatic one-second React updates and renderer
isolation checks. The same addon built for Node was used without an
Electron-specific rebuild.

Windows was also tested successfully by the project maintainer. The detailed
checks above refer to macOS only.

The Linux implementation is included but still requires native validation.

The system memory panel was checked on Windows x64 (Electron 45.3.1): total
memory, available memory and uptime matched Node's `os` module. Its
macOS and Linux implementations are included but still require native
validation. The processor panel was checked on Windows x64 too (four logical
processors and the total, also under load); its macOS and Linux implementations
still require native validation.
