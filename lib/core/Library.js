/**
 * @file Library.js
 * @module core/Library
 * @description Library loading and FFI function wrapping for CDLL and WinDLL.
 *
 * This module provides the core library loading functionality including:
 * - FunctionWrapper for Python-like function attribute syntax
 * - CDLL class for loading C libraries (cdecl calling convention)
 * - WinDLL class for loading Windows libraries (stdcall calling convention)
 *
 * **Python ctypes Compatibility**:
 * - `CDLL` ≈ Python's `ctypes.CDLL`
 * - `WinDLL` ≈ Python's `ctypes.WinDLL`
 *
 * @example Loading a library
 * ```javascript
 * import { CDLL } from 'node-ctypes';
 *
 * const libc = new CDLL(null); // Load C standard library
 * const printf = libc.func('printf', c_int, [c_char_p]);
 * printf('Hello from Node.js!\n');
 * ```
 *
 * @example Python-like syntax
 * ```javascript
 * const libc = new CDLL(null);
 * const abs = libc.abs;
 * abs.argtypes = [c_int];
 * abs.restype = c_int;
 * console.log(abs(-42)); // 42
 * ```
 *
 * @example Windows DLL
 * ```javascript
 * import { WinDLL } from 'node-ctypes';
 *
 * const user32 = new WinDLL('user32.dll');
 * const MessageBoxW = user32.func('MessageBoxW', c_int, [c_void_p, c_wchar_p, c_wchar_p, c_uint]);
 * ```
 */

import { _toNativeReturnType } from "./types.js";
import { adaptCallbackFunction, argumentConverters, convertArguments, coerceValue, resultConverter } from "./conversions.js";

/**
 * Creates the Library-related classes with required dependencies injected.
 *
 * @param {Class} Library - Native Library class
 * @param {Class} LRUCache - LRU cache class
 * @param {Function} _toNativeType - Type conversion function
 * @param {Function} _toNativeTypes - Type array conversion function
 * @param {Object} native - Native module reference
 * @returns {Object} Object containing FunctionWrapper, CDLL, WinDLL classes
 * @private
 */
export function createLibraryClasses(Library, LRUCache, _toNativeType, _toNativeTypes, native) {
  // Chiave di cache di un tipo: i tipi oggetto/classe (POINTER, struct, ...) hanno
  // un id stabile; `${tipo}` darebbe "[object Object]" per tutti i POINTER.
  const typeIds = new WeakMap();
  let nextTypeId = 0;
  const typeKey = (t) => {
    if (t === null || (typeof t !== "object" && typeof t !== "function")) return String(t);
    let id = typeIds.get(t);
    if (id === undefined) {
      id = `#${++nextTypeId}`;
      typeIds.set(t, id);
    }
    return id;
  };

  class FunctionWrapper {
    constructor(cdll, name) {
      const argtypes = [];
      let restype = undefined;
      let cachedFunc = null;

      // Python ctypes: restype predefinito c_int.
      const resolve = () => {
        if (!cachedFunc) {
          cachedFunc = cdll.func(name, restype === undefined ? FunctionWrapper.defaultRestype : restype, argtypes);
        }
        return cachedFunc;
      };

      // Funzione semplice con accessor invece di un Proxy: ogni chiamata
      // attraverso un Proxy costava ~20 ns in più.
      const func = (...args) => (cachedFunc ?? resolve())(...args);

      Object.defineProperties(func, {
        argtypes: {
          get: () => argtypes,
          set: (value) => {
            argtypes.splice(0, argtypes.length, ...value);
            cachedFunc = null; // Invalidate cache
          },
          configurable: true,
        },
        restype: {
          get: () => (restype === undefined ? FunctionWrapper.defaultRestype : restype),
          set: (value) => {
            restype = value;
            cachedFunc = null; // Invalidate cache
          },
          configurable: true,
        },
        errcheck: {
          get: () => (cachedFunc ? cachedFunc.errcheck : null),
          set: (value) => {
            resolve().errcheck = value;
          },
          configurable: true,
        },
        callAsync: {
          get: () => resolve().callAsync,
          // Come con il Proxy precedente: l'assegnazione non ha effetto.
          set: () => {},
          configurable: true,
        },
      });

      return func;
    }
  }

  /**
   * Wrapper conveniente per CDLL (come in Python ctypes)
   */
  class CDLL {
    constructor(libPath, options = {}) {
      // Python ctypes: CDLL(name, mode) con il mode di dlopen in posizione.
      if (typeof options === "number") {
        options = { mode: options };
      }
      this._lib = options.mode === undefined ? new Library(libPath) : new Library(libPath, options.mode);
      // Use LRU cache to prevent unbounded memory growth
      const cacheSize = options.cacheSize ?? 1000;
      this._cache = new LRUCache(cacheSize);
      // Cache for FunctionWrapper instances (Python-like syntax)
      this._funcWrapperCache = new Map();
      // Python ctypes: if the library is opened with these flags, each FFI
      // call snapshots errno / GetLastError immediately so the user can read
      // them back via lib.get_last_error() / lib.get_errno() without risk of
      // intervening JS/Node code clobbering the value.
      this._use_last_error = !!options.use_last_error;
      this._use_errno = !!options.use_errno;

      // Return a proxy to enable Python-like syntax: libc.abs.argtypes = [...]; libc.abs.restype = ...; libc.abs(...)
      return new Proxy(this, {
        get(target, prop, receiver) {
          // Allow access to existing properties/methods
          if (prop in target || typeof prop !== "string") {
            return Reflect.get(target, prop, receiver);
          }
          // Check if we already have a FunctionWrapper for this function name
          if (target._funcWrapperCache.has(prop)) {
            return target._funcWrapperCache.get(prop);
          }
          // Create and cache a new FunctionWrapper
          const wrapper = new FunctionWrapper(target, prop);
          target._funcWrapperCache.set(prop, wrapper);
          return wrapper;
        },
      });
    }

    /**
     * Ottiene una funzione dalla libreria
     * @param {string} name - Nome della funzione
     * @param {Function|number|CType} returnType - Tipo di ritorno (SimpleCData class, CType value, o CType)
     * @param {Array<Function|number|CType>} argTypes - Tipi degli argomenti
     * @param {Object} [options] - Opzioni aggiuntive (es. { abi: 'stdcall' })
     * @returns {Function} Funzione callable
     */
    func(name, returnType, argTypes = [], options = {}) {
      const cacheKey = `${name}:${typeKey(returnType)}:${argTypes.map(typeKey).join(",")}`;

      if (this._cache.has(cacheKey)) {
        return this._cache.get(cacheKey);
      }

      // Propagate library-level use_last_error / use_errno to the FFIFunction
      const mergedOptions = {
        ...options,
        ...(this._use_last_error ? { use_last_error: true } : {}),
        ...(this._use_errno ? { use_errno: true } : {}),
      };
      const ffiFunc = this._lib.func(name, _toNativeReturnType(returnType, native), _toNativeTypes(argTypes, native), mergedOptions);

      // =========================================================================
      // OPTIMIZATION: Create specialized wrapper based on argument types
      // For primitive-only args, bypass the processing loop entirely
      // =========================================================================

      const argCount = argTypes.length;

      // Check if any argtype defines a `from_param` classmethod. When true,
      // every call-site must route through a preprocessing pass that lets
      // user-defined types convert incoming values. This mirrors Python
      // ctypes' from_param protocol.
      const anyFromParam = argTypes.some((t) => t && typeof t === "function" && typeof t.from_param === "function");

      // Helper: apply Python ctypes _as_parameter_ / from_param protocols.
      // Used only in the slow path (anyFromParam = true).
      const applyParamProtocols = (arg, i) => {
        if (arg && typeof arg === "object" && arg._as_parameter_ !== undefined) {
          arg = arg._as_parameter_;
        }
        if (i < argCount) {
          const t = argTypes[i];
          if (t && typeof t === "function" && typeof t.from_param === "function") {
            arg = t.from_param(arg);
            if (arg && typeof arg === "object" && arg._as_parameter_ !== undefined) {
              arg = arg._as_parameter_;
            }
          }
        }
        return arg;
      };

      // Conversione degli argomenti come il from_param di base di Python
      // (vedi conversions.js): un convertitore per posizione dichiarata.
      const C = argumentConverters(argTypes, native);
      const [C0, C1, C2, C3, C4, C5] = C;
      const convertAll = (args) => convertArguments(args, C);

      // Funzioni specializzate per numero di argomenti (niente array per la
      // chiamata comune); `method` è "call" o "callAsync".
      const specialize = (method) => {
        if (anyFromParam) {
          // SLOW PATH: from_param su ogni argomento dichiarato.
          return function (...args) {
            const processedArgs = new Array(args.length);
            for (let i = 0; i < args.length; i++) {
              processedArgs[i] = i < argCount ? applyParamProtocols(C[i](args[i]), i) : coerceValue(args[i]);
            }
            return ffiFunc[method](...processedArgs);
          };
        }
        switch (argCount) {
          case 0:
            return function () {
              return arguments.length === 0 ? ffiFunc[method]() : ffiFunc[method](...convertAll(arguments));
            };
          case 1:
            return function (a0) {
              return arguments.length === 1 ? ffiFunc[method](C0(a0)) : ffiFunc[method](...convertAll(arguments));
            };
          case 2:
            return function (a0, a1) {
              return arguments.length === 2 ? ffiFunc[method](C0(a0), C1(a1)) : ffiFunc[method](...convertAll(arguments));
            };
          case 3:
            return function (a0, a1, a2) {
              return arguments.length === 3 ? ffiFunc[method](C0(a0), C1(a1), C2(a2)) : ffiFunc[method](...convertAll(arguments));
            };
          case 4:
            return function (a0, a1, a2, a3) {
              return arguments.length === 4 ? ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3)) : ffiFunc[method](...convertAll(arguments));
            };
          case 5:
            return function (a0, a1, a2, a3, a4) {
              return arguments.length === 5 ? ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4)) : ffiFunc[method](...convertAll(arguments));
            };
          case 6:
            return function (a0, a1, a2, a3, a4, a5) {
              return arguments.length === 6 ? ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4), C5(a5)) : ffiFunc[method](...convertAll(arguments));
            };
          default:
            return function (...args) {
              return ffiFunc[method](...convertAll(args));
            };
        }
      };

      let callMethod = specialize("call");
      let asyncCallMethod = specialize("callAsync");

      // Python: con restype POINTER(T) / CFUNCTYPE il risultato è un oggetto
      // puntatore / una funzione, ed errcheck riceve il valore già convertito:
      // in questo caso errcheck è applicato qui invece che nel nativo.
      const convertResult = resultConverter(returnType);
      let jsErrcheck = null;
      if (convertResult !== undefined) {
        const rawCall = callMethod;
        const rawAsync = asyncCallMethod;
        const finish = (result, args) => {
          const converted = convertResult(result);
          return jsErrcheck === null ? converted : jsErrcheck(converted, callMethod, args);
        };
        callMethod = function (...args) {
          return finish(rawCall.apply(this, args), args);
        };
        asyncCallMethod = function (...args) {
          return rawAsync.apply(this, args).then((result) => finish(result, args));
        };
      }

      // If use_last_error / use_errno is set on the library, wrap callMethod
      // so the most-recently-called FFIFunction is remembered on the library.
      if (this._use_last_error || this._use_errno) {
        const self = this;
        const origCall = callMethod;
        callMethod = function (...args) {
          self._lastCalledFfi = ffiFunc;
          return origCall.apply(this, args);
        };
        const origAsync = asyncCallMethod;
        asyncCallMethod = function (...args) {
          self._lastCalledFfi = ffiFunc;
          return origAsync.apply(this, args);
        };
      }

      // Aggiungi metadata come proprietà non-enumerable per non interferire
      Object.defineProperties(callMethod, {
        funcName: { value: name },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: { value: asyncCallMethod, writable: false, enumerable: false, configurable: false },
        // Esponi errcheck come setter/getter
        errcheck: {
          get() {
            return ffiFunc._errcheck ?? null;
          },
          set(callback) {
            ffiFunc._errcheck = callback;
            if (convertResult !== undefined) {
              jsErrcheck = callback ?? null;
            } else {
              ffiFunc.setErrcheck(callback);
            }
          },
          enumerable: false,
          configurable: true,
        },
      });

      this._cache.set(cacheKey, callMethod);
      return callMethod;
    }

    /**
     * Ottiene l'indirizzo di un simbolo
     * @param {string} name - Nome del simbolo
     * @returns {BigInt} Indirizzo del simbolo
     */
    symbol(name) {
      return this._lib.symbol(name);
    }

    /**
     * Crea un callback JS chiamabile da C
     * @param {Function} fn - Funzione JavaScript
     * @param {Function|number|CType} returnType - Tipo di ritorno (SimpleCData class, CType value, o CType)
     * @param {Array<Function|number|CType>} argTypes - Tipi degli argomenti
     * @returns {Object} Oggetto callback con proprietà pointer e metodi
     */
    callback(fn, returnType, argTypes = []) {
      return this._lib.callback(_toNativeReturnType(returnType, native), _toNativeTypes(argTypes, native), adaptCallbackFunction(fn, argTypes));
    }

    /**
     * Chiude la libreria
     */
    close() {
      this._lib.close();
      this._cache.clear();
    }

    [Symbol.dispose]() {
      this.close();
    }

    /**
     * Read the snapshotted GetLastError / errno from the most recent call on
     * this library. Requires `use_last_error: true` at construction.
     * Python ctypes parity: `ctypes.get_last_error()` / library-scoped variant.
     */
    get_last_error() {
      if (!this._use_last_error) {
        throw new Error("Library was not opened with use_last_error: true");
      }
      return this._lastCalledFfi ? this._lastCalledFfi.getCapturedLastError() : 0;
    }

    get_errno() {
      if (!this._use_errno) {
        throw new Error("Library was not opened with use_errno: true");
      }
      return this._lastCalledFfi ? this._lastCalledFfi.getCapturedErrno() : 0;
    }

    get path() {
      return this._lib.path;
    }

    get loaded() {
      return this._lib.loaded;
    }
  }

  /**
   * WinDLL - come CDLL ma con stdcall di default (per Windows)
   */
  class WinDLL extends CDLL {
    func(name, returnType, argTypes = [], options = {}) {
      return super.func(name, returnType, argTypes, {
        abi: "stdcall",
        ...options,
      });
    }
  }

  /**
   * OleDLL - come WinDLL ma auto-lancia errore se restype è HRESULT e il
   * valore ritornato è negativo (HRESULT failure code).
   *
   * Python ctypes parity: `ctypes.OleDLL`.
   */
  class OleDLL extends WinDLL {
    func(name, returnType, argTypes = [], options = {}) {
      const fn = super.func(name, returnType, argTypes, options);

      // If the return type is tagged as HRESULT, install an errcheck that
      // throws on negative values (Python's OleDLL behavior).
      if (returnType && returnType._isHResult) {
        const prevErrcheck = fn.errcheck;
        fn.errcheck = (result, func, args) => {
          const r = prevErrcheck ? prevErrcheck(result, func, args) : result;
          const n = typeof r === "bigint" ? Number(r) : r;
          if (typeof n === "number" && n < 0) {
            const hex = (n >>> 0).toString(16).padStart(8, "0").toUpperCase();
            const err = new Error(`OleDLL '${name}' failed with HRESULT 0x${hex}`);
            err.hresult = n;
            err.winerror = n >>> 0;
            throw err;
          }
          return r;
        };
      }
      return fn;
    }
  }

  return { FunctionWrapper, CDLL, WinDLL, OleDLL };
}
