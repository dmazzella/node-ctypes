/**
 * @file conversions.js
 * @module core/conversions
 * @description Convert outgoing JS arguments according to their declared ctypes types.
 */

import { isMirror, mirrorAddress, mirrorsActive, refresh } from "../memory/mirror.js";
import { ArgumentError } from "../platform/errors.js";
import { encodeWide } from "../memory/buffer.js";
import { requireDescriptor } from "./types.js";
import { byrefOwners, resolveParameter } from "./parameters.js";
import { snapshotArgumentBytes } from "../memory/ownership.js";
import { structArgumentFactories } from "../structures/protocol.js";
import { scalarArgumentKind, scalarArgumentSnapshot, scalarArgumentValue, scalarInstanceInfo } from "../types/scalar-protocol.js";

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

// By-value arguments need the view, not the native address of its mirror.
function coerceStructValue(a, owners) {
  if (a !== null && typeof a === "object") {
    retainArgument(owners, a);
    const b = a._buffer ?? a;
    if (ArrayBuffer.isView(b)) {
      retainArgument(owners, b);
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
function structArgument(T, index, pointerSize) {
  const declaredClass = typeof T === "function" ? T : undefined;
  const factory = typeof T === "function" ? undefined : structArgumentFactories.get(T);
  const instance = typeof T === "function" ? (values) => new T(values) : (values) => T.create(values);
  const memory = mirrorsActive ? coerceStructValue : coerceObject;
  const coerce = (value, owners) => {
    const bytes = memory(value, owners);
    const def = T._structDef ?? T._unionDef ?? T;
    const size = def.size;
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength < size) return bytes; // Validated by the addon.
    // CPython's StructUnionType_paramfunc copies only above sizeof(void*).
    if (size > pointerSize) {
      const copy = snapshotArgumentBytes(bytes, def);
      retainArgument(owners, copy);
      return copy;
    }
    if (mirrorsActive && isMirror(bytes)) {
      // Another alias can write native memory during a later from_param.
      // Read it when the addon marshals the argument, not during JS conversion.
      return {
        get _buffer() {
          refresh(bytes, 0, size);
          return bytes;
        },
      };
    }
    return bytes;
  };
  const build = factory === undefined ? (values, owners) => coerce(instance(values), owners) : (values, owners) => factory(values, coerce, owners);
  const convert = (a, owners, adapted = false) => {
    // A plain object of field values, the common case, skips the generic
    // parameter probes: only `_as_parameter_` and `_buffer` change its meaning.
    // Their presence is tested without reading them, so an adapter getter runs
    // once, in resolveArgument, with its errors normalized there.
    if (a !== null && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype && !("_as_parameter_" in a) && !("_buffer" in a)) {
      retainArgument(owners, a);
      return build(a, owners);
    }
    a = resolveArgument(a, owners, index, adapted ? undefined : declaredClass);
    retainArgument(owners, a);
    if (Array.isArray(a)) {
      // Python rifiuta anche una tupla.
      throw new ArgumentError(`argument ${index + 1}: TypeError: expected ${T.name || "structure"} instance instead of Array`);
    }
    if (a !== null && typeof a === "object" && a._buffer === undefined && a._as_parameter_ === undefined && !ArrayBuffer.isView(a) && !(a instanceof ArrayBuffer)) {
      return build(a, owners);
    }
    return coerce(a, owners);
  };
  // A plain object of field values becomes a fresh Buffer passed directly to
  // the call, so nothing else needs to stay reachable.
  convert.needsOwners = (a) => needsArgumentOwners(a) && !(Object.getPrototypeOf(a) === Object.prototype && !("_buffer" in a) && !("_as_parameter_" in a));
  // A user from_param has already accepted the argument; marshal its result.
  if (declaredClass !== undefined) Object.defineProperty(convert, "marshalAdapted", { value: (a, owners) => convert(a, owners, true) });
  return convert;
}

/**
 * Conversion of an argument beyond `argtypes` (variadic, or without
 * argtypes): a numeric SimpleCData instance keeps its type and snapshots its
 * value before the next conversion (`printf("%f", c_double(2.0))`).
 */
export function coerceVariadic(a, owners) {
  if (a === null || (typeof a !== "object" && typeof a !== "function")) return a;
  const info = scalarInstanceInfo(a);
  if (info !== undefined) {
    retainArgument(owners, a);
    return scalarArgumentSnapshot(a, info);
  }
  a = resolveParameter(a, owners);
  retainArgument(owners, a);
  if (a !== null && typeof a === "object" && a._isSimpleCDataInstance === true) return scalarArgumentSnapshot(a);
  return coerceObject(a, owners);
}

function declaredArgument(t, index, native) {
  if (isStructType(t)) return structArgument(t, index, native.POINTER_SIZE);
  if (t !== null && (typeof t === "function" || typeof t === "object") && t._isArrayType === true) return arrayArgument(t, index);
  if (t !== null && typeof t === "object" && t._pointerTo !== undefined) return pointerArgument(t, index, native);
  const kind = typeof t === "function" ? t._type : t;
  if (kind === native.CType.STRING || kind === native.CType.WSTRING) return stringArgument(t, kind, index, native);
  if (kind === native.CType.POINTER) return voidPointerArgument(index, native);
  if (typeof t === "function" && t._isSimpleCData === true) return scalarArgument(t, kind, index, native);
  // A scalar CType number as argtype: the same conversion order.
  const check = typeof kind === "number" ? scalarCheck(kind, index, native) : undefined;
  return check === undefined ? coerceObject : (a, owners) => check(coerceObject(a, owners));
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
  return argTypes.map((t, index) => {
    const base = declaredArgument(t, index, native);
    if (t === null || (typeof t !== "function" && typeof t !== "object")) return base;
    const fromParam = t.from_param;
    if (fromParam === undefined) {
      if (typeof t === "object" && base === coerceObject) requireDescriptor(t, native, index);
      return base;
    }
    return fromParamArgument(t, base.marshalAdapted ?? base, index, fromParam);
  });
}

function readPointerBits(size, buffer) {
  return size === 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

function pointerValue(value, native) {
  const buffer = value._buffer;
  if (mirrorsActive) refresh(buffer);
  return readPointerBits(native.POINTER_SIZE, buffer);
}

function voidPointerArgument(index, native) {
  return (value, owners) => {
    value = resolveArgument(value, owners, index);
    if (typeof value === "number" && !Number.isInteger(value)) {
      throw new ArgumentError(`argument ${index + 1}: TypeError: 'float' object cannot be interpreted as ctypes.c_void_p`);
    }
    if (value?._isSimpleCDataInstance === true && value.constructor._isPointerValued === true) {
      retainArgument(owners, value);
      return pointerValue(value, native);
    }
    return objectMemory(value, owners);
  };
}

function stringArgument(T, kind, index, native) {
  const wide = kind === native.CType.WSTRING;
  const charKind = wide ? "wchar" : "char";
  const typeName = wide ? "c_wchar_p" : "c_char_p";
  const fail = (value) => {
    const name =
      typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value)) ? "int" : typeof value === "number" ? "float" : typeof value === "boolean" ? "bool" : value?.constructor?.name === "Object" ? "object" : typeof value;
    throw new ArgumentError(`argument ${index + 1}: TypeError: '${name}' object cannot be interpreted as ctypes.${typeName}`);
  };
  const convert = (value, owners) => {
    value = resolveArgument(value, owners, index);
    if (value === null || value === undefined || typeof value === "string") return value;
    retainArgument(owners, value);
    if (value?._isSimpleCDataInstance === true) {
      if (typeof T === "function" ? !(value instanceof T) : value.constructor._type !== kind) fail(value);
      return pointerValue(value, native);
    }
    const element = value?._pointerType?._pointerTo ?? value?._arrayType?.elementType;
    if (element !== undefined) {
      if (element._charKind !== charKind) fail(value);
      return objectMemory(value, owners);
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return objectMemory(value, owners);
    fail(value);
  };
  // A custom from_param result is already adapted and may be a c_void_p.
  Object.defineProperty(convert, "marshalAdapted", {
    value: (value, owners) => {
      value = resolveArgument(value, owners, index);
      if (value?._isSimpleCDataInstance === true) {
        retainArgument(owners, value);
        return value.constructor._isPointerValued === true ? pointerValue(value, native) : value.value;
      }
      return objectMemory(value, owners);
    },
  });
  // c_char_p: strings, null and undefined are returned unchanged (the native
  // entry function converts them itself, see Library._createFunction).
  if (!wide) Object.defineProperty(convert, "passesStrings", { value: true });
  return convert;
}

// The largest BigInt magnitude a float or double argument accepts here: the
// native conversion raises RangeError from 2 ** 1024.
const maxFloatBigInt = 2n ** 1023n;

/**
 * Conversion of a scalar argument as the native call does it, before the next
 * argument is converted (CPython: from_param, then the C conversion, argument
 * by argument). Values the call accepts as they are pass unchanged: integral
 * numbers, booleans and BigInts for the integer kinds (any integral Number is
 * reduced to the type's bits), numbers, booleans and BigInts up to 2 ** 1023
 * for float and double, a character below 256 or an integer in range(256) for
 * c_char, one UTF-16 unit (not a surrogate) for c_wchar, anything for bool.
 * Other values go to the native conversion itself (`checkArgument`): its
 * rules and ArgumentError messages are those of the call, and it returns the
 * converted C value, so code running afterwards (a later adapter changing a
 * Buffer passed to c_char) cannot change it; memory passed by address stays
 * the original value.
 *
 * @returns {Function|undefined} `(value) => value`, undefined for other kinds
 */
function scalarCheck(kind, index, native) {
  const C = native.CType;
  let plain;
  switch (kind) {
    case C.BOOL:
      // ToBoolean, which runs no JavaScript and cannot change later.
      return (value) => value;
    case C.FLOAT:
    case C.DOUBLE:
      plain = (value) => typeof value === "number" || typeof value === "boolean" || (typeof value === "bigint" && value >= -maxFloatBigInt && value <= maxFloatBigInt);
      break;
    case C.INT8:
    case C.UINT8:
    case C.INT16:
    case C.UINT16:
    case C.INT32:
    case C.UINT32:
    case C.INT64:
    case C.UINT64:
    case C.LONG:
    case C.ULONG:
    case C.SIZE_T:
    case C.SSIZE_T:
      plain = (value) => (typeof value === "number" && Number.isInteger(value)) || typeof value === "boolean" || typeof value === "bigint";
      break;
    case C.CHAR:
      plain = (value) => (typeof value === "string" && value.length === 1 && value.charCodeAt(0) < 256) || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) || typeof value === "boolean";
      break;
    case C.WCHAR:
      plain = (value) => {
        if (typeof value !== "string" || value.length !== 1) return false;
        const unit = value.charCodeAt(0);
        return unit < 0xd800 || unit > 0xdfff;
      };
      break;
    default:
      return undefined;
  }
  return (value) => (plain(value) ? value : native.checkArgument(index, kind, value));
}

function scalarArgument(T, kind, index, native) {
  const boolean = T._isBoolean === true;
  // As CPython (from_param, then the C conversion, argument by argument), a
  // value the call would reject fails here, before the converters of the later
  // arguments can run user code (adapters, getters).
  const checked = scalarCheck(kind, index, native) ?? ((value) => value);
  const stored = (value, info, owners, adapted) => {
    retainArgument(owners, value);
    if (!boolean && info.type !== T && !(value instanceof T) && !(adapted && info.kind === kind)) {
      throw new ArgumentError(`argument ${index + 1}: TypeError: incompatible types, ${info.type.name} instance instead of ${T.name} instance`);
    }
    return scalarArgumentValue(value, info);
  };
  const make = (adapted) => (value, owners) => {
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
      const info = scalarInstanceInfo(value);
      if (info !== undefined) return stored(value, info, owners, adapted);
      value = resolveArgument(value, owners, index);
    }
    if (value === null || typeof value !== "object") return checked(value);
    const info = scalarInstanceInfo(value);
    if (info !== undefined) return stored(value, info, owners, adapted);
    retainArgument(owners, value);
    if (value._isSimpleCDataInstance === true) {
      if (!boolean && !(value instanceof T) && !(adapted && scalarArgumentKind(value) === kind)) {
        throw new ArgumentError(`argument ${index + 1}: TypeError: incompatible types, ${value.constructor.name} instance instead of ${T.name} instance`);
      }
      return scalarArgumentValue(value);
    }
    return checked(objectMemory(value, owners));
  };
  const convert = make(false);
  Object.defineProperty(convert, "marshalAdapted", { value: make(true) });
  // A valid primitive value (not an object or a function) is returned unchanged.
  Object.defineProperty(convert, "passesPrimitives", { value: true });
  return convert;
}

function resolveArgument(value, owners, index, expectedStruct) {
  try {
    return resolveParameter(value, owners, expectedStruct);
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
    const argument = value;
    value = resolveArgument(value, owners, index);
    const direct = value === argument;
    // CPython's implicit byref, array decay and NULL conversions apply only to the original argument.
    if (!direct && value === null) fail();
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
    if (typeof base === "function" && value instanceof base) {
      if (!direct) fail();
      return objectMemory(value, owners);
    }
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
      if (!direct) fail();
      if ((!compatibleType(value._arrayType, base) && !compatibleType(value._arrayType.elementType, base)) || value._arrayType._swapped_) fail();
      return coerceObject(value, owners);
    }
    if (value?._isSimpleCDataInstance === true || value?._structDef !== undefined) {
      if (typeof base === "function" && value instanceof base) return objectMemory(value, owners);
      const kind = value.constructor?._type;
      if ((base._charKind === "char" && kind === native.CType.STRING) || (base._charKind === "wchar" && kind === native.CType.WSTRING)) {
        // Unlike pointerValue, this path reads _buffer again after refreshing a mirror. A getter can observe both reads.
        if (mirrorsActive) refresh(value._buffer);
        return readPointerBits(native.POINTER_SIZE, value._buffer);
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
function fromParamArgument(T, base, index, fromParam) {
  const converter = (a, owners) => {
    retainArgument(owners, a);
    let converted;
    try {
      converted = Reflect.apply(fromParam, T, [a]);
    } catch (e) {
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
  // The arity first, as the native call (and CPython) report it before any
  // argument conversion error.
  if (n < declared) throw new TypeError(`Expected ${declared} arguments, got ${n}`);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = i < declared ? converters[i](args[i], owners) : coerceVariadic(args[i], owners);
  }
  return out;
}
