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
import { adaptCallbackFunction } from "./callback-conversions.js";
import { argumentConverters } from "./conversions.js";
import { buildFunctionBinding } from "./invocation.js";
import { composeResult, resultCheck, resultConverter, scalarResult, structResult } from "./results.js";
import { createTypeKey } from "../utils/cache.js";
import { callOn } from "./executor.js";

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
  const typeKey = createTypeKey();
  // Captured at load so calls are not affected by later patches.
  const reflectApply = Reflect.apply;
  // Library Proxy -> the CDLL instance behind it.
  const libraryTargets = new WeakMap();
  // Funzione passata a errcheck quando la chiamata passa da un attributo
  // della libreria (FunctionWrapper).
  const kErrcheckFunc = Symbol("errcheckFunc");

  // Chiave di cache delle opzioni di func() (abi, ...), indipendente dall'ordine.
  const optionsKey = (options) => {
    let key = "";
    for (const name of Object.keys(options).sort()) {
      key += `;${name}=${typeKey(options[name])}`;
    }
    return key;
  };

  function captureResult(cdll, name, type) {
    return { represent: resultConverter(type, native), check: cdll._resultCheck(type, name) };
  }

  class AttributeSignature {
    // The exposed array is stable; only assignment changes the bound signature.
    argtypes = [];
    #declaredArgtypes;
    #converters;
    #restype;
    #result;

    setArguments(value) {
      const types = [...(value ?? [])];
      const converters = argumentConverters(types, native);
      this.argtypes.splice(0, this.argtypes.length, ...types);
      this.#declaredArgtypes = types;
      this.#converters = converters;
    }

    returnType(cdll) {
      return this.#restype === undefined ? cdll._defaultRestype() : this.#restype;
    }

    setResult(cdll, name, value) {
      const type = value === undefined ? cdll._defaultRestype() : value;
      this.#result = captureResult(cdll, name, type);
      this.#restype = value;
    }

    bind(cdll, name) {
      const type = this.returnType(cdll);
      const { represent, check } = this.#result ?? captureResult(cdll, name, type);
      this.#declaredArgtypes ??= [];
      this.#converters ??= [];
      return cdll._createFunction(name, type, this.#declaredArgtypes, {}, { represent, check, converters: this.#converters });
    }
  }

  class FunctionWrapper {
    constructor(cdll, name) {
      let declaration;
      const signature = () => (declaration ??= new AttributeSignature());
      let errcheck = null;
      let cachedFunc = null;

      // Python ctypes: restype predefinito c_int. Ogni attributo (libc.abs) ha
      // la sua funzione, non quella condivisa dalla cache di func(): errcheck
      // non tocca altri utenti della stessa firma e resta dopo un cambio di
      // argtypes / restype, come in Python.
      const resolve = () => {
        if (!cachedFunc) {
          cachedFunc = signature().bind(cdll, name);
          Object.defineProperty(cachedFunc, kErrcheckFunc, { value: func });
          if (errcheck !== null) {
            cachedFunc.errcheck = errcheck;
          }
        }
        return cachedFunc;
      };

      // A plain function with accessors instead of a Proxy: each call through
      // a Proxy cost ~20 ns more. The arguments are forwarded as `arguments`,
      // without the array of (...args): called as `lib.name(...)` (through the
      // library's Proxy) V8 does not inline it and the array cost ~60 ns. A
      // method, like an arrow function, is not a constructor.
      const { func } = {
        func() {
          return reflectApply(cachedFunc ?? resolve(), undefined, arguments);
        },
      };

      Object.defineProperties(func, {
        address: { get: () => resolve().address },
        _as_parameter_: { get: () => resolve().address },
        argtypes: {
          get: () => signature().argtypes,
          set: (value) => {
            signature().setArguments(value);
            cachedFunc = null; // Invalidate cache
          },
          configurable: true,
        },
        restype: {
          get: () => signature().returnType(cdll),
          set: (value) => {
            signature().setResult(cdll, name, value);
            cachedFunc = null; // Invalidate cache
          },
          configurable: true,
        },
        errcheck: {
          get: () => errcheck,
          set: (value) => {
            if (value !== null && value !== undefined && typeof value !== "function") throw new TypeError("errcheck must be a function or null");
            errcheck = value ?? null;
            if (cachedFunc) {
              cachedFunc.errcheck = errcheck;
            }
          },
          configurable: true,
        },
        callAsync: {
          get: () => resolve().callAsync,
          // Come con il Proxy precedente: l'assegnazione non ha effetto.
          set: () => {},
          configurable: true,
        },
        callOn: {
          get: () => resolve().callOn,
          set: () => {},
          configurable: true,
        },
        _callOn: {
          get: () => resolve()._callOn,
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
      this._lib = new Library(libPath, options.mode, options.winmode);
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
      const wrappers = this._funcWrapperCache;
      const proxy = new Proxy(this, {
        get(target, prop, receiver) {
          // A function already looked up comes first, as in Python, where
          // __getattr__ stores it on the instance: one Map lookup instead of
          // the `in` walk of the prototype chain, which misses for functions.
          if (typeof prop === "string") {
            const cached = wrappers.get(prop);
            if (cached !== undefined) {
              return cached;
            }
          }
          // Allow access to existing properties/methods
          if (prop in target || typeof prop !== "string") {
            return Reflect.get(target, prop, receiver);
          }
          // Create and cache a new FunctionWrapper
          const wrapper = new FunctionWrapper(target, prop);
          wrappers.set(prop, wrapper);
          return wrapper;
        },
        // As in Python, a property set later with the name of a function
        // replaces it, and `delete lib.name` forgets the function: the next
        // access creates a new one.
        defineProperty(target, prop, descriptor) {
          wrappers.delete(prop);
          return Reflect.defineProperty(target, prop, descriptor);
        },
        deleteProperty(target, prop) {
          wrappers.delete(prop);
          return Reflect.deleteProperty(target, prop);
        },
      });
      libraryTargets.set(proxy, this);
      return proxy;
    }

    /**
     * Ottiene una funzione dalla libreria
     * @param {string} name - Nome della funzione
     * @param {Function|number|CType} returnType - Tipo di ritorno (SimpleCData class, CType value, o CType)
     * @param {Array<Function|number|CType>} argTypes - Tipi degli argomenti
     * @param {Object} [options] - Opzioni aggiuntive (es. { abi: 'stdcall' })
     * @returns {Function} Funzione callable
     */
    _defaultRestype() {
      return FunctionWrapper.defaultRestype;
    }

    func(name, returnType = this._defaultRestype(), argTypes = [], options = {}) {
      const cacheKey = `${name}:${typeKey(returnType)}:${argTypes.map(typeKey).join(",")}${optionsKey(options)}`;
      let fn = this._cache.get(cacheKey);
      if (fn === undefined) {
        fn = this._createFunction(name, returnType, argTypes, options);
        this._cache.set(cacheKey, fn);
      }
      return fn;
    }

    /**
     * Controllo del risultato prima di errcheck (Python: `_check_retval_` del
     * restype, es. HRESULT in OleDLL). undefined se non c'è.
     * @protected
     */
    _resultCheck(returnType, name) {
      return resultCheck(returnType, name, this.constructor.name);
    }

    /**
     * Crea una nuova funzione, senza cache (vedi func()).
     * @protected
     */
    _createFunction(name, returnType, argTypes = [], options = {}, signature) {
      const nativeOptions = {
        ...options,
        ...(this._use_last_error ? { use_last_error: true } : {}),
        ...(this._use_errno ? { use_errno: true } : {}),
        ...(structResult(returnType) ? { struct_buffer: true } : {}),
        ...(scalarResult(returnType) ? { scalar_buffer: true } : {}),
      };
      const ffiFunc = this._lib.func(name, signature?.nativeRestype ?? _toNativeReturnType(returnType, native), signature?.nativeArgtypes ?? _toNativeTypes(argTypes, native), nativeOptions);
      // Bind first: a missing symbol must fail before reading from_param or _check_retval_ here.
      return CDLL.#wrapFunction(this, ffiFunc, name, returnType, argTypes, signature);
    }

    static #wrapFunction(library, ffiFunc, name, returnType, argTypes, signature) {
      const converters = signature?.converters ?? argumentConverters(argTypes, native);
      const baseConvert = signature === undefined ? resultConverter(returnType, native) : signature.represent;
      const check = signature === undefined ? library._resultCheck(returnType, name) : signature.check;
      const convertResult = composeResult(baseConvert, check);
      // The library itself, not its Proxy: this write runs on every call when tracking errors.
      const self = libraryTargets.get(library) ?? library;
      const trackLastCalled =
        library._use_last_error || library._use_errno
          ? () => {
              self._lastCalledFfi = ffiFunc;
            }
          : undefined;

      const { exposed, asyncCallMethod, onExecutor, errcheckDescriptor } = buildFunctionBinding({
        ffiFunc,
        converters,
        convertResult,
        trackLastCalled,
        entryName: name,
        getErrcheckTarget: () => exposed[kErrcheckFunc] ?? exposed,
      });

      Object.defineProperties(exposed, {
        funcName: { value: name },
        address: { value: ffiFunc.address },
        _as_parameter_: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: { value: asyncCallMethod, writable: false, enumerable: false, configurable: false },
        callOn: { value: (target, ...args) => callOn(exposed, target, args), writable: false, enumerable: false, configurable: false },
        _callOn: { value: onExecutor },
        errcheck: errcheckDescriptor,
      });

      return exposed;
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
      const args = [_toNativeReturnType(returnType, native), _toNativeTypes(argTypes, native), adaptCallbackFunction(fn, argTypes, returnType, native)];
      const scalarArgs = argTypes.map(scalarResult);
      if (scalarArgs.some(Boolean)) args.push(scalarArgs);
      return this._lib.callback(...args);
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
    _createFunction(name, returnType, argTypes = [], options = {}, signature) {
      return super._createFunction(
        name,
        returnType,
        argTypes,
        {
          abi: "stdcall",
          ...options,
        },
        signature,
      );
    }
  }

  /**
   * OleDLL - come WinDLL ma con restype HRESULT un valore negativo (codice di
   * errore HRESULT) lancia un errore.
   *
   * Python ctypes parity: `ctypes.OleDLL`; come HRESULT._check_retval_ il
   * controllo precede errcheck e non viene sostituito da esso.
   */
  class OleDLL extends WinDLL {
    _defaultRestype() {
      return OleDLL.defaultRestype;
    }
  }

  return { FunctionWrapper, CDLL, WinDLL, OleDLL };
}
