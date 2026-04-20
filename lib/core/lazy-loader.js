/**
 * @file lazy-loader.js
 * @module core/lazy-loader
 * @description Attribute-access lazy library loaders, mirroring Python's
 * `ctypes.cdll.<libname>` / `ctypes.windll.<libname>` namespaces.
 *
 * **Python ctypes Compatibility**:
 * ```python
 * import ctypes
 * ctypes.cdll.msvcrt.printf.restype = ctypes.c_int        # Python defaults to c_int
 * ctypes.cdll.msvcrt.printf(b"Hi\n")
 * ```
 *
 * Here the library requires `argtypes` + `restype` to be set before calling
 * (no silent `c_int` default — you'll get "restype not set" otherwise):
 *
 * ```javascript
 * import { cdll, windll, c_int, c_char_p } from "node-ctypes";
 *
 * // Attribute-style (Python parity, requires explicit types):
 * cdll.msvcrt.printf.argtypes = [c_char_p];
 * cdll.msvcrt.printf.restype = c_int;
 * cdll.msvcrt.printf("Hi\n");
 *
 * // Or the one-shot .func(name, restype, [argtypes]) form:
 * const printf = cdll.msvcrt.func("printf", c_int, [c_char_p]);
 * printf("Hi\n");
 * ```
 *
 * Libraries are cached per-name so `cdll.msvcrt === cdll.msvcrt`.
 */

/**
 * Create a Proxy-backed namespace that lazily instantiates a DLL class on
 * first attribute access.
 *
 * @param {Function} DllClass - CDLL, WinDLL, or OleDLL constructor.
 * @returns {Proxy} Namespace object with `.<libname>` auto-loading.
 */
export function createLazyLoader(DllClass) {
  const cache = new Map();
  return new Proxy(Object.create(null), {
    get(_, libName) {
      if (typeof libName !== "string") return undefined;
      // Skip symbol/private probes used by Node's inspect / util.inspect.
      if (libName === "then") return undefined;
      if (!cache.has(libName)) {
        cache.set(libName, new DllClass(libName));
      }
      return cache.get(libName);
    },
    has(_, libName) {
      return typeof libName === "string";
    },
  });
}
