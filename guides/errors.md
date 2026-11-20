---
title: Errors and results
---

# Errors and results

## Errors: `errno` and `GetLastError`

`GetLastError()` / `get_errno()` read a **private thread-local slot** —
exactly like Python's `ctypes.get_last_error()` / `ctypes.get_errno()`.
The slot is updated **only** by FFI calls through libraries opened with
`use_last_error` or `use_errno`; unflagged calls leave it unchanged. As in Python
those calls swap it with the system value: the function sees the value set
with `set_errno()` / `set_last_error()`, the value it leaves becomes the
private one, and the system value is restored after the call.

```javascript
const user32 = new WinDLL("user32.dll", { use_last_error: true });
const FindWindow = user32.func("FindWindowW", c_void_p, [c_wchar_p, c_wchar_p]);
FindWindow("NoSuchClass", null);

GetLastError(); // top-level (Python: ctypes.get_last_error)
user32.get_last_error(); // per-library alias
```

The snapshot is captured in native code immediately after the native call,
whether direct or through libffi, before any other JS can clobber it. To read the raw system
error instead, call `GetLastError` via FFI like any other function.

## Error checking (`errcheck`)

Set `fn.errcheck = (result, func, args) => ...` to check or replace a result,
or set it to `null` to clear it. For `lib.func()`, library attributes and
`CFUNCTYPE` / `WINFUNCTYPE` callers, `func` is the public callable and `args`
contains the original, unconverted arguments. Result conversion and any
`OleDLL` HRESULT check run before the hook.

Each invocation captures its hook before argument adapters or getters run.
Replacing or clearing it affects later invocations, including reentrant calls,
not the call already in progress or a pending `callAsync()` job.

Hooks do not prevent otherwise unreachable functions and libraries from being
garbage-collected, even when they reference the function itself. Active calls
and workers retain their captured hook through result checking; `close()` is
still rejected while that checking runs.

The low-level native handle's `setErrcheck()` API instead passes the native
handle as `func`, invoked with `.call()`, not a directly callable function.

## Output parameters (`paramflags`)

When at least one `out` param is declared, the call returns **only the
out-params** (single value, or array if >1) — the `restype` is
discarded. To also inspect it (e.g. a thread ID or success flag), attach an
`errcheck`:

```javascript
const { DWORD, HWND, LPDWORD } = wintypes;
const proto = WINFUNCTYPE(DWORD, HWND, LPDWORD);
const fn = proto.bind(user32, "GetWindowThreadProcessId", [
  { dir: "in", name: "hWnd" },
  { dir: "out", name: "pid" },
]);

const pid = fn(hwnd); // positional; thread ID is discarded
const p2 = fn({ hWnd: hwnd }); // or named-args

fn.errcheck = (threadId, func, args) => {
  if (!threadId) throw new Error("call failed");
  return args; // continue returning the PID from the output instance
};
const p3 = await fn.callAsync(hwnd);

fn.errcheck = (threadId, func, args) => {
  if (!threadId) throw new Error("call failed");
  return { threadId, processId: args[1].value };
};
const ids = fn(hwnd); // inspect both the return value and the output parameter
```

As in Python, the value returned by `errcheck` is the result of the call,
unless it is `args` itself: then the out-params are returned. Here `args`
is the expanded argument list, with out-params as instances. When the hook
returns `args`, output processing uses the original instances: changing
`args[i].value` affects the result, but replacing `args[i]` does not.

These bindings have their own hook, independent of any cached `lib.func()`
binding, and support `callAsync()` with the same output processing and
per-call hook snapshot. Adapter temporaries stay alive through that processing,
also when the hook throws.

OUT conversion invokes the output instance's `__ctypes_from_outparam__()`.
By default a builtin scalar yields its value, while a scalar subclass yields
the instance. Override the method for custom output conversion.

Use `{ dir: "inout", name: "value" }`, or tuple flag `3`, to pass an existing
instance and return that exact instance after C modifies it. INOUT does not
call `__ctypes_from_outparam__`; positional, named and default arguments use
the same rule. Mixed outputs preserve parameter order. If `errcheck` returns
anything other than the original `args`, neither OUT nor INOUT unpacking runs.

## Error slots

- `get_errno()` / `set_errno(v)`
- `GetLastError()` / `SetLastError(v)` / `FormatError(code)`, Python names `get_last_error()` / `set_last_error(v)` (all platforms)
- `ArgumentError` — raised for arguments that do not match `argtypes` (`"argument N: TypeError: ..."`)
- Per-library: `lib.get_last_error()` / `lib.get_errno()`
