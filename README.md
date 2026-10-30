# node-ctypes

[![npm version](https://img.shields.io/npm/v/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![npm downloads](https://img.shields.io/npm/dm/node-ctypes.svg)](https://www.npmjs.com/package/node-ctypes)
[![Build](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml/badge.svg)](https://github.com/dmazzella/node-ctypes/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Python ctypes for Node.js.** A foreign function interface built with C++20,
[node-addon-api](https://github.com/nodejs/node-addon-api) and
[libffi](https://github.com/libffi/libffi).
If you know Python ctypes, you already know node-ctypes.

## Support

Development help is welcome: issues, pull requests and discussions are all appreciated.

> [!TIP]
> If you find **node-ctypes** useful, consider :star: this project
> and why not ... [Buy me a coffee](https://www.buymeacoffee.com/damianomazp) :smile:

---

## Quick start

```bash
npm install node-ctypes
```

Prebuilt binaries ship for Windows, macOS 13.5+ and Linux (glibc 2.28+ or musl /
Alpine), on x64 and ARM64 — wherever Node 24 runs.

```javascript
import { CDLL, Structure, c_int32, c_size_t, c_char_p } from "node-ctypes";

// 1. Load a shared library
const libc = new CDLL(process.platform === "win32" ? "msvcrt" : null);

// 2. Declare a function signature
const strlen = libc.func("strlen", c_size_t, [c_char_p]);
console.log(strlen("hello")); // 5n

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

Requires Node.js >= 24, CMake >= 3.15, and a C++20 compiler and standard library.
Run these commands from a source checkout:

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

Direct native calls are limited to a bounded set of exact scalar C++
signatures with up to four arguments, on 64-bit little-endian targets using
the default ABI. Other signatures use the existing cached libffi plans/CIFs,
including pointers and strings whose pointee types and qualifiers are not
encoded in the native type metadata. Float/double arguments continue to use
libffi on x86-64. This changes the optimization route, not the JavaScript API.

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

`array(type, n)` reuses the same type while it is alive. Instances, function
signatures and containing types keep their array types alive; the cache itself
does not. Unused array types and their length entries can be garbage-collected,
including arrays of builtin element types.

An array type in `argtypes` is passed by address, as in C and Python
(`fill.argtypes = [c_int32 * 4]`). As in Python, the argument must be an
instance of an array with the same element type and length; a Buffer or a
typed array is also accepted as its memory. Other values raise
`ArgumentError`.

Builtin numeric scalars accept numbers, booleans and BigInt; integers wrap to
their C width, but reject non-integral or non-finite numbers. Use BigInt when
the original integer needs more precision than a JS number can represent.
No argument, or `undefined` in a constructor, initializes zero. Explicit
`null`, strings and arbitrary objects are not implicit numeric conversions.
Assigning a scalar instance to a field or passing it to a declared numeric
argument requires a compatible type. The documented numeric-pointer argument
extensions below are unchanged.

`c_bool` and `wintypes.VARIANT_BOOL` use JavaScript truthiness, using `.value`
for scalar instances rather than treating every instance as true.
`VARIANT_BOOL` stores true as `-1`, and its results and callback arguments
are booleans. Boolean bitfields normalize before masking and read as booleans.

Nested structs, anonymous fields (`static _anonymous_ = ["data"]`),
explicit packing (`static _pack_ = 1`), minimum alignment
(`static _align_ = 16`), self-referential pointers (`POINTER(() => Node)`)
and subclasses that add fields to their base class all work identically to
Python. The layout of bit fields follows Python's `_layout_`: `"gcc-sysv"`
by default, `"ms"` on Windows or with `_pack_`. Bit fields wider than 53
bits read as BigInt.

`_pack_` follows Python's integer conversion and permits zero and non-powers
of two (for example `3`) with the MS layout. An explicit `_pack_`, including
zero, is incompatible with `"gcc-sysv"`. Layouts with non-power-of-two
alignment can be used for memory serialization but are rejected as native
by-value signatures: they do not describe a valid C ABI alignment.

Structures and unions passed or returned by value keep this layout, also
with `_pack_`: as with GCC and clang, a structure with misaligned fields is
passed in memory on x86-64 System V (Linux, macOS Intel), where Python
ctypes passes it in registers and the called function reads wrong values.

Each returned structure or union owns a snapshot of its value, including
results declared with functional `struct()` / `union()` definitions. Array
views, nested composites and union getters remain valid after later calls,
reentrant conversion or `errcheck`, and concurrent `callAsync()` jobs.
Mutating one result does not modify another result's value storage.

This is not a deep copy through pointers: pointer fields can still refer to
the same external memory. Explicit `definition.toObject(buffer)` keeps its
existing buffer-view behavior. Synchronous low-level native `struct_buffer`
results are borrowed, reusable storage; public callables snapshot their
results before any JavaScript result conversion.

Low-level native `StructType` descriptors are builders only until consumed.
Adding a descriptor as a field, constructing an `ArrayType` from it (even at
length zero), preparing a function/callback signature, or creating/reading a
native value finalizes the captured layout and its dependencies.
`addField()` then throws instead of changing sizes, offsets or FFI metadata
already in use. Build a new descriptor for a different layout.
`getSize()` and `getAlignment()` alone leave an unused builder open; an
outer builder can still receive fields after it captures a finalized child.
Direct by-value self-reference is rejected. Pointers do not capture or
finalize the pointed-to layout.

### Pointers, buffers, and cast

```javascript
import { POINTER, pointer, cast, c_int32, c_void_p } from "node-ctypes";

// Pointer to an existing c-data instance (Python: pointer(x))
const x = new c_int32(42);
const px = pointer(x);
px.contents.value; // 42   (Python: px.contents.value — a live c_int32)
px[0]; // 42   (Python: px[0])
px[0] = 100;
x.value; // 100  (same memory)

// View existing memory as a typed pointer
const IntPtr = POINTER(c_int32);
const p = IntPtr.fromBuffer(someBuffer);
p[0];
p[1];
p[2]; // pointer arithmetic

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

Declared `POINTER(T)` parameters reject incompatible ctypes instances,
arrays and pointer types before entering C. Compatible subclasses and arrays
are accepted, and a matching scalar/structure is passed by reference.
These implicit scalar/array/NULL conversions apply to direct arguments only.
To adapt one of these values through `_as_parameter_`, return an explicit
compatible pointer or `byref` value instead, as in CPython.
An explicit `cast()` changes the pointer type. Raw addresses and raw
Buffer/TypedArray/ArrayBuffer memory remain node-ctypes extensions; use
`c_void_p` for portable raw-address code.

`byref(value, byteOffset = 0)` preserves the original owner and supports
signed byte offsets. In-range references remain Buffer views; references
outside the object's byte range carry an address and owner. As with raw
addresses, the caller must ensure such memory is valid before dereferencing.
Function pointers read from fields or obtained from FFI bindings can be
assigned back to fields/arrays and passed as pointer arguments. Bare JS
functions still require `callback()` / a prototype-created callback.

### Callbacks

```javascript
import { callback, CFUNCTYPE, c_int32, c_void_p, readValue } from "node-ctypes";

// Python-style type: CFUNCTYPE(restype, ...argtypes)
const CompareFn = CFUNCTYPE(c_int32, c_void_p, c_void_p);
const cmp = new CompareFn((a, b) => readValue(a, c_int32) - readValue(b, c_int32));

// Or the one-shot form:
const cmp2 = callback((a, b) => readValue(a, c_int32) - readValue(b, c_int32), c_int32, [c_void_p, c_void_p]);

// Pass the callback itself (as in Python) or its address `cmp.pointer`.
qsort(arr, 5, 4, cmp);

// CFUNCTYPE types also work as struct fields (read back as a callable).

// IMPORTANT: release the trampoline when done. Unlike Python, we cannot
// rely on GC — the callback holds a libffi closure that native code may
// still reference.
cmp.release();
cmp2.release();
```

`CFUNCTYPE` and `WINFUNCTYPE` weakly intern live prototypes by the complete
identity and order of their argument/return types, separately for each calling
convention. Repeated requests reuse the same live prototype, as in Python,
without keeping abandoned types alive. Callers, callbacks and output bindings
retain their prototype while they are live.

Prototype metadata is shared. Changing its public `restype` / `argtypes`
metadata does not recompile the captured native signature or alter cache keys;
request a different signature to change the ABI. Each new caller prepares its
argument-conversion pipeline and captures its result-check hook independently.
Existing callers retain their result-check snapshot and their own `errcheck`.
An installed `from_param` converter still resolves the method at call time,
as before.

Both callbacks and libraries implement `Symbol.dispose`, so they work
with the `using` declaration for scope-bound cleanup (also on `throw`):

```javascript
{
  using libc = new CDLL(null);
  using cmp = callback(fn, c_int32, [c_void_p, c_void_p]);
  qsort(arr, 5, 4, cmp);
} // close() + release() run automatically
```

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

For an embedding runtime that must detach its native thread state before waiting,
the optional fourth argument can be `{ abi, nativeContext: { suspend, resume, onError, notify? } }`
instead of the existing ABI string. Each hook accepts a ctypes native function,
a low-level function handle, or a nonzero BigInt function address:

```javascript
const onRequest = threadSafeCallback(handleRequest, c_int, [c_int], {
  nativeContext: {
    suspend: runtime.func("save_context", c_void_p, []),
    resume: runtime.func("restore_context", null, [c_void_p]),
    onError: runtime.func("install_error", null, [c_void_p]),
    notify: runtime.func("wake_host", null, []),
  },
});
```

Function objects resolve through `_as_parameter_` or `address` once, when the
callback is constructed. The hooks are called directly using the default C ABI;
the function wrapper's JS converters and `errcheck` are not invoked:

- `void *suspend(void)` runs on a foreign caller before queueing.
- `void resume(void *)` restores that caller's saved state after dispatch, including
  queue failure or environment shutdown. Neither hook runs on the Node host fast path.
- `void onError(void *)` consumes an opaque error pointer on the original caller
  thread, after restoration. During the JS callback, use
  `callback.setNativeError(pointer)` once and return the native API's required error
  sentinel (`NULL`, `-1`, etc.). Error payloads belong to each invocation, including
  concurrent and nested calls; JS exceptions are still reported as documented above.
- Optional `void notify(void)` runs on the foreign caller after successful queueing,
  while its native state is detached. It may wake the host through the consumer's
  runtime, but must not execute JavaScript itself.

`callback.drain()` executes a snapshot of pending calls **on the owning Node
thread**, returning the number it claimed. Each call executes at most once,
whether the TSFN or a drain gets there first. Delayed TSFN deliveries retain
only the shared request state and do not touch completed calls' native arguments.
The consumer must provide a safe way to reenter the host and call `drain()`;
calling it before entering a blocking native wait is not sufficient.

Hooks must not throw or execute JavaScript. Plain JS functions and known
JS-backed callback wrappers are rejected; an address cannot prove a function's
signature, validity or implementation. Supplied function objects are retained by
the native dispatcher through release and queued delivery cleanup. This does not
prevent explicitly closing their libraries or releasing their underlying resources;
raw addresses carry no owner. Keep the callback and the hook libraries
alive until all native calls have returned; explicit release is rejected while a
native-context call is active. These hooks do not acquire the host runtime context,
pump a blocked host event loop automatically, or implement interpreter ownership/subinterpreters.
The host JS handler must acquire/release its own runtime context around native API
operations. The ordinary callback path is unchanged when no hooks are supplied.

Both callback implementations store narrow integer results in a complete
libffi `ffi_arg`, with the declared signedness; failures zero that complete
slot. Floating-point results retain their own storage width. The native
`Callback` / `ThreadSafeCallback` classes also expose `getPointer()`, which
throws after release.

### Errors: `errno` and `GetLastError`

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
    ["wYear", WORD],
    ["wMonth", WORD],
    ["wDayOfWeek", WORD],
    ["wDay", WORD],
    ["wHour", WORD],
    ["wMinute", WORD],
    ["wSecond", WORD],
    ["wMilliseconds", WORD],
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

### Error checking (`errcheck`)

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

### Scalar subclasses and result hooks

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

### Output parameters (`paramflags`)

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
is the expanded argument list, with out-params as instances.

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

Typed pointers read from fields or array elements, and views derived from
them, retain their known memory owners. Typed assignments and
`from_buffer_copy()` preserve known pointer references, including overlapping
and self-copies; replacing a pointer releases its previous reference.

Raw copies (`memmove()`, Buffer methods) do not transfer ownership metadata.
Likewise, `from_address()` given a raw address cannot discover its allocation
or library: the caller must keep that memory valid. Keeping a known owner
alive does not take over responsibility for freeing externally allocated
memory or explicitly releasing callbacks.

`memmove()` and `memset()` return the destination address as BigInt, including
zero-length operations (`0n` for a NULL destination with count zero).
Counts must be non-negative safe integers. Copies/fills involving JS memory
still stop at its end; raw native addresses remain the caller's responsibility.
Scalar `from_buffer()` / `from_buffer_copy()` validate byte size and offset
before producing an instance and accept Buffer, typed views and ctypes memory.

### Electron

Electron does not allow Buffers over memory that V8 did not allocate, so a
Buffer _view_ of native memory cannot exist there. node-ctypes detects this
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
or write; instances on ordinary Buffers (`new Point()`, `c_int(5)`) do not
need this native-memory synchronization. Set `NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`
to run in this mode on Node.js.

### Adapter protocols: `_as_parameter_` and `from_param`

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

Primitive arrays also follow their containing class's byte order, recursively
for multidimensional arrays, including floats and wide-character arrays.
Arrays of structures keep the element structure's own byte order. The same
array type can be shared with native/little-endian containers without being
modified. Raw Buffer and typed-memory copies still copy bytes, not values
converted between byte orders.

### TypeScript

Argument and return types are inferred from declared type classes such as
`c_int32` and `c_size_t`. A literal tuple (`as const`) preserves argument types:

```ts
const libc = new CDLL(null);
const strlen = libc.func("strlen", c_size_t, [c_char_p] as const);
const n: bigint = strlen("hello"); // typed as bigint, not any
```

`static _fields_ = [["x", c_int32]]` compiles as written in Python (no
`as const`). For typed struct fields use `defineStruct` instead of
`extends Structure`:

```ts
class Point extends defineStruct({ x: c_int32, y: c_int32 }) {
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2);
  }
}
const p = new Point({ x: 3, y: 4 }); // p.x, p.y typed as number
```

`struct()` / `union()` fields, `POINTER()` targets and arrays of numeric
types are typed too; a `null` return type is `void`:

```ts
const PointDef = struct({ x: c_int32, y: c_double });
PointDef.get(buf, "y"); // number
POINTER(c_int32).fromAddress(addr)[0]; // number (.contents: c_int32 instance)
array(c_int32, 4).create([1, 2, 3, 4])[0]; // number
libc.func("srand", null, [c_uint32]); // returns undefined
```

---

## API reference

### Primitive types

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
- `byref(obj, byteOffset = 0)` — lightweight reference with a signed byte offset
- `cast(ptr, type)` — reinterpret a pointer as another type
- `memmove(dst, src, n)` / `memset(dst, val, n)` — buffers, ctypes instances, pointers or addresses; return the destination address as BigInt
- `readValue(ptr, type, offset?)` / `writeValue(ptr, type, val, offset?)`
- `create_string_buffer(init, size?)` / `c_buffer` / `create_unicode_buffer(init, size?)` — with `.value` (and `.raw`)
- `string_at(addr, size?)` / `wstring_at(addr, size?)` — exactly `size` units, or up to the NUL

With an explicit byte count, `string_at` returns a lossless Latin1 string:
`Buffer.from(string_at(addr, n), "latin1")` recovers all `n` original bytes,
including embedded NUL and invalid UTF-8. Without a count it retains the
UTF-8 text representation. `wstring_at` counts native wide-character units.

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

### Supported Python ctypes behavior

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

### Not supported

- **`ctypes.resize(instance, size)`** — Structure/Union instances use a
  Node `Buffer`, and Buffers aren't resizable in place.
  Work-around: `new MyStruct(myBuffer)` with a pre-sized buffer.
- **`c_longdouble`** (80/128-bit float, `ffi_type_longdouble`) — rarely
  used; use a native wrapper that converts to supported types, or access
  storage through pointers/bytes. Declaring a `long double` ABI value as
  `c_double` is not a portable substitute.

### Migrating from 1.x

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

---

## Examples

Each example in `examples/` has its own README; see the [index](examples/README.md).

- [Electron + React](examples/cross-platform/electron-app/README.md) — a native system clock through a sandboxed preload bridge, synchronized C-memory views and a packaged ASAR application
- [Embedded Python](examples/cross-platform/python/README.md) — CPython through its C API: code, modules, callbacks, JavaScript objects by reference, shared memory, threads, asyncio and cancellation (Windows, macOS, Linux)
- [Smart card (PC/SC)](examples/cross-platform/smartcard/README.md) — `winscard` on Windows, `PCSC.framework` on macOS, `libpcsclite` on Linux
- [Cryptoki (PKCS #11)](examples/cross-platform/cryptoki/README.md) — complete 3.2 declarations with 2.20–3.2 dispatch and a standalone SoftHSM demo: temporary token, login, RSA, ECDSA, AES and SHA-256
- [Accessibility](examples/macos/accessibility/README.md) — macOS UI automation with the Accessibility API
- [COM automation](examples/windows/com/README.md) — shell shortcuts (`IShellLinkW`) and Active Directory (`IDirectorySearch`)
- [Controls](examples/windows/controls/README.md) — Win32 common controls
- [LDAP](examples/windows/ldap/README.md) — LDAPv3 paged search (`wldap32`)
- [Registry](examples/windows/registry/README.md) — `setValue` / `getValue` / `openKey` / `deleteKey`
- [System tray](examples/windows/tray/README.md) — tray icon + popup menu

---

## Tests & docs

From the repository root, `npm --prefix tests test` first builds a small C library (`tests/fixtures/`, into
`build/fixture/`) used by the tests of structures by value, array parameters
and reentrant calls; `npm run build:test-fixture` builds it alone. Matched
Python/JavaScript contracts live under `tests/cpython_parity/`, divided by domain,
and load the same library. Node-specific async, representation and GC checks
live under `tests/node_specific/`; genuine Python-only scheduling checks live
under `tests/python_specific/`. The former `common/` and `windows/` suites have
been migrated into these domains.

Paired JavaScript uses the Python-shaped API: `Structure`/`Union` classes,
`ARRAY`, library attributes with `argtypes`/`restype`, and `CFUNCTYPE` bindings.
The structural guard checks neighboring files and matching class/method IDs
using the existing TypeScript parser and Python AST; runtime assertions remain
independent checks against CPython, not a claim based on file names alone.

```bash
npm install
npm run build
npm --prefix tests install
npm --prefix tests test                              # functional/parity tests
NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 npm --prefix tests test  # mirrored native memory
npm --prefix tests run test:parity                    # matched CPython and JS contracts
npm --prefix tests run test:parity:check              # paired file/case/discovery/style guard
npm --prefix tests run test:python                    # all Python references
npm run test:types                                   # TypeScript declarations
npm run docs                                         # TypeDoc API site in docs/
npm run docs:serve                                   # preview
```

See the [test suite guide](tests/README.md) for paired-case conventions,
runtime differences and focused commands.

### Performance comparisons

There are two JavaScript comparisons, both against another FFI library.
From the repository root, after building node-ctypes:

```bash
npm --prefix tests install             # includes Koffi
npm run build:test-fixture             # shared C functions for both libraries
npm run bench:koffi                    # node-ctypes vs Koffi; Node 24+
npm run bench:ffi                      # node-ctypes vs node:ffi; Node 26+
```

The private test package explicitly approves the install script for Koffi 3.3.3.
When upgrading Koffi, review the new version before updating that approval with
`npm --prefix tests install-scripts approve koffi`; future versions are not
automatically authorized.

`bench:ffi` adds `--experimental-ffi` automatically. Both comparisons
print a table grouped by workload and automatically generate HTML reports:

- `tests/benchmarks/results/koffi.html`
- `tests/benchmarks/results/node-ffi.html`

These paths are relative to the repository root, regardless of the working
directory. Each successful run replaces its previous report; generated results
are ignored by Git. Open the HTML file directly in a browser: it is responsive
and self-contained, with native HTML/CSS bar charts and no browser JavaScript,
external resources or server requirements.

| Column                   | Meaning                                               |
| ------------------------ | ----------------------------------------------------- |
| Case                     | The same operation and inputs for both libraries      |
| node-ctypes / competitor | Median time +/- MAD (dispersion), in ns per operation |
| Ratio                    | node-ctypes time divided by competitor time           |

A ratio of `0.50x` means node-ctypes took half the time; `2.00x` means it
took twice the time. Lower times are better. There is no overall score
combining unrelated calls, memory access and asynchronous scheduling.
In the charts, **shorter bars are better**. Each workload group shares a linear
scale starting at zero; different groups use different scales. Bars show
medians, with +/- MAD whiskers (not confidence intervals). Each library also
shows its total measured operation count and elapsed time across the samples.

Reports record library/runtime versions, CPU, OS/kernel, buffer mode, start/
finish timestamps and Git revision/working-tree status. Missing CPU or Git
metadata produces an explicit warning rather than invented values.

The comparisons cover scalars, mixed arguments, short/long strings, buffer
arguments, field reads and callbacks. Koffi also covers structures by value,
variadic calls and async calls with 1/8 calls in flight. Cases without an
equivalent documented node:ffi API are listed as **not compared**, not
emulated with a different native signature.

The `CFUNCTYPE` rows measure calls through an already-bound node-ctypes
prototype, against an independently bound competitor function with the same
C signature. Bindings are separate to avoid sharing optimization feedback
with the direct-call rows. These cases do not include prototype construction
or callback registration.

Both sides call the same C fixture and verify results before/after timing.
String contents are encoded on every call; node-ctypes reuses scratch storage,
not previously encoded strings. Measurements describe warmed repeated calls,
not cold-start allocation costs.
String lengths are compared as Numbers, including conversion where the API
returns BigInt; wide integers are BigInt in both APIs. Structures are plain
objects. Async times include scheduling and are reported per completed call,
with the concurrency shown in the case name.

Defaults are nine samples of at least 250 ms per library after warmup,
alternating library order. Each native signature has a separate call-site to
avoid mixing V8 optimization feedback between cases.
Each row is printed when its measurements finish.
Run comparisons serially, not concurrently. Optional arguments:

```bash
npm run bench:koffi -- --filter string,callback
npm run bench:ffi -- --samples 11 --duration 500
npm run bench:koffi -- --output comparison.json
```

`--output comparison.json` additionally saves medians, dispersion and all sample
durations/operation counts as JSON, and writes `comparison.html` next to it
instead of the default HTML report. Parent directories are created automatically.
HTML generation runs only after all measurements finish.
`benchmark_koffi.js` and `benchmark_node_ffi.js` define the actual side-by-side
comparisons; `runner.js` shares timing, table output and HTML generation without
extra dependencies or a separate renderer script. There is no separate
self-benchmark command, and benchmarks are not run by the functional/parity
test suite.

### Release validation

The workflow retains the eight Node 24 native build targets (Windows/macOS,
x64/ARM64, and Linux glibc/musl). C++20 conformance is checked with
`-pedantic-errors` on GCC/Clang and `/permissive-` on MSVC; vendor optimization
and the node-addon-api integration remain unchanged.

Three runtime-control jobs reuse the built artifacts on Node 26 without
rebuilding the addon, running the functional parity suite normally and with
mirrored buffers. A Linux job runs the focused Python 3.15
reference tests in addition to the Python 3.14 reference coverage.

The package assembler requires all eight nonempty binaries and includes
declarations, README, changelog and license. It fails on missing/unknown
artifacts or a stale output directory. Publish depends on the runtime gates,
requires a pushed tag matching the manifest version exactly, and uses `next`
for prereleases instead of `latest`. Manual workflow runs never publish.
These are configured gates, not a substitute for a successful native CI run.

`npm --prefix tests test` builds the fixture and runs the suite;
`npm --prefix tests run test:js` reuses an already-built fixture/addon.
Both use the documented `--test-timeout` runner option.

---

## License

MIT. Built with [libffi](https://github.com/libffi/libffi),
[node-addon-api](https://github.com/nodejs/node-addon-api), and
[cmake-js](https://github.com/cmake-js/cmake-js).
