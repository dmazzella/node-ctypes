---
title: Libraries and functions
---

# Libraries and functions

## Calling a C function

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

How a call reaches C depends on its signature; the JavaScript API is the same:

- Synchronous calls of scalars, pointers and strings, up to 32 arguments, are
  register-frame calls on AArch64, x86-64 System V and Win64 with the default
  calling convention: each argument is converted straight into its register
  or stack slot, and one C++ call per ABI passes them. On Apple ARM64 the stack
  arguments are packed by size and alignment, as that ABI requires.
- A bounded set of exact scalar signatures with up to four arguments uses fixed
  C++ invokers instead (on x86-64 without `float`/`double` arguments, so that
  a variadic function declared with `argtypes` gets its doubles as libffi
  passes them).
- Structures and unions by value, other calling conventions and the general
  path use libffi. The call interface of the declared signature is prepared
  when the function is bound; those of calls with extra (variadic or inferred)
  arguments are kept in a small per-function cache.
- `callAsync()` uses the fixed invoker of its signature or libffi.

`CDLL.func()` and `CFUNCTYPE` callers return the native function itself when
the arguments need no JavaScript conversion (numbers, booleans, BigInt, and
strings for `c_char_p`); calls with objects, an `errcheck` or other
signatures go through the JavaScript converters. Building with
`CTYPES_ENABLE_DIRECT_CALLS=OFF` disables the fixed invokers and the
register-frame calls.

## Library loaders

- `CDLL(name, mode?)` or `CDLL(name, { mode?, use_errno?, use_last_error? })` — C calling convention; `mode` is the `dlopen` flag (`RTLD_GLOBAL`, `RTLD_LOCAL`, `DEFAULT_MODE`)
- `WinDLL(name, ...)` — Windows `__stdcall`
- `OleDLL(name, ...)` — like `WinDLL`, auto-raises on negative `HRESULT`
- `find_library(name)` — cross-platform name resolution
- `cdll.<libname>`, `windll.<libname>` — lazy namespaces; `cdll.LoadLibrary(name)`, `new LibraryLoader(CDLL)`
- Functions without `restype` return `c_int`; without `argtypes` the arguments are converted from their JS values (as Python)

An untyped object such as `{}` is rejected with `TypeError` when assigning
`fn.argtypes` or `fn.restype`, even before the first call. The previous
declaration and `errcheck` remain usable. `CFUNCTYPE` also rejects such an
object when creating the prototype. This check does not look up the symbol
or move native ABI validation out of binding.

## Closing a library

A bound function keeps its library loaded as long as it is referenced, also
when the `CDLL` object itself is no longer used. After `close()`, `loaded` is
false and its bound functions and symbol lookups throw; `close()` itself
throws while a call to one of them is in progress (from a callback, or a
pending `callAsync()`). Repeated `close()` calls are harmless.

Existing `in_dll()` views keep the underlying module loaded even after
`close()`. Release of the native library handle is deferred until the last
dependent view, Buffer, typed array or typed pointer copy is collected; those
existing views remain usable. Actual physical unloading depends on the OS loader: for example,
musl keeps shared libraries resident until process exit even after `dlclose()`.
Raw addresses obtained with `symbol()` do not carry this ownership information.

## Adapter protocols: `_as_parameter_` and `from_param`

```javascript
// Instance protocol: auto-unwrap on call
class Handle {
  constructor(h) {
    this._as_parameter_ = h;
  }
}
user32.CloseHandle(new Handle(hwnd));

// Class protocol: custom conversion in argtypes
class StrLen extends c_int32 {
  static from_param(s) {
    return typeof s === "string" ? s.length : s;
  }
}
const abs = libc.func("abs", c_int32, [StrLen]);
abs("hello"); // 5
```

As in Python, `from_param` receives the argument as passed (also with
`CFUNCTYPE` prototypes), its result is converted as the declared type, and
an error it throws becomes `ArgumentError` (`"argument 1: RangeError: ..."`).

Non-pointer scalar CData arguments are read from their backing bytes, not an
overridden public `.value` getter. Each value is snapshotted before converting
the next argument, even without `argtypes`. A scalar `from_param` converter may
return a CData instance of another class when its native scalar kind matches
the declared type.

When a `Structure` or `Union` class is declared **by value**, its default
conversion accepts instances of that class or its subclasses. Another aggregate
with the same layout is not enough: it must supply an `_as_parameter_` that
resolves to an accepted value, or the call raises `ArgumentError` before
converting the next argument. A custom `from_param` can explicitly return a
different aggregate with the correct C ABI. JavaScript field objects and byte
views are still accepted; functional `struct()` / `union()` definitions do
not impose a class check.

For a declared structure or union passed by value, the snapshot boundary is
`sizeof(c_void_p)`, as in CPython. Above that size, a later `from_param` can
change the original but not the bytes the C function receives. At or below
that size, the C function can see the later change. Only the aggregate itself
is copied: pointer fields still address the same memory. Passing a pointer or
an array by address does not take this snapshot.

Objects passed through argument adapters and the objects produced by their
conversions stay alive while later arguments are converted and until the
result and `errcheck` have been processed. With `callAsync()`, those temporary
owners stay alive until its Promise settles. The native worker also retains
memory passed by value or as an integer address, including values materialized
by getters.

`_as_parameter_` chains are resolved recursively, including results of
`from_param`, with intermediate owners retained. As in CPython, an adapter may
be visited again when a stateful getter eventually returns a usable value;
object identity alone is not rejected as a cycle, and there is no fixed
128-step limit. Non-terminating recursion raises an argument conversion error.
The available recursion depth and stack-error wording follow the JavaScript
runtime, rather than CPython's runtime-specific recursion guard.

This only covers the call: if C stores a pointer for later use, or returns a
pointer into an argument's memory, keep the source object referenced for as
long as that pointer is used. Callbacks still require explicit `.release()`.
