/** Scalar conversion and views must distinguish built-in ctypes from application subclasses. */
import { flush, kMirrorBase, mirrorBase, mirroredPrototype, mirrorsActive, refresh } from "../memory/mirror.js";

const simpleTypes = new WeakSet();
const scalarInstances = new WeakMap();
const scalarTypeInfos = new WeakMap();
const scalarAccessors = [];
const scalarArgumentKinds = new Set();
const scalarArgumentTypes = new Map();
const applyScalarReader = Reflect.apply;

export function registerSimpleType(type) {
  simpleTypes.add(type);
  scalarArgumentKinds.add(type._type);
}

export function scalarTypeInfo(type, swapped = false) {
  let variants = scalarTypeInfos.get(type);
  if (variants === undefined) {
    const kind = type._type;
    variants = [{ type, kind, swapped: false, pointer: type._isPointerValued === true }];
    scalarTypeInfos.set(type, variants);
  }
  const index = swapped ? 1 : 0;
  if (variants[index] === undefined) variants[index] = { ...variants[0], swapped: true };
  return variants[index];
}

export function registerScalarAccessor(accessor) {
  scalarAccessors.push(accessor);
}

export function registerScalarInstance(value, type, swapped = false) {
  scalarInstances.set(value, scalarTypeInfo(type, swapped));
}

export function scalarInstanceInfo(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  for (const accessor of scalarAccessors) {
    const info = accessor(value);
    if (info !== undefined) return info;
  }
  return scalarInstances.get(value);
}

export function scalarArgumentKind(value) {
  return scalarInstanceInfo(value)?.kind;
}

export function scalarArgumentValue(value, info = scalarInstanceInfo(value)) {
  if (info === undefined) return value.value;
  const buffer = value._buffer;
  if (mirrorsActive) refresh(buffer);
  const reader = info.swapped ? info.type._readerBE : info.type._reader;
  return applyScalarReader(reader, info.type, [buffer, 0]);
}

export function scalarArgumentSnapshot(value, info = scalarInstanceInfo(value)) {
  if (info === undefined || info.pointer || info.kind === 0 || !scalarArgumentKinds.has(info.kind)) return value;
  let constructor = scalarArgumentTypes.get(info.kind);
  if (constructor === undefined) {
    constructor = function ScalarArgument() {};
    Object.defineProperties(constructor, {
      _isSimpleCData: { value: true },
      _type: { value: info.kind },
    });
    scalarArgumentTypes.set(info.kind, constructor);
  }
  // Keep the inferred type, but snapshot the value before the next adapter.
  return { constructor, value: scalarArgumentValue(value, info) };
}

export function isScalarSubclass(type) {
  return typeof type === "function" && type._isSimpleCData === true && !simpleTypes.has(type);
}

export function scalarView(type, buffer, swapped = false) {
  // C-owned representations must bypass application constructors and writers.
  const base = mirrorsActive ? mirrorBase(buffer) : undefined;
  const value = Object.create(base === undefined ? type.prototype : mirroredPrototype(type));
  value._buffer = buffer;
  if (base !== undefined) value[kMirrorBase] = base;
  const useSwapped = !!(swapped && type._readerBE && type._writerBE);
  registerScalarInstance(value, type, useSwapped);
  if (useSwapped) {
    Object.defineProperty(value, "value", {
      get() {
        if (base !== undefined) refresh(buffer);
        return type._readerBE(buffer, 0);
      },
      set(v) {
        type._writerBE(buffer, 0, v);
        if (base !== undefined) flush(buffer);
      },
    });
  }
  return value;
}

export function scalarReader(type, reader, swapped = false) {
  return isScalarSubclass(type) ? (buffer, offset) => scalarView(type, buffer.subarray(offset, offset + type._size), swapped) : reader;
}

export function scalarOutparam() {
  return isScalarSubclass(this.constructor) ? this : this.value;
}

/**
 * Python: a float is not an integer ("'float' object cannot be interpreted as
 * an integer"); in JS, numbers that are not integral (or not finite).
 *
 * @throws {TypeError}
 */
export function notIntegral() {
  throw new TypeError("'float' object cannot be interpreted as an integer");
}

export function booleanValue(value) {
  return !!(value !== null && typeof value === "object" && value._isSimpleCDataInstance === true ? value.value : value);
}
