/**
 * @file UnionClass.js
 * @module structures/UnionClass
 * @description Union base class for Python ctypes-compatible unions.
 *
 * This module provides the `Union` base class that users extend to create
 * custom union types where all fields share the same memory location.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.Union` class with `_fields_` attribute.
 *
 * @example Basic Union subclass
 * ```javascript
 * import { Union, c_int32, c_float } from 'node-ctypes';
 *
 * class Value extends Union {
 *   static _fields_ = [
 *     ['as_int', c_int32],
 *     ['as_float', c_float]
 *   ];
 * }
 *
 * const v = new Value();
 * v.as_int = 0x40490FDB; // IEEE 754 for ~3.14159
 * console.log(v.as_float); // ~3.14159
 * ```
 *
 * @example Type reinterpretation
 * ```javascript
 * class ByteWord extends Union {
 *   static _fields_ = [
 *     ['bytes', array(c_uint8, 4)],
 *     ['word', c_uint32]
 *   ];
 * }
 *
 * const bw = new ByteWord();
 * bw.word = 0x12345678;
 * console.log([...bw.bytes]); // [0x78, 0x56, 0x34, 0x12] (little-endian)
 * ```
 */

/**
 * Creates the Union base class with required dependencies injected.
 *
 * @param {Class} Structure - Structure base class to extend from
 * @param {Function} union - Union definition function
 * @param {Function} bitfield - Bitfield helper function for Python-style [name, type, bits] syntax
 * @returns {Class} Union base class
 * @private
 */
export function createUnionClass(Structure, union, bitfield) {
  /**
   * Union base class for creating C-style unions.
   *
   * Extends `Structure` but uses union layout where all fields share the
   * same memory location (offset 0). The union size is the maximum of all
   * field sizes.
   *
   * **Python ctypes Compatibility**:
   * Similar to Python's `ctypes.Union` with:
   * - `_fields_` attribute (array or object)
   * - All fields at same memory location
   * - Size equals largest field size
   *
   * @class Union
   * @extends Structure
   *
   * @example RGB color union
   * ```javascript
   * class Color extends Union {
   *   static _fields_ = [
   *     ['rgba', c_uint32],
   *     ['components', array(c_uint8, 4)]
   *   ];
   * }
   *
   * const color = new Color();
   * color.rgba = 0xFF0080FF; // RGBA: 255, 0, 128, 255
   * console.log([...color.components]); // [255, 128, 0, 255] (little-endian)
   * ```
   */
  class Union extends Structure {
    static _buildStruct() {
      const fields = this._fields_ || {};
      let mapFields = {};
      if (Array.isArray(fields)) {
        for (const entry of fields) {
          if (Array.isArray(entry) && entry.length >= 2) {
            const name = entry[0];
            const type = entry[1];
            // Python-style bitfield: [name, type, bits]
            if (entry.length >= 3 && typeof entry[2] === "number") {
              mapFields[name] = bitfield(type, entry[2]);
            } else {
              mapFields[name] = type;
            }
          }
        }
      } else if (typeof fields === "object" && fields !== null) {
        mapFields = fields;
      }
      const def = union(mapFields);
      this._structDef = def;
      return def;
    }
  }

  return Union;
}
