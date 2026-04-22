# node-ctypes

[![npm version](https://img.shields.io/npm/v/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![npm downloads](https://img.shields.io/npm/dm/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![Build](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml/badge.svg)](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Python ctypes for Node.js** — A foreign function interface library that mirrors the Python ctypes API, built on [libffi](https://github.com/libffi/libffi) and [N-API](https://nodejs.org/api/n-api.html).

If you know Python ctypes, you already know node-ctypes.

## Installation

```bash
npm install node-ctypes
```

Prebuilt binaries for Windows, Linux, and macOS (x64/ARM64).

<details>
<summary>Build from source</summary>

Requires Node.js >= 16, CMake >= 3.15, and a C++ compiler.

```bash
npm install
npm run build
```

</details>

## Python ctypes vs node-ctypes

### Loading libraries and calling functions

**Python:**

```python
from ctypes import CDLL, c_int

libc = CDLL("libc.so.6")
abs_func = libc.abs
abs_func.argtypes = [c_int]
abs_func.restype = c_int
print(abs_func(-42))  # 42
```

**Node.js:**

```javascript
import { CDLL, c_int } from "node-ctypes";

const libc = new CDLL("libc.so.6"); // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS
const abs_func = libc.abs;
abs_func.argtypes = [c_int];
abs_func.restype = c_int;
console.log(abs_func(-42)); // 42
```

A traditional syntax is also available: `libc.func("abs", c_int, [c_int])`.

### Structures

**Python:**

```python
from ctypes import Structure, c_int, c_uint32

class Point(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

p = Point(10, 20)
print(p.x, p.y)  # 10 20
```

**Node.js:**

```javascript
import { Structure, c_int, c_uint32 } from "node-ctypes";

class Point extends Structure {
  static _fields_ = [
    ["x", c_int],
    ["y", c_int],
  ];
}

const p = new Point(10, 20);
console.log(p.x, p.y); // 10 20
```

Nested structs, unions, bit fields, and anonymous fields all work the same way.

### Unions

```javascript
import { Union, c_int, c_float } from "node-ctypes";

class IntOrFloat extends Union {
  static _fields_ = [
    ["i", c_int],
    ["f", c_float],
  ];
}

const u = new IntOrFloat();
u.f = 3.14159;
console.log(u.i); // Bit pattern of float as integer
```

### Arrays

```javascript
import { array, c_int32 } from "node-ctypes";

const IntArray = array(c_int32, 5);
const arr = IntArray.create([1, 2, 3, 4, 5]);
console.log(arr[0]); // 1
```

### Pointers

```javascript
import { POINTER, pointer, c_int32 } from "node-ctypes";

const IntPtr = POINTER(c_int32);
const buf = Buffer.alloc(4);
buf.writeInt32LE(42, 0);

const p = IntPtr.fromBuffer(buf);
console.log(p.contents); // 42 (like *p in C)
console.log(p[0]); // 42 (like p[0] in C)

// pointer() function
const x = new c_int32(42);
const px = pointer(x);
console.log(px.contents); // 42

// fromAddress() — typed access to native memory
const pValues = POINTER(MyStruct).fromAddress(nativeAddr);
console.log(pValues[0].field); // pointer arithmetic (like pValues[0] in C)
console.log(pValues[5].field); // pValues + 5 * sizeof(MyStruct)

// cast() to POINTER — Python: cast(c_void_p(addr), POINTER(MyStruct))
const pData = cast(rawAddr, POINTER(MyStruct));
console.log(pData[0].field); // same result as fromAddress()
```

### Callbacks

```javascript
import { callback, c_int32, c_void_p, readValue } from "node-ctypes";

const compare = callback((a, b) => readValue(a, c_int32) - readValue(b, c_int32), c_int32, [c_void_p, c_void_p]);

// Use with qsort, etc.
compare.release(); // Release when done
```

`CFUNCTYPE(restype, ...argtypes)` is also supported for Python-compatible function pointer types.

### Variadic functions

```javascript
import { CDLL, c_int, c_void_p, c_char_p, string_at } from "node-ctypes";

const libc = new CDLL("libc.so.6"); // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS
const sprintf = libc.func("sprintf", c_int, [c_void_p, c_char_p]);

const buf = Buffer.alloc(256);
sprintf(buf, "Hello %s! %d", "World", 42); // Extra args auto-detected
console.log(string_at(buf)); // "Hello World! 42"
```

### Windows API

```javascript
import { WinDLL, Structure, c_uint16, c_void, c_void_p } from "node-ctypes";

const kernel32 = new WinDLL("kernel32.dll"); // Uses __stdcall

class SYSTEMTIME extends Structure {
  static _fields_ = [
    ["wYear", c_uint16],
    ["wMonth", c_uint16],
    ["wDayOfWeek", c_uint16],
    ["wDay", c_uint16],
    ["wHour", c_uint16],
    ["wMinute", c_uint16],
    ["wSecond", c_uint16],
    ["wMilliseconds", c_uint16],
  ];
}

const GetLocalTime = kernel32.func("GetLocalTime", c_void, [c_void_p]);
const st = new SYSTEMTIME();
GetLocalTime(st);
console.log(`${st.wYear}-${st.wMonth}-${st.wDay}`);
```

## API Compatibility Reference

| Feature               | Python ctypes                           | node-ctypes                                     |
| --------------------- | --------------------------------------- | ----------------------------------------------- |
| Load library          | `CDLL("lib.so")`                        | `new CDLL("lib.so")`                            |
| Function setup        | `f.argtypes = [c_int]`                  | `f.argtypes = [c_int]`                          |
| Structs               | `class P(Structure):`                   | `class P extends Structure`                     |
| Unions                | `class U(Union):`                       | `class U extends Union`                         |
| Arrays                | `c_int * 5`                             | `array(c_int, 5)`                               |
| Bit fields            | `("f", c_uint, 3)`                      | `["f", c_uint32, 3]`                            |
| Callbacks             | `CFUNCTYPE(c_int, c_int)`               | `CFUNCTYPE(c_int, c_int)`                       |
| Pointers              | `POINTER(c_int)` / `pointer(obj)`       | `POINTER(c_int)` / `pointer(obj)`               |
| Pointer arithmetic    | `p[i]`, C-style `ptr + n`               | `p[i]`, `p.add(n)`, `p.slice(a, b)`             |
| Sizeof                | `sizeof(c_int)`                         | `sizeof(c_int)`                                 |
| Alignment             | `alignment(c_int)`                      | `alignment(c_int)`                              |
| Strings               | `c_char_p(b"hello")`                    | `create_string_buffer("hello")`                 |
| Variadic              | `sprintf(buf, b"%d", 42)`               | `sprintf(buf, "%d", 42)`                        |
| Errno slot            | `get_errno()` / `set_errno()`           | `get_errno()` / `set_errno()`                   |
| Last-error slot (Win) | `get_last_error()` / `set_last_error()` | `GetLastError()` / `SetLastError()`             |
| byref                 | `byref(obj)`                            | `byref(obj)`                                    |
| cast                  | `cast(ptr, type)`                       | `cast(ptr, type)` (supports `POINTER()` target) |
| Find library          | `ctypes.util.find_library("c")`         | `find_library("c")`                             |
| Lazy load             | `ctypes.cdll.msvcrt.printf(...)`        | `cdll.msvcrt.printf(...)`                       |
| `from_buffer`         | `S.from_buffer(buf)`                    | `S.from_buffer(buf)`                            |
| `from_buffer_copy`    | `S.from_buffer_copy(buf)`               | `S.from_buffer_copy(buf)`                       |
| `from_address`        | `S.from_address(addr)`                  | `S.from_address(addr)`                          |
| `in_dll`              | `c_int.in_dll(lib, "errno")`            | `c_int.in_dll(lib, "errno")`                    |
| `_as_parameter_`      | Unwrap on call                          | Unwrap on call                                  |
| `from_param`          | Custom conversion                       | Custom conversion                               |
| `use_last_error`      | `CDLL(..., use_last_error=True)`        | `new CDLL(..., { use_last_error: true })`       |
| `use_errno`           | `CDLL(..., use_errno=True)`             | `new CDLL(..., { use_errno: true })`            |
| `OleDLL` / `HRESULT`  | `OleDLL("ole32")` auto-raises           | `new OleDLL("ole32.dll")` auto-throws           |
| `paramflags`          | `proto((name, lib), paramflags)`        | `proto.bind(lib, name, paramflags)`             |
| Big-endian struct     | `class X(BigEndianStructure)`           | `class X extends BigEndianStructure`            |
| Little-endian struct  | `class X(LittleEndianStructure)`        | `class X extends LittleEndianStructure`         |
| Big-endian union      | `class X(BigEndianUnion)`               | `class X extends BigEndianUnion`                |
| Little-endian union   | `class X(LittleEndianUnion)`            | `class X extends LittleEndianUnion`             |

## Supported Types

| Type        | Aliases            | Size       |
| ----------- | ------------------ | ---------- |
| `c_int8`    | `c_char`           | 1          |
| `c_uint8`   | `c_uchar`          | 1          |
| `c_int16`   | `c_short`          | 2          |
| `c_uint16`  | `c_ushort`         | 2          |
| `c_int32`   | `c_int`            | 4          |
| `c_uint32`  | `c_uint`           | 4          |
| `c_int64`   | `c_long` (64-bit)  | 8          |
| `c_uint64`  | `c_ulong` (64-bit) | 8          |
| `c_float`   |                    | 4          |
| `c_double`  |                    | 8          |
| `c_void_p`  | pointer            | 8 (64-bit) |
| `c_char_p`  | string             | pointer    |
| `c_wchar_p` | wide string        | pointer    |
| `c_bool`    |                    | 1          |
| `c_size_t`  |                    | platform   |
| `c_ssize_t` |                    | platform   |

## Python ctypes Parity

`node-ctypes` targets near-complete compatibility with CPython's `ctypes`.
Highlights below.

### Library loading & resolution

```javascript
import { find_library, cdll, windll, CDLL, OleDLL, HRESULT } from "node-ctypes";

// Cross-platform name resolution
const libc = new CDLL(find_library("c"));

// Lazy namespaces (Python: ctypes.cdll / ctypes.windll). Unlike Python,
// node-ctypes does NOT default restype to c_int — set it explicitly or use
// the one-shot .func() form.
const GetTickCount = windll.kernel32.func("GetTickCount", c_uint32, []);
GetTickCount();

// Attribute-style (requires restype/argtypes to be set):
cdll.msvcrt.printf.argtypes = [c_char_p];
cdll.msvcrt.printf.restype = c_int;
cdll.msvcrt.printf("Hi\n");

// Auto-throw on negative HRESULT (Python: OleDLL)
const ole32 = new OleDLL("ole32.dll");
const CoInit = ole32.func("CoInitializeEx", HRESULT, [c_void_p, c_uint32]);
CoInit(null, 0); // throws on failure, no manual check needed
```

### Snapshotted errno / GetLastError (Python ctypes parity)

`GetLastError()` / `get_errno()` read a **private thread-local slot** — exactly
like `ctypes.get_last_error()` / `ctypes.get_errno()` in Python. The slot is
updated **only** by FFI calls through libraries opened with `use_last_error`
or `use_errno`. If you never set that flag, the slot stays at 0.

```javascript
import { WinDLL, GetLastError, c_void_p, c_wchar_p } from "node-ctypes";

const user32 = new WinDLL("user32.dll", { use_last_error: true });
const FindWindow = user32.func("FindWindowW", c_void_p, [c_wchar_p, c_wchar_p]);

FindWindow("NoSuchClass", null);

// Both read the same snapshot — the one taken atomically in native code
// immediately after ffi_call, before any other JS can clobber it.
console.log(GetLastError()); // top-level API (Python: ctypes.get_last_error)
console.log(user32.get_last_error()); // per-library alias
```

To read the **system** `GetLastError()` directly (ignoring the private slot),
call the Win32 API manually as any other FFI function — same as Python.

### `paramflags` — out parameters become return values

```javascript
const proto = WINFUNCTYPE(BOOL, HWND, POINTER(DWORD), POINTER(DWORD));
const fn = proto.bind(user32, "GetWindowThreadProcessId", [
  { dir: "in", name: "hWnd" },
  { dir: "out", name: "pid" },
  { dir: "out", name: "tid" },
]);
const [ok, pid, tid] = fn(hwnd); // positional
const [ok2, pid2, tid2] = fn({ hWnd }); // or named
```

### Structure helpers: `from_buffer` / `from_address` / `in_dll`

```javascript
// Share memory with an existing Buffer (zero-copy view)
const r = RECT.from_buffer(packet, 16);

// Wrap an externally-allocated pointer
const r2 = RECT.from_address(malloc_result);

// Bind to an exported global variable
const tz = c_int32.in_dll(libc, "_timezone");
console.log(tz.value);
```

### `_as_parameter_` and `from_param` protocols

```javascript
class Handle {
  constructor(h) {
    this._as_parameter_ = h;
  }
}
user32.CloseHandle(new Handle(hwnd)); // auto-unwraps

class StrLen extends c_int32 {
  static from_param(s) {
    return typeof s === "string" ? s.length : s;
  }
}
const abs = libc.func("abs", c_int32, [StrLen]);
abs("hello"); // 5
```

### `BigEndianStructure` / `LittleEndianStructure`

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

## Key Differences from Python ctypes

- Callbacks must be manually released with `.release()` to prevent memory leaks
- No automatic memory management for returned pointers
- Both `class extends Structure` (Python-like) and `struct({...})` (functional) syntaxes available
- Only type classes (`c_int32`) are accepted, not string literals (`"int32"`) — same as Python
- `c_char_p` / `c_wchar_p` argtypes also accept a raw `BigInt` / `number` pointer
  address. Python ctypes is stricter (raises `TypeError` on `int`); for portable
  code use `c_void_p` argtype when passing a raw address — both libraries
  accept it there. See below.

### Passing raw pointer addresses

```javascript
// You receive a LPWSTR address from another API (e.g. IDirectorySearch::
// GetNextColumnName writes an address into a Buffer):
const addr = pszColumn.readBigUInt64LE(0);

// Node-ctypes (convenience — accepted on string argtypes):
lib.wcslen.argtypes = [c_wchar_p];
lib.wcslen(addr); // works

// Python-idiomatic (works in both libraries — use for portable code):
lib.wcslen.argtypes = [c_void_p];
lib.wcslen(addr); // works
```

### Debugging callback leaks

Forgetting `.release()` leaks the libffi trampoline and, if C code retains the pointer,
can cause use-after-free. To catch this in development, set
`NODE_CTYPES_DEBUG_CALLBACKS=1`:

```bash
NODE_CTYPES_DEBUG_CALLBACKS=1 node my-app.js
```

Every callback garbage-collected without `.release()` prints a warning with the creation
stack trace. Zero overhead when the variable is unset (default).

### TypeScript

Argument/return types are narrowed when `argTypes` is passed as a literal tuple
(`as const`) and `returnType` is a CType constant:

```ts
import { CDLL, c_int, c_char_p, c_int64 } from "node-ctypes";

const libc = new CDLL(null);
const strlen = libc.func("strlen", c_int64, [c_char_p] as const);
const n: bigint = strlen("hello"); // typed as bigint, not any
```

For typed struct fields use `defineStruct` instead of the class-extension syntax:

```ts
import { defineStruct, c_int32 } from "node-ctypes";

class Point extends defineStruct({ x: c_int32, y: c_int32 }) {
  distance(): number {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
}
const p = new Point({ x: 3, y: 4 }); // p.x, p.y typed as number
```

## Utility Functions

- `create_string_buffer(init)` / `create_unicode_buffer(init)` — create C string buffers
- `string_at(address, size)` / `wstring_at(address, size)` — read strings from memory
- `readValue(ptr, type, offset)` / `writeValue(ptr, type, value, offset)` — direct memory access
- `sizeof(type)` — type size in bytes
- `alignment(type)` — type alignment in bytes
- `addressof(ptr)` — get address as BigInt
- `memmove(dst, src, count)` / `memset(dst, value, count)` — memory operations
- `GetLastError()` / `FormatError(code)` — Windows error helpers

## Examples

- [Windows Controls Demo](examples/windows/demo_controls.js) — Win32 common controls showcase
- [Windows Registry Demo](examples/windows/demo_registry.js) — `setValue` / `getValue` / `openKey` / `deleteValue` / `deleteKey`
- [Windows Tray Demo](examples/windows/demo_tray.js) — system tray icon and popup menu
- [Windows COM — Shortcut](examples/windows/demo_comtypes_file.js) — create a `.lnk` via `IShellLinkW` + `IPersistFile`
- [Windows COM — Active Directory](examples/windows/demo_comtypes_ads.js) — `IDirectorySearch` / `ADsOpenObject` for AD queries (`--tree` / `--flat`)
- [Windows LDAP Demo](examples/windows/demo_ldap.js) — LDAP v3 paged search (`wldap32`), tree/flat output, auth with `SEC_WINNT_AUTH_IDENTITY`
- [Smart Card (PC/SC) Demo](examples/demo_scard.js) — `WinSCard` on Windows, `pcsclite` on macOS/Linux

## Tests

```bash
cd tests
npm install
npm run test
```

See [tests/common/](tests/common/) for working examples including parallel Python implementations.

## Documentation

Generate the API docs locally:

```bash
npm run docs
```

This produces a browsable site in `docs/` using [TypeDoc](https://typedoc.org/). To preview it:

```bash
npm run docs:serve
```

## License

MIT

## Credits

Built with [libffi](https://github.com/libffi/libffi), [node-addon-api](https://github.com/nodejs/node-addon-api), and [cmake-js](https://github.com/cmake-js/cmake-js).
