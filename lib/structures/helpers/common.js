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
  return typeof type === "object" && type !== null && typeof type.size === "number" && Array.isArray(type.fields) && typeof type.create === "function";
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
  return typeof type === "object" && type !== null && type._isArrayType === true;
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
