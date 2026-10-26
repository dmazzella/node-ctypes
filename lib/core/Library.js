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
import { adaptCallbackFunction, argumentConverters, argumentsNeedOwners, callWithArgumentOwners, callWithResultHandler, convertArguments, resultCheck, resultConverter, scalarResult, specializeCall, structResult } from "./conversions.js";
import { createTypeKey } from "../utils/cache.js";

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

  class FunctionWrapper {
    constructor(cdll, name) {
      const argtypes = [];
      let declaredArgtypes = [];
      let converters = [];
      let restype = undefined;
      let resultSignature;
      let errcheck = null;
      let cachedFunc = null;

      // Python ctypes: restype predefinito c_int. Ogni attributo (libc.abs) ha
      // la sua funzione, non quella condivisa dalla cache di func(): errcheck
      // non tocca altri utenti della stessa firma e resta dopo un cambio di
      // argtypes / restype, come in Python.
      const resolve = () => {
        if (!cachedFunc) {
          const returnType = restype === undefined ? cdll._defaultRestype() : restype;
          const signature = resultSignature ?? { represent: resultConverter(returnType), check: cdll._resultCheck(returnType, name) };
          cachedFunc = cdll._createFunction(name, returnType, declaredArgtypes, {}, { ...signature, converters });
          Object.defineProperty(cachedFunc, kErrcheckFunc, { value: func });
          if (errcheck !== null) {
            cachedFunc.errcheck = errcheck;
          }
        }
        return cachedFunc;
      };

      // Funzione semplice con accessor invece di un Proxy: ogni chiamata
      // attraverso un Proxy costava ~20 ns in più.
      const func = (...args) => (cachedFunc ?? resolve())(...args);

      Object.defineProperties(func, {
        address: { get: () => resolve().address },
        _as_parameter_: { get: () => resolve().address },
        argtypes: {
          get: () => argtypes,
          set: (value) => {
            // Python: argtypes = None toglie i tipi degli argomenti.
            const types = [...(value ?? [])];
            const next = argumentConverters(types, native);
            argtypes.splice(0, argtypes.length, ...types);
            declaredArgtypes = types;
            converters = next;
            cachedFunc = null; // Invalidate cache
          },
          configurable: true,
        },
        restype: {
          get: () => (restype === undefined ? cdll._defaultRestype() : restype),
          set: (value) => {
            const returnType = value === undefined ? cdll._defaultRestype() : value;
            resultSignature = { represent: resultConverter(returnType), check: cdll._resultCheck(returnType, name) };
            restype = value;
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
      // Propagate library-level use_last_error / use_errno to the FFIFunction
      const mergedOptions = {
        ...options,
        ...(this._use_last_error ? { use_last_error: true } : {}),
        ...(this._use_errno ? { use_errno: true } : {}),
        ...(structResult(returnType) ? { struct_buffer: true } : {}),
        ...(scalarResult(returnType) ? { scalar_buffer: true } : {}),
      };
      const ffiFunc = this._lib.func(name, signature?.nativeRestype ?? _toNativeReturnType(returnType, native), signature?.nativeArgtypes ?? _toNativeTypes(argTypes, native), mergedOptions);

      // =========================================================================
      // OPTIMIZATION: Create specialized wrapper based on argument types
      // For primitive-only args, bypass the processing loop entirely
      // =========================================================================

      // Conversione degli argomenti come il from_param di base di Python
      // (vedi conversions.js): un convertitore per posizione dichiarata.
      const C = signature?.converters ?? argumentConverters(argTypes, native);
      const convertAll = (args) => convertArguments(args, C);
      const hasAdapters = C.some((convert) => convert.requiresOwners);
      const baseConvert = signature === undefined ? resultConverter(returnType) : signature.represent;
      const check = signature === undefined ? this._resultCheck(returnType, name) : signature.check;
      const convertResult = check === undefined ? baseConvert : baseConvert === undefined ? check : (result) => check(baseConvert(result));
      const captureHere = convertResult === undefined;
      const callState = { errcheck: null };
      let checkedSync;
      const checkedCall = (method, args, checked) => {
        const originalArgs = Array.isArray(args) ? args : Array.prototype.slice.call(args);
        const func = errcheckFunc();
        const finish = (result) => checked(convertResult === undefined ? result : convertResult(result), func, originalArgs);
        const call = method === "call" ? (checkedSync ??= ffiFunc._makeCheckedCall()) : undefined;
        return callWithResultHandler(ffiFunc, method, originalArgs, C, finish, hasAdapters || argumentsNeedOwners(originalArgs), call);
      };
      const ownedCall = (method, args) => callWithArgumentOwners(ffiFunc, method, args, C);
      const invoke = (method, args, checked) => {
        if (captureHere && checked !== null) return checkedCall(method, args, checked);
        return captureHere && (hasAdapters || argumentsNeedOwners(args)) ? ownedCall(method, args) : ffiFunc[method](...convertAll(args));
      };

      let callMethod = specializeCall(ffiFunc, "call", C, callState, (args, checked) => invoke("call", args, checked), captureHere);
      let asyncCallMethod = specializeCall(ffiFunc, "callAsync", C, callState, (args, checked) => invoke("callAsync", args, checked), captureHere);

      // Result handlers run inside the native call scope, after conversion and
      // with the hook/arguments captured before any argument adapter executes.
      if (convertResult !== undefined) {
        const rawCall = callMethod;
        const rawAsync = asyncCallMethod;
        const finish = (result) => convertResult(result);
        callMethod = function (...args) {
          if (callState.errcheck !== null) return checkedCall("call", args, callState.errcheck);
          if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "call", args, C, finish);
          return finish(rawCall.apply(this, args), args);
        };
        asyncCallMethod = function (...args) {
          if (callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck);
          if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "callAsync", args, C, finish);
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

      // Python: errcheck riceve la funzione su cui è impostato (l'attributo
      // della libreria, se passa da lì), qualunque sia il restype.
      const errcheckFunc = () => callMethod[kErrcheckFunc] ?? callMethod;

      // Aggiungi metadata come proprietà non-enumerable per non interferire
      Object.defineProperties(callMethod, {
        funcName: { value: name },
        address: { value: ffiFunc.address },
        _as_parameter_: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: { value: asyncCallMethod, writable: false, enumerable: false, configurable: false },
        // Esponi errcheck come setter/getter
        errcheck: {
          get() {
            return callState.errcheck;
          },
          set(callback) {
            callback = callback ?? null;
            if (callback !== null && typeof callback !== "function") throw new TypeError("errcheck must be a function or null");
            callState.errcheck = callback;
          },
          enumerable: false,
          configurable: true,
        },
      });

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
