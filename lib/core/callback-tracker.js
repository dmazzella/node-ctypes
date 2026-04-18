/**
 * @file callback-tracker.js
 * @module core/callback-tracker
 * @description Opt-in leak detector for callbacks created via `callback()` / `threadSafeCallback()`.
 *
 * Enabled only when the environment variable `NODE_CTYPES_DEBUG_CALLBACKS=1` is set
 * (or any truthy value). In production (default) this module is a no-op with zero overhead:
 * `trackCallback()` returns the wrapper untouched.
 *
 * When enabled, each callback is registered with a `FinalizationRegistry`. If the V8 GC
 * reclaims the wrapper without `.release()` having been called, a warning is emitted with
 * the creation stack trace. This catches a common footgun where callbacks silently leak
 * native libffi trampolines, and where the C side may invoke a now-freed pointer.
 *
 * The tracker does **not** auto-release — doing so could cause use-after-free if native
 * code retains the pointer. It only warns.
 */

const DEBUG = (() => {
  const v = process.env.NODE_CTYPES_DEBUG_CALLBACKS;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
})();

// Lazily constructed so a simple `require` does not allocate the registry in prod.
let registry = null;

function ensureRegistry() {
  if (registry) return registry;
  registry = new FinalizationRegistry((info) => {
    if (info.state.released) return;
    const lines = [
      `[node-ctypes] ${info.kind} "${info.name}" was garbage-collected without .release().`,
      `  The native trampoline may still be invoked by C code — this can cause leaks or use-after-free.`,
      `  Fix: call .release() before losing the reference.`,
    ];
    if (info.createdAt) {
      lines.push(`  Created at:`);
      lines.push(
        info.createdAt
          .split("\n")
          .slice(1) // drop "Error" header
          .map((l) => "    " + l.trim())
          .join("\n"),
      );
    }
    process.emitWarning(lines.join("\n"), "CallbackLeakWarning");
  });
  return registry;
}

/**
 * Wrap a callback factory's returned object with leak-tracking.
 *
 * @param {object} wrapper - The object returned by callback()/threadSafeCallback() — must expose `release()`.
 * @param {Function} fn - The user JS function being wrapped (used for a friendly name).
 * @param {string} kind - Either `"callback"` or `"threadSafeCallback"` for the warning message.
 * @returns {object} The same wrapper (possibly with `.release` instrumented) when DEBUG is on;
 *                   otherwise the original wrapper unchanged.
 */
export function trackCallback(wrapper, fn, kind) {
  if (!DEBUG) return wrapper;

  const state = { released: false };
  const info = {
    state,
    kind,
    name: (fn && fn.name) || "<anonymous>",
    createdAt: new Error().stack,
  };

  const reg = ensureRegistry();
  // Use a distinct unregister token so wrap can deregister on explicit release.
  const token = {};
  reg.register(wrapper, info, token);

  const originalRelease = wrapper.release.bind(wrapper);
  wrapper.release = function () {
    state.released = true;
    reg.unregister(token);
    return originalRelease();
  };

  return wrapper;
}
