/**
 * @file executor.js
 * @module core/executor
 * @description `fn.callOn(executor, ...args)`: the same call as
 * `fn.callAsync(...args)` (conversions, out parameters, errcheck, argument
 * lifetime), run on an {@link Executor} thread instead of a libuv worker.
 */

let native = null;

/**
 * Set the native module (once, from lib/index.js, before any call).
 *
 * @param {Object} nativeModule - Native module
 */
export function initExecutor(nativeModule) {
  native = nativeModule;
}

/**
 * Run `fn.callAsync(...args)` on `target`: an `Executor`, or
 * `{ executor, signal }` to cancel the call while it is still queued.
 *
 * The native binding takes the executor for exactly one call: the next
 * asynchronous call of `fn`'s native function, made synchronously below.
 *
 * @param {Function} fn - A function with `callAsync` and `_ffi`
 * @param {Object} target - Executor or `{ executor, signal }`
 * @param {Array} args - Call arguments
 * @returns {Promise<*>}
 */
export function callOn(fn, target, args) {
  let executor = target;
  let signal;
  if (!(target instanceof native.Executor)) {
    executor = target?.executor;
    signal = target?.signal ?? undefined;
    if (!(executor instanceof native.Executor)) {
      return Promise.reject(new TypeError("callOn requires an Executor or { executor, signal }"));
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      return Promise.reject(new TypeError("callOn: signal must be an AbortSignal"));
    }
  }
  if (signal?.aborted) return Promise.reject(signal.reason);

  const previous = executor._lastJob;
  let promise;
  native.setCallTarget(executor, fn._ffi);
  try {
    promise = fn.callAsync(...args);
  } finally {
    native.setCallTarget(null);
  }
  const job = executor._lastJob;
  if (signal === undefined || job === previous) return promise;

  // Cancel while queued: the promise rejects with the abort reason; a call
  // that has started completes normally.
  const abort = () => executor._cancel(job, signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  return promise.finally(() => signal.removeEventListener("abort", abort));
}
