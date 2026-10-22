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
import { argumentConverters, convertArguments, resultConverter } from "./conversions.js";
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
 * Normalize a paramflags entry: Python tuple `[flag, name, default]`
 * (flag 1 = in, 2 = out, 4 = in defaulting to 0) or `{ dir, name, default }`.
 * @private
 */
function toParamFlag(pf) {
  if (!Array.isArray(pf)) return pf;
  const [flag = 1, name, ...rest] = pf;
  const dir = flag & 2 ? "out" : "in";
  const result = { dir, name };
  if (rest.length > 0) result.default = rest[0];
  else if (flag & 4) result.default = 0;
  return result;
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
    paramflags = paramflags.map(toParamFlag);
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

// Tipo funzione CFUNCTYPE / WINFUNCTYPE: chiamato con un indirizzo restituisce
// una funzione chiamabile, con una funzione JS crea un callback C.
function createFuncPtrType(native, typeName, abi) {
  return function (restype, ...argtypes) {
    const nativeRestype = _toNativeReturnType(restype, native);
    const nativeArgtypes = _toNativeTypes(argtypes, native);
    const converters = argumentConverters(argtypes, native);
    const convertResult = resultConverter(restype);

    function factory(addressOrFn, paramflags) {
      // Python ctypes parity: CFUNCTYPE(...)(jsFunc) wraps a JS function as a C callback.
      if (typeof addressOrFn === "function") {
        return createCallback(addressOrFn, restype, argtypes, native, abi);
      }
      // Python: prototype((name, dll)) / prototype((name, dll), paramflags)
      // binds an exported function of a library to this prototype.
      if (Array.isArray(addressOrFn)) {
        const [name, library] = addressOrFn;
        if (typeof name !== "string" || library === null || typeof library !== "object" || typeof library.symbol !== "function") {
          throw new TypeError(`${typeName}: expected [name, library]`);
        }
        if (paramflags !== undefined) {
          return factory.bind(library, name, paramflags);
        }
        addressOrFn = library.symbol(name);
      }
      // Python accetta l'indirizzo come int: anche qui number o BigInt.
      const address = typeof addressOrFn === "number" ? BigInt(addressOrFn) : addressOrFn;
      if (typeof address !== "bigint") {
        throw new TypeError(`${typeName}: argument must be an address (BigInt or number), a JS function or [name, library]`);
      }

      const ffiFunc = abi ? new native.FFIFunction(address, null, nativeRestype, nativeArgtypes, { abi }) : new native.FFIFunction(address, null, nativeRestype, nativeArgtypes);

      // Come le funzioni di CDLL: restype POINTER/CFUNCTYPE convertito, ed
      // errcheck applicato sul valore convertito.
      let jsErrcheck = null;
      const finish = (result, args) => {
        if (convertResult === undefined) return result;
        const converted = convertResult(result);
        return jsErrcheck === null ? converted : jsErrcheck(converted, callMethod, args);
      };

      const callMethod = function (...args) {
        return finish(ffiFunc.call(...convertArguments(args, converters)), args);
      };

      Object.defineProperties(callMethod, {
        funcName: { value: `0x${address.toString(16)}` },
        address: { value: ffiFunc.address },
        _ffi: { value: ffiFunc },
        callAsync: {
          value: function (...args) {
            return ffiFunc.callAsync(...convertArguments(args, converters)).then((result) => finish(result, args));
          },
          writable: false,
          enumerable: false,
          configurable: false,
        },
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

      return callMethod;
    }

    // Attach metadata + paramflags binding to the factory
    factory.restype = restype;
    factory.argtypes = argtypes;
    factory._isFuncPtr = true;
    attachBind(factory, restype, argtypes, abi);

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
