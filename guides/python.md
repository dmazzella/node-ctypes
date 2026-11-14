---
title: Python ctypes parity
---

# Python ctypes parity

## Supported Python ctypes behavior

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

## Differences

- **Callbacks must be released** with `.release()`. GC cannot detect when
  C code still holds the pointer; relying on it causes use-after-free.
- **No automatic memory management** for returned pointers.
- **Both class and functional syntax**: `class extends Structure`
  (Python-like) and `struct({...})` (functional) are both supported.
- **Use type classes** such as `c_int32`, rather than string names such as
  `"int32"`, for the Python-compatible, typed API.
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
  or `ArrayBuffer` (as its address) as arguments.
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
- **Floating-point scalars accept BigInt in the range `-2**63` to `2**64-1`**,
  converted to a JS number; larger BigInts raise a range error. This applies
  consistently to constructors, fields and function arguments.
- **Array instances are Buffers whose Array methods work on the elements**
  (`slice`, `map`, `includes`, …, as Python sequences); the Buffer methods
  (`readInt32LE`, `subarray`, …) work on the bytes.
- **Array index reads follow JavaScript bounds behavior**: out-of-range
  indices return `undefined`; negative indices do not wrap around as in Python.
- **Unions by value on x86-64 System V** are passed with the ABI rules;
  Python passes them in the wrong registers (libffi#33).
- **Structure/Union fields are accessors of the class**, as Python fields
  are descriptors (`vars(s)` is empty): `Object.keys(s)` and `{ ...s }` do
  not list them; use `s.toObject()`. `JSON.stringify(s)` and
  `console.log(s)` show the fields.

## Not supported

- **`ctypes.resize(instance, size)`** — Structure/Union instances use a
  Node `Buffer`, and Buffers aren't resizable in place.
  Work-around: `new MyStruct(myBuffer)` with a pre-sized buffer.
- **`c_longdouble`** (80/128-bit float, `ffi_type_longdouble`) — rarely
  used; use a native wrapper that converts to supported types, or access
  storage through pointers/bytes. Declaring a `long double` ABI value as
  `c_double` is not a portable substitute.

## Migrating from 1.x

2.0 follows Python ctypes more closely. Code relying on the 1.x behavior
needs these changes:

| 1.x                                                                                                     | 2.0 (as Python)                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ptr.contents` returned the value                                                                       | returns a live instance: `ptr.contents.value` (simple types), `ptr.contents.x` (structs); `ptr[0]` still returns the value |
| `POINTER(T)` restype returned a `bigint` address                                                        | returns a pointer object (`null` for NULL); use `.address` for the number                                                  |
| NULL `POINTER` struct fields were pointer objects                                                       | they are `null`                                                                                                            |
| `c_char` values were numbers                                                                            | 1-character strings; `c_char * n` fields read/write as strings                                                             |
| invalid `c_char` values were truncated                                                                  | `TypeError` (`"one character bytes, bytearray, or an integer in range(256) expected, not ..."`)                            |
| wrong argument types raised `TypeError`                                                                 | raise `ArgumentError` (a `TypeError` subclass), message `"argument N: TypeError: ..."`                                     |
| unsupported pointer arguments (functions, plain objects) passed NULL                                    | raise `ArgumentError` (`"'function' object cannot be interpreted as ctypes.c_void_p"`)                                     |
| functions without `restype` / `argtypes`                                                                | default `restype` is `c_int`; without `argtypes` the call uses the fixed-argument ABI                                      |
| `create_string_buffer(init)`                                                                            | also takes `size` and returns a Buffer with `.value` / `.raw`                                                              |
| `c_long` / `c_ulong` (and `BOOL`, `LONG`, `DWORD`, `ULONG`) fields and `.value` were numbers on Windows | `BigInt` on every platform, like function results; writes accept numbers and BigInt                                        |
| `wintypes.CHAR` was `c_ubyte`; `LPDWORD`, `PDWORD`, `LPBYTE`, `PBYTE`, `PHKEY` were `c_void_p`          | as Python: `CHAR = c_char` and pointer types are `POINTER(T)` (fields and results are pointer objects)                     |
| `string_at(addr, n)` / `wstring_at(addr, n)` stopped at the first NUL                                   | read exactly `n` units; without `n`, `wstring_at` reads up to the NUL (no 256-character limit)                             |
