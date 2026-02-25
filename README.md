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
import { CDLL, c_int } from 'node-ctypes';

const libc = new CDLL("libc.so.6");  // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS
const abs_func = libc.abs;
abs_func.argtypes = [c_int];
abs_func.restype = c_int;
console.log(abs_func(-42));  // 42
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
import { Structure, c_int, c_uint32 } from 'node-ctypes';

class Point extends Structure {
    static _fields_ = [["x", c_int], ["y", c_int]];
}

const p = new Point(10, 20);
console.log(p.x, p.y);  // 10 20
```

Nested structs, unions, bit fields, and anonymous fields all work the same way.

### Unions

```javascript
import { Union, c_int, c_float } from 'node-ctypes';

class IntOrFloat extends Union {
    static _fields_ = [["i", c_int], ["f", c_float]];
}

const u = new IntOrFloat();
u.f = 3.14159;
console.log(u.i);  // Bit pattern of float as integer
```

### Arrays

```javascript
import { array, c_int32 } from 'node-ctypes';

const IntArray = array(c_int32, 5);
const arr = IntArray.create([1, 2, 3, 4, 5]);
console.log(arr[0]);  // 1
```

### Pointers

```javascript
import { POINTER, pointer, c_int32 } from 'node-ctypes';

const IntPtr = POINTER(c_int32);
const buf = Buffer.alloc(4);
buf.writeInt32LE(42, 0);

const p = IntPtr.fromBuffer(buf);
console.log(p.contents);  // 42
console.log(p[0]);         // 42

// pointer() function
const x = new c_int32(42);
const px = pointer(x);
console.log(px.contents);  // 42
```

### Callbacks

```javascript
import { callback, c_int32, c_void_p, readValue } from 'node-ctypes';

const compare = callback(
    (a, b) => readValue(a, c_int32) - readValue(b, c_int32),
    c_int32, [c_void_p, c_void_p]
);

// Use with qsort, etc.
compare.release();  // Release when done
```

`CFUNCTYPE(restype, ...argtypes)` is also supported for Python-compatible function pointer types.

### Variadic functions

```javascript
import { CDLL, c_int, c_void_p, c_char_p, string_at } from 'node-ctypes';

const libc = new CDLL('libc.so.6');  // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS
const sprintf = libc.func('sprintf', c_int, [c_void_p, c_char_p]);

const buf = Buffer.alloc(256);
sprintf(buf, 'Hello %s! %d', 'World', 42);  // Extra args auto-detected
console.log(string_at(buf));  // "Hello World! 42"
```

### Windows API

```javascript
import { WinDLL, Structure, c_uint16, c_void, c_void_p } from 'node-ctypes';

const kernel32 = new WinDLL('kernel32.dll');  // Uses __stdcall

class SYSTEMTIME extends Structure {
    static _fields_ = [
        ["wYear", c_uint16], ["wMonth", c_uint16],
        ["wDayOfWeek", c_uint16], ["wDay", c_uint16],
        ["wHour", c_uint16], ["wMinute", c_uint16],
        ["wSecond", c_uint16], ["wMilliseconds", c_uint16]
    ];
}

const GetLocalTime = kernel32.func('GetLocalTime', c_void, [c_void_p]);
const st = new SYSTEMTIME();
GetLocalTime(st);
console.log(`${st.wYear}-${st.wMonth}-${st.wDay}`);
```

## API Compatibility Reference

| Feature | Python ctypes | node-ctypes |
|---------|---------------|-------------|
| Load library | `CDLL("lib.so")` | `new CDLL("lib.so")` |
| Function setup | `f.argtypes = [c_int]` | `f.argtypes = [c_int]` |
| Structs | `class P(Structure):` | `class P extends Structure` |
| Unions | `class U(Union):` | `class U extends Union` |
| Arrays | `c_int * 5` | `array(c_int, 5)` |
| Bit fields | `("f", c_uint, 3)` | `["f", c_uint32, 3]` |
| Callbacks | `CFUNCTYPE(c_int, c_int)` | `CFUNCTYPE(c_int, c_int)` |
| Pointers | `POINTER(c_int)` / `pointer(obj)` | `POINTER(c_int)` / `pointer(obj)` |
| Sizeof | `sizeof(c_int)` | `sizeof(c_int)` |
| Strings | `c_char_p(b"hello")` | `create_string_buffer("hello")` |
| Variadic | `sprintf(buf, b"%d", 42)` | `sprintf(buf, "%d", 42)` |
| Errno | `get_errno()` | `get_errno()` |
| byref | `byref(obj)` | `byref(obj)` |
| cast | `cast(ptr, type)` | `cast(ptr, type)` |

## Supported Types

| Type | Aliases | Size |
|------|---------|------|
| `c_int8` | `c_char` | 1 |
| `c_uint8` | `c_uchar` | 1 |
| `c_int16` | `c_short` | 2 |
| `c_uint16` | `c_ushort` | 2 |
| `c_int32` | `c_int` | 4 |
| `c_uint32` | `c_uint` | 4 |
| `c_int64` | `c_long` (64-bit) | 8 |
| `c_uint64` | `c_ulong` (64-bit) | 8 |
| `c_float` | | 4 |
| `c_double` | | 8 |
| `c_void_p` | pointer | 8 (64-bit) |
| `c_char_p` | string | pointer |
| `c_wchar_p` | wide string | pointer |
| `c_bool` | | 1 |
| `c_size_t` | | platform |

## Key Differences from Python ctypes

- Callbacks must be manually released with `.release()` to prevent memory leaks
- No automatic memory management for returned pointers
- Both `class extends Structure` (Python-like) and `struct({...})` (functional) syntaxes available
- Only type classes (`c_int32`) are accepted, not string literals (`"int32"`) — same as Python

## Utility Functions

- `create_string_buffer(init)` / `create_unicode_buffer(init)` — create C string buffers
- `string_at(address, size)` / `wstring_at(address, size)` — read strings from memory
- `readValue(ptr, type, offset)` / `writeValue(ptr, type, value, offset)` — direct memory access
- `sizeof(type)` — type size in bytes
- `addressof(ptr)` — get address as BigInt
- `memmove(dst, src, count)` / `memset(dst, value, count)` — memory operations
- `GetLastError()` / `FormatError(code)` — Windows error helpers

## Examples

- [Windows Controls Demo](examples/windows/demo_controls.js) — Win32 common controls showcase
- [Windows Registry Demo](examples/windows/demo_registry.js) — setValue, getValue, openKey, deleteValue, deleteKey
- [Windows Tray Demo](examples/windows/demo_tray.js) — System tray menu
- [Windows COM Automation Demo](examples/windows/demo_comtypes.js) — IShellLinkW / IPersistFile COM interfaces
- [Windows LDAP Demo](examples/windows/demo_ldap.js) — LDAP directory queries
- [Smart Card (PC/SC) Demo](examples/demo_scard.js) — WinSCard on Windows, pcsclite on macOS/Linux

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
