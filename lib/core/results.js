/** Result representation and checks captured from a declared restype. */
import { kFromBytes } from "../structures/Structure.js";
import { structResultReaders } from "../structures/protocol.js";
import { isScalarSubclass, scalarView } from "../types/scalar-protocol.js";
import { requireDescriptor } from "./types.js";

const reflectApply = Reflect.apply;

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
 * @param {Object} native - Native descriptor classes
 * @returns {Function|undefined} Converter `(result, owned = false)`; async
 * completion owns its struct buffer, while a sync call may reuse it.
 */
export function resultConverter(restype, native) {
  if (isScalarSubclass(restype)) return (bytes) => scalarView(restype, bytes);
  if (restype?._isVariantBool === true) return (result) => result !== 0;
  if (restype !== null && typeof restype === "object" && restype._pointerTo !== undefined) {
    return (r) => (r === null || r === 0n ? null : restype.fromAddress(r));
  }
  if (typeof restype === "function" && restype._isFuncPtr === true) {
    return (r) => (r === null || r === 0n ? null : restype(r));
  }
  if (typeof restype === "function" && typeof restype._buildStruct === "function") {
    // Materialize the C value without running subclass initializers.
    const materialize = restype[kFromBytes].bind(restype);
    return (bytes, owned = false) => materialize(owned ? bytes : copyResultBytes(bytes));
  }
  if (restype !== null && typeof restype === "object" && restype._isStructType === true) {
    // toObject may retain array views or union getters over its input.
    return structResultReaders.get(restype) ?? ((r) => restype.toObject(copyResultBytes(r)));
  }
  if (restype !== null && typeof restype === "object" && restype._isArrayType !== true) requireDescriptor(restype, native);
  return undefined;
}

export function scalarResult(restype) {
  return isScalarSubclass(restype);
}

export function resultCheck(restype, name, loader = "FFI") {
  const check = restype?._check_retval_;
  const hresult = restype?._isHResult === true;
  if (!hresult && check === undefined) return undefined;
  return (result) => {
    if (check !== undefined && typeof check !== "function") throw new TypeError("_check_retval_ must be callable");
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
    return check === undefined ? result : reflectApply(check, restype, [result]);
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

export function composeResult(represent, check) {
  return check === undefined ? represent : (value, owned) => check(represent === undefined ? value : represent(value, owned));
}
