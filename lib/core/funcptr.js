/**
 * @file funcptr.js
 * @module core/funcptr
 * @description Function pointer type factories for calling raw function pointers.
 *
 * Provides CFUNCTYPE and WINFUNCTYPE factories that create callable function
 * types from raw memory addresses (BigInt). This enables COM vtable dispatch
 * and other scenarios where function pointers are obtained at runtime.
 *
 * **Python ctypes Compatibility**:
 * - `CFUNCTYPE(restype, ...argtypes)` ≈ Python's `ctypes.CFUNCTYPE`
 * - `WINFUNCTYPE(restype, ...argtypes)` ≈ Python's `ctypes.WINFUNCTYPE`
 *
 * @example Calling a function by address
 * ```javascript
 * import { WinDLL, WINFUNCTYPE, c_int32, c_void_p, c_wchar_p, c_uint32 } from 'node-ctypes';
 *
 * const user32 = new WinDLL('user32.dll');
 * const msgBoxAddr = user32.symbol('MessageBoxW');
 *
 * const MsgBoxProto = WINFUNCTYPE(c_int32, c_void_p, c_wchar_p, c_wchar_p, c_uint32);
 * const msgBox = MsgBoxProto(msgBoxAddr);
 * msgBox(null, 'Hello from FuncPtr!', 'Test', 0);
 * ```
 *
 * @example COM vtable dispatch
 * ```javascript
 * import { WINFUNCTYPE, POINTER, c_int32, c_void_p } from 'node-ctypes';
 *
 * // The first field of a COM object is the address of its vtable
 * const vtable = POINTER(c_void_p).fromAddress(c_void_p.from_address(objPtr).value);
 *
 * // QueryInterface is the first vtable entry
 * const QueryInterface = WINFUNCTYPE(c_int32, c_void_p, c_void_p, c_void_p);
 * const qi = QueryInterface(vtable[0]);
 * ```
 */

import { _toNativeReturnType, _toNativeTypes } from "./types.js";
import { argumentConverters, convertArguments } from "./conversions.js";
import { argumentsNeedOwners, callWithArgumentOwners, createCheckedInvoker, specializeCall } from "./invocation.js";
import { composeResult, resultCheck, resultConverter, scalarResult, structResult } from "./results.js";
import { callback as createCallback, guardCallbackCalls } from "./callback.js";
import { normalizeParamflags, applyParamflags } from "./paramflags.js";
import { keepFunctionOwner } from "../memory/ownership.js";
import { cacheWeakValue, createTypeKey } from "../utils/cache.js";
import { callOn } from "./executor.js";

const prototypeOwners = new WeakMap();

// Tipo funzione CFUNCTYPE / WINFUNCTYPE: chiamato con un indirizzo restituisce
// una funzione chiamabile, con una funzione JS crea un callback C.
function createFuncPtrType(native, typeName, abi) {
  const cache = new Map();
  const signatures = new WeakMap();
  const typeKey = createTypeKey();
  let recent;
  return function (restype, ...argtypes) {
    const previous = recent?.deref();
    if (previous !== undefined) {
      const signature = signatures.get(previous);
      let same = signature.restype === restype && signature.argtypes.length === argtypes.length;
      for (let i = 0; same && i < argtypes.length; i++) same = signature.argtypes[i] === argtypes[i];
      if (same) return previous;
    }
    const key = `${typeKey(restype)};${argtypes.map(typeKey).join(";")}`;
    const cached = cache.get(key)?.deref();
    if (cached !== undefined) {
      recent = cache.get(key);
      return cached;
    }
    const nativeRestype = _toNativeReturnType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);
    const converters = argumentConverters(argtypes, native);
    const hasAdapters = converters.some((convert) => convert.requiresOwners);
    const represent = resultConverter(restype, native);
    const check = resultCheck(restype, typeName);
    const convertResult = composeResult(represent, check);
    const signature = { nativeRestype, nativeArgtypes, converters, represent, check };

    function factory(addressOrFn, paramflags) {
      let callback;
      // Python ctypes parity: CFUNCTYPE(...)(jsFunc) wraps a JS function as a C callback.
      if (typeof addressOrFn === "function") {
        callback = createCallback(addressOrFn, restype, argtypes, native, abi);
        addressOrFn = callback.pointer;
      }
      // Python: prototype((name, dll)) / prototype((name, dll), paramflags)
      // binds an exported function of a library to this prototype.
      let ownerLibrary;
      if (Array.isArray(addressOrFn)) {
        const [name, library] = addressOrFn;
        if (typeof name !== "string" || library === null || typeof library !== "object" || typeof library.symbol !== "function") {
          throw new TypeError(`${typeName}: expected [name, library]`);
        }
        if (paramflags !== undefined) {
          return factory.bind(library, name, paramflags);
        }
        // La funzione tiene caricata la libreria del simbolo (come CDLL.func).
        const nativeLibrary = library._lib ?? library;
        if (nativeLibrary instanceof native.Library) ownerLibrary = nativeLibrary;
        addressOrFn = library.symbol(name);
      }
      // Python accetta l'indirizzo come int: anche qui number o BigInt.
      const address = typeof addressOrFn === "number" ? BigInt(addressOrFn) : addressOrFn;
      if (typeof address !== "bigint") {
        throw new TypeError(`${typeName}: argument must be an address (BigInt or number), a JS function or [name, library]`);
      }

      const options = {};
      if (abi) options.abi = abi;
      if (ownerLibrary) options.library = ownerLibrary;
      if (structResult(restype)) options.struct_buffer = true;
      if (scalarResult(restype)) options.scalar_buffer = true;
      let ffiFunc;
      try {
        ffiFunc = new native.FFIFunction(address, null, nativeRestype, nativeArgtypes, options);
      } catch (error) {
        callback?.release();
        throw error;
      }

      // Come le funzioni di CDLL: restype POINTER/CFUNCTYPE convertito, ed
      // errcheck applicato sul valore convertito.
      const callState = { errcheck: null };
      const checkedCall = createCheckedInvoker(ffiFunc, converters, hasAdapters, convertResult, () => exposed);
      const finish = (result) => (convertResult === undefined ? result : convertResult(result));
      const finishAsync = (result) => (convertResult === undefined ? result : convertResult(result, true));

      const invoke = (args, checked) => {
        if (checked !== null) return checkedCall("call", args, checked);
        if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "call", args, converters, finish);
        return finish(ffiFunc.call(...convertArguments(args, converters)), args);
      };
      const callMethod =
        convertResult === undefined && !hasAdapters && converters.length <= 6
          ? specializeCall(ffiFunc, "call", converters, callState, invoke)
          : function (...args) {
              return invoke(args, callState.errcheck);
            };

      const asyncCall = function (...args) {
        if (callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck);
        if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "callAsync", args, converters, finishAsync);
        return ffiFunc.callAsync(...convertArguments(args, converters)).then((result) => finishAsync(result, args));
      };
      // callOn(): the same call on the Executor of `target` (this invocation's own).
      const onExecutor = function (target, args) {
        if (callState.errcheck !== null) return checkedCall("callAsync", args, callState.errcheck, target);
        if (hasAdapters || argumentsNeedOwners(args)) return callWithArgumentOwners(ffiFunc, "callAsync", args, converters, finishAsync, target);
        return ffiFunc.callOn(target, ...convertArguments(args, converters)).then((result) => finishAsync(result, args));
      };
      const guarded = callback && guardCallbackCalls(callback, callMethod, asyncCall, onExecutor);
      const call = guarded?.call ?? callMethod;
      let exposed = call;
      if (callback === undefined && convertResult === undefined && !hasAdapters && converters.every((convert) => convert.passesPrimitives === true || convert.passesStrings === true)) {
        exposed = ffiFunc._makeEntry(callMethod) ?? callMethod;
      }
      Object.defineProperties(exposed, {
        ...guarded?.properties,
        name: { value: "callMethod", configurable: true },
        length: { value: 0, configurable: true },
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _as_parameter_: guarded?.properties._as_parameter_ ?? { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: guarded?.callAsync ?? asyncCall,
          writable: false,
          enumerable: false,
          configurable: false,
        },
        callOn: {
          value: (target, ...args) => callOn(exposed, target, args),
          writable: false,
          enumerable: false,
          configurable: false,
        },
        _callOn: { value: guarded?.callOnExecutor ?? onExecutor },
        errcheck: {
          get() {
            return callState.errcheck;
          },
          set(callback) {
            callback = callback ?? null;
            if (callback !== null && typeof callback !== "function") throw new TypeError("errcheck must be a function or null");
            callState.errcheck = callback;
            if (exposed !== call) ffiFunc._setEntryDefer(callback !== null);
          },
          enumerable: false,
          configurable: true,
        },
      });

      if (callback !== undefined) keepFunctionOwner(exposed, callback);
      prototypeOwners.set(exposed, factory);
      return exposed;
    }

    // Attach metadata + paramflags binding to the factory
    factory.restype = restype;
    factory.argtypes = argtypes.slice();
    factory._isFuncPtr = true;
    factory.bind = function bindWithFlags(library, symbolName, paramflags) {
      const flags = normalizeParamflags(paramflags, argtypes);
      const rawFn = library._createFunction(symbolName, restype, argtypes, abi ? { abi } : {}, signature);
      const bound = applyParamflags(rawFn, argtypes, flags, signature);
      prototypeOwners.set(bound, factory);
      return bound;
    };

    signatures.set(factory, { restype, argtypes });
    cacheWeakValue(cache, key, factory);
    recent = cache.get(key);
    return factory;
  };
}

/**
 * Creates a function pointer type factory with cdecl calling convention.
 *
 * @param {Object} native - Native module reference
 * @returns {Function} `CFUNCTYPE(restype, ...argtypes)`: factory that accepts an
 *   address (BigInt or number) and returns a callable, or a JS function and
 *   returns a callback
 */
export function createCFUNCTYPE(native) {
  return createFuncPtrType(native, "CFUNCTYPE", undefined);
}

/**
 * Creates a function pointer type factory with stdcall calling convention.
 *
 * @param {Object} native - Native module reference
 * @returns {Function} `WINFUNCTYPE(restype, ...argtypes)`, as {@link createCFUNCTYPE}
 */
export function createWINFUNCTYPE(native) {
  return createFuncPtrType(native, "WINFUNCTYPE", "stdcall");
}
