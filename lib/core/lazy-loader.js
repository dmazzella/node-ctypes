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
 * As in Python, `restype` defaults to `c_int` and, without `argtypes`, the
 * arguments are converted from their JS values:
 *
 * ```javascript
 * import { cdll, windll, c_int, c_char_p } from "node-ctypes";
 *
 * // Attribute-style (Python parity):
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
// Proprietà interrogate da String(), JSON.stringify, util.inspect, test
// runner e framework: non sono nomi di librerie.
const probes = new Set(["then", "toJSON", "valueOf", "constructor", "inspect", "nodeType", "asymmetricMatch", "$$typeof"]);

export function createLazyLoader(DllClass) {
  const cache = new Map();
  // Python: cdll.LoadLibrary(name, ...) crea sempre una nuova istanza.
  const LoadLibrary = (name, ...args) => new DllClass(name, ...args);
  const toString = () => `[object LibraryLoader ${DllClass.name}]`;
  // Python LibraryLoader.__getattr__: i nomi che iniziano con "_" non sono librerie.
  const isLibraryName = (name) => typeof name === "string" && name !== "" && name[0] !== "_" && !probes.has(name) && name !== "toString" && name !== "LoadLibrary";
  return new Proxy(Object.create(null), {
    get(_, libName) {
      if (libName === "LoadLibrary") return LoadLibrary;
      if (libName === "toString") return toString;
      if (!isLibraryName(libName)) return undefined;
      if (!cache.has(libName)) {
        cache.set(libName, new DllClass(libName));
      }
      return cache.get(libName);
    },
    has(_, libName) {
      return libName === "LoadLibrary" || libName === "toString" || isLibraryName(libName);
    },
  });
}
