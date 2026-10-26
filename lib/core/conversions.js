/**
 * @file conversions.js
 * @module core/conversions
 * @description Argument and result conversions shared by CDLL functions and
 * CFUNCTYPE callers, following Python ctypes (`from_param` and restype
 * conversion).
 */

import { mirrorAddress, mirrorsActive, refresh } from "../memory/mirror.js";
import { ArgumentError } from "../platform/errors.js";
import { encodeWide } from "../memory/buffer.js";
import { buildWrapper } from "../structures/helpers/wrap.js";
import { activeArgumentOwners as argumentOwnerRegistry, byrefOwners, isScalarSubclass, resolveParameter, scalarView, structArgumentFactories } from "../structures/helpers/common.js";

const activeArgumentOwners = argumentOwnerRegistry;

function retainArgument(owners, value) {
  if (owners !== undefined && value !== null && (typeof value === "object" || typeof value === "function")) owners.push(value);
}

export function needsArgumentOwners(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return "_buffer" in value || "_as_parameter_" in value || (mirrorsActive && mirrorAddress(value) !== undefined);
  }
  return true;
}

export function argumentsNeedOwners(args) {
  for (let i = 0; i < args.length; i++) if (needsArgumentOwners(args[i])) return true;
  return false;
}

// The general fallback receives the hook snapshot taken before any owner probe.
export function specializeCall(ffiFunc, method, converters, state, invoke, captureHere = true) {
  const [C0, C1, C2, C3, C4, C5] = converters;
  const hasAdapters = converters.some((convert) => convert.requiresOwners);
  switch (converters.length) {
    case 0:
      return function () {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 0) return invoke(arguments, checked);
        return ffiFunc[method]();
      };
    case 1:
      return function (a0) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 1) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0));
      };
    case 2:
      return function (a0, a1) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 2) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0) || needsArgumentOwners(a1))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1));
      };
    case 3:
      return function (a0, a1, a2) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 3) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0) || needsArgumentOwners(a1) || needsArgumentOwners(a2))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2));
      };
    case 4:
      return function (a0, a1, a2, a3) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 4) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0) || needsArgumentOwners(a1) || needsArgumentOwners(a2) || needsArgumentOwners(a3))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3));
      };
    case 5:
      return function (a0, a1, a2, a3, a4) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 5) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0) || needsArgumentOwners(a1) || needsArgumentOwners(a2) || needsArgumentOwners(a3) || needsArgumentOwners(a4))) return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4));
      };
    case 6:
      return function (a0, a1, a2, a3, a4, a5) {
        const checked = captureHere ? state.errcheck : null;
        if (checked !== null || arguments.length !== 6) return invoke(arguments, checked);
        if (captureHere && (hasAdapters || needsArgumentOwners(a0) || needsArgumentOwners(a1) || needsArgumentOwners(a2) || needsArgumentOwners(a3) || needsArgumentOwners(a4) || needsArgumentOwners(a5)))
          return callWithArgumentOwners(ffiFunc, method, arguments, converters);
        return ffiFunc[method](C0(a0), C1(a1), C2(a2), C3(a3), C4(a4), C5(a5));
      };
    default:
      return function (...args) {
        const checked = captureHere ? state.errcheck : null;
        return invoke(args, checked);
      };
  }
}

// The registry is a GC root, including while another converter reenters JS.
export function callWithArgumentOwners(ffiFunc, method, args, converters, finish, resultHandler, checkedCall) {
  const owners = [];
  activeArgumentOwners.add(owners);
  let pending = false;
  try {
    const converted = convertArguments(args, converters, owners);
    const result =
      resultHandler === undefined ? ffiFunc[method](...converted) : checkedCall === undefined ? ffiFunc[method === "callAsync" ? "_callAsyncWithErrcheck" : "_callWithErrcheck"](resultHandler, ...converted) : checkedCall(resultHandler, ...converted);
    if (method === "callAsync") {
      const completed = finish === undefined ? result : result.then((value) => finish(value, args));
      const promise = completed.finally(() => activeArgumentOwners.delete(owners));
      pending = true;
      return promise;
    }
    return finish === undefined ? result : finish(result, args);
  } finally {
    if (!pending) activeArgumentOwners.delete(owners);
  }
}

export function callWithResultHandler(ffiFunc, method, args, converters, handler, retainOwners, checkedCall) {
  if (retainOwners) return callWithArgumentOwners(ffiFunc, method, args, converters, undefined, handler, checkedCall);
  if (checkedCall !== undefined) return checkedCall(handler, ...convertArguments(args, converters));
  return ffiFunc[method === "callAsync" ? "_callAsyncWithErrcheck" : "_callWithErrcheck"](handler, ...convertArguments(args, converters));
}

/**
 * Base conversion of an object argument:
 * - struct/union/array instance or Buffer view → its Buffer (by reference)
 * - pointer created from an address → the address
 * - object with `_as_parameter_` (callbacks, adapters) → that value
 * - copy of native memory (no external buffers, memory/mirror.js) → the
 *   original address
 * - anything else unchanged
 */
export function coerceObject(a, owners) {
  return objectMemory(resolveParameter(a, owners), owners);
}

function objectMemory(a, owners) {
  if (a === null || typeof a !== "object") return a;
  retainArgument(owners, a);
  const b = a._buffer;
  if (b !== undefined) {
    retainArgument(owners, b);
    // Puntatore creato da indirizzo (fromAddress): senza Buffer va passato
    // l'indirizzo, altrimenti al C arriverebbe NULL.
    if (b === null && a._pointerType !== undefined) return a.address;
    if (mirrorsActive) return mirrorAddress(b) ?? b;
    return b;
  }
  const parameter = a._as_parameter_;
  if (parameter !== undefined) {
    retainArgument(owners, parameter);
    return parameter;
  }
  if (mirrorsActive) return mirrorAddress(a) ?? a;
  return a;
}

// Struct/union passato per valore: il nativo copia i byte del Buffer, che per
// una copia di memoria nativa vanno prima riletti.
function coerceStructValue(a, owners) {
  if (a !== null && typeof a === "object") {
    retainArgument(owners, a);
    const b = Buffer.isBuffer(a._buffer) ? a._buffer : a;
    if (Buffer.isBuffer(b)) {
      retainArgument(owners, b);
      refresh(b);
      return b;
    }
  }
  return coerceObject(a, owners);
}

const isStructType = (t) => t !== null && (typeof t === "function" || typeof t === "object") && (typeof t._buildStruct === "function" || typeof t._buildUnion === "function" || t._isStructType === true);

/**
 * Converter for a struct/union passed by value. A plain object (fields by
 * name, a node-ctypes extension) uses the type's field writers. Simple
 * functional structs omit the transient Proxy; other types still construct
 * an instance so custom constructors and complex layouts keep their behavior.
 * An array is rejected, as a Python tuple.
 */
function structArgument(T, index) {
  const instance = typeof T === "function" ? (values) => new T(values) : (structArgumentFactories.get(T) ?? ((values) => T.create(values)));
  const coerce = mirrorsActive ? coerceStructValue : coerceObject;
  return (a, owners) => {
    a = resolveArgument(a, owners, index);
    retainArgument(owners, a);
    if (Array.isArray(a)) {
      // Python rifiuta anche una tupla.
      throw new ArgumentError(`argument ${index + 1}: TypeError: expected ${T.name || "structure"} instance instead of Array`);
    }
    if (a !== null && typeof a === "object" && a._buffer === undefined && a._as_parameter_ === undefined && !ArrayBuffer.isView(a) && !(a instanceof ArrayBuffer)) {
      return coerce(instance(a), owners);
    }
    return coerce(a, owners);
  };
}

/**
 * Python default conversion (no argtypes, variadic arguments): a SimpleCData
 * instance is passed by value (`abs(c_int(-5))`), other objects as
 * {@link coerceObject}.
 */
export function coerceValue(a, owners) {
  if (a === null || (typeof a !== "object" && typeof a !== "function")) return a;
  retainArgument(owners, a);
  if (a._isSimpleCDataInstance === true) return a.value;
  return coerceObject(a, owners);
}

/**
 * Conversion of an argument beyond `argtypes` (variadic, or without
 * argtypes): a SimpleCData instance is passed as is, and the native call uses
 * its type, as Python does (`printf("%f", c_double(2.0))`).
 */
export function coerceVariadic(a, owners) {
  a = resolveParameter(a, owners);
  retainArgument(owners, a);
  if (a !== null && typeof a === "object" && a._isSimpleCDataInstance === true) return a;
  return coerceObject(a, owners);
}

/**
 * Argument converters for `argtypes`, one per position. A SimpleCData instance
 * passed to a simple-type parameter is its value; to a pointer-like parameter
 * (c_void_p, c_char_p, c_wchar_p) only when it is of that type, otherwise its
 * address is passed.
 *
 * @param {Array} argTypes - Declared argument types
 * @param {Object} native - Native module (for CType)
 * @returns {Function[]} One converter per declared argument
 */
export function argumentConverters(argTypes, native) {
  const pointerKinds = new Set([native.CType.POINTER, native.CType.STRING, native.CType.WSTRING]);
  const baseConverter = (t, index) => {
    if (isStructType(t)) return structArgument(t, index);
    if (t !== null && (typeof t === "function" || typeof t === "object") && t._isArrayType === true) return arrayArgument(t, index);
    if (t !== null && typeof t === "object" && t._pointerTo !== undefined) return pointerArgument(t, index, native);
    if (typeof t !== "function" || t._isSimpleCData !== true) return coerceObject;
    if (!pointerKinds.has(t._type)) return scalarArgument(t, index);
    return (a, owners) => {
      a = resolveArgument(a, owners, index);
      if (a === null || typeof a !== "object") return a;
      retainArgument(owners, a);
      if (a._isSimpleCDataInstance === true && a instanceof t) return a.value;
      return coerceObject(a, owners);
    };
  };
  return argTypes.map((t, index) => {
    const base = baseConverter(t, index);
    if (t === null || (typeof t !== "function" && typeof t !== "object") || typeof t.from_param !== "function") return base;
    return fromParamArgument(t, base, index);
  });
}

function scalarArgument(T, index) {
  const boolean = T._isBoolean === true;
  return (value, owners) => {
    if (value !== null && (typeof value === "object" || typeof value === "function")) value = resolveArgument(value, owners, index);
    if (value === null || typeof value !== "object") return value;
    retainArgument(owners, value);
    if (value._isSimpleCDataInstance === true) {
      if (!boolean && !(value instanceof T)) {
        throw new ArgumentError(`argument ${index + 1}: TypeError: incompatible types, ${value.constructor.name} instance instead of ${T.name} instance`);
      }
      return value.value;
    }
    return objectMemory(value, owners);
  };
}

function resolveArgument(value, owners, index) {
  try {
    return resolveParameter(value, owners);
  } catch (error) {
    throw new ArgumentError(`argument ${index + 1}: ${error?.name ?? "Error"}: ${error?.message ?? String(error)}`, { cause: error });
  }
}

const compatibleType = (actual, expected) => actual === expected || (typeof actual === "function" && typeof expected === "function" && actual.prototype instanceof expected);

function pointerArgument(T, index, native) {
  const base = T._pointerTo;
  const fail = () => {
    throw new ArgumentError(`argument ${index + 1}: TypeError: incompatible pointer, expected POINTER(${base.name ?? "type"})`);
  };
  const convert = (value, owners) => {
    value = resolveArgument(value, owners, index);
    if (value === null || value === undefined || typeof value === "bigint") return value;
    if (typeof value === "number") {
      if (!Number.isInteger(value)) fail();
      return value;
    }
    if (typeof value === "string" && base._charKind === "char") return value;
    if (typeof value === "string" && base._charKind === "wchar") {
      const buffer = Buffer.concat([encodeWide(value, native.WCHAR_SIZE), Buffer.alloc(native.WCHAR_SIZE)]);
      retainArgument(owners, buffer);
      return buffer;
    }
    if (typeof base === "function" && value instanceof base) return objectMemory(value, owners);
    const reference = value !== null && (typeof value === "object" || typeof value === "function") ? byrefOwners.get(value) : undefined;
    if (reference !== undefined) {
      if (reference.type !== undefined && !compatibleType(reference.type, base)) fail();
      return objectMemory(value, owners);
    }
    if (value?._pointerType !== undefined) {
      if (!compatibleType(value._pointerType._pointerTo, base)) fail();
      return objectMemory(value, owners);
    }
    if (value?._arrayType !== undefined) {
      if ((!compatibleType(value._arrayType, base) && !compatibleType(value._arrayType.elementType, base)) || value._arrayType._swapped_) fail();
      return coerceObject(value, owners);
    }
    if (value?._isSimpleCDataInstance === true || value?._structDef !== undefined) {
      if (typeof base === "function" && value instanceof base) return objectMemory(value, owners);
      const kind = value.constructor?._type;
      if ((base._charKind === "char" && kind === native.CType.STRING) || (base._charKind === "wchar" && kind === native.CType.WSTRING)) {
        if (mirrorsActive) refresh(value._buffer);
        return native.POINTER_SIZE === 8 ? value._buffer.readBigUInt64LE(0) : BigInt(value._buffer.readUInt32LE(0));
      }
      fail();
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || Buffer.isBuffer(value?._buffer)) return objectMemory(value, owners);
    fail();
  };
  if (base._charKind === "wchar") Object.defineProperty(convert, "requiresOwners", { value: true });
  return convert;
}

/**
 * Converter for an argtype with a `from_param` method (Python protocol): it
 * receives the argument as passed, its result (or the result's
 * `_as_parameter_`) is converted as the declared type. Its errors become
 * ArgumentError "argument N: <name>: <message>", as in Python.
 */
function fromParamArgument(T, base, index) {
  const converter = (a, owners) => {
    retainArgument(owners, a);
    let converted;
    try {
      converted = T.from_param(a);
    } catch (e) {
      if (e instanceof ArgumentError) throw e;
      throw new ArgumentError(`argument ${index + 1}: ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`, { cause: e });
    }
    retainArgument(owners, converted);
    return base(converted, owners);
  };
  Object.defineProperty(converter, "requiresOwners", { value: true });
  return converter;
}

const arrayTypeName = (T) => `${T.elementType?.name || "array"} * ${T.length}`;

function describeValue(a) {
  if (a === null) return "null";
  if (typeof a !== "object") return typeof a;
  if (a._arrayType !== undefined) return arrayTypeName(a._arrayType);
  return a.constructor?.name ?? "object";
}

/**
 * Converter for an array parameter (`argtypes = [c_int * 4]`): the array is
 * passed by address, as in C and Python. As Python, only instances of the
 * same array type (element type and length) are accepted; Buffers and typed
 * arrays are also accepted as memory.
 *
 * @param {Function} T - Array type
 * @param {number} index - Parameter position (for the error message)
 * @returns {Function} Converter
 */
function arrayArgument(T, index) {
  return (a, owners) => {
    a = resolveArgument(a, owners, index);
    retainArgument(owners, a);
    if (a !== null && typeof a === "object") {
      const arrayType = a._arrayType;
      if (arrayType !== undefined) {
        if (arrayType === T || (arrayType.elementType === T.elementType && arrayType.length === T.length)) return coerceObject(a, owners);
      } else if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
        return coerceObject(a, owners);
      } else if (a._as_parameter_ !== undefined) {
        const parameter = a._as_parameter_;
        retainArgument(owners, parameter);
        return parameter;
      }
    }
    throw new ArgumentError(`argument ${index + 1}: TypeError: expected ${arrayTypeName(T)} instance instead of ${describeValue(a)}`);
  };
}

/**
 * Convert all call arguments: declared ones with their converter, the rest
 * (variadic or without argtypes) with the Python default conversion.
 */
export function convertArguments(args, converters, owners) {
  const n = args.length;
  const declared = converters.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = i < declared ? converters[i](args[i], owners) : coerceVariadic(args[i], owners);
  }
  return out;
}

function copyResultBytes(result) {
  const bytes = Buffer.alloc(result.length);
  bytes.set(result);
  return bytes;
}

/**
 * Python restype conversion done in JS: `POINTER(T)` returns a pointer object
 * (`null` for NULL), a CFUNCTYPE type returns a callable. Undefined when the
 * native result is already final.
 *
 * @param {*} restype - Declared return type
 * @returns {Function|undefined} Converter from the native result
 */
export function resultConverter(restype) {
  if (isScalarSubclass(restype)) return (bytes) => scalarView(restype, bytes);
  if (restype?._isVariantBool === true) return (result) => result !== 0;
  if (restype !== null && typeof restype === "object" && restype._pointerTo !== undefined) {
    return (r) => (r === null || r === 0n ? null : restype.fromAddress(r));
  }
  if (typeof restype === "function" && restype._isFuncPtr === true) {
    return (r) => (r === null || r === 0n ? null : restype(r));
  }
  // Snapshot before constructors/readers can reenter: toObject may keep
  // array views or union getters over the native function's reusable buffer.
  if (typeof restype === "function" && typeof restype._buildStruct === "function") {
    return (r) => new restype(copyResultBytes(r));
  }
  if (restype !== null && typeof restype === "object" && restype._isStructType === true) {
    return (r) => restype.toObject(copyResultBytes(r));
  }
  return undefined;
}

export function scalarResult(restype) {
  return isScalarSubclass(restype);
}

export function resultCheck(restype, name, loader = "FFI") {
  const check = restype?._check_retval_;
  if (check !== undefined && typeof check !== "function") throw new TypeError("_check_retval_ must be callable");
  const hresult = restype?._isHResult === true;
  if (!hresult && check === undefined) return undefined;
  return (result) => {
    if (hresult) {
      const value = result?._isSimpleCDataInstance === true ? result.value : result;
      const number = typeof value === "bigint" ? Number(value) : value;
      if (typeof number === "number" && number < 0) {
        const hex = (number >>> 0).toString(16).padStart(8, "0").toUpperCase();
        const error = new Error(`${loader} '${name}' failed with HRESULT 0x${hex}`);
        error.hresult = number;
        error.winerror = number >>> 0;
        throw error;
      }
    }
    return check === undefined ? result : check.call(restype, result);
  };
}

/**
 * True when `restype` is a struct or union returned by value: the native
 * function must then return its bytes (FFIFunction option `struct_buffer`),
 * which {@link resultConverter} turns into the result.
 *
 * @param {*} restype - Declared return type
 * @returns {boolean}
 */
export function structResult(restype) {
  return (typeof restype === "function" && typeof restype._buildStruct === "function") || (restype !== null && typeof restype === "object" && restype._isStructType === true);
}

/**
 * Adapt a JS function used as a C callback to Python semantics: arguments
 * declared `POINTER(T)` are passed as pointer objects (`null` for NULL), and an
 * object returned by the function (pointer, SimpleCData instance, ...) is
 * converted like an argument.
 *
 * @param {Function} fn - JS callback
 * @param {Array} argTypes - Declared argument types
 * @returns {Function} Function to register with the native callback
 */
export function adaptCallbackFunction(fn, argTypes, returnType, native) {
  const scalarTypes = argTypes.map((type) => (isScalarSubclass(type) ? type : null));
  const hasScalars = scalarTypes.some((type) => type !== null);
  const pointerTypes = argTypes.map((t) => (t !== null && typeof t === "object" && t._pointerTo !== undefined ? t : null));
  const hasPointers = pointerTypes.some((t) => t !== null);
  // Struct/union per valore: il nativo passa una copia in un Buffer.
  const structViews = argTypes.map(structView);
  const hasStructs = structViews.some((view) => view !== null);
  const variantArgs = argTypes.map((type) => type?._isVariantBool === true);
  const hasVariants = variantArgs.some(Boolean);
  const variantResult = returnType?._isVariantBool === true;
  const toResult = stringResult(returnType, native);
  const convertResult = (result) => {
    if (variantResult) return returnType.from_param(result);
    if (toResult !== undefined && typeof result === "string") return toResult(result);
    return result !== null && (typeof result === "object" || typeof result === "function") ? coerceValue(result) : result;
  };
  if (!hasScalars && !hasVariants && !hasPointers && !hasStructs) {
    return function (...args) {
      return convertResult(fn.apply(this, args));
    };
  }
  return function (...args) {
    if (hasScalars) {
      for (let i = 0; i < scalarTypes.length; i++) {
        if (scalarTypes[i] !== null) args[i] = scalarView(scalarTypes[i], args[i]);
      }
    }
    if (hasVariants) {
      for (let i = 0; i < variantArgs.length; i++) {
        if (variantArgs[i] && scalarTypes[i] === null) args[i] = args[i] !== 0;
      }
    }
    if (hasPointers) {
      for (let i = 0; i < pointerTypes.length; i++) {
        const T = pointerTypes[i];
        if (T !== null && args[i] !== null) {
          args[i] = T.fromAddress(args[i]);
        }
      }
    }
    if (hasStructs) {
      for (let i = 0; i < structViews.length; i++) {
        if (structViews[i] !== null) args[i] = structViews[i](args[i]);
      }
    }
    return convertResult(fn.apply(this, args));
  };
}

/**
 * View of a struct/union argument of a callback (Buffer with a copy of the
 * C value): an instance of the class, or of the struct()/union() definition.
 *
 * @returns {Function|null} Converter, null for other argument types
 */
function structView(type) {
  if (typeof type === "function" && typeof type._buildStruct === "function") return (buf) => new type(buf);
  if (type !== null && typeof type === "object" && type._isStructType === true) {
    return (buf) => new Proxy(buf, buildWrapper(type, { instanceTag: "StructInstance", exposeAnonymous: true }));
  }
  return null;
}

/**
 * Result of a callback whose restype is c_char_p / c_wchar_p and that returns
 * a JS string: a NUL-terminated buffer, kept alive as long as the callback
 * (Python keeps it forever, with "RuntimeWarning: memory leak in callback
 * function"). Buffers are cached by value, so a callback that returns the
 * same strings does not accumulate memory.
 *
 * @returns {Function|undefined} Converter, undefined for other restypes
 */
function stringResult(returnType, native) {
  if (native === undefined || typeof returnType !== "function" || returnType._isSimpleCData !== true) return undefined;
  const wide = returnType._type === native.CType.WSTRING;
  if (!wide && returnType._type !== native.CType.STRING) return undefined;
  const kept = new Map();
  return (value) => {
    let buf = kept.get(value);
    if (buf === undefined) {
      buf = wide ? Buffer.concat([encodeWide(value, native.WCHAR_SIZE), Buffer.alloc(native.WCHAR_SIZE)]) : Buffer.from(`${value}\0`, "utf8");
      kept.set(value, buf);
    }
    return buf;
  };
}
