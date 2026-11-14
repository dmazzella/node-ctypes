---
title: Asynchronous calls
---

# Asynchronous calls

## Asynchronous calls: `callAsync` and `Executor`

`fn.callAsync(...args)` runs the call on a libuv worker and returns a promise;
the event loop stays free meanwhile. Arguments are converted on the
JavaScript thread before the call, results (and `errcheck`) after it, and the
memory passed by address stays referenced until the promise settles.

libuv workers are shared with `fs`, `dns` and `crypto` (4 by default), and
concurrent calls run in parallel in any order. For long or blocking calls, or
calls that must run in sequence on one thread (thread-local state,
thread-affine handles, libraries that are not thread-safe), use an
`Executor`: a native thread owned by node-ctypes with a FIFO queue.
`fn.callOn(executor, ...args)` is the same call as `callAsync`, run there:

```javascript
import { Executor } from "node-ctypes";

const executor = new Executor({ name: "device" }); // thread name for debuggers
const read = await lib.device_read.callOn(executor, handle, buffer, buffer.length);

// Cancel a call that has not started yet: the promise rejects with signal.reason.
const controller = new AbortController();
const next = lib.device_read.callOn({ executor, signal: controller.signal }, handle, buffer, buffer.length);
controller.abort();

await executor.close(); // waits for the accepted calls, then stops the thread
```

- Calls run one at a time, in arrival order; each promise settles once.
- The thread starts with the first call. Pending calls keep the process
  alive; an idle executor does not, and is collected with its thread when no
  longer referenced. `close()` rejects new calls, waits for the accepted ones
  and stops the thread (an executor cannot be reopened).
- `executor.pending`, `completed`, `running` and `closed` report its state.
- `spin` (microseconds, default 50, `0` to disable): after a call the thread
  polls for the next one this long (at most 50 µs) before sleeping, and the JavaScript thread
  waits this long for a call submitted to an idle executor, completing it
  without a round trip through the event loop. Awaited calls in sequence then
  cost a few microseconds instead of tens; its errcheck may run before
  `callOn` returns. The wait is per function: `spin` for a function not
  called yet, then about one and a half times its measured typical duration,
  up to `spinLimit` (microseconds, default 500); a function that usually takes
  longer completes through the event loop without delaying the others. Inline
  completions are limited to 1 ms per turn of the event loop, so timers, I/O
  and UI events keep running.
- A call that has started cannot be interrupted: the signal only removes
  queued calls.
- On process exit (or worker termination) queued calls are discarded and a
  running call is left to finish on its own.
- Callbacks invoked during the call run on the executor thread: use
  `threadSafeCallback`, as with `callAsync`.

An `Executor` also suits many short calls kept in flight. Each `callAsync()`
queues its own libuv work item, which wakes a worker, and completes
separately; the executor thread takes the next queued call without being
woken and delivers the completed calls to JavaScript together. With several
calls in flight this usually costs less than `callAsync()`: about a third on
Windows, where waking a thread is expensive, less of a difference elsewhere.
The calls then run one at a time: for short calls that is usually faster than
spreading them over the libuv workers, but blocking calls that must overlap
still need `callAsync()` or one executor each.
