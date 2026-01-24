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

    // Return a proxy to enable Python-like syntax: libc.abs.argtypes = [...]; libc.abs.restype = ...; libc.abs(...)
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Allow access to existing properties/methods
        if (prop in target || typeof prop !== "string") {
          return Reflect.get(target, prop, receiver);
        }
        // Assume it's a function name from the library
        return new FunctionWrapper(target, prop);
      },
    });
  }

  /**
   * Ottiene una funzione dalla libreria
   * @param {string} name - Nome della funzione
   * @param {string|CType} returnType - Tipo di ritorno
   * @param {Array<string|CType>} argTypes - Tipi degli argomenti
   * @param {Object} [options] - Opzioni aggiuntive (es. { abi: 'stdcall' })
   * @returns {Function} Funzione callable
   */
  func(name, returnType, argTypes = [], options = {}) {
    const cacheKey = `${name}:${returnType}:${argTypes.join(",")}`;

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const ffiFunc = this._lib.func(name, _toNativeType(returnType, native), _toNativeTypes(argTypes, native), options);

    // =========================================================================
    // OPTIMIZATION: Create specialized wrapper based on argument types
    // For primitive-only args, bypass the processing loop entirely
    // =========================================================================

    const argCount = argTypes.length;

    // Check if all args are primitive types (no structs/buffers that need _buffer extraction)
    const allPrimitive = argTypes.every((t) => {
      if (typeof t === "function" && t._isSimpleCData) {
        // SimpleCData types that are NOT pointers are primitive
        const typeName = t._type;
        return typeName !== "pointer" && typeName !== "char_p" && typeName !== "wchar_p";
      }
      if (typeof t === "string") {
        return t !== "pointer" && t !== "char_p" && t !== "wchar_p" && t !== "void_p";
      }
      // CType objects from native - check if it's a pointer type
      if (t && typeof t === "object" && t.name) {
        return !t.name.includes("pointer") && !t.name.includes("char_p");
      }
      return false;
    });

    let callMethod;

    if (argCount === 0) {
      // FAST PATH: No arguments - direct call
      callMethod = function () {
        return ffiFunc.call();
      };
    } else if (allPrimitive) {
      // FAST PATH: All primitive args - direct call without processing
      switch (argCount) {
        case 1:
          callMethod = function (a0) {
            return ffiFunc.call(a0);
          };
          break;
        case 2:
          callMethod = function (a0, a1) {
            return ffiFunc.call(a0, a1);
          };
          break;
        case 3:
          callMethod = function (a0, a1, a2) {
            return ffiFunc.call(a0, a1, a2);
          };
          break;
        case 4:
          callMethod = function (a0, a1, a2, a3) {
            return ffiFunc.call(a0, a1, a2, a3);
          };
          break;
        default:
          // Fallback for many args
          callMethod = function (...args) {
            return ffiFunc.call(...args);
          };
      }
    } else {
      // SLOW PATH: Has buffer/struct args - need to extract _buffer
      callMethod = function (...args) {
        const processedArgs = [];

        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          // Check for _buffer FIRST (handles Proxy-wrapped structs)
          // This avoids calling Buffer.isBuffer() on Proxy which can cause issues
          if (arg && typeof arg === "object") {
            // Check for struct proxy FIRST - accessing _buffer on Proxy is safe
            // but Buffer.isBuffer(proxy) can cause hangs
            if (arg._buffer !== undefined && Buffer.isBuffer(arg._buffer)) {
              // Struct proxy or object with _buffer
              processedArgs.push(arg._buffer);
            } else if (Buffer.isBuffer(arg)) {
              // Already a buffer, use directly
              processedArgs.push(arg);
            } else {
              // Other object, pass as-is
              processedArgs.push(arg);
            }
          } else {
            // Primitive value (number, string, bigint, null, undefined)
            processedArgs.push(arg);
          }
        }

        return ffiFunc.call(...processedArgs);
      };
    }

    // Aggiungi metadata come proprietà non-enumerable per non interferire
    Object.defineProperties(callMethod, {
      funcName: { value: name },
      address: { value: ffiFunc.address },
      _ffi: { value: ffiFunc },
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
   * @param {string|CType} returnType - Tipo di ritorno
   * @param {Array<string|CType>} argTypes - Tipi degli argomenti
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

  return { FunctionWrapper, CDLL, WinDLL };
}
