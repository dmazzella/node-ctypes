---
title: Coming from Koffi
---

# Coming from Koffi

Koffi and node-ctypes both call C functions from Node.js without a compiler.
Koffi has its own API, with C-like prototype strings; node-ctypes follows
Python ctypes. This page maps the Koffi 3.3 API, as described in Koffi's own
documentation, to node-ctypes.

In the examples, `libc` is `new CDLL(process.platform === "win32" ? "msvcrt" : null)`.

## Libraries and functions

| Koffi                                                 | node-ctypes                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `koffi.load(path)`                                    | `new CDLL(path)`; `WinDLL` for `__stdcall` APIs, `OleDLL` for `HRESULT` APIs                   |
| `koffi.load(path, { global: true })`                  | `new CDLL(path, RTLD_GLOBAL)`                                                                  |
| `lib.unload()`                                        | `lib.close()`, or a `using` declaration; its functions then throw `Library is closed`          |
| `lib.func('int atoi(const char *str)')`               | `lib.func("atoi", c_int, [c_char_p])`                                                          |
| `lib.func('atoi', 'int', ['str'])`                    | the same, or `lib.atoi.argtypes = [c_char_p]` and `lib.atoi.restype = c_int`                   |
| `lib.func('__stdcall', 'MessageBoxA', ...)`           | a `WinDLL` library, or `lib.func(name, restype, argtypes, { abi: "stdcall" })`                 |
| `fn.async(...args, (err, res) => {})`                 | `await fn.callAsync(...args)`, or `fn.callOn(executor, ...args)` on an [Executor](async.md)    |
| `lib.symbol(name)` with `koffi.decode`/`koffi.encode` | `c_int.in_dll(lib, name)`, a live instance; `lib.symbol(name)` also returns the address BigInt |

node-ctypes has no prototype parser: signatures are type objects (`c_int`,
`POINTER(T)`, structure classes), as in Python.

**Variadic functions.** Koffi needs the type before each extra argument
(`printf(fmt, 'int', 6, 'double', 8.5)`). node-ctypes infers the type from
the value, with the C promotions; a ctypes instance fixes it
(`new c_double(4)`):

```javascript
const printf = libc.func("printf", c_int, [c_char_p]);
printf("Integer %d, double %g, str %s\n", 6, 8.5, "THE END");
```

Variadic functions can also be called with `callAsync()`.

## Types

| Koffi                                          | node-ctypes                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `int8_t`, `uint8_t`, `int16_t` … `int`, `uint` | `c_int8`, `c_uint8`, `c_int16` … `c_int`, `c_uint`                                 |
| `int64_t`, `uint64_t`                          | `c_int64`, `c_uint64`: results are always BigInt                                   |
| `long`, `ulong`                                | `c_long`, `c_ulong`: results are BigInt on every platform                          |
| `size_t`                                       | `c_size_t`: results are BigInt                                                     |
| `float`, `double`, `bool`                      | `c_float`, `c_double`, `c_bool`                                                    |
| `char`, a number                               | `c_byte`, a number; `c_char` is a one-character string, as Python `bytes`          |
| `str`, `const char *`                          | `c_char_p`                                                                         |
| `wchar_t *`, `wstring`                         | `c_wchar_p` (UTF-16 on Windows, UTF-32 elsewhere)                                  |
| `void *`                                       | `c_void_p`; addresses are BigInt                                                   |
| `koffi.pointer(T)`, `'T *'`                    | `POINTER(T)`: pointer objects with `.contents`, `[i]` and `.address`; NULL is null |
| `koffi.enumeration(...)`                       | no enum type: `c_int` and constants, as in Python                                  |
| `koffi.alias('HWND', ...)`                     | a JavaScript constant, for example `const HWND = c_void_p`                         |
| `koffi.types.long`                             | `c_long`                                                                           |
| `koffi.sizeof(T)`, `koffi.alignof(T)`          | `sizeof(T)`, `alignment(T)`                                                        |
| `koffi.offsetof(T, 'field')`                   | for `struct({...})` definitions, `Def.fields` lists each field with its `offset`   |

The [Types](types.md) page has the full table, with sizes and aliases.

## Structures, unions and arrays

| Koffi                                      | node-ctypes                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `koffi.struct('A', { a: 'int', ... })`     | `class A extends Structure { static _fields_ = [["a", c_int], ...] }`, or `struct({ a: c_int })` |
| `koffi.pack(...)`                          | `static _pack_ = 1`                                                                              |
| member alignment, `b: [8, 'int16_t']`      | no per-field alignment; `static _align_` sets the minimum alignment of the whole structure       |
| `koffi.opaque()`, `koffi.pointer(opaque)`  | `class FILE extends Structure {}` used as `POINTER(FILE)`, or `c_void_p`                         |
| `koffi.array('int16_t', 2)`                | `array(c_int16, 2)` (Python `c_int16 * 2`)                                                       |
| flexible array members                     | no equivalent: read the trailing elements with `array(T, n).from_address(address)`               |
| `koffi.union(...)`, `new koffi.Union(...)` | `class U extends Union { static _fields_ = [...] }`                                              |

Koffi converts structures to and from plain objects. In node-ctypes a plain
object is accepted for a structure argument passed by value; a structure
result is an instance of the `Structure` class, or a plain object for a
`struct({...})` definition. Arrays are Buffers whose array methods work on
the elements, rather than typed arrays. See
[Structures, unions and arrays](structures.md).

## Pointers and memory

| Koffi                                 | node-ctypes                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `koffi.decode(ptr, 'int')`            | `readValue(ptr, c_int)`                                                                               |
| `koffi.decode(ptr, 'char *')`         | `readValue(ptr, c_char_p)` (the `char *` stored at `ptr`); `string_at(ptr)` reads the string at `ptr` |
| `koffi.decode(ptr, StructType)`       | `StructType.from_address(ptr)`, a live view                                                           |
| `koffi.encode(ptr, 'int', value)`     | `writeValue(ptr, c_int, value)`                                                                       |
| `koffi.view(ptr, len)`                | `array(c_uint8, len).from_address(ptr)._buffer`                                                       |
| `koffi.alloc(...)`, `koffi.free(ptr)` | `new T()`, `array(T, n)()`, `create_string_buffer(n)`: the instance owns its memory                   |
| `koffi.disposable(...)`, `'str!'`     | no equivalent: declare `c_void_p`, read with `string_at()`, then call the library's `free`            |
| `_Out_ T *`, `koffi.out(...)`         | `POINTER(T)` argument and `byref(instance)`, or an `out` parameter with `paramflags`                  |
| `_Inout_ T *`, `koffi.inout(...)`     | `byref(instance)` (C reads and writes it), or an `inout` parameter with `paramflags`                  |
| `koffi.errno()`                       | `get_errno()` with a library opened with `{ use_errno: true }`                                        |

Keep an instance referenced while C uses its memory. Memory allocated by C is
freed with the library's own function, called through node-ctypes like any
other:

```javascript
const strdup = libc.func(process.platform === "win32" ? "_strdup" : "strdup", c_void_p, [c_char_p]);
const free = libc.func("free", null, [c_void_p]);
const copy = strdup("copy");
string_at(copy); // "copy"
free(copy);
```

Output parameters:

```javascript
const strtol = libc.func("strtol", c_long, [c_char_p, POINTER(c_char_p), c_int]);
const end = new c_char_p();
strtol("123abc", byref(end), 10); // 123n
end.value; // "abc"
```

`get_errno()` reads a private slot, as Python `ctypes.get_errno()`: calls
through a library opened with `use_errno` capture errno right after the call;
other calls leave the slot unchanged. On Windows each C runtime has its own
errno. Under Electron, views over native memory are synchronized copies
instead of failing ([Electron](memory.md#electron)). See
[Pointers and memory](memory.md) and [Errors and results](errors.md).

## Callbacks

| Koffi                                          | node-ctypes                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `koffi.proto('int Cb(int a, int b)')`          | `CFUNCTYPE(c_int, c_int, c_int)`                                                     |
| a JS function passed as a transient callback   | an explicit callback, `new Proto(fn)` or `callback(fn, restype, argtypes)`           |
| `koffi.register(fn, type)`, `koffi.unregister` | the same callback objects; call `.release()` (or `using`) when C no longer uses them |
| callbacks called from other threads            | `threadSafeCallback(fn, restype, argtypes)`                                          |
| pointer arguments as BigInt, `koffi.decode`    | `c_void_p` arguments are BigInt; `POINTER(T)` arguments are pointer objects          |
| `koffi.call(ptr, proto, ...args)`              | `Proto(address)(...args)`                                                            |
| `koffi.decode(ptr, proto)`                     | `Proto(address)`, a callable                                                         |

A bare JavaScript function passed where C expects a function pointer raises
`ArgumentError`: create the callback first and release it when done.

```javascript
const qsort = libc.func("qsort", null, [c_void_p, c_size_t, c_size_t, c_void_p]);
const values = array(c_int32, 4)(3, 1, 4, 2);
const compare = callback((a, b) => readValue(a, c_int32) - readValue(b, c_int32), c_int32, [c_void_p, c_void_p]);
qsort(values, 4, 4, compare);
compare.release();
[...values]; // [1, 2, 3, 4]
```

A plain callback called from another thread does not run JavaScript and
returns zero; `threadSafeCallback()` runs the function on the JavaScript
thread and makes the calling thread wait for its result. See
[Callbacks](callbacks.md).

## What node-ctypes adds

- The Python ctypes API, with its semantics checked against CPython by paired
  tests ([Python ctypes parity](python.md)).
- An [Executor](async.md): a native thread with a FIFO queue, cancellation
  and inline completion of short calls.
- `errcheck`, `paramflags` and the `_as_parameter_` / `from_param` adapter
  protocols ([Errors and results](errors.md),
  [Libraries and functions](functions.md)).
- `wintypes` and the Windows API helpers ([Windows API](windows.md)).
- Typed signatures and structures in TypeScript ([TypeScript](typescript.md)).
