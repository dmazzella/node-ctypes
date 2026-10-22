# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Embedded Python example**: `Temporal` values (Node.js 26+) convert to
  and from `date`, `time`, `datetime` and `timedelta`; the interpreter can
  be hosted by a worker thread (`demo_python_worker.js`), one thread per
  process.
- **Embedded Python example**: synchronous Python code waiting for a thread
  that calls JavaScript (`Thread.join()`, `Event.wait()`, ...) is no longer a
  deadlock: the main thread runs the call, woken by `SIGURG` on POSIX
  systems and by the interrupt event on Windows with Python 3.14+.

## [2.1.0] - 2026-10-21

### Added

- **`threadSafeCallback().ref()` / `.unref()`**: like a timer, a thread-safe
  callback keeps the event loop alive until released; `.unref()` lets the
  process exit when nothing else is pending, while calls from other threads
  are still delivered. Both return the wrapper.
- **Embedded Python example** (`examples/cross-platform/python`): CPython
  driven through its C API with node-ctypes, on Windows, macOS and Linux
  (glibc and musl), Python 3.8+ including free-threaded builds. It runs code
  and imports modules (local `.py` files and numpy too), converts values
  both ways (dict keys as properties, `Tuple`, `Date` ↔ `datetime`), uses
  JavaScript objects from Python by reference (`JsProxy`, `byReference()`),
  shares memory between typed arrays and Python buffers without copies,
  implements `with` / `async with` and time limits, and connects asyncio to
  the Node.js event loop with a `threadSafeCallback`: coroutines are
  awaitable from JavaScript, coroutines and Python threads call JavaScript
  functions, async iterators and cancellation work in both directions.
- **A README for every example**, published as child pages of the Examples
  document in the API documentation.

### Changed

- **Examples are organized by platform and example**
  (`examples/cross-platform/`, `examples/macos/`, `examples/windows/`), one
  folder per example with its library, demos and README;
  `examples/README.md` is an index. The COM demos are renamed
  `windows/com/demo_com_shortcut.js` and
  `windows/com/demo_com_active_directory.js`.

### Fixed

- **Smart card example on Linux**: `libpcsclite.so.1` is loaded by soname
  (the library is in the multiarch directory), `SCardError` codes are
  unsigned 32-bit numbers (`c_long` results are BigInt), and listing readers
  returns `[]` when none is connected (`SCARD_E_NO_READERS_AVAILABLE`).

## [2.0.0] - 2026-10-21

2.0 aligns node-ctypes with Python ctypes as closely as the language allows,
so that Python code can be ported with only the changes JavaScript requires.
It contains breaking changes: see [Migrating from 1.x](README.md#migrating-from-1x).

### Breaking changes

- **`pointer.contents` returns a live instance** on the pointed memory, as in
  Python: `p.contents.value` for simple types, `p.contents.x` for structures.
  Assigning an instance re-points the pointer; assigning a plain value writes
  it. `p[i]` still returns the value (a live instance for structures).
- **`POINTER(T)` restype returns a pointer object** (`null` for NULL) instead
  of a `bigint` address; use `.address` for the number. A `CFUNCTYPE` restype
  returns a callable function.
- **NULL `POINTER` fields of structures and unions read as `null`.**
- **`c_char` values are 1-character strings** (Python `bytes` of length 1)
  instead of numbers; `c_wchar` values are 1-character strings.
  `c_char * n` / `c_wchar * n` fields read and write as strings.
- **Invalid `c_char` / `c_wchar` values raise `TypeError`**
  (`"one character bytes, bytearray or integer expected"`,
  `"one character unicode string expected"`) instead of being truncated.
- **Argument conversion errors raise `ArgumentError`** (a `TypeError`
  subclass) with the Python message `"argument N: TypeError: ..."`. Numeric
  arguments accept numbers, booleans and BigInt (truncated to the type, as
  Python masks integers) and reject strings, `null` and objects.
- **Values that are not pointers raise `ArgumentError` (`"wrong type"`)** for
  pointer parameters instead of passing NULL (JS functions, plain objects,
  symbols). Invalid values assigned to pointer fields raise `TypeError`
  instead of writing 0.
- **Functions without `restype` return `c_int`**, and calls without
  `argtypes` use the fixed-argument ABI with Python's default conversions
  (e.g. a `c_int(5)` instance is passed by value).
- **`c_long` / `c_ulong` are `BigInt` on every platform**: fields and
  `.value` on Windows (where `long` is 32-bit) were numbers, while function
  results were already `BigInt`. This includes `wintypes.BOOL`, `LONG`,
  `DWORD`, `ULONG`, `LSTATUS`, `COLORREF`. Writes accept numbers and BigInt.
- **`wintypes` follows Python's `ctypes.wintypes`**: `CHAR` is `c_char`
  (was `c_ubyte`); `LPDWORD`, `PDWORD`, `LPBYTE`, `PBYTE`, `PHKEY` are
  `POINTER(T)` (were `c_void_p`), so fields and results of these types are
  pointer objects.
- **`string_at(addr, n)` / `wstring_at(addr, n)` read exactly `n` units**,
  embedded NULs included, instead of stopping at the first NUL.
- **`create_string_buffer(init, size)` / `create_unicode_buffer(init, size)`**
  honor `size` (`RangeError` if `init` does not fit) and return Buffers with
  `.value` (and `.raw` for char buffers).
- **`array(type, n)` returns a callable type** (a function, as Python's
  `type * n`) instead of a plain object.
- **Structure/union instances assigned to nested fields are copied
  bytewise**, as in Python, instead of field by field.
- **TypeScript declarations** follow the new runtime types (see below).

### Added

- Prebuilt binaries for Linux with musl (Alpine), x64 and ARM64
  (`ctypes-linux-<arch>-musl.node`), selected automatically.
- Python names: `ArgumentError`, `ARRAY`, `c_buffer`, `c_voidp`, `c_time_t`,
  `SIZEOF_TIME_T`, `RTLD_GLOBAL`, `RTLD_LOCAL`, `DEFAULT_MODE`,
  `LibraryLoader`, `cdll.LoadLibrary()` (and `windll` / `oledll`),
  `get_last_error()` / `set_last_error()` (on every platform), `CType.CHAR`.
- `CDLL(name, mode)` and `CDLL(name, { mode })` with the `dlopen` flags.
- Array types are callable like Python's: `array(c_int, 3)(1, 2, 3)` (also
  with `new`); arrays of arrays, of `POINTER(T)` and of `CFUNCTYPE` types;
  `.value` / `.raw` on `c_char` arrays and `.value` on `c_wchar` arrays.
- `CFUNCTYPE` types as `argtypes`, `restype` and structure/union fields (read
  back as callables); `sizeof` / `alignment` of `CFUNCTYPE` and `alignment` of
  `POINTER` types.
- `POINTER(POINTER(T))` and `POINTER(CFUNCTYPE)` element access
  (`pp[i].contents`, `pp[i] = pointer(x)`).
- `prototype([name, library])` and `prototype([name, library], paramflags)`,
  as Python's `prototype((name, dll), paramflags)`; `paramflags` also accept
  Python tuples `[flag, name, default]`.
- A structure instance as the single positional initializer
  (`new RECT(point)`).
- `memmove` / `memset` accept addresses, ctypes instances and pointers, not
  only Buffers.
- `c_void_p` parameters accept strings (passed as `char *`) and any
  TypedArray, DataView or ArrayBuffer.
- Objects assigned to pointer / `CFUNCTYPE` fields and array elements are
  kept alive with the structure, as Python's `_objects`.
- `POINTER(T)` arguments of callbacks are pointer objects; objects returned by
  callbacks are converted like arguments.
- `readValue` / `writeValue` accept pointer objects.
- `wintypes` matches Python's `ctypes.wintypes` on all its names: structures
  (`RECT`, `POINT`, `SIZE`, `MSG`, `FILETIME`, `SMALL_RECT`, `_COORD`,
  `WIN32_FIND_DATAA/W`), pointer types (`LPRECT`, `PHANDLE`, `LPMSG`, ...),
  `RGB()`, `MAX_PATH`, `VARIANT_BOOL` and the missing handle types.
- TypeScript: `wintypes` declarations; `static _fields_ = [["x", c_int]]`
  compiles without `as const`; `_pack_` as a number; typed `contents`,
  callable array types, buffer `.value` / `.raw`, pointer and function-pointer
  results; `StructureOf`, `ArrayInstance`, `CharBufferValue`,
  `WideBufferValue`, `MemoryTarget`.
- Type tests in `tests/types` (`npm run test:types`) and Python parity tests
  (`tests/common/test_python_parity.js` with its Python twin).

### Fixed

- Segmentation fault when passing a JS function or a plain object to a
  pointer parameter (e.g. a function to `qsort` instead of a callback).
- Segmentation fault when assigning a union instance with a pointer member
  (e.g. `c_wchar_p`) to a structure field.
- Segmentation fault when passing pointers created with `fromAddress()` and
  callback wrappers as arguments.
- `addressof()` of an array instance threw a "requires a Buffer" error.
- `wstring_at(addr)` truncated strings at 256 characters (512 on Windows), and
  so did long `c_wchar_p` fields; `wstring_at(addr, n)` behaved differently on
  Windows and Unix; invalid code points threw `RangeError` (now U+FFFD).
- `string_at(buffer)` could read past the end of the Buffer.
- `c_long` / `c_ulong` fields threw when assigned a BigInt on Windows, and so
  did 32-bit bit fields.
- `wchar_t` alignment in arrays and structures (`alignof(wchar_t)`).
- The function cache could return a function declared with other types of the
  same name (now keyed by type identity).
- `pointer(structInstance).contents` was not an instance of the structure
  class; `.constructor` of structure instances returned a bound function.
- `restype = null` (Python's `None`) threw `Invalid return type`; it now
  means `void`.
- The native module was looked up from `process.cwd()`: applications started
  from another directory, and nested installs, failed with "Native module not
  found". It is now located from the package itself (the previous locations
  remain as a fallback).
- macOS prebuilt binaries required the macOS version of the CI runner
  (26.0 on arm64, 15.0 on x64); they now target macOS 13.5, like Node 24.

### Performance

- Faster calls: per-function `call` without wrapper unwrapping, direct-call
  invokers for common signatures and lighter argument marshalling. In
  `tests/benchmarks/benchmark_koffi.js` the average gap with koffi dropped
  from 2.56x to about 1.45x (Apple Silicon).
- Faster JS paths: `readValue` at an address, array element access,
  `create_string_buffer`, structure instances sharing one Proxy handler.

### Changed

- Native code uses node-addon-api only; raw N-API is confined to
  `src/napi_fast.h` and all system headers are included from `src/shared.h`.
- `typescript` is a devDependency; CI type-checks `lib/index.d.ts` in a
  dedicated job and packaging depends on it.
- Linux binaries are built in `manylinux_2_28` containers: they require glibc
  2.28 (like Node 24) and the system libstdc++, instead of glibc 2.34 and the
  libstdc++ of GCC 13 (Ubuntu 22.04 and Debian 11/12 could not load them).
  CI fails if a build raises these requirements.
- Examples rewritten in Python ctypes style (`wintypes` structures,
  `DWORD()` / `HKEY()` with `byref` and `.value`, `in_dll`, `buf.value`,
  typed prototypes instead of raw Buffers and offsets).

## [1.14.0] - 2026-10-21

### Changed

- libffi updated to 3.8.0 (through 3.7.0 and 3.7.1), with `ffi_call_plan`
  support.
- Dependencies updated to their latest versions.

### Added

- Benchmark of node-ctypes against `node:ffi`.

## [1.13.0] - 2026-06-22

### Added

- `Symbol.dispose` support for callbacks and libraries (`using`).

### Changed

- `node:` prefix for built-in imports; koffi updated to 3.x in benchmarks.

## [1.12.0] - 2026-04-24

### Changed

- Library restructured for Python ctypes parity and maintainability.

### Performance

- No array allocations in the slow path of `func()` call wrappers; branch
  hints on the FFI hot path.

## [1.11.1] - 2026-04-22

### Fixed

- LDAP example: binary attributes preserved when `ensureSchema` inherits the
  caller options.

## [1.11.0] - 2026-04-22

### Changed

- `GetLastError` / `errno` API unified with Python ctypes semantics.

## [1.10.1] - 2026-04-22

### Performance

- Lower per-call overhead in the hot path.

### Fixed

- Documentation of the lazy library loaders.

## [1.10.0] - 2026-04-20

### Added

- Broader Python ctypes parity.

### Changed

- LTO/IPO enabled for Release builds.

## [1.9.0] - 2026-04-18

### Added

- Typed API and callback leak guard.

### Performance

- Faster structures.

### Fixed

- ESM import in tests on Windows (`pathToFileURL`).

## [1.8.0] - 2026-03-14

### Added

- `POINTER()` fields in unions; more tests and Python compatibility.

### Fixed

- Pointer size.

## [1.7.0] - 2026-03-11

### Added

- `PointerTypeDef` and `alignment()`; better pointer handling in structures
  and unions.

## [1.6.0] - 2026-03-09

### Added

- Documentation and examples.

### Fixed

- SID interpretation (`objectsid`) in the LDAP example.

## [1.5.0] - 2026-02-20

### Added

- Function pointer type factories (`CFUNCTYPE` / `WINFUNCTYPE`), callbacks
  with optional ABI.
- COM automation example (`IShellLinkW`, `IPersistFile`) and LDAP wrapper
  example (`wldap32.dll`).

## [1.4.0] - 2026-02-10

### Added

- Asynchronous function calls; simpler variadic calls.

### Changed

- Better error messages.

## [1.3.0] - 2026-02-05

### Added

- Inline string buffers and pointer support; cross-platform C library
  loading in tests.

## [1.2.0] - 2026-02-01

### Changed

- CType internals reworked; spdlog and dotenv removed.

## [1.1.0] - 2026-01-28

### Added

- PC/SC smart card example.

### Changed

- `long` / `ulong` alignment handling; values returned as BigInt.

## [1.0.2] - 2026-01-24

### Fixed

- `wchar` and pointer handling in primitive types.

## [1.0.1] - 2026-01-24

### Fixed

- Buffer handling in primitive type writers.

## [1.0.0] - 2026-01-24

### Changed

- Security and cross-platform improvements; JS files restructured.

## 0.1.x - 2026-01-17 to 2026-01-23

Initial releases.

[Unreleased]: https://github.com/dmazzella/node-ctypes/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/dmazzella/node-ctypes/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/dmazzella/node-ctypes/compare/v1.14.0...v2.0.0
[1.14.0]: https://github.com/dmazzella/node-ctypes/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/dmazzella/node-ctypes/compare/v1.12.1...v1.13.0
[1.12.0]: https://github.com/dmazzella/node-ctypes/compare/v1.11.1...v1.12.1
[1.11.1]: https://github.com/dmazzella/node-ctypes/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/dmazzella/node-ctypes/compare/v1.10.1...v1.11.0
[1.10.1]: https://github.com/dmazzella/node-ctypes/compare/v1.10.0...v1.10.1
[1.10.0]: https://github.com/dmazzella/node-ctypes/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/dmazzella/node-ctypes/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/dmazzella/node-ctypes/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/dmazzella/node-ctypes/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/dmazzella/node-ctypes/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/dmazzella/node-ctypes/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dmazzella/node-ctypes/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dmazzella/node-ctypes/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dmazzella/node-ctypes/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dmazzella/node-ctypes/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/dmazzella/node-ctypes/compare/dbbb592...v1.0.2
[1.0.1]: https://github.com/dmazzella/node-ctypes/compare/78acf28...dbbb592
[1.0.0]: https://github.com/dmazzella/node-ctypes/compare/v0.1.7...78acf28
