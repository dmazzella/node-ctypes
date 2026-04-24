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
  class FunctionWrapper {
    constructor(cdll, name) {
      const argtypes = [];
      let restype = undefined;
      let cachedFunc = null;

      // Create a function and proxy it to make it callable
      const func = (...args) => {
        if (restype === undefined) {
          throw new Error(`Function ${name}: restype not set`);
        }
        if (!cachedFunc) {
          cachedFunc = cdll.func(name, restype, argtypes);
        }
        return cachedFunc(...args);
      };

      // Proxy the function to intercept property access
      return new Proxy(func, {
        get(target, prop) {
          if (prop === "argtypes") return argtypes;
          if (prop === "restype") return restype;
          if (prop === "errcheck") return cachedFunc ? cachedFunc.errcheck : undefined;
          if (prop === "callAsync") {
            if (restype === undefined) {
              throw new Error(`Function ${name}: restype not set`);
            }
            if (!cachedFunc) {
              cachedFunc = cdll.func(name, restype, argtypes);
            }
            return cachedFunc.callAsync;
          }
          return target[prop];
        },
        set(target, prop, value) {
          if (prop === "argtypes") {
            argtypes.splice(0, argtypes.length, ...value);
            cachedFunc = null; // Invalidate cache
            return true;
          }
          if (prop === "restype") {
            restype = value;
            cachedFunc = null; // Invalidate cache
            return true;
          }
          if (prop === "errcheck") {
            if (!cachedFunc) {
              if (restype === undefined) {
                throw new Error(`Function ${name}: restype not set`);
              }
              cachedFunc = cdll.func(name, restype, argtypes);
            }
            cachedFunc.errcheck = value;
            return true;
          }
          target[prop] = value;
          return true;
        },
      });
    }
  }

  /**
   * Wrapper conveniente per CDLL (come in Python ctypes)
   */
  class CDLL {
    constructor(libPath, options = {}) {
      this._lib = new Library(libPath);
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
      const cacheKey = `${name}:${returnType}:${argTypes.join(",")}`;

      if (this._cache.has(cacheKey)) {
        return this._cache.get(cacheKey);
      }

      // Propagate library-level use_last_error / use_errno to the FFIFunction
      const mergedOptions = {
        ...options,
        ...(this._use_last_error ? { use_last_error: true } : {}),
        ...(this._use_errno ? { use_errno: true } : {}),
      };
      const ffiFunc = this._lib.func(name, _toNativeType(returnType, native), _toNativeTypes(argTypes, native), mergedOptions);

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

      let callMethod;

      // COERCE: unified inline coercion for any arg type.
      // - primitives (number, string, bigint, null, undefined): pass through
      // - object with ._buffer: unwrap to the raw Buffer (struct/array wrapper)
      // - object with ._as_parameter_: unwrap (ctypes object protocol)
      // - anything else (plain Buffer, etc.): pass through as-is
      // Replaces both the old UNWRAP (primitive fast path) and the slow-path
      // processedArgs loop, covering pointer/string/wstring args without allocation.
      const COERCE = (a) => {
        if (a === null || typeof a !== "object") return a;
        if (a._buffer !== undefined) return a._buffer;
        if (a._as_parameter_ !== undefined) return a._as_parameter_;
        return a;
      };

      if (argCount === 0) {
        // FAST PATH: No declared arguments — still support variadic
        callMethod = function (...args) {
          if (args.length === 0) {
            return ffiFunc.call();
          }
          return ffiFunc.call(...args);
        };
      } else if (!anyFromParam) {
        // FAST PATH: No from_param — arity-specialized wrappers with inline COERCE.
        // Covers all arg types (primitive, pointer, string, struct wrapper) without
        // allocating a rest-params array or a processedArgs accumulator.
        // Each case checks arguments.length to forward variadic extras (cold path).
        switch (argCount) {
          case 1:
            callMethod = function (a0) {
              if (arguments.length === 1) return ffiFunc.call(COERCE(a0));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              for (let i = 1; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          case 2:
            callMethod = function (a0, a1) {
              if (arguments.length === 2) return ffiFunc.call(COERCE(a0), COERCE(a1));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              arr[1] = COERCE(a1);
              for (let i = 2; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          case 3:
            callMethod = function (a0, a1, a2) {
              if (arguments.length === 3) return ffiFunc.call(COERCE(a0), COERCE(a1), COERCE(a2));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              arr[1] = COERCE(a1);
              arr[2] = COERCE(a2);
              for (let i = 3; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          case 4:
            callMethod = function (a0, a1, a2, a3) {
              if (arguments.length === 4) return ffiFunc.call(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              arr[1] = COERCE(a1);
              arr[2] = COERCE(a2);
              arr[3] = COERCE(a3);
              for (let i = 4; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          case 5:
            callMethod = function (a0, a1, a2, a3, a4) {
              if (arguments.length === 5) return ffiFunc.call(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3), COERCE(a4));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              arr[1] = COERCE(a1);
              arr[2] = COERCE(a2);
              arr[3] = COERCE(a3);
              arr[4] = COERCE(a4);
              for (let i = 5; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          case 6:
            callMethod = function (a0, a1, a2, a3, a4, a5) {
              if (arguments.length === 6) return ffiFunc.call(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3), COERCE(a4), COERCE(a5));
              const n = arguments.length,
                arr = new Array(n);
              arr[0] = COERCE(a0);
              arr[1] = COERCE(a1);
              arr[2] = COERCE(a2);
              arr[3] = COERCE(a3);
              arr[4] = COERCE(a4);
              arr[5] = COERCE(a5);
              for (let i = 6; i < n; i++) arr[i] = arguments[i];
              return ffiFunc.call(...arr);
            };
            break;
          default:
            // > 6 args: rest params unavoidable, but still no processedArgs allocation
            callMethod = function (...args) {
              for (let i = 0; i < args.length; i++) args[i] = COERCE(args[i]);
              return ffiFunc.call(...args);
            };
        }
      } else {
        // SLOW PATH: anyFromParam = true — must call from_param on each arg.
        callMethod = function (...args) {
          const processedArgs = new Array(args.length);
          for (let i = 0; i < args.length; i++) {
            processedArgs[i] = applyParamProtocols(COERCE(args[i]), i);
          }
          return ffiFunc.call(...processedArgs);
        };
      }

      // =========================================================================
      // ASYNC WRAPPER: same argument processing, but calls callAsync
      // Returns a Promise instead of the result directly
      // =========================================================================

      let asyncCallMethod;

      if (argCount === 0) {
        asyncCallMethod = function (...args) {
          if (args.length === 0) {
            return ffiFunc.callAsync();
          }
          return ffiFunc.callAsync(...args);
        };
      } else if (!anyFromParam) {
        // FAST PATH: inline COERCE, no processedArgs allocation
        switch (argCount) {
          case 1:
            asyncCallMethod = (a0) => ffiFunc.callAsync(COERCE(a0));
            break;
          case 2:
            asyncCallMethod = (a0, a1) => ffiFunc.callAsync(COERCE(a0), COERCE(a1));
            break;
          case 3:
            asyncCallMethod = (a0, a1, a2) => ffiFunc.callAsync(COERCE(a0), COERCE(a1), COERCE(a2));
            break;
          case 4:
            asyncCallMethod = (a0, a1, a2, a3) => ffiFunc.callAsync(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3));
            break;
          case 5:
            asyncCallMethod = (a0, a1, a2, a3, a4) => ffiFunc.callAsync(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3), COERCE(a4));
            break;
          case 6:
            asyncCallMethod = (a0, a1, a2, a3, a4, a5) => ffiFunc.callAsync(COERCE(a0), COERCE(a1), COERCE(a2), COERCE(a3), COERCE(a4), COERCE(a5));
            break;
          default:
            asyncCallMethod = function (...args) {
              for (let i = 0; i < args.length; i++) args[i] = COERCE(args[i]);
              return ffiFunc.callAsync(...args);
            };
        }
      } else {
        // SLOW PATH: anyFromParam = true
        asyncCallMethod = function (...args) {
          const processedArgs = new Array(args.length);
          for (let i = 0; i < args.length; i++) {
            processedArgs[i] = applyParamProtocols(COERCE(args[i]), i);
          }
          return ffiFunc.callAsync(...processedArgs);
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
            return ffiFunc._errcheck;
          },
          set(callback) {
            ffiFunc._errcheck = callback;
            ffiFunc.setErrcheck(callback);
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
      return this._lib.callback(_toNativeType(returnType, native), _toNativeTypes(argTypes, native), fn);
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
