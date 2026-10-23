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

Prebuilt binaries ship for Windows, macOS 13.5+ and Linux (glibc 2.28+ or musl /
Alpine), on x64 and ARM64 — wherever Node 24 runs.

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
import { Structure, Union, array, c_int32, c_uint32, c_float, c_char } from "node-ctypes";

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
const arr = IntArr5(1, 2, 3, 4, 5); // Python: (c_int32 * 5)(1, 2, 3, 4, 5)

// char arrays read and write as strings (Python: bytes)
const name = array(c_char, 16)();
name.value = "node"; // .value / .raw as in Python
```

An array type in `argtypes` is passed by address, as in C and Python
(`fill.argtypes = [c_int32 * 4]`). As in Python, the argument must be an
instance of an array with the same element type and length; a Buffer or a
typed array is also accepted as its memory. Other values raise
`ArgumentError`.

Nested structs, anonymous fields (`static _anonymous_ = ["data"]`),
explicit packing (`static _pack_ = 1`), minimum alignment
(`static _align_ = 16`), self-referential pointers (`POINTER(() => Node)`)
and subclasses that add fields to their base class all work identically to
Python. The layout of bit fields follows Python's `_layout_`: `"gcc-sysv"`
by default, `"ms"` on Windows or with `_pack_`. Bit fields wider than 53
bits read as BigInt.

Structures and unions passed or returned by value keep this layout, also
with `_pack_`: as with GCC and clang, a structure with misaligned fields is
passed in memory on x86-64 System V (Linux, macOS Intel), where Python
ctypes passes it in registers and the called function reads wrong values.

### Pointers, buffers, and cast

```javascript
import { POINTER, pointer, cast, c_int32, c_void_p } from "node-ctypes";

// Pointer to an existing c-data instance (Python: pointer(x))
const x = new c_int32(42);
const px = pointer(x);
px.contents.value; // 42   (Python: px.contents.value — a live c_int32)
px[0];             // 42   (Python: px[0])
px[0] = 100;
x.value;           // 100  (same memory)

// View existing memory as a typed pointer
const IntPtr = POINTER(c_int32);
const p = IntPtr.fromBuffer(someBuffer);
p[0]; p[1]; p[2];   // pointer arithmetic

// cast() — Python: cast(ptr, POINTER(T))
const q = cast(someBuffer, POINTER(c_int32));
const r = cast(addressAsBigInt, POINTER(MyStruct));
```

A `POINTER(T)` restype returns a pointer object, and a NULL pointer (return
value or struct field) is `null` — where Python returns a falsy pointer.

To hand a raw address to a function, use `c_void_p` as the argtype for
portable code (Python accepts raw `int` only there). As in Python, values
that cannot be converted (a plain JS function, an object) raise
`ArgumentError` instead of passing NULL; `c_void_p` also accepts strings
(as `char *`, Python `bytes`) and any TypedArray/ArrayBuffer.

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

// Pass the callback itself (as in Python) or its address `cmp.pointer`.
qsort(arr, 5, 4, cmp);

// CFUNCTYPE types also work as struct fields (read back as a callable).

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

A function keeps its library loaded as long as it is referenced, also when
the `CDLL` object itself is no longer used. After `close()`, its functions
throw instead of calling unloaded code; `close()` itself throws while a call
to one of them is in progress (from a callback, or a pending `callAsync()`).

Set `NODE_CTYPES_DEBUG_CALLBACKS=1` to log a stack trace for every
callback garbage-collected without `.release()`.

Callbacks invoked by native threads need `threadSafeCallback()`: the
JavaScript function runs on the main thread, and the calling thread waits
for its result (several threads can call it at the same time; each gets the
result of its own call, `0` if the function throws). Like a timer, a
thread-safe callback keeps the event loop
alive until released; `.unref()` lets the process exit when nothing else
is pending (calls are still delivered while it runs), `.ref()` restores it:

```javascript
const onEvent = threadSafeCallback((code) => console.log("event", code), null, [c_int]).unref();
startWorker(onEvent); // a native library calling onEvent from its own thread
```

### Errors: `errno` and `GetLastError`

`GetLastError()` / `get_errno()` read a **private thread-local slot** —
exactly like Python's `ctypes.get_last_error()` / `ctypes.get_errno()`.
The slot is used **only** by FFI calls through libraries opened with
`use_last_error` or `use_errno`; otherwise it stays at 0. As in Python
those calls swap it with the system value: the function sees the value set
with `set_errno()` / `set_last_error()`, the value it leaves becomes the
private one, and the system value is restored after the call.

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

`wintypes` is Python's `ctypes.wintypes`: the same types (BOOL, BYTE,
WORD, DWORD, HANDLE, HWND, LPARAM, WPARAM, LPCWSTR, …), structures (`RECT`,
`POINT`, `SIZE`, `MSG`, `FILETIME`, `WIN32_FIND_DATAW`, …) and pointer types
(`LPDWORD = POINTER(DWORD)`, `LPRECT`, `PHANDLE`, …), plus common extras
(`LRESULT`, `UINT_PTR`, `LSTATUS`, …).

```javascript
import { WinDLL, Structure, POINTER, byref, wintypes } from "node-ctypes";
const { WORD, HWND, BOOL, RECT, LPRECT } = wintypes;

const kernel32 = new WinDLL("kernel32.dll");

class SYSTEMTIME extends Structure {
  static _fields_ = [
    ["wYear", WORD], ["wMonth", WORD], ["wDayOfWeek", WORD], ["wDay", WORD],
    ["wHour", WORD], ["wMinute", WORD], ["wSecond", WORD], ["wMilliseconds", WORD],
  ];
}

kernel32.GetLocalTime.argtypes = [POINTER(SYSTEMTIME)];
kernel32.GetLocalTime.restype = null;
const st = new SYSTEMTIME();
kernel32.GetLocalTime(byref(st));

const user32 = new WinDLL("user32.dll");
user32.GetClientRect.argtypes = [HWND, LPRECT];
user32.GetClientRect.restype = BOOL;
const rect = new RECT();
user32.GetClientRect(hwnd, byref(rect));
rect.right - rect.left; // LONG (c_long) values are BigInt
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
  return args; // args: the arguments, out params as instances (args[1].value)
};
```

As in Python, the value returned by `errcheck` is the result of the call,
unless it is `args` itself: then the out-params are returned.

### Sharing memory with existing buffers

```javascript
// Zero-copy view over a Node Buffer (Python: Structure.from_buffer)
const r = RECT.from_buffer(packet, 16);

// Wrap an externally-allocated pointer (Python: Structure.from_address)
const r2 = RECT.from_address(malloc_result);

// Bind a C-exported global (Python: c_int.in_dll)
const tz = c_int32.in_dll(libc, "_timezone");

// Raw bytes at an address (Python: (c_ubyte * n).from_address(addr));
// `bytes._buffer` is a Buffer over that memory, as Python's memoryview()
const bytes = array(c_uint8, 64).from_address(malloc_result);
const view = new Float32Array(bytes._buffer.buffer, bytes._buffer.byteOffset, 16);
```

### Electron

Electron does not allow Buffers over memory that V8 did not allocate, so a
Buffer *view* of native memory cannot exist there. node-ctypes detects this
when it loads (`EXTERNAL_BUFFERS` is `false`) and keeps the same API:

- instances on native memory (`from_address`, `in_dll`, `pointer.contents`,
  `p[i]`, pointer fields) work on a copy that is re-read before every access
  and written back after every assignment, so they still see what C writes
  and C sees what JavaScript writes;
- passed to a C function, `addressof()`, `pointer()`, `memmove()` and
  `memset()`, such an instance uses the original address;
- the `_buffer` of such an instance is the copy: a typed array or Buffer
  method over it does not read or write native memory. Use the instance
  (`arr[i]`, `s.field`) or `memmove()`.

Only the bytes of the accessed field are copied, one native call per read
or write (about 50 ns); instances on ordinary Buffers (`new Point()`,
`c_int(5)`) have no extra cost. Set `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`
to run in this mode on Node.js.

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

As in Python, `from_param` receives the argument as passed (also with
`CFUNCTYPE` prototypes), its result is converted as the declared type, and
an error it throws becomes `ArgumentError` (`"argument 1: RangeError: ..."`).

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

`static _fields_ = [["x", c_int32]]` compiles as written in Python (no
`as const`). For typed struct fields use `defineStruct` instead of
`extends Structure`:

```ts
class Point extends defineStruct({ x: c_int32, y: c_int32 }) {
  distance() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
}
const p = new Point({ x: 3, y: 4 }); // p.x, p.y typed as number
```

`struct()` / `union()` fields, `POINTER()` targets and arrays of numeric
types are typed too; a `null` return type is `void`:

```ts
const PointDef = struct({ x: c_int32, y: c_double });
PointDef.get(buf, "y");                       // number
POINTER(c_int32).fromAddress(addr)[0];        // number (.contents: c_int32 instance)
array(c_int32, 4).create([1, 2, 3, 4])[0];    // number
libc.func("srand", null, [c_uint32]);         // returns undefined
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
| `c_long`    |                | platform | 4 on Windows, 8 on Unix 64-bit; BigInt values |
| `c_ulong`   |                | platform | mirrors `c_long`; BigInt values               |
| `c_float`   |                | 4        |                                               |
| `c_double`  |                | 8        |                                               |
| `c_bool`    |                | 1        |                                               |
| `c_char`    |                | 1        | 1-char string (Python `bytes`); also 0..255   |
| `c_wchar`   |                | 2 or 4   | 1-char string; 2 on Windows, 4 on Unix        |
| `c_char_p`  |                | pointer  | `char *` (NUL-terminated)                     |
| `c_wchar_p` |                | pointer  | `wchar_t *` (NUL-terminated wide)             |
| `c_void_p`  | `c_voidp`      | pointer  | opaque pointer / `HANDLE`                     |
| `c_time_t`  |                | 8        | `time_t` (`SIZEOF_TIME_T`)                    |
| `c_size_t`  |                | pointer  | pointer-sized unsigned integer                |
| `c_ssize_t` |                | pointer  | pointer-sized signed integer                  |
| `HRESULT`   |                | 4        | `c_int32` subclass — auto-raise on `OleDLL`   |

Plus the Win32 types, structures and pointer types of `ctypes.wintypes` under `wintypes`.

### Library loaders

- `CDLL(name, mode?)` or `CDLL(name, { mode?, use_errno?, use_last_error? })` — C calling convention; `mode` is the `dlopen` flag (`RTLD_GLOBAL`, `RTLD_LOCAL`, `DEFAULT_MODE`)
- `WinDLL(name, ...)` — Windows `__stdcall`
- `OleDLL(name, ...)` — like `WinDLL`, auto-raises on negative `HRESULT`
- `find_library(name)` — cross-platform name resolution
- `cdll.<libname>`, `windll.<libname>` — lazy namespaces; `cdll.LoadLibrary(name)`, `new LibraryLoader(CDLL)`
- Functions without `restype` return `c_int`; without `argtypes` the arguments are converted from their JS values (as Python)

### Type constructors

- `struct({...})` / `class extends Structure` — composite struct types
- `class extends Union` — union types
- `array(type, n)` / `ARRAY(type, n)` — Python's `type * n`; callable: `array(c_int, 3)(1, 2, 3)`; elements can be simple types, structures, arrays, `POINTER(T)` and `CFUNCTYPE` types
- `POINTER(type)` — pointer-to-type; accepts a thunk `POINTER(() => T)`
- `pointer(instance)` — pointer to an existing c-data instance
- `CFUNCTYPE(restype, ...argtypes)` — function pointer type: `proto(jsFn)` (callback), `proto(address)`, `proto([name, lib], paramflags?)` (Python: `proto((name, dll), paramflags)`)
- `WINFUNCTYPE(restype, ...argtypes)` — `__stdcall` callback type
- `defineStruct({...})` — typed-TS variant of `struct`

### Memory & introspection

- `sizeof(type)` / `alignment(type)` — in bytes
- `addressof(obj)` → BigInt
- `byref(obj)` — lightweight pass-by-reference marker
- `cast(ptr, type)` — reinterpret a pointer as another type
- `memmove(dst, src, n)` / `memset(dst, val, n)` — buffers, ctypes instances, pointers or addresses
- `readValue(ptr, type, offset?)` / `writeValue(ptr, type, val, offset?)`
- `create_string_buffer(init, size?)` / `c_buffer` / `create_unicode_buffer(init, size?)` — with `.value` (and `.raw`)
- `string_at(addr, size?)` / `wstring_at(addr, size?)` — exactly `size` units, or up to the NUL

### Error slots

- `get_errno()` / `set_errno(v)`
- `GetLastError()` / `SetLastError(v)` / `FormatError(code)`, Python names `get_last_error()` / `set_last_error(v)` (all platforms)
- `ArgumentError` — raised for arguments that do not match `argtypes` (`"argument N: TypeError: ..."`)
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

Structs, unions, bit fields (`_layout_` `"gcc-sysv"` / `"ms"`), anonymous
fields, `_pack_`, `_align_`, subclasses of structures and unions, nested layouts,
structures and unions by value (a struct `restype` returns an instance),
arrays (also of arrays, pointers and function pointers), pointers and
pointer arithmetic (also `POINTER(POINTER(T))`), callbacks (`CFUNCTYPE` /
`WINFUNCTYPE`, also as struct fields), `prototype((name, dll), paramflags)`,
`from_buffer` / `from_buffer_copy` / `from_address` / `in_dll`,
`_as_parameter_` / `from_param`, `paramflags` out-params, `errcheck`,
`use_errno` / `use_last_error`, `OleDLL` + `HRESULT` auto-raise,
`BigEndianStructure` / `LittleEndianStructure` and union variants,
`ctypes.wintypes`, keepalive of objects assigned to fields (`_objects`).

### Differences

- **Callbacks must be released** with `.release()`. GC cannot detect when
  C code still holds the pointer; relying on it causes use-after-free.
- **No automatic memory management** for returned pointers.
- **Both class and functional syntax**: `class extends Structure`
  (Python-like) and `struct({...})` (functional) are both supported.
- **Only type classes**, not string literals: `c_int32`, never `"int32"`
  — same as Python.
- **`bytes` are JS strings**: `c_char` values, `c_char * n` arrays and
  fields, `c_char_p` and `create_string_buffer().value` use strings (UTF-8)
  where Python uses `bytes`; `.raw` is a `Buffer`.
- **NULL pointers are `null`**, where Python returns a falsy pointer object.
- **`c_char_p` / `c_wchar_p` accept raw addresses** (BigInt/number) as
  argtypes. Python is stricter (raises `TypeError` on `int`). For
  portable code use `c_void_p` there; both libraries accept it.
- **`get_last_error()` / `set_last_error()`** exist on every platform
  (Python: Windows only), so the same code runs everywhere.
- **64-bit and pointer-sized integers** (`c_int64`, `c_uint64`,
  `c_size_t`, `c_ssize_t`) also accept `null` (as 0) and a `Buffer`
  (as its address) as arguments.
- **Variadic arguments follow the C promotions**: a `c_float`, `c_int8`,
  `c_char`, … instance passed beyond `argtypes` is passed as `double` /
  `int`, where Python fails (`ffi_prep_cif_var failed`).
- **A plain object is accepted for a structure argument** passed by value
  (fields by name).
- **`c_wchar` also accepts a code point** (`new c_wchar(0x4E2D)`), where
  Python requires a 1-character string.
- **`memmove()` / `memset()` stop at the end of JS memory** (Buffer, typed
  array, `ArrayBuffer`) instead of writing past it.
- **Integer types reject non-integral numbers** (`3.7`, `NaN`) as Python
  rejects floats; JS has no int/float distinction, so `3.0` is accepted.
- **Array instances are Buffers whose Array methods work on the elements**
  (`slice`, `map`, `includes`, …, as Python sequences); the Buffer methods
  (`readInt32LE`, `subarray`, …) work on the bytes.
- **Unions by value on x86-64 System V** are passed with the ABI rules;
  Python passes them in the wrong registers (libffi#33).
- **Structure/Union fields are accessors of the class**, as Python fields
  are descriptors (`vars(s)` is empty): `Object.keys(s)` and `{ ...s }` do
  not list them; use `s.toObject()`. `JSON.stringify(s)` and
  `console.log(s)` show the fields.

### Not supported

- **`ctypes.resize(instance, size)`** — Structure/Union instances use a
  Node `Buffer`, and Buffers aren't resizable in place.
  Work-around: `new MyStruct(myBuffer)` with a pre-sized buffer.
- **`c_longdouble`** (80/128-bit float, `ffi_type_longdouble`) — rarely
  used; fall back to `c_double` or raw bytes.

### Migrating from 1.x

2.0 follows Python ctypes more closely. Code relying on the 1.x behavior
needs these changes:

| 1.x | 2.0 (as Python) |
| --- | --- |
| `ptr.contents` returned the value | returns a live instance: `ptr.contents.value` (simple types), `ptr.contents.x` (structs); `ptr[0]` still returns the value |
| `POINTER(T)` restype returned a `bigint` address | returns a pointer object (`null` for NULL); use `.address` for the number |
| NULL `POINTER` struct fields were pointer objects | they are `null` |
| `c_char` values were numbers | 1-character strings; `c_char * n` fields read/write as strings |
| invalid `c_char` values were truncated | `TypeError` (`"one character bytes, bytearray, or an integer in range(256) expected, not ..."`) |
| wrong argument types raised `TypeError` | raise `ArgumentError` (a `TypeError` subclass), message `"argument N: TypeError: ..."` |
| unsupported pointer arguments (functions, plain objects) passed NULL | raise `ArgumentError` (`"'function' object cannot be interpreted as ctypes.c_void_p"`) |
| functions without `restype` / `argtypes` | default `restype` is `c_int`; without `argtypes` the call uses the fixed-argument ABI |
| `create_string_buffer(init)` | also takes `size` and returns a Buffer with `.value` / `.raw` |
| `c_long` / `c_ulong` (and `BOOL`, `LONG`, `DWORD`, `ULONG`) fields and `.value` were numbers on Windows | `BigInt` on every platform, like function results; writes accept numbers and BigInt |
| `wintypes.CHAR` was `c_ubyte`; `LPDWORD`, `PDWORD`, `LPBYTE`, `PBYTE`, `PHKEY` were `c_void_p` | as Python: `CHAR = c_char` and pointer types are `POINTER(T)` (fields and results are pointer objects) |
| `string_at(addr, n)` / `wstring_at(addr, n)` stopped at the first NUL | read exactly `n` units; without `n`, `wstring_at` reads up to the NUL (no 256-character limit) |

---

## Examples

Each example in `examples/` has its own README; see the [index](examples/README.md).

- [Embedded Python](examples/cross-platform/python/README.md) — CPython through its C API: code, modules, callbacks, JavaScript objects by reference, shared memory, threads, asyncio and cancellation (Windows, macOS, Linux)
- [Smart card (PC/SC)](examples/cross-platform/smartcard/README.md) — `winscard` on Windows, `PCSC.framework` on macOS, `libpcsclite` on Linux
- [Accessibility](examples/macos/accessibility/README.md) — macOS UI automation with the Accessibility API
- [COM automation](examples/windows/com/README.md) — shell shortcuts (`IShellLinkW`) and Active Directory (`IDirectorySearch`)
- [Controls](examples/windows/controls/README.md) — Win32 common controls
- [LDAP](examples/windows/ldap/README.md) — LDAPv3 paged search (`wldap32`)
- [Registry](examples/windows/registry/README.md) — `setValue` / `getValue` / `openKey` / `deleteKey`
- [System tray](examples/windows/tray/README.md) — tray icon + popup menu

---

## Tests & docs

`npm test` first builds a small C library (`tests/fixtures/`, into
`build/fixture/`) used by the tests of structures by value, array parameters
and reentrant calls; `npm run build:test-fixture` builds it alone. Python
twins of the tests (`tests/common/*.py`) load the same library.

```bash
cd tests && npm install && npm run test    # unit tests (JS + Python parity)
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm test  # again as in Electron (from tests/)
npm run test:types                          # type-check lib/index.d.ts (tests/types)
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
