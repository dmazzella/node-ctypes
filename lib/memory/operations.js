/**
 * @file operations.js
 * @module memory/operations
 * @description Memory read/write operations and type size queries.
 *
 * This module provides low-level memory operations for reading and writing
 * typed values to/from buffers, similar to Python ctypes memory access.
 *
 * **Python ctypes Compatibility**:
 * These functions provide similar functionality to Python's struct module
 * and ctypes memory operations.
 *
 * @example
 * ```javascript
 * import { readValue, writeValue, sizeof, c_int32, c_double } from 'node-ctypes';
 *
 * const buf = Buffer.alloc(16);
 *
 * // Write values
 * writeValue(buf, c_int32, 42, 0);
 * writeValue(buf, c_double, 3.14, 8);
 *
 * // Read values
 * const int_val = readValue(buf, c_int32, 0);    // 42
 * const double_val = readValue(buf, c_double, 8); // 3.14
 *
 * // Get type sizes
 * console.log(sizeof(c_int32));  // 4
 * console.log(sizeof(c_double)); // 8
 * ```
 */

/**
 * Reads a typed value from memory at the specified offset.
 *
 * **Supported Types**:
 * - SimpleCData classes (c_int32, c_uint64, c_float, c_double, etc.)
 * - Structure classes (user-defined structs)
 * - Union classes (user-defined unions)
 *
 * **Python ctypes Compatibility**:
 * Similar to reading from a ctypes pointer or using struct.unpack.
 *
 * @param {Buffer|bigint|number} ptr - Buffer or memory address to read from
 * @param {Function|Object} type - Type to read (SimpleCData class, Structure, or Union)
 * @param {number} [offset=0] - Byte offset from ptr
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} ptrToBuffer - ptrToBuffer function reference
 * @param {Function} Structure - Structure class reference
 * @param {Function} Union - Union class reference
 * @returns {*} Value read from memory
 * @throws {RangeError} If offset is negative or read exceeds buffer bounds
 * @throws {TypeError} If ptr is not a Buffer/address or type is unsupported
 *
 * @example Read primitive types
 * ```javascript
 * import { readValue, c_int32, c_float } from 'node-ctypes';
 *
 * const buf = Buffer.from([0x2A, 0x00, 0x00, 0x00]); // 42 in little-endian
 * const value = readValue(buf, c_int32, 0);
 * console.log(value); // 42
 * ```
 *
 * @example Read from address
 * ```javascript
 * const address = 0x1234567890ABCDEFn;
 * const value = readValue(address, c_int32, 0);
 * ```
 *
 * @example Read struct
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const buf = Buffer.alloc(8);
 * const point = readValue(buf, Point, 0);
 * console.log(point); // { x: 0, y: 0 }
 * ```
 */
export function readValue(ptr, type, offset = 0, sizeof, ptrToBuffer, Structure, Union) {
  // Validate offset
  if (typeof offset !== "number" || offset < 0) {
    throw new RangeError("offset must be a non-negative number");
  }

  // SimpleCData class - use its _reader directly
  if (typeof type === "function" && type._isSimpleCData) {
    if (Buffer.isBuffer(ptr)) {
      const size = type._size || sizeof(type);
      // Bounds check for buffer reads
      if (offset + size > ptr.length) {
        throw new RangeError(`Read would exceed buffer bounds (offset: ${offset}, size: ${size}, buffer length: ${ptr.length})`);
      }
      return type._reader(ptr, offset);
    }

    // Allow passing an address (BigInt or number) and convert to buffer
    if (typeof ptr === "bigint" || typeof ptr === "number") {
      const size = type._size || sizeof(type);
      const buf = ptrToBuffer(ptr, size + offset);
      return type._reader(buf, offset);
    }

    throw new TypeError("readValue requires a Buffer or pointer address");
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    return def.toObject(tempBuf);
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    return def.toObject(tempBuf);
  }

  throw new TypeError(`readValue: unsupported type ${type}`);
}

/**
 * Writes a typed value to memory at the specified offset.
 *
 * **Supported Types**:
 * - SimpleCData classes (c_int32, c_uint64, c_float, c_double, etc.)
 * - Structure classes (user-defined structs)
 * - Union classes (user-defined unions)
 *
 * **Python ctypes Compatibility**:
 * Similar to writing to a ctypes pointer or using struct.pack.
 *
 * @param {Buffer} ptr - Buffer to write to (must be a Buffer, not an address)
 * @param {Function|Object} type - Type to write (SimpleCData class, Structure, or Union)
 * @param {*} value - Value to write
 * @param {number} [offset=0] - Byte offset in buffer
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} Structure - Structure class reference
 * @param {Function} Union - Union class reference
 * @returns {number} Number of bytes written
 * @throws {RangeError} If offset is negative or write exceeds buffer bounds
 * @throws {TypeError} If ptr is not a Buffer or type is unsupported
 *
 * @example Write primitive types
 * ```javascript
 * import { writeValue, c_int32, c_double } from 'node-ctypes';
 *
 * const buf = Buffer.alloc(16);
 * writeValue(buf, c_int32, 42, 0);
 * writeValue(buf, c_double, 3.14159, 8);
 * ```
 *
 * @example Write struct
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const buf = Buffer.alloc(8);
 * writeValue(buf, Point, { x: 10, y: 20 }, 0);
 * ```
 */
export function writeValue(ptr, type, value, offset = 0, sizeof, Structure, Union) {
  // Validate offset
  if (typeof offset !== "number" || offset < 0) {
    throw new RangeError("offset must be a non-negative number");
  }

  // SimpleCData class - use its _writer directly
  if (typeof type === "function" && type._isSimpleCData) {
    if (!Buffer.isBuffer(ptr)) {
      throw new TypeError("writeValue requires a Buffer");
    }
    const size = type._size || sizeof(type);
    // Bounds check for buffer writes
    if (offset + size > ptr.length) {
      throw new RangeError(`Write would exceed buffer bounds (offset: ${offset}, size: ${size}, buffer length: ${ptr.length})`);
    }
    type._writer(ptr, offset, value);
    return type._size;
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    if (Buffer.isBuffer(value)) {
      value.copy(tempBuf, 0, 0, def.size);
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        def.set(tempBuf, k, v);
      }
    }
    return def.size;
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    const tempBuf = ptr.subarray(offset, offset + def.size);
    if (Buffer.isBuffer(value)) {
      value.copy(tempBuf, 0, 0, def.size);
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        def.set(tempBuf, k, v);
      }
    }
    return def.size;
  }

  throw new TypeError(`writeValue: unsupported type ${type}`);
}

/**
 * Returns the size in bytes of a type or type instance.
 *
 * **Supported Inputs**:
 * - SimpleCData classes (c_int32, c_uint64, etc.)
 * - SimpleCData instances (new c_int32())
 * - Structure classes (user-defined structs)
 * - Union classes (user-defined unions)
 * - Struct/Union definition objects
 * - Array type objects
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.sizeof()`.
 *
 * @param {Function|Object} type - Type or instance to get size of
 * @param {Function} Structure - Structure class reference
 * @param {Function} Union - Union class reference
 * @returns {number} Size in bytes
 * @throws {TypeError} If type is unsupported
 *
 * @example Primitive type sizes
 * ```javascript
 * import { sizeof, c_int32, c_uint64, c_double } from 'node-ctypes';
 *
 * console.log(sizeof(c_int32));  // 4
 * console.log(sizeof(c_uint64)); // 8
 * console.log(sizeof(c_double)); // 8
 * ```
 *
 * @example Struct size
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * console.log(sizeof(Point)); // 8
 * ```
 *
 * @example Instance size
 * ```javascript
 * const val = new c_int32(42);
 * console.log(sizeof(val)); // 4
 * ```
 */
export function sizeof(type, Structure, Union) {
  // SimpleCData class (e.g., sizeof(c_uint64))
  if (typeof type === "function" && type._isSimpleCData) {
    return type._size;
  }

  // SimpleCData instance (e.g., sizeof(new c_uint64()))
  if (type && type._buffer && type.constructor && type.constructor._isSimpleCData) {
    return type.constructor._size;
  }

  // Struct type (class)
  if (typeof type === "function" && type.prototype instanceof Structure) {
    const def = type._structDef || type._buildStruct();
    return def.size;
  }

  // Union type (class)
  if (typeof type === "function" && type.prototype instanceof Union) {
    const def = type._unionDef || type._buildUnion();
    return def.size;
  }

  // Struct/Union definition object
  if (typeof type === "object" && type !== null && typeof type.size === "number") {
    return type.size;
  }

  // Array type
  if (typeof type === "object" && type !== null && typeof type.getSize === "function") {
    return type.getSize();
  }

  throw new TypeError(`sizeof: unsupported type. Use SimpleCData classes like c_int32, c_uint64, etc.`);
}
