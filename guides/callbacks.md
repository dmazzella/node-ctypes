---
title: Callbacks
---

# Callbacks

## Callbacks

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
// rely on GC — the callback holds a native trampoline that C code may
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

Structure, union and scalar-instance arguments received by `callback()`,
`CFUNCTYPE` and `threadSafeCallback()` are owned snapshots. For a `Structure`
or `Union` class passed by value, ctypes calls the constructor **with no
arguments**, then copies the C bytes into that same instance. The constructor
can inspect its initially zeroed fields and save views of them. The handler
and those views see the C values, not the constructor's field writes. This
differs from a function returning a class by value, which skips the constructor.
Pointer fields copy the address, not the pointed-to memory.

Signatures with a class aggregate keep incoming bytes in dedicated buffers,
so a reentrant constructor cannot alter them through a previously exposed
snapshot pool. Otherwise, small functional aggregates and scalar-instance
arguments use distinct slices of an 8 KB off-heap pool reserved for callback
snapshots. Native-call temporaries use a separate pool that is never exposed.
Slices are never reused. Detaching a pooled snapshot's `ArrayBuffer` only
affects snapshots in that pool; later callbacks use a fresh one.

- Retaining any slice keeps its whole 8 KB backing `ArrayBuffer` alive. When
  storing many small arguments for a long time, copy them, for example
  `Buffer.from(value._buffer)` or a new instance built from its fields.
- `value._buffer.buffer` is the whole pool and can contain other callback
  snapshots. Use `_buffer` itself (or `byteOffset` and `length`), and copy
  before handing the underlying `ArrayBuffer` to untrusted code.

Values larger than 2 KB, layouts aligned to more than 8 bytes and raw native
callbacks keep a dedicated allocation.

Both callbacks and libraries implement `Symbol.dispose`, so they work
with the `using` declaration for scope-bound cleanup (also on `throw`):

```javascript
{
  using libc = new CDLL(null);
  using cmp = callback(fn, c_int32, [c_void_p, c_void_p]);
  qsort(arr, 5, 4, cmp);
} // close() + release() run automatically
```

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
