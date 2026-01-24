/**
 * @file bitfield-helpers.js
 * @module structures/bitfield-helpers
 * @description Helper functions for reading and writing bitfield values in structs.
 *
 * This module provides low-level bitfield manipulation functions used by struct
 * and union implementations to pack multiple small integer values into single bytes.
 *
 * @example
 * ```javascript
 * import { _readBitField, _writeBitField } from './structures/bitfield-helpers.js';
 *
 * const buf = Buffer.alloc(4);
 * _writeBitField(buf, 0, c_uint32, 0, 3, 5); // Write 5 to bits 0-2
 * const value = _readBitField(buf, 0, c_uint32, 0, 3); // Read bits 0-2
 * ```
 */

/**
 * Reads an unsigned integer value from a buffer.
 *
 * @param {Buffer} buf - Buffer to read from
 * @param {number} offset - Byte offset in buffer
 * @param {number} byteSize - Size in bytes (1, 2, 4, or 8)
 * @param {Function} sizeof - sizeof function reference
 * @returns {number|bigint} Value read from buffer
 * @throws {Error} If byteSize is not supported
 * @private
 */
export function _readUintFromBuffer(buf, offset, byteSize) {
  switch (byteSize) {
    case 1:
      return buf.readUInt8(offset);
    case 2:
      return buf.readUInt16LE(offset);
    case 4:
      return buf.readUInt32LE(offset);
    case 8:
      return buf.readBigUInt64LE(offset);
    default:
      throw new Error(`Unsupported byte size: ${byteSize}`);
  }
}

/**
 * Writes an unsigned integer value to a buffer.
 *
 * @param {Buffer} buf - Buffer to write to
 * @param {number} offset - Byte offset in buffer
 * @param {number} byteSize - Size in bytes (1, 2, 4, or 8)
 * @param {number|bigint} value - Value to write
 * @throws {Error} If byteSize is not supported
 * @private
 */
export function _writeUintToBuffer(buf, offset, byteSize, value) {
  switch (byteSize) {
    case 1:
      buf.writeUInt8(value, offset);
      break;
    case 2:
      buf.writeUInt16LE(value, offset);
      break;
    case 4:
      buf.writeUInt32LE(value, offset);
      break;
    case 8:
      buf.writeBigUInt64LE(value, offset);
      break;
    default:
      throw new Error(`Unsupported byte size: ${byteSize}`);
  }
}

/**
 * Reads a bitfield value from a buffer.
 *
 * Extracts a specific range of bits from an integer value stored in memory.
 * Used by struct/union implementations to support packed bitfields.
 *
 * @param {Buffer} buf - Buffer to read from
 * @param {number} offset - Byte offset of the containing integer
 * @param {Function|Object} baseType - Base integer type (c_uint8, c_uint16, c_uint32, c_uint64)
 * @param {number} bitOffset - Starting bit position (0-based)
 * @param {number} bitSize - Number of bits to read
 * @param {Function} sizeof - sizeof function reference
 * @returns {number} Extracted bitfield value
 *
 * @example
 * ```javascript
 * // Read 3-bit field starting at bit 5
 * const value = _readBitField(buf, 0, c_uint32, 5, 3);
 * ```
 * @private
 */
export function _readBitField(buf, offset, baseType, bitOffset, bitSize, sizeof) {
  const baseSize = sizeof(baseType);
  const value = _readUintFromBuffer(buf, offset, baseSize);

  // Extract the bits
  if (baseSize === 8) {
    const mask = (1n << BigInt(bitSize)) - 1n;
    return Number((value >> BigInt(bitOffset)) & mask);
  } else {
    const mask = (1 << bitSize) - 1;
    return (value >> bitOffset) & mask;
  }
}

/**
 * Writes a bitfield value to a buffer.
 *
 * Modifies a specific range of bits in an integer value stored in memory,
 * preserving other bits. Used by struct/union implementations to support
 * packed bitfields.
 *
 * @param {Buffer} buf - Buffer to write to
 * @param {number} offset - Byte offset of the containing integer
 * @param {Function|Object} baseType - Base integer type (c_uint8, c_uint16, c_uint32, c_uint64)
 * @param {number} bitOffset - Starting bit position (0-based)
 * @param {number} bitSize - Number of bits to write
 * @param {number} newValue - Value to write (will be masked to bitSize)
 * @param {Function} sizeof - sizeof function reference
 *
 * @example
 * ```javascript
 * // Write 5 to a 3-bit field starting at bit 2
 * _writeBitField(buf, 0, c_uint32, 2, 3, 5);
 * ```
 * @private
 */
export function _writeBitField(buf, offset, baseType, bitOffset, bitSize, newValue, sizeof) {
  const baseSize = sizeof(baseType);
  let value = _readUintFromBuffer(buf, offset, baseSize);

  // Modify the bits
  if (baseSize === 8) {
    const mask = (1n << BigInt(bitSize)) - 1n;
    const clearMask = ~(mask << BigInt(bitOffset));
    value = (value & clearMask) | ((BigInt(newValue) & mask) << BigInt(bitOffset));
  } else {
    const mask = (1 << bitSize) - 1;
    const clearMask = ~(mask << bitOffset);
    value = (value & clearMask) | ((newValue & mask) << bitOffset);
  }

  _writeUintToBuffer(buf, offset, baseSize, value);
}
