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
 * import { WINFUNCTYPE, c_int32, c_void_p, ptrToBuffer } from 'node-ctypes';
 *
 * // Read vtable pointer from COM object
 * const vtableBuf = ptrToBuffer(objPtr, 8);
 * const vtableAddr = vtableBuf.readBigUInt64LE(0);
 * const vtable = ptrToBuffer(vtableAddr, 24); // 3 IUnknown methods * 8 bytes
 *
 * // QueryInterface is the first vtable entry
 * const QueryInterface = WINFUNCTYPE(c_int32, c_void_p, c_void_p, c_void_p);
 * const qi = QueryInterface(vtable.readBigUInt64LE(0));
 * ```
 */

import { _toNativeType, _toNativeTypes } from "./types.js";
import { callback as createCallback } from "./callback.js";

/**
 * Internal helper: builds a function wrapper that interprets paramflags
 * (Python ctypes-style in/out/default semantics) on top of an already-bound
 * native function. Used by both CFUNCTYPE and WINFUNCTYPE factories.
 *
 * `paramflags` is an array the same length as argtypes, where each entry is:
 *   { dir: "in" | "out", name: string, default?: any }
 *
 * Calling conventions:
 *   - Positional: fn(arg1, arg2, ...) — only "in" params supplied in order
 *   - Named:      fn({ name1: v1, name2: v2 }) — object with in-param names
 *
 * Return value (Python ctypes parity):
 *   - Nessun out param          → il valore del restype (tal quale).
 *   - 1 out param, nessun altro → il valore della out (non un array).
 *   - N out params              → array di N elementi [out1, out2, ...].
 *
 *   Quando ci sono out params, `result` (restype) NON appare nel return.
 *   Se serve ispezionarlo usa `.errcheck = fn` che riceve (result, func, args).
 *
 * @private
 */
function applyParamflags(rawFn, restype, argtypes, paramflags) {
  if (paramflags.length !== argtypes.length) {
    throw new TypeError(`paramflags length (${paramflags.length}) must match argtypes length (${argtypes.length})`);
  }

  // Classify slots and cache pointed-to types for out-params
  const slots = paramflags.map((pf, idx) => {
    const isOut = pf.dir === "out";
    const argtype = argtypes[idx];
    let outType = null;
    if (isOut) {
      // Expect POINTER(T) argtype; derive base type for read-back
      outType = argtype && argtype._pointerTo ? argtype._pointerTo : null;
      if (!outType) {
        throw new TypeError(`paramflags[${idx}] is "out" but argtype ${idx} is not a POINTER(T)`);
      }
    }
    return { idx, name: pf.name, dir: pf.dir, default: pf.default, argtype, outType };
  });

  const inputs = slots.filter((s) => s.dir !== "out");
  const outputs = slots.filter((s) => s.dir === "out");

  return function paramflagsWrapper(...callArgs) {
    const namedForm =
      callArgs.length === 1 &&
      callArgs[0] !== null &&
      typeof callArgs[0] === "object" &&
      !Buffer.isBuffer(callArgs[0]) &&
      !Array.isArray(callArgs[0]) &&
      // Exclude struct/union proxies (they have _buffer)
      callArgs[0]._buffer === undefined;

    const rawArgs = new Array(slots.length);
    const outBuffers = [];

    // Populate in-slots
    let posIdx = 0;
    for (const input of inputs) {
      let value;
      if (namedForm) {
        value = callArgs[0][input.name];
        if (value === undefined) value = input.default;
      } else {
        value = posIdx < callArgs.length ? callArgs[posIdx++] : input.default;
      }
      if (value === undefined) {
        throw new TypeError(`paramflags: missing required arg "${input.name}"`);
      }
      rawArgs[input.idx] = value;
    }

    // Allocate out-slots. `outType` può essere:
    //   - SimpleCData class: usa _size + _reader
    //   - Structure/Union class: usa .size (dalla structDef) + new T(buf)
    //   - structDef/unionDef object: usa .size + def.toObject(buf)
    for (const output of outputs) {
      const t = output.outType;
      let baseSize;
      if (t._isSimpleCData) {
        baseSize = t._size;
      } else if (typeof t === "function" && (typeof t._buildStruct === "function" || typeof t._buildUnion === "function")) {
        const def = t._structDef || t._unionDef || t._buildStruct?.() || t._buildUnion?.();
        baseSize = def?.size;
      } else if (t && typeof t === "object" && typeof t.size === "number") {
        baseSize = t.size;
      }
      if (!baseSize || baseSize <= 0) {
        throw new TypeError(`paramflags "out" param "${output.name}": cannot determine size of target type`);
      }
      const buf = Buffer.alloc(baseSize);
      outBuffers.push({ buf, type: t, name: output.name });
      rawArgs[output.idx] = buf;
    }

    const result = rawFn(...rawArgs);

    if (outputs.length === 0) return result;

    // Read-back per type: SimpleCData → _reader, Structure/Union → instance
    // wrapper, plain def → toObject.
    const outs = outBuffers.map(({ buf, type }) => {
      if (type._isSimpleCData) return type._reader(buf, 0);
      if (typeof type === "function" && (typeof type._buildStruct === "function" || typeof type._buildUnion === "function")) {
        // Istanzia la classe wrappando il buffer (zero-copy se Structure).
        return new type(buf);
      }
      if (type && typeof type === "object" && typeof type.toObject === "function") {
        return type.toObject(buf);
      }
      // Fallback: ritorna il buffer raw.
      return buf;
    });
    // Python ctypes parity: quando ci sono out-params il return value è
    // SOLO le outs (singolo valore se 1, array se >1) — indipendentemente
    // da restype. Il `result` (già post-errcheck se configurato) viene
    // scartato qui; se l'utente deve ispezionarlo, deve usare un errcheck
    // callback che lo riceve come primo argomento.
    return outs.length === 1 ? outs[0] : outs;
  };
}

/**
 * Attach a `.bind(library, name, paramflags)` method to a CFUNCTYPE/WINFUNCTYPE
 * factory, enabling Python-style typed binding with in/out params.
 * @private
 */
function attachBind(factory, restype, argtypes, abi) {
  factory.bind = function bindWithFlags(library, symbolName, paramflags) {
    // Validate paramflags up-front so shape errors surface before the symbol
    // lookup (which may fail for unrelated reasons like missing export).
    if (!Array.isArray(paramflags)) {
      throw new TypeError("paramflags must be an array");
    }
    if (paramflags.length !== argtypes.length) {
      throw new TypeError(`paramflags length (${paramflags.length}) must match argtypes length (${argtypes.length})`);
    }
    for (let i = 0; i < paramflags.length; i++) {
      const pf = paramflags[i];
      if (pf.dir === "out" && !(argtypes[i] && argtypes[i]._pointerTo)) {
        throw new TypeError(`paramflags[${i}] is "out" but argtype ${i} is not a POINTER(T)`);
      }
    }
    const rawFn = library.func(symbolName, restype, argtypes, abi ? { abi } : {});
    return applyParamflags(rawFn, restype, argtypes, paramflags);
  };
  return factory;
}

/**
 * Creates a function pointer type factory with cdecl calling convention.
 *
 * @param {Function|Object|number} restype - Return type
 * @param {...(Function|Object|number)} argtypes - Argument types
 * @returns {Function} Factory that accepts a BigInt address and returns a callable
 */
export function createCFUNCTYPE(native) {
  return function CFUNCTYPE(restype, ...argtypes) {
    const nativeRestype = _toNativeType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);

    function factory(addressOrFn) {
      // Python ctypes parity: CFUNCTYPE(...)(jsFunc) wraps a JS function as a C callback.
      if (typeof addressOrFn === "function") {
        return createCallback(addressOrFn, restype, argtypes, native);
      }
      const address = addressOrFn;
      if (typeof address !== "bigint") {
        throw new TypeError("CFUNCTYPE: argument must be a BigInt address or a JS function");
      }

      const ffiFunc = new native.FFIFunction(address, null, nativeRestype, nativeArgtypes);

      const callMethod = function (...args) {
        const processedArgs = processArgs(args);
        return ffiFunc.call(...processedArgs);
      };

      Object.defineProperties(callMethod, {
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: function (...args) {
            const processedArgs = processArgs(args);
            return ffiFunc.callAsync(...processedArgs);
          },
          writable: false,
          enumerable: false,
          configurable: false,
        },
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

      return callMethod;
    }

    // Attach metadata + paramflags binding to the factory
    factory.restype = restype;
    factory.argtypes = argtypes;
    factory._isFuncPtr = true;
    attachBind(factory, restype, argtypes, undefined);

    return factory;
  };
}

/**
 * Creates a function pointer type factory with stdcall calling convention.
 *
 * @param {Function|Object|number} restype - Return type
 * @param {...(Function|Object|number)} argtypes - Argument types
 * @returns {Function} Factory that accepts a BigInt address and returns a callable
 */
export function createWINFUNCTYPE(native) {
  return function WINFUNCTYPE(restype, ...argtypes) {
    const nativeRestype = _toNativeType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);

    function factory(addressOrFn) {
      // Python ctypes parity: WINFUNCTYPE(...)(jsFunc) wraps a JS function as a stdcall callback.
      if (typeof addressOrFn === "function") {
        return createCallback(addressOrFn, restype, argtypes, native, "stdcall");
      }
      const address = addressOrFn;
      if (typeof address !== "bigint") {
        throw new TypeError("WINFUNCTYPE: argument must be a BigInt address or a JS function");
      }

      const ffiFunc = new native.FFIFunction(address, null, nativeRestype, nativeArgtypes, { abi: "stdcall" });

      const callMethod = function (...args) {
        const processedArgs = processArgs(args);
        return ffiFunc.call(...processedArgs);
      };

      Object.defineProperties(callMethod, {
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: function (...args) {
            const processedArgs = processArgs(args);
            return ffiFunc.callAsync(...processedArgs);
          },
          writable: false,
          enumerable: false,
          configurable: false,
        },
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

      return callMethod;
    }

    // Attach metadata + paramflags binding to the factory (stdcall)
    factory.restype = restype;
    factory.argtypes = argtypes;
    factory._isFuncPtr = true;
    attachBind(factory, restype, argtypes, "stdcall");

    return factory;
  };
}

/**
 * Process arguments, extracting _buffer from struct/union proxies.
 * @private
 */
function processArgs(args) {
  // Scansione iniziale: se nessun argomento è un Structure/Union proxy
  // (i.e. nessuno ha un `_buffer` Buffer esposto), ritorna l'array
  // originale senza copiare — evita un'allocazione per ogni call.
  const len = args.length;
  let firstToExtract = -1;
  for (let i = 0; i < len; i++) {
    const arg = args[i];
    if (arg && typeof arg === "object" && arg._buffer !== undefined && Buffer.isBuffer(arg._buffer)) {
      firstToExtract = i;
      break;
    }
  }
  if (firstToExtract === -1) return args;

  // Fallback: serve materializzare un nuovo array solo dal primo match.
  const out = new Array(len);
  for (let i = 0; i < firstToExtract; i++) out[i] = args[i];
  for (let i = firstToExtract; i < len; i++) {
    const arg = args[i];
    if (arg && typeof arg === "object" && arg._buffer !== undefined && Buffer.isBuffer(arg._buffer)) {
      out[i] = arg._buffer;
    } else {
      out[i] = arg;
    }
  }
  return out;
}
