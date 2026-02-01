/**
 * @file pointer.js
 * @module memory/pointer
 * @description Pointer manipulation and address operations for C interoperability.
 *
 * This module provides Python ctypes-compatible functions for working with pointers,
 * addresses, and pointer types. It handles pointer creation, dereferencing, casting,
 * and address operations.
 *
 * **Python ctypes Compatibility**:
 * - `addressOf()` ≈ Python's `ctypes.addressof()`
 * - `byref()` ≈ Python's `ctypes.byref()`
 * - `cast()` ≈ Python's `ctypes.cast()`
 * - `POINTER()` ≈ Python's `ctypes.POINTER()`
 *
 * @example Basic pointer operations
 * ```javascript
 * import { addressOf, byref, cast, POINTER, c_int32 } from 'node-ctypes';
 *
 * const buf = Buffer.alloc(4);
 * const addr = addressOf(buf);       // Get buffer address
 * const ref = byref(buf);            // Pass by reference
 *
 * const IntPtr = POINTER(c_int32);   // Create pointer type
 * const ptr = IntPtr.create();       // NULL pointer
 * ```
 */

/**
 * Gets the memory address of a buffer or pointer.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.addressof()`.
 *
 * @param {Buffer|bigint|number} ptr - Buffer or address to get address of
 * @param {Function} alloc - alloc function reference
 * @param {Object} native - Native module reference
 * @returns {bigint} Memory address as BigInt
 *
 * @example Get buffer address
 * ```javascript
 * import { addressOf } from 'node-ctypes';
 *
 * const buf = Buffer.alloc(64);
 * const addr = addressOf(buf);
 * console.log(addr); // 0x7f8e4c000000n (example address)
 * ```
 *
 * @example Address of SimpleCData instance
 * ```javascript
 * const val = new c_int32(42);
 * const addr = addressOf(val._buffer);
 * ```
 */
export function addressOf(ptr, alloc, native) {
  if (Buffer.isBuffer(ptr)) {
    // Get the buffer's memory address
    const tempBuf = alloc(native.POINTER_SIZE);
    native.writeValue(tempBuf, native.CType.POINTER, ptr, 0);
    if (native.POINTER_SIZE === 8) return tempBuf.readBigUInt64LE(0);
    return BigInt(tempBuf.readUInt32LE(0));
  }
  if (typeof ptr === "bigint") {
    return ptr;
  }
  return BigInt(ptr);
}

/**
 * Passes an object by reference (Python byref equivalent).
 *
 * Returns the underlying buffer of a SimpleCData instance or the buffer itself.
 * This is useful for passing arguments to C functions that expect pointers.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.byref()`. Used to pass arguments by
 * reference without creating a full POINTER() type.
 *
 * @param {Buffer|Object} obj - Object to pass by reference
 *   - SimpleCData instance (has _buffer property)
 *   - Buffer object
 *   - Structure instance (has _buffer property)
 * @returns {Buffer} The underlying buffer
 * @throws {TypeError} If obj is not a ctypes instance or Buffer
 *
 * @example Pass SimpleCData by reference
 * ```javascript
 * import { byref, c_int32, CDLL } from 'node-ctypes';
 *
 * const libc = new CDLL(null);
 * const value = new c_int32(0);
 *
 * // C function: void get_value(int *out);
 * const get_value = libc.func('get_value', c_void, [c_void_p]);
 * get_value(byref(value));
 *
 * console.log(value.value); // Value set by C function
 * ```
 *
 * @example Pass struct by reference
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const point = Point.create({ x: 10, y: 20 });
 *
 * // C function: void move_point(Point *p, int dx, int dy);
 * const move_point = libc.func('move_point', c_void, [c_void_p, c_int32, c_int32]);
 * move_point(byref(point), 5, 10);
 * ```
 */
export function byref(obj) {
  // SimpleCData instance or Structure instance - return its buffer
  if (obj && obj._buffer && Buffer.isBuffer(obj._buffer)) {
    return obj._buffer;
  }
  // Buffer - return as-is
  if (Buffer.isBuffer(obj)) {
    return obj;
  }
  throw new TypeError("byref() argument must be a ctypes instance or Buffer");
}

/**
 * Casts a pointer to a different type.
 *
 * Interprets the memory at the pointer location as a different type.
 * This is a low-level operation that should be used with caution.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.cast()`.
 *
 * @param {Buffer|bigint} ptr - Source pointer
 * @param {Function|Object} targetType - Target type (SimpleCData class or struct def)
 * @param {Function} readValue - readValue function reference
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} ptrToBuffer - ptrToBuffer function reference
 * @returns {*} Value read as target type, or wrapper object for structs
 * @throws {TypeError} If ptr or targetType is invalid
 *
 * @example Cast pointer to different primitive type
 * ```javascript
 * import { cast, c_int32, c_float } from 'node-ctypes';
 *
 * const buf = Buffer.from([0x00, 0x00, 0x80, 0x3F]); // 1.0 as float
 * const int_val = cast(buf, c_int32);   // Read as int32
 * const float_val = cast(buf, c_float); // Read as float
 * console.log(int_val);   // 1065353216
 * console.log(float_val); // 1.0
 * ```
 *
 * @example Cast to struct
 * ```javascript
 * class Header extends Structure {
 *   static _fields_ = [
 *     ['magic', c_uint32],
 *     ['version', c_uint32]
 *   ];
 * }
 *
 * const buf = Buffer.from([0x4D, 0x5A, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
 * const header = cast(buf, Header._structDef);
 * console.log(header.contents); // { magic: 23117, version: 1 }
 * ```
 */
export function cast(ptr, targetType, readValue, sizeof, ptrToBuffer) {
  // Validate inputs
  if (!ptr) {
    throw new TypeError("cast() requires a non-null pointer");
  }
  if (!targetType) {
    throw new TypeError("cast() requires a target type");
  }

  // Struct type - return wrapper object
  if (typeof targetType === "object" && targetType.size !== undefined) {
    const buf = Buffer.isBuffer(ptr) ? ptr : ptrToBuffer(ptr, targetType.size);
    return {
      _buffer: buf,
      _struct: targetType,
      get contents() {
        return targetType.toObject(buf);
      },
      getField(name) {
        return targetType.get(buf, name);
      },
      setField(name, value) {
        targetType.set(buf, name, value);
      },
    };
  }

  // Primitive type - read and return value
  if (Buffer.isBuffer(ptr)) {
    return readValue(ptr, targetType, 0);
  }

  // BigInt/number address - convert to buffer and read
  const tempBuf = ptrToBuffer(ptr, sizeof(targetType));
  return readValue(tempBuf, targetType, 0);
}

/**
 * Creates a buffer backed by a specific memory address.
 *
 * **WARNING**: This is a low-level operation! Accessing invalid memory will
 * crash the process. Only use with addresses from trusted sources (FFI returns,
 * addressOf, etc.).
 *
 * @param {bigint|number} address - Memory address
 * @param {number} size - Size in bytes
 * @param {Object} native - Native module reference
 * @returns {Buffer} Buffer pointing to the address
 *
 * @example Read C string from pointer
 * ```javascript
 * import { ptrToBuffer } from 'node-ctypes';
 *
 * // Got pointer from C function
 * const str_ptr = some_c_function(); // Returns pointer
 * const buf = ptrToBuffer(str_ptr, 256);
 * const str = buf.toString('utf8');
 * ```
 *
 * @example Access struct at address
 * ```javascript
 * const addr = get_struct_ptr(); // From C
 * const buf = ptrToBuffer(addr, sizeof(MyStruct));
 * const struct_data = MyStruct.toObject(buf);
 * ```
 */
export function ptrToBuffer(address, size, native) {
  return native.ptrToBuffer(address, size);
}

/**
 * Creates a POINTER type for a base type.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.POINTER()`.
 *
 * Returns a type definition object with methods to create, dereference, and
 * manipulate pointers to the specified base type.
 *
 * @param {Function|Object} baseType - Type to create pointer for
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} alloc - alloc function reference
 * @param {Function} readValue - readValue function reference
 * @param {Function} writeValue - writeValue function reference
 * @param {Function} c_void_p - c_void_p type reference
 * @param {Object} native - Native module reference
 * @returns {Object} Pointer type definition with methods
 *
 * @example Create pointer type and NULL pointer
 * ```javascript
 * import { POINTER, c_int32 } from 'node-ctypes';
 *
 * const IntPtr = POINTER(c_int32);
 * const ptr = IntPtr.create(); // NULL pointer
 * ```
 *
 * @example Create pointer to existing buffer
 * ```javascript
 * const value_buf = Buffer.from([0x2A, 0x00, 0x00, 0x00]); // 42
 * const ptr = IntPtr.fromBuffer(value_buf);
 * ```
 *
 * @example Dereference pointer
 * ```javascript
 * const addr = ptr_func(); // Get pointer from C function
 * const IntPtr = POINTER(c_int32);
 * const ptr_buf = Buffer.alloc(8);
 * writeValue(ptr_buf, c_void_p, addr);
 * const addr_value = IntPtr.deref(ptr_buf);
 * ```
 *
 * @example Pointer to struct
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const PointPtr = POINTER(Point._structDef);
 * const ptr = PointPtr.create();
 * ```
 */
export function POINTER(baseType, sizeof, alloc, readValue, writeValue, c_void_p, native) {
  const baseSize = typeof baseType === "object" ? baseType.size : sizeof(baseType);
  const typeName = typeof baseType === "object" ? "struct" : baseType._type || "unknown";

  return {
    _pointerTo: baseType,
    _baseSize: baseSize,
    size: native.POINTER_SIZE,

    /**
     * Creates a NULL pointer.
     * @returns {Buffer} Buffer containing NULL pointer
     */
    create() {
      const buf = alloc(native.POINTER_SIZE);
      writeValue(buf, c_void_p, 0n);
      return buf;
    },

    /**
     * Creates a pointer to an existing buffer.
     * @param {Buffer} targetBuf - Target buffer to point to
     * @returns {Buffer} Buffer containing pointer to targetBuf
     */
    fromBuffer(targetBuf) {
      const buf = alloc(native.POINTER_SIZE);
      writeValue(buf, c_void_p, targetBuf);
      return buf;
    },

    /**
     * Dereferences the pointer (reads the address it points to).
     * @param {Buffer} ptrBuf - Buffer containing the pointer
     * @returns {bigint|null} Address value, or null if NULL pointer
     */
    deref(ptrBuf) {
      const addr = readValue(ptrBuf, c_void_p);
      if (addr === 0n || addr === null) {
        return null;
      }
      // For struct types, return address (can't safely create buffer without native support)
      if (typeof baseType === "object" && baseType.toObject) {
        return addr;
      }
      // For primitive types, return address
      return addr;
    },

    /**
     * Sets the pointer to point to a value or buffer.
     * @param {Buffer} ptrBuf - Buffer containing the pointer
     * @param {Buffer|bigint|number} value - Value to set (buffer or address)
     */
    set(ptrBuf, value) {
      if (Buffer.isBuffer(value)) {
        writeValue(ptrBuf, c_void_p, value);
      } else {
        writeValue(ptrBuf, c_void_p, value);
      }
    },

    /**
     * Returns string representation of pointer type.
     * @returns {string} Type name
     */
    toString() {
      return `POINTER(${typeName})`;
    },
  };
}
