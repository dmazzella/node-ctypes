---
title: Types
---

# Types

## Primitive types

| Type        | Aliases       | Size     | Notes                                         |
| ----------- | ------------- | -------- | --------------------------------------------- |
| `c_int8`    | `c_byte`      | 1        |                                               |
| `c_uint8`   | `c_ubyte`     | 1        |                                               |
| `c_int16`   | `c_short`     | 2        |                                               |
| `c_uint16`  | `c_ushort`    | 2        |                                               |
| `c_int32`   | `c_int`       | 4        |                                               |
| `c_uint32`  | `c_uint`      | 4        |                                               |
| `c_int64`   | `c_longlong`  | 8        |                                               |
| `c_uint64`  | `c_ulonglong` | 8        |                                               |
| `c_long`    |               | platform | 4 on Windows, 8 on Unix 64-bit; BigInt values |
| `c_ulong`   |               | platform | mirrors `c_long`; BigInt values               |
| `c_float`   |               | 4        |                                               |
| `c_double`  |               | 8        |                                               |
| `c_bool`    |               | 1        |                                               |
| `c_char`    |               | 1        | 1-char string (Python `bytes`); also 0..255   |
| `c_wchar`   |               | 2 or 4   | 1-char string; 2 on Windows, 4 on Unix        |
| `c_char_p`  |               | pointer  | `char *` (NUL-terminated)                     |
| `c_wchar_p` |               | pointer  | `wchar_t *` (NUL-terminated wide)             |
| `c_void_p`  | `c_voidp`     | pointer  | opaque pointer / `HANDLE`                     |
| `c_time_t`  |               | 8        | `time_t` (`SIZEOF_TIME_T`)                    |
| `c_size_t`  |               | pointer  | pointer-sized unsigned integer                |
| `c_ssize_t` |               | pointer  | pointer-sized signed integer                  |
| `HRESULT`   |               | 4        | `c_int32` subclass — auto-raise on `OleDLL`   |

Plus the Win32 types, structures and pointer types of `ctypes.wintypes` under `wintypes`.

## Scalar subclasses and result hooks

Builtin scalar types return ordinary JS values. A subclass instead produces
an instance containing the original C bytes, without invoking its constructor,
public buffer factory or writer. Derived scalar fields, array elements,
pointer indexing and callback arguments likewise expose typed instances;
memory views remain live, including in mirror mode.

The result pipeline is:
`C bytes -> restype representation -> _check_retval_ -> errcheck -> OUT/INOUT`.
A static `_check_retval_` receives the represented result and can replace it
or throw. It is captured when the function is bound; reassigning an attribute's
`restype` rebuilds that binding.

```javascript
class CheckedInt extends c_int32 {
  static _check_retval_(value) {
    return value.value + 100;
  }
}
const checkedAbs = libc.func("abs", CheckedInt, [c_int32]);
checkedAbs(-7); // 107
```

Explicit `HRESULT` validation runs before `errcheck` with all loaders and
prototype callers, not only `OleDLL`. An error in result checking prevents
both `errcheck` and output conversion.
`OleDLL` attributes and `func(name)` default to `HRESULT`; other loaders
default to `c_int`. An explicit restype always overrides the default.
