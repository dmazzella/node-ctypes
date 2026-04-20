/**
 * @file lazy-loader.js
 * @module core/lazy-loader
 * @description Attribute-access lazy library loaders, mirroring Python's
 * `ctypes.cdll.<libname>` / `ctypes.windll.<libname>` namespaces.
 *
 * **Python ctypes Compatibility**:
 * ```python
 * import ctypes
 * ctypes.cdll.msvcrt.printf(b"Hi\n")
 * ctypes.windll.user32.MessageBoxW(0, "Hi", "Title", 0)
 * ```
 *
 * Here:
 * ```javascript
 * import { cdll, windll } from "node-ctypes";
 * cdll.msvcrt.printf("Hi\n");
 * windll.user32.MessageBoxW(0n, "Hi", "Title", 0);
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
