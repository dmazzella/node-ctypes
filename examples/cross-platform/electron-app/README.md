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

- [electron/native-clock.ts](./electron/native-clock.ts) owns all DLL handles,
  signatures, allocations and native-memory views.
- [electron/main.ts](./electron/main.ts) exposes one IPC operation and checks the
  sender. Native libraries are closed when the application quits.
- [electron/preload.ts](./electron/preload.ts) exposes only the typed
  `window.nativeClock.read()` operation, not a generic IPC or FFI interface.
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
