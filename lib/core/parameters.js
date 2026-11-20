/** Resolve _as_parameter_ while retaining objects across reentrant getters. */
import { structClass } from "../structures/protocol.js";

export const activeArgumentOwners = new Set();

// GC roots of in-progress synchronous conversions, released in LIFO order.
export const activeOwnerStack = [];

export const byrefOwners = new WeakMap();

// Brand of callback wrappers: their constant pointer (the `_as_parameter_`
// value), read without the generic parameter probes.
export const callbackPointer = Symbol("callbackPointer");

export function resolveParameter(value, owners, expectedStruct) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const pointer = value[callbackPointer];
  if (pointer !== undefined) {
    if (owners !== undefined) owners.push(value);
    return pointer;
  }
  if (owners !== undefined) owners.push(value);
  if (ArrayBuffer.isView(value) && !("_as_parameter_" in value)) return value;
  const actual = expectedStruct === undefined ? undefined : value[structClass];
  if (actual !== undefined) {
    if (actual === expectedStruct || value instanceof expectedStruct) return value;
    // An unrelated aggregate is not interchangeable, but may be an adapter.
  } else if (value._isSimpleCDataInstance === true || value._pointerType !== undefined || value._arrayType !== undefined || value._structDef !== undefined || byrefOwners.has(value)) return value;
  const parameter = value._as_parameter_;
  if (parameter === undefined) {
    if (actual !== undefined) throw new TypeError(`expected ${expectedStruct.name} instance instead of ${actual.name}`);
    return value;
  }
  if (parameter === null || (typeof parameter !== "object" && typeof parameter !== "function")) return parameter;
  if (owners !== undefined) return resolveParameter(parameter, owners, expectedStruct);

  // Resolver-only memory operations also retain parents while nested getters can collect.
  const retained = [value];
  activeOwnerStack.push(retained);
  try {
    return resolveParameter(parameter, retained, expectedStruct);
  } finally {
    activeOwnerStack.pop();
  }
}
