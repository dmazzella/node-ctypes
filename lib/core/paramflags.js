import { isScalarSubclass, scalarOutparam } from "../types/scalar-protocol.js";
import { callOn } from "./executor.js";

function unpackOutput(instance, { dir, simple, outType }) {
  if (dir === "inout") return instance;
  const convert = instance.__ctypes_from_outparam__;
  if (convert === scalarOutparam) return simple ? instance.value : instance;
  if (convert !== undefined) {
    if (typeof convert !== "function") throw new TypeError("__ctypes_from_outparam__ must be callable");
    return convert.call(instance);
  }
  return typeof outType === "function" ? instance : outType.toObject(instance._buffer);
}

// Once the symbol is bound, capture slot metadata. Each call owns its output
// instances; errcheck may reenter the same wrapper or replace entries in args.
export function applyParamflags(rawFn, argtypes, paramflags, signature) {
  if (paramflags.length !== argtypes.length) {
    throw new TypeError(`paramflags length (${paramflags.length}) must match argtypes length (${argtypes.length})`);
  }

  // Classify slots and cache pointed-to types for out-params
  const slots = paramflags.map((pf, idx) => {
    if (!["in", "out", "inout"].includes(pf.dir)) throw new TypeError(`paramflags[${idx}] has an invalid direction`);
    const isOut = pf.dir !== "in";
    const argtype = argtypes[idx];
    let outType = null;
    if (isOut) {
      // Expect POINTER(T) argtype; derive base type for read-back
      outType = argtype && argtype._pointerTo ? argtype._pointerTo : null;
      if (!outType) {
        throw new TypeError(`paramflags[${idx}] is "out" but argtype ${idx} is not a POINTER(T)`);
      }
    }
    return { idx, name: pf.name, dir: pf.dir, default: pf.default, outType, simple: outType?._isSimpleCData === true && !isScalarSubclass(outType) };
  });

  const inputs = slots.filter((s) => s.dir !== "out");
  const outputs = slots.filter((s) => s.dir !== "in");

  let errcheck = null;

  // `call`: the callOn target when `method` is "callOn".
  const invokeWithFlags = (method, callArgs, call) => {
    const checked = errcheck;
    const namedForm =
      callArgs.length === 1 &&
      callArgs[0] !== null &&
      typeof callArgs[0] === "object" &&
      !Buffer.isBuffer(callArgs[0]) &&
      !ArrayBuffer.isView(callArgs[0]) &&
      !(callArgs[0] instanceof ArrayBuffer) &&
      !Array.isArray(callArgs[0]) &&
      // Exclude struct/union proxies (they have _buffer)
      callArgs[0]._buffer === undefined;

    const rawArgs = new Array(slots.length);

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

    // Keep the original instances: errcheck can replace entries in rawArgs.
    const instances =
      outputs.length === 0
        ? null
        : outputs.map(({ idx, dir, outType, name }) => {
            const instance = dir === "inout" ? rawArgs[idx] : newOutInstance(outType, name);
            rawArgs[idx] = instance;
            return instance;
          });

    const finish = (result) => {
      // Returning the original args continues normal output unpacking.
      if (checked !== null) {
        const value = checked(result, paramflagsWrapper, rawArgs);
        if (value !== rawArgs) return value;
      }
      if (instances === null) return result;
      if (instances.length === 1) return unpackOutput(instances[0], outputs[0]);
      return instances.map((instance, i) => unpackOutput(instance, outputs[i]));
    };
    // The private binding snapshots this handler and keeps adapter temporaries
    // alive until output processing finishes, including on an async rejection.
    const previous = rawFn.errcheck;
    rawFn.errcheck = finish;
    try {
      if (method === "callOn") return rawFn._callOn(call, rawArgs);
      return method === "callAsync" ? rawFn.callAsync(...rawArgs) : rawFn(...rawArgs);
    } finally {
      rawFn.errcheck = previous;
    }
  };

  let paramflagsWrapper;
  if (inputs.length > 0 && outputs.length === 0 && signature.represent === undefined && signature.check === undefined && signature.converters.every((convert) => convert.passesPrimitives === true)) {
    paramflagsWrapper = (...args) => {
      // Exact positional numbers need no defaults, owners or output conversion.
      // A reentrant call can still have an outer handler on the private binding.
      if (errcheck === null && args.length === inputs.length && args.every(Number.isFinite) && rawFn.errcheck === null) return rawFn(...args);
      return invokeWithFlags("call", args);
    };
  } else {
    paramflagsWrapper = (...args) => invokeWithFlags("call", args);
  }
  Object.defineProperties(paramflagsWrapper, {
    funcName: { value: rawFn.funcName },
    address: { value: rawFn.address },
    _as_parameter_: { value: rawFn.address },
    _ffi: { value: rawFn._ffi },
    callAsync: { value: (...args) => invokeWithFlags("callAsync", args) },
    callOn: { value: (target, ...args) => callOn(paramflagsWrapper, target, args) },
    _callOn: { value: (call, args) => invokeWithFlags("callOn", args, call) },
    errcheck: {
      get: () => errcheck,
      set: (callback) => {
        if (callback !== null && callback !== undefined && typeof callback !== "function") {
          throw new TypeError("errcheck must be a function or null");
        }
        errcheck = callback ?? null;
      },
      enumerable: false,
      configurable: true,
    },
  });
  return paramflagsWrapper;
}

function newOutInstance(type, name) {
  if (typeof type === "function" && (type._isSimpleCData || type._isArrayType || typeof type._buildStruct === "function")) {
    return new type();
  }
  if (type && typeof type === "object" && typeof type.create === "function") {
    return type.create();
  }
  throw new TypeError(`paramflags "out" param "${name}": cannot determine the target type`);
}

/**
 * Normalize a paramflags entry: Python tuple `[flag, name, default]`
 * (flag 1 = in, 2 = out, 3 = inout, 4 = in defaulting to 0) or `{ dir, name, default }`.
 * @private
 */
function toParamFlag(pf) {
  if (!Array.isArray(pf)) return pf;
  const [flag = 1, name, ...rest] = pf;
  const dir = (flag & 3) === 3 ? "inout" : flag & 2 ? "out" : "in";
  const result = { dir, name };
  if (rest.length > 0) result.default = rest[0];
  else if (flag & 4) result.default = 0;
  return result;
}

export function normalizeParamflags(paramflags, argtypes) {
  // Only shape and pointer requirements precede lookup. Names, defaults and
  // full direction validation belong to the successfully bound wrapper.
  if (!Array.isArray(paramflags)) {
    throw new TypeError("paramflags must be an array");
  }
  paramflags = paramflags.map(toParamFlag);
  if (paramflags.length !== argtypes.length) {
    throw new TypeError(`paramflags length (${paramflags.length}) must match argtypes length (${argtypes.length})`);
  }
  for (let i = 0; i < paramflags.length; i++) {
    const pf = paramflags[i];
    if (pf.dir !== "in" && !(argtypes[i] && argtypes[i]._pointerTo)) {
      throw new TypeError(`paramflags[${i}] is "out" but argtype ${i} is not a POINTER(T)`);
    }
  }
  return paramflags;
}
