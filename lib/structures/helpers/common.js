/**
 * @file helpers.js
 * @module structures/helpers
 * @description Helper functions and type checks for structure and type system.
 *
 * This module provides utility functions for working with structures, arrays,
 * and bitfields in the node-ctypes type system.
 *
 * @example
 * ```javascript
 * import { bitfield, _isStruct, _isArrayType } from './structures/helpers.js';
 *
 * // Create a bitfield
 * const flags = bitfield(c_uint32, 8); // 8-bit field
 *
 * // Check if type is a struct
 * if (_isStruct(myType)) {
 *   // Handle struct type
 * }
 * ```
 */

/**
 * Creates a bitfield definition.
 *
 * Bitfields allow packing multiple boolean or small integer values into a single
 * integer type, useful for flags and compact data structures.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's ctypes bitfield syntax in Structure _fields_.
 *
 * @param {Function|Object} baseType - Base integer type (c_uint8, c_uint16, c_uint32, c_uint64)
 * @param {number} bits - Number of bits to allocate (1 to baseSize*8)
 * @param {Function} sizeof - sizeof function reference
 * @returns {Object} Bitfield definition object
 * @throws {Error} If bits is out of valid range for base type
 *
 * @example 8-bit flags in uint32
 * ```javascript
 * import { struct, bitfield, c_uint32 } from 'node-ctypes';
 *
 * const Flags = struct({
 *   isActive: bitfield(c_uint32, 1),   // 1 bit
 *   priority: bitfield(c_uint32, 3),   // 3 bits
 *   category: bitfield(c_uint32, 4),   // 4 bits
 * });
 * ```
 *
 * @example Using different base types
 * ```javascript
 * // Small bitfield (up to 8 bits)
 * const smallFlags = bitfield(c_uint8, 5);
 *
 * // Large bitfield (up to 64 bits)
 * const largeFlags = bitfield(c_uint64, 48);
 * ```
 */
export function bitfield(baseType, bits, sizeof) {
  const baseSize = sizeof(baseType);
  const maxBits = baseSize * 8;

  if (bits < 1 || bits > maxBits) {
    throw new Error(`Bit field size must be between 1 and ${maxBits} for ${baseType}`);
  }

  return {
    _isBitField: true,
    baseType: baseType,
    bits: bits,
    baseSize: baseSize,
  };
}

/**
 * Checks if a type is a struct definition.
 *
 * @param {*} type - Type to check
 * @returns {boolean} True if type is a struct definition
 *
 * @example
 * ```javascript
 * const myStruct = struct({ x: c_int32, y: c_int32 });
 * console.log(_isStruct(myStruct)); // true
 * console.log(_isStruct(c_int32));  // false
 * ```
 *
 * @private
 */
export function _isStruct(type) {
  // Check for struct definition object (from struct() function)
  if (typeof type === "object" && type !== null && typeof type.size === "number" && Array.isArray(type.fields) && typeof type.create === "function") {
    return true;
  }
  // Check for Structure/Union class (has _fields_ or _structDef and _buildStruct)
  if (typeof type === "function" && (type._fields_ || type._structDef) && typeof type._buildStruct === "function") {
    return true;
  }
  return false;
}

/**
 * Checks if a type is an array type definition.
 *
 * @param {*} type - Type to check
 * @returns {boolean} True if type is an array type
 *
 * @example
 * ```javascript
 * const intArray = array(c_int32, 10);
 * console.log(_isArrayType(intArray)); // true
 * console.log(_isArrayType(c_int32));  // false
 * ```
 *
 * @private
 */
export function _isArrayType(type) {
  // I tipi array sono funzioni chiamabili (array(c_int, 3)(1, 2, 3)).
  return (typeof type === "object" || typeof type === "function") && type !== null && type._isArrayType === true;
}

/**
 * Checks if a type is a bitfield definition.
 *
 * @param {*} type - Type to check
 * @returns {boolean} True if type is a bitfield
 *
 * @example
 * ```javascript
 * const flags = bitfield(c_uint32, 8);
 * console.log(_isBitField(flags)); // true
 * console.log(_isBitField(c_int32)); // false
 * ```
 *
 * @private
 */
export function _isBitField(type) {
  return typeof type === "object" && type !== null && type._isBitField === true;
}

/**
 * Address stored by a pointer field assignment: a pointer instance, a
 * CFUNCTYPE/callback object (`_as_parameter_`), a BigInt/number address,
 * `null` (NULL) or a Buffer holding an address. Other values are a TypeError,
 * as in Python, instead of a silent NULL.
 *
 * @param {*} value - Assigned value
 * @param {number} pointerSize - Native pointer size
 * @returns {bigint} Address to store
 */
export function pointerFieldAddress(value, pointerSize) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value === null || value === undefined) return 0n;
  if (typeof value === "object") {
    if (typeof value.address === "bigint") return value.address;
    const param = value._as_parameter_;
    if (typeof param === "bigint") return param;
    if (typeof param === "number") return BigInt(param);
    if (Buffer.isBuffer(value)) return pointerSize === 8 ? value.readBigUInt64LE(0) : BigInt(value.readUInt32LE(0));
  }
  throw new TypeError(`incompatible types, ${typeof value === "function" ? "function" : typeof value} instead of pointer`);
}

const funcPtrFieldTypes = new WeakMap();

/**
 * Field type for a CFUNCTYPE prototype: a pointer-sized field whose value is
 * the callable function (`null` for NULL), as Python ctypes.
 *
 * @param {Function} prototype - CFUNCTYPE/WINFUNCTYPE type
 * @returns {Object} Pointer-like field type
 */
export function funcPtrFieldType(prototype) {
  let fieldType = funcPtrFieldTypes.get(prototype);
  if (fieldType === undefined) {
    fieldType = { _pointerTo: prototype, _isFuncPtrField: true, fromAddress: (address) => prototype(address) };
    funcPtrFieldTypes.set(prototype, fieldType);
  }
  return fieldType;
}

/**
 * Keep `value` alive as long as `targetBuf`, like Python ctypes `_objects`:
 * an object whose address is stored in the buffer (pointer, callback) must
 * not be garbage collected while native code can still read that address.
 * Shares the slot table used for c_char_p / c_wchar_p fields.
 *
 * @param {Buffer} targetBuf - Buffer holding the address
 * @param {number} offset - Offset of the slot
 * @param {*} value - Referenced object (or null to clear the slot)
 */
export function keepAlive(targetBuf, offset, value) {
  let keep = targetBuf.__ctypesKeepalive;
  if (keep === undefined) {
    keep = Object.create(null);
    Object.defineProperty(targetBuf, "__ctypesKeepalive", { value: keep });
  }
  keep[offset] = value !== null && typeof value === "object" ? value : undefined;
}

/**
 * Write a pointer field (struct, union or array element) and keep the
 * assigned object alive with the buffer, as Python ctypes `_objects`.
 *
 * @param {Buffer} buf - Target buffer
 * @param {number} offset - Field offset
 * @param {*} value - Assigned value (see {@link pointerFieldAddress})
 * @param {number} pointerSize - Native pointer size
 */
export function writePointerField(buf, offset, value, pointerSize) {
  const address = pointerFieldAddress(value, pointerSize);
  if (pointerSize === 8) buf.writeBigUInt64LE(address, offset);
  else buf.writeUInt32LE(Number(address), offset);
  keepAlive(buf, offset, value);
}

/**
 * Copy a struct/union instance into a nested field: the bytes (as Python
 * does) plus the objects it keeps alive (strings, pointers, callbacks), so
 * the addresses copied with them stay valid.
 *
 * @param {Buffer} buf - Target buffer
 * @param {number} offset - Field offset
 * @param {number} size - Field size
 * @param {Object} value - Instance with a `_buffer`
 */
export function copyInstance(buf, offset, size, value) {
  const source = value._buffer;
  source.copy(buf, offset, 0, size);
  const kept = source.__ctypesKeepalive;
  if (kept !== undefined) {
    for (const key of Object.keys(kept)) {
      if (Number(key) < size) keepAlive(buf, offset + Number(key), kept[key]);
    }
  }
}
