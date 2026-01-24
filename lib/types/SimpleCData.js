/**
 * @file SimpleCData.js
 * @module types/SimpleCData
 * @description SimpleCData base class for primitive C types.
 *
 * This module provides the `SimpleCData` base class that serves as the foundation
 * for all primitive C types (integers, floats, chars, pointers). It handles
 * memory allocation, value reading/writing, and provides Python ctypes-compatible
 * methods.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes._SimpleCData` base class.
 *
 * @example Creating custom type
 * ```javascript
 * import { SimpleCData } from 'node-ctypes';
 *
 * class c_int32 extends SimpleCData {
 *   static _size = 4;
 *   static _type = 'int32';
 *   static _reader = (buf, off) => buf.readInt32LE(off);
 *   static _writer = (buf, off, val) => buf.writeInt32LE(val, off);
 * }
 *
 * const x = new c_int32(42);
 * console.log(x.value); // 42
 * x.value = 100;
 * console.log(x.value); // 100
 * ```
 *
 * @example Using from_buffer (zero-copy)
 * ```javascript
 * const buffer = Buffer.from([0x2A, 0x00, 0x00, 0x00]); // 42 in LE
 * const x = c_int32.from_buffer(buffer, 0);
 * console.log(x.value); // 42
 * x.value = 100; // Modifies original buffer!
 * console.log(buffer); // [0x64, 0x00, 0x00, 0x00]
 * ```
 *
 * @example Using from_buffer_copy
 * ```javascript
 * const buffer = Buffer.from([0x2A, 0x00, 0x00, 0x00]);
 * const x = c_int32.from_buffer_copy(buffer, 0);
 * x.value = 100; // Does NOT modify original buffer
 * console.log(buffer); // Still [0x2A, 0x00, 0x00, 0x00]
 * ```
 */

/**
 * Creates the SimpleCData base class with required dependencies injected.
 *
 * @param {Function} alloc - Memory allocation function
 * @returns {Class} SimpleCData base class
 * @private
 */
export function createSimpleCDataClass(alloc) {
  /**
   * SimpleCData base class for primitive C types.
   *
   * Subclasses must define:
   * - `static _size`: Size in bytes
   * - `static _type`: Type name string
   * - `static _reader(buffer, offset)`: Function to read value from buffer
   * - `static _writer(buffer, offset, value)`: Function to write value to buffer
   *
   * **Python ctypes Compatibility**:
   * Similar to Python's `ctypes._SimpleCData` with:
   * - `.value` property for get/set
   * - `.size` property
   * - `from_buffer()` for zero-copy wrapping
   * - `from_buffer_copy()` for copied data
   *
   * @class SimpleCData
   *
   * @example Integer type
   * ```javascript
   * class c_uint8 extends SimpleCData {
   *   static _size = 1;
   *   static _type = 'uint8';
   *   static _reader = (buf, off) => buf.readUInt8(off);
   *   static _writer = (buf, off, val) => buf.writeUInt8(val, off);
   * }
   *
   * const byte = new c_uint8(255);
   * console.log(byte.value); // 255
   * console.log(byte.size); // 1
   * console.log(byte.toString()); // "c_uint8(255)"
   * ```
   *
   * @example Float type
   * ```javascript
   * class c_float extends SimpleCData {
   *   static _size = 4;
   *   static _type = 'float';
   *   static _reader = (buf, off) => buf.readFloatLE(off);
   *   static _writer = (buf, off, val) => buf.writeFloatLE(val, off);
   * }
   *
   * const pi = new c_float(3.14159);
   * console.log(pi.value); // 3.1415898799896240
   * ```
   */
  class SimpleCData {
    /**
     * @param {number|bigint} [value] - Initial value (default: 0)
     */
    constructor(value) {
      const Ctor = this.constructor;
      this._buffer = alloc(Ctor._size);
      if (value !== undefined && value !== null) {
        this.value = value;
      }
    }

    /**
     * Get the current value
     */
    get value() {
      const Ctor = this.constructor;
      return Ctor._reader(this._buffer, 0);
    }

    /**
     * Set the value
     */
    set value(v) {
      const Ctor = this.constructor;
      Ctor._writer(this._buffer, 0, v);
    }

    /**
     * Size of the type in bytes (instance property)
     */
    get size() {
      return this.constructor._size;
    }

    /**
     * Create instance from existing buffer (Python ctypes compatible)
     * WARNING: Returns a VIEW into the buffer, not a copy!
     * @param {Buffer} buffer - Source buffer
     * @param {number} [offset=0] - Offset in buffer
     * @returns {SimpleCData} New instance wrapping the buffer slice
     */
    static from_buffer(buffer, offset = 0) {
      if (!Buffer.isBuffer(buffer)) {
        throw new TypeError("from_buffer requires a Buffer");
      }
      const inst = Object.create(this.prototype);
      inst._buffer = buffer.subarray(offset, offset + this._size);
      return inst;
    }

    /**
     * Create instance from a COPY of buffer data (Python ctypes compatible)
     * @param {Buffer} buffer - Source buffer
     * @param {number} [offset=0] - Offset in buffer
     * @returns {SimpleCData} New instance with copied data
     */
    static from_buffer_copy(buffer, offset = 0) {
      if (!Buffer.isBuffer(buffer)) {
        throw new TypeError("from_buffer_copy requires a Buffer");
      }
      const inst = new this();
      buffer.copy(inst._buffer, 0, offset, offset + this._size);
      return inst;
    }

    /**
     * Size of the type in bytes (static property)
     */
    static get size() {
      return this._size;
    }

    toString() {
      return `${this.constructor.name}(${this.value})`;
    }

    toJSON() {
      const v = this.value;
      return typeof v === "bigint" ? v.toString() : v;
    }

    valueOf() {
      return this.value;
    }
  }

  SimpleCData._isSimpleCData = true;

  return SimpleCData;
}
