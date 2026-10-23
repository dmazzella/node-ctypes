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

/**
 * Base conversion of an object argument:
 * - struct/union/array instance or Buffer view → its Buffer (by reference)
 * - pointer created from an address → the address
 * - object with `_as_parameter_` (callbacks, adapters) → that value
 * - copy of native memory (no external buffers, memory/mirror.js) → the
 *   original address
 * - anything else unchanged
 */
export function coerceObject(a) {
  if (a === null || typeof a !== "object") return a;
  const b = a._buffer;
  if (b !== undefined) {
    // Puntatore creato da indirizzo (fromAddress): senza Buffer va passato
    // l'indirizzo, altrimenti al C arriverebbe NULL.
    if (b === null && a._pointerType !== undefined) return a.address;
    if (mirrorsActive) return mirrorAddress(b) ?? b;
    return b;
  }
  if (a._as_parameter_ !== undefined) return a._as_parameter_;
  if (mirrorsActive) return mirrorAddress(a) ?? a;
  return a;
}

// Struct/union passato per valore: il nativo copia i byte del Buffer, che per
// una copia di memoria nativa vanno prima riletti.
function coerceStructValue(a) {
  if (a !== null && typeof a === "object") {
    const b = Buffer.isBuffer(a._buffer) ? a._buffer : a;
    if (Buffer.isBuffer(b)) {
      refresh(b);
      return b;
    }
  }
  return coerceObject(a);
}

const isStructType = (t) => t !== null && (typeof t === "function" || typeof t === "object") && (typeof t._buildStruct === "function" || typeof t._buildUnion === "function" || t._isStructType === true);

/**
 * Converter for a struct/union passed by value. A plain object (fields by
 * name, a node-ctypes extension) becomes an instance of the type first, so
 * bit fields and fields of `_pack_` layouts (which the native description
 * holds as bytes) get their values. An array is rejected, as a Python tuple.
 */
function structArgument(T, index) {
  const instance = typeof T === "function" ? (values) => new T(values) : (values) => T.create(values);
  const coerce = mirrorsActive ? coerceStructValue : coerceObject;
  return (a) => {
    if (Array.isArray(a)) {
      // Python rifiuta anche una tupla.
      throw new ArgumentError(`argument ${index + 1}: TypeError: expected ${T.name || "structure"} instance instead of Array`);
    }
    if (a !== null && typeof a === "object" && a._buffer === undefined && a._as_parameter_ === undefined && !ArrayBuffer.isView(a) && !(a instanceof ArrayBuffer)) {
      return coerce(instance(a));
    }
    return coerce(a);
  };
}

/**
 * Python default conversion (no argtypes, variadic arguments): a SimpleCData
 * instance is passed by value (`abs(c_int(-5))`), other objects as
 * {@link coerceObject}.
 */
export function coerceValue(a) {
  if (a === null || typeof a !== "object") return a;
  if (a._isSimpleCDataInstance === true) return a.value;
  return coerceObject(a);
}

/**
 * Conversion of an argument beyond `argtypes` (variadic, or without
 * argtypes): a SimpleCData instance is passed as is, and the native call uses
 * its type, as Python does (`printf("%f", c_double(2.0))`).
 */
export function coerceVariadic(a) {
  if (a !== null && typeof a === "object" && a._isSimpleCDataInstance === true) return a;
  return coerceObject(a);
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
    if (typeof t !== "function" || t._isSimpleCData !== true) return coerceObject;
    if (!pointerKinds.has(t._type)) return coerceValue;
    return (a) => {
      if (a === null || typeof a !== "object") return a;
      if (a._isSimpleCDataInstance === true && a instanceof t) return a.value;
      return coerceObject(a);
    };
  };
  return argTypes.map((t, index) => {
    const base = baseConverter(t, index);
    if (t === null || (typeof t !== "function" && typeof t !== "object") || typeof t.from_param !== "function") return base;
    return fromParamArgument(t, base, index);
  });
}

/**
 * Converter for an argtype with a `from_param` method (Python protocol): it
 * receives the argument as passed, its result (or the result's
 * `_as_parameter_`) is converted as the declared type. Its errors become
 * ArgumentError "argument N: <name>: <message>", as in Python.
 */
function fromParamArgument(T, base, index) {
  return (a) => {
    let converted;
    try {
      converted = T.from_param(a);
    } catch (e) {
      if (e instanceof ArgumentError) throw e;
      throw new ArgumentError(`argument ${index + 1}: ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`, { cause: e });
    }
    return base(converted);
  };
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
  return (a) => {
    if (a !== null && typeof a === "object") {
      const arrayType = a._arrayType;
      if (arrayType !== undefined) {
        if (arrayType === T || (arrayType.elementType === T.elementType && arrayType.length === T.length)) return coerceObject(a);
      } else if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
        return coerceObject(a);
      } else if (a._as_parameter_ !== undefined) {
        return a._as_parameter_;
      }
    }
    throw new ArgumentError(`argument ${index + 1}: TypeError: expected ${arrayTypeName(T)} instance instead of ${describeValue(a)}`);
  };
}

/**
 * Convert all call arguments: declared ones with their converter, the rest
 * (variadic or without argtypes) with the Python default conversion.
 */
export function convertArguments(args, converters) {
  const n = args.length;
  const declared = converters.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = i < declared ? converters[i](args[i]) : coerceVariadic(args[i]);
  }
  return out;
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
  if (restype !== null && typeof restype === "object" && restype._pointerTo !== undefined) {
    return (r) => (r === null || r === 0n ? null : restype.fromAddress(r));
  }
  if (typeof restype === "function" && restype._isFuncPtr === true) {
    return (r) => (r === null || r === 0n ? null : restype(r));
  }
  // Struct/union per valore: il nativo restituisce i byte (opzione
  // `struct_buffer`, vedi structResult) in un Buffer riusato dalla funzione
  // a ogni chiamata, copiato qui nella memoria dell'istanza. Python:
  // un'istanza della classe.
  if (typeof restype === "function" && typeof restype._buildStruct === "function") {
    return (r) => {
      const bytes = Buffer.alloc(r.length);
      bytes.set(r);
      return new restype(bytes);
    };
  }
  if (restype !== null && typeof restype === "object" && restype._isStructType === true) {
    return (r) => restype.toObject(r);
  }
  return undefined;
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
  const pointerTypes = argTypes.map((t) => (t !== null && typeof t === "object" && t._pointerTo !== undefined ? t : null));
  const hasPointers = pointerTypes.some((t) => t !== null);
  // Struct/union per valore: il nativo passa una copia in un Buffer.
  const structViews = argTypes.map(structView);
  const hasStructs = structViews.some((view) => view !== null);
  const toResult = stringResult(returnType, native);
  return function (...args) {
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
    const result = fn.apply(this, args);
    if (toResult !== undefined && typeof result === "string") return toResult(result);
    return result !== null && typeof result === "object" ? coerceValue(result) : result;
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
