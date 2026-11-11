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
 * Each invocation passes its own call object (`{ executor, signal, job }`)
 * down to the native call: argument adapters (`from_param`) and errcheck may
 * run other callOn meanwhile, and they have theirs. The native call reads the
 * executor from it, does not queue the call when the signal was aborted while
 * the arguments were prepared, and writes the job id into it, so that the
 * abort cancels this call and no other.
 *
 * @param {Function} fn - A function with `_callOn(call, args)`
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

  const call = { executor, signal, job: 0 };
  const promise = fn._callOn(call, args);
  // Internal: a target object asking for it (`_job`) receives the job id
  // (node-comtypes records the calls of an operation to cancel them).
  if (target !== executor && "_job" in target) target._job = call.job;
  // No job: rejected without being queued (closed executor, signal aborted
  // while the arguments were prepared).
  if (signal === undefined || call.job === 0) return promise;

  // Cancel while queued: the promise rejects with the abort reason; a call
  // that has started (or completed inline) completes normally.
  const abort = () => executor._cancel(call.job, signal.reason);
  if (signal.aborted) {
    // Aborted by code that ran during the call (an inline errcheck).
    abort();
    return promise;
  }
  signal.addEventListener("abort", abort, { once: true });
  return promise.finally(() => signal.removeEventListener("abort", abort));
}
