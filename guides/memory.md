---
title: Pointers and memory
---

# Pointers and memory

## Pointers, buffers, and cast

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

## Sharing memory with existing buffers

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

Do not detach (`ArrayBuffer.prototype.transfer()`, a `postMessage` /
`structuredClone` transfer list) memory passed to a call that is still running:
a pending `callAsync()`, or the outer call while a callback runs. Native code
keeps its address and may access memory that now belongs to another
`ArrayBuffer` or has been released. Node-API cannot prevent the detach, so
node-ctypes reports it instead. A synchronous call during which a JavaScript
callback ran throws `argument N: memory was detached ...` after native code
returns, and a `callAsync()` whose Buffer, typed array, DataView or ArrayBuffer
argument was detached rejects. The check covers those arguments as passed,
not addresses stored inside structures or obtained with `addressof()`.

## Memory & introspection

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

## Electron

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
