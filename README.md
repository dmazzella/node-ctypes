# node-ctypes

[![npm version](https://img.shields.io/npm/v/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![npm downloads](https://img.shields.io/npm/dm/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![Build](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml/badge.svg)](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Python ctypes for Node.js.** A foreign function interface built on
[libffi](https://github.com/libffi/libffi) and [N-API](https://nodejs.org/api/n-api.html).
If you know Python ctypes, you already know node-ctypes.

---

## Quick start

```bash
npm install node-ctypes
```

Prebuilt binaries ship for Windows, Linux, and macOS (x64/ARM64).

```javascript
import { CDLL, Structure, c_int32, c_char_p } from "node-ctypes";

// 1. Load a shared library
const libc = new CDLL(process.platform === "win32" ? "msvcrt" : null);

// 2. Declare a function signature
const strlen = libc.func("strlen", c_int32, [c_char_p]);
console.log(strlen("hello")); // 5

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

<details>
<summary>Build from source</summary>

Requires Node.js >= 24, CMake >= 3.15, and a C++ compiler.

```bash
npm install
npm run build
```

</details>

---

## Guides

### Calling a C function

Two equivalent styles — use whichever reads better:

```javascript
// Python-style: set argtypes/restype on the bound symbol
const abs = libc.abs;
abs.argtypes = [c_int32];
abs.restype = c_int32;
abs(-42); // 42

// One-shot: declare signature at lookup
const abs2 = libc.func("abs", c_int32, [c_int32]);
abs2(-42); // 42
```

For Windows `__stdcall` APIs use `WinDLL` instead of `CDLL`. For COM-style
auto-`HRESULT`-checking use `OleDLL`.

### Structs, unions, bit fields, arrays

```javascript
import { Structure, Union, array, c_int32, c_uint32, c_float } from "node-ctypes";

class Rect extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
    ["w", c_int32],
    ["h", c_int32],
  ];
}

class Value extends Union {
  static _fields_ = [
    ["i", c_int32],
    ["f", c_float],
  ];
}

// Bit fields: [name, type, bitCount]
class Flags extends Structure {
  static _fields_ = [
    ["enabled", c_uint32, 1],
    ["mode", c_uint32, 3],
    ["priority", c_uint32, 4],
  ];
}

// Arrays: elementType * count (Python: `c_int32 * 5`)
const IntArr5 = array(c_int32, 5);
const buf = IntArr5.create([1, 2, 3, 4, 5]);
```

Nested structs, anonymous fields (`static _anonymous_ = ["data"]`),
explicit packing (`static _pack_ = 1`), and self-referential pointers
(`POINTER(() => Node)`) all work identically to Python.

### Pointers, buffers, and cast

```javascript
import { POINTER, pointer, cast, c_int32, c_void_p } from "node-ctypes";

// Pointer to an existing c-data instance (Python: pointer(x))
const x = new c_int32(42);
const px = pointer(x);
px.contents;   // 42   (Python: *px or px.contents)
px[0];         // 42   (Python: px[0])
px[0] = 100;
x.value;       // 100  (same memory)

// View existing memory as a typed pointer
const IntPtr = POINTER(c_int32);
const p = IntPtr.fromBuffer(someBuffer);
p[0]; p[1]; p[2];   // pointer arithmetic

// cast() — Python: cast(ptr, POINTER(T))
const q = cast(someBuffer, POINTER(c_int32));
const r = cast(addressAsBigInt, POINTER(MyStruct));
```

To hand a raw address to a function, use `c_void_p` as the argtype for
portable code (Python accepts raw `int` only there).

### Callbacks

```javascript
import { callback, CFUNCTYPE, c_int32, c_void_p, readValue } from "node-ctypes";

// Python-style type: CFUNCTYPE(restype, ...argtypes)
const CompareFn = CFUNCTYPE(c_int32, c_void_p, c_void_p);
const cmp = new CompareFn((a, b) => readValue(a, c_int32) - readValue(b, c_int32));

// Or the one-shot form:
const cmp2 = callback(
  (a, b) => readValue(a, c_int32) - readValue(b, c_int32),
  c_int32,
  [c_void_p, c_void_p]
);

// IMPORTANT: release the trampoline when done. Unlike Python, we cannot
// rely on GC — the callback holds a libffi closure that native code may
// still reference.
cmp.release();
```

Both callbacks and libraries implement `Symbol.dispose`, so they work
with the `using` declaration for scope-bound cleanup (also on `throw`):

```javascript
{
  using libc = new CDLL(null);
  using cmp = callback(fn, c_int32, [c_void_p, c_void_p]);
  qsort(arr, 5, 4, cmp);
} // close() + release() run automatically
```

Set `NODE_CTYPES_DEBUG_CALLBACKS=1` to log a stack trace for every
callback garbage-collected without `.release()`.

### Errors: `errno` and `GetLastError`

`GetLastError()` / `get_errno()` read a **private thread-local slot** —
exactly like Python's `ctypes.get_last_error()` / `ctypes.get_errno()`.
The slot is updated **only** by FFI calls through libraries opened with
`use_last_error` or `use_errno`; otherwise it stays at 0.

```javascript
const user32 = new WinDLL("user32.dll", { use_last_error: true });
const FindWindow = user32.func("FindWindowW", c_void_p, [c_wchar_p, c_wchar_p]);
FindWindow("NoSuchClass", null);

GetLastError();              // top-level (Python: ctypes.get_last_error)
user32.get_last_error();     // per-library alias
```

The snapshot is captured atomically in native code immediately after
`ffi_call`, before any other JS can clobber it. To read the raw system
error instead, call `GetLastError` via FFI like any other function.

### Windows API

`wintypes` mirrors `ctypes.wintypes` (BOOL, BYTE, WORD, DWORD, HANDLE,
HWND, LPARAM, WPARAM, LRESULT, LPCWSTR, LPSTR, HGDIOBJ, …) — pure
aliases of the primitive CTypes, so signatures read identical to MSDN.

```javascript
import { WinDLL, Structure, wintypes } from "node-ctypes";
const { WORD, HWND, BOOL, LPVOID } = wintypes;

const kernel32 = new WinDLL("kernel32.dll");

class SYSTEMTIME extends Structure {
  static _fields_ = [
    ["wYear", WORD], ["wMonth", WORD], ["wDayOfWeek", WORD], ["wDay", WORD],
    ["wHour", WORD], ["wMinute", WORD], ["wSecond", WORD], ["wMilliseconds", WORD],
  ];
}

const GetLocalTime = kernel32.func("GetLocalTime", null, [LPVOID]);
const st = new SYSTEMTIME();
GetLocalTime(st);

const user32 = new WinDLL("user32.dll");
const IsWindow = user32.func("IsWindow", BOOL, [HWND]);
```

### Output parameters (`paramflags`)

When at least one `out` param is declared, the call returns **only the
out-params** (single value, or array if >1) — the `restype` is
discarded. To also inspect it (e.g. a `BOOL` success flag), attach an
`errcheck`:

```javascript
const proto = WINFUNCTYPE(BOOL, HWND, POINTER(DWORD), POINTER(DWORD));
const fn = proto.bind(user32, "GetWindowThreadProcessId", [
  { dir: "in", name: "hWnd" },
  { dir: "out", name: "pid" },
  { dir: "out", name: "tid" },
]);

const [pid, tid] = fn(hwnd);     // positional
const [p2, t2] = fn({ hWnd });   // or named-args

fn.errcheck = (result, func, args) => {
  if (!result) throw new Error("call failed");
  return result; // ignored when outs exist
};
```

### Sharing memory with existing buffers

```javascript
// Zero-copy view over a Node Buffer (Python: Structure.from_buffer)
const r = RECT.from_buffer(packet, 16);

// Wrap an externally-allocated pointer (Python: Structure.from_address)
const r2 = RECT.from_address(malloc_result);

// Bind a C-exported global (Python: c_int.in_dll)
const tz = c_int32.in_dll(libc, "_timezone");
```

### Adapter protocols: `_as_parameter_` and `from_param`

```javascript
// Instance protocol: auto-unwrap on call
class Handle {
  constructor(h) { this._as_parameter_ = h; }
}
user32.CloseHandle(new Handle(hwnd));

// Class protocol: custom conversion in argtypes
class StrLen extends c_int32 {
  static from_param(s) { return typeof s === "string" ? s.length : s; }
}
const abs = libc.func("abs", c_int32, [StrLen]);
abs("hello"); // 5
```

### Big-endian structures

```javascript
class NetHeader extends BigEndianStructure {
  static _fields_ = [
    ["magic", c_uint32],
    ["length", c_uint32],
  ];
}
const h = new NetHeader();
h.magic = 0x12345678; // stored as 12 34 56 78 on the wire
```

`LittleEndianStructure`, `BigEndianUnion`, `LittleEndianUnion` work the
same way. Byte order is per-class — nested structs keep their own.

### TypeScript

Argument and return types are narrowed when `argTypes` is a literal
tuple (`as const`) and `returnType` is a CType constant:

```ts
const libc = new CDLL(null);
const strlen = libc.func("strlen", c_int64, [c_char_p] as const);
const n: bigint = strlen("hello"); // typed as bigint, not any
```

For typed struct fields use `defineStruct` instead of `extends Structure`:

```ts
class Point extends defineStruct({ x: c_int32, y: c_int32 }) {
  distance() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
}
const p = new Point({ x: 3, y: 4 }); // p.x, p.y typed as number
```

---

## API reference

### Primitive types

| Type        | Aliases        | Size     | Notes                                         |
| ----------- | -------------- | -------- | --------------------------------------------- |
| `c_int8`    | `c_byte`       | 1        |                                               |
| `c_uint8`   | `c_ubyte`      | 1        |                                               |
| `c_int16`   | `c_short`      | 2        |                                               |
| `c_uint16`  | `c_ushort`     | 2        |                                               |
| `c_int32`   | `c_int`        | 4        |                                               |
| `c_uint32`  | `c_uint`       | 4        |                                               |
| `c_int64`   | `c_longlong`   | 8        |                                               |
| `c_uint64`  | `c_ulonglong`  | 8        |                                               |
| `c_long`    |                | platform | 4 on Windows (LLP64), 8 on Unix 64-bit (LP64) |
| `c_ulong`   |                | platform | platform-dependent, mirrors `c_long`          |
| `c_float`   |                | 4        |                                               |
| `c_double`  |                | 8        |                                               |
| `c_bool`    |                | 1        |                                               |
| `c_char`    |                | 1        | accepts a 1-char string or int                |
| `c_wchar`   |                | 2 or 4   | 2 on Windows (UTF-16), 4 on Unix              |
| `c_char_p`  |                | pointer  | `char *` (NUL-terminated)                     |
| `c_wchar_p` |                | pointer  | `wchar_t *` (NUL-terminated wide)             |
| `c_void_p`  |                | pointer  | opaque pointer / `HANDLE`                     |
| `c_size_t`  |                | pointer  | pointer-sized unsigned integer                |
| `c_ssize_t` |                | pointer  | pointer-sized signed integer                  |
| `HRESULT`   |                | 4        | `c_int32` subclass — auto-raise on `OleDLL`   |

Plus Win32 aliases under `wintypes` (full `ctypes.wintypes` parity).

### Library loaders

- `CDLL(name, { use_errno?, use_last_error? })` — C calling convention
- `WinDLL(name, ...)` — Windows `__stdcall`
- `OleDLL(name, ...)` — like `WinDLL`, auto-raises on negative `HRESULT`
- `find_library(name)` — cross-platform name resolution
- `cdll.<libname>`, `windll.<libname>` — lazy namespaces

### Type constructors

- `struct({...})` / `class extends Structure` — composite struct types
- `class extends Union` — union types
- `array(type, n)` — Python's `type * n`
- `POINTER(type)` — pointer-to-type; accepts a thunk `POINTER(() => T)`
- `pointer(instance)` — pointer to an existing c-data instance
- `CFUNCTYPE(restype, ...argtypes)` — callback type
- `WINFUNCTYPE(restype, ...argtypes)` — `__stdcall` callback type
- `defineStruct({...})` — typed-TS variant of `struct`

### Memory & introspection

- `sizeof(type)` / `alignment(type)` — in bytes
- `addressof(obj)` → BigInt
- `byref(obj)` — lightweight pass-by-reference marker
- `cast(ptr, type)` — reinterpret a pointer as another type
- `memmove(dst, src, n)` / `memset(dst, val, n)`
- `readValue(ptr, type, offset?)` / `writeValue(ptr, type, val, offset?)`
- `create_string_buffer(init)` / `create_unicode_buffer(init)`
- `string_at(addr, size?)` / `wstring_at(addr, size?)`

### Error slots

- `get_errno()` / `set_errno(v)`
- `GetLastError()` / `SetLastError(v)` / `FormatError(code)`
- Per-library: `lib.get_last_error()` / `lib.get_errno()`

### Structure helpers

- `T.from_buffer(buf, offset?)` — zero-copy view
- `T.from_buffer_copy(buf, offset?)` — independent copy
- `T.from_address(addr)` — wrap raw pointer
- `T.in_dll(lib, name)` — bind to exported global
- `T._as_parameter_` / `T.from_param(v)` — adapter protocols

---

## Python ctypes parity & differences

### What works identically

Structs, unions, bit fields, anonymous fields, `_pack_`, nested layouts,
arrays, pointers and pointer arithmetic, callbacks (`CFUNCTYPE` /
`WINFUNCTYPE`), `from_buffer` / `from_buffer_copy` / `from_address` /
`in_dll`, `_as_parameter_` / `from_param`, `paramflags` out-params,
`errcheck`, `use_errno` / `use_last_error`, `OleDLL` + `HRESULT`
auto-raise, `BigEndianStructure` / `LittleEndianStructure` and union
variants, all Win32 aliases under `wintypes`.

### Differences

- **Callbacks must be released** with `.release()`. GC cannot detect when
  C code still holds the pointer; relying on it causes use-after-free.
- **No automatic memory management** for returned pointers.
- **Both class and functional syntax**: `class extends Structure`
  (Python-like) and `struct({...})` (functional) are both supported.
- **Only type classes**, not string literals: `c_int32`, never `"int32"`
  — same as Python.
- **`c_char_p` / `c_wchar_p` accept raw addresses** (BigInt/number) as
  argtypes. Python is stricter (raises `TypeError` on `int`). For
  portable code use `c_void_p` there; both libraries accept it.

### Not supported

- **`ctypes.resize(instance, size)`** — our Structure/Union instances are
  `Proxy` objects wrapping a Node `Buffer`; Buffers aren't resizable in
  place, and re-pointing the Proxy target would break identity.
  Work-around: `new MyStruct(myBuffer)` with a pre-sized buffer.
- **`c_longdouble`** (80/128-bit float, `ffi_type_longdouble`) — rarely
  used; fall back to `c_double` or raw bytes.

---

## Examples

- [Windows Controls Demo](examples/windows/demo_controls.js) — Win32 common controls
- [Windows Registry Demo](examples/windows/demo_registry.js) — `setValue` / `getValue` / `openKey` / `deleteKey`
- [Windows Tray Demo](examples/windows/demo_tray.js) — system tray icon + popup menu
- [Windows COM (Shortcut)](examples/windows/demo_comtypes_file.js) — `IShellLinkW` + `IPersistFile`
- [Windows COM (Active Directory)](examples/windows/demo_comtypes_ads.js) — `IDirectorySearch` / `ADsOpenObject`
- [Windows LDAP Demo](examples/windows/demo_ldap.js) — LDAPv3 paged search (`wldap32`)
- [Smart Card (PC/SC) Demo](examples/demo_scard.js) — `WinSCard` on Windows, `pcsclite` on macOS/Linux

---

## Tests & docs

```bash
cd tests && npm install && npm run test    # unit tests (JS + Python parity)
npm run docs                                # TypeDoc API site in docs/
npm run docs:serve                          # preview
```

See [tests/common/](tests/common/) for runnable examples alongside
parallel Python ctypes implementations.

---

## License

MIT. Built with [libffi](https://github.com/libffi/libffi),
[node-addon-api](https://github.com/nodejs/node-addon-api), and
[cmake-js](https://github.com/cmake-js/cmake-js).
