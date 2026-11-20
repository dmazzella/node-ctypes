/** Normalize public ctypes declarations for native arguments and return values. */
import { buildNativeAggregate } from "./native-aggregate.js";

export function _toNativeType(type, native) {
  if (typeof type === "function" && type._isSimpleCData) {
    return type._type;
  }

  if (type && typeof type === "object" && type._pointerTo !== undefined) {
    return native.CType.POINTER;
  }

  if (typeof type === "function" && type._isFuncPtr === true) {
    return native.CType.POINTER;
  }

  if (typeof type === "function" && typeof type._buildStruct === "function") {
    const def = type._structDef || type._buildStruct();
    return buildNativeAggregate(def, native);
  }
  if (typeof type === "function" && typeof type._buildUnion === "function") {
    const def = type._unionDef || type._buildUnion();
    return buildNativeAggregate(def, native);
  }

  if (type && typeof type === "object" && type._isStructType && Array.isArray(type.fields)) {
    return buildNativeAggregate(type, native);
  }

  if (type && (typeof type === "object" || typeof type === "function") && type._isArrayType) {
    return type._native || type;
  }

  if (typeof type === "number") return type;

  return type;
}

// A null restype denotes void, not a null pointer.
export function _toNativeReturnType(type, native) {
  if (type === null) return native.CType.VOID;
  return _toNativeType(type, native);
}

// Array parameters decay to pointers; array fields in aggregates do not.
export function _toNativeTypes(types, native) {
  if (!Array.isArray(types)) return types;
  return types.map((type) => (type && (typeof type === "object" || typeof type === "function") && type._isArrayType === true ? native.CType.POINTER : _toNativeType(type, native)));
}

export function requireDescriptor(type, native, index) {
  // A low-level array wrapper can resolve its _native getter later, at binding.
  if (type instanceof native.StructType || type instanceof native.ArrayType || "_native" in type) return;
  const position = index === undefined ? "return type" : `argument type at index ${index}`;
  throw new TypeError(`Invalid ${position}: expected a ctypes type descriptor`);
}
