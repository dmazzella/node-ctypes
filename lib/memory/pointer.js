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
  // If it's an object with _buffer (SimpleCData, Structure, Union, array proxy), use its buffer
  if (!Buffer.isBuffer(ptr) && ptr && ptr._buffer && Buffer.isBuffer(ptr._buffer)) {
    ptr = ptr._buffer;
  }
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
export function cast(ptr, targetType, readValue, sizeof, ptrToBuffer, native) {
  // Validate inputs
  if (!ptr) {
    throw new TypeError("cast() requires a non-null pointer");
  }
  if (!targetType) {
    throw new TypeError("cast() requires a target type");
  }

  // PointerTypeDef — return a PointerInstance via fromAddress() or fromBuffer()
  // Python equivalent: cast(c_void_p(addr), POINTER(c_int32)) — read stored address
  // Python equivalent: cast(arr, POINTER(c_int32))  — pointer to arr's memory
  // Python equivalent: cast(p, POINTER(c_double))   — pointer to same memory as p
  if (typeof targetType === "object" && targetType._pointerTo !== undefined) {
    // PointerInstance — use its address/buffer (Python: cast(p, POINTER(OtherType)))
    if (ptr && typeof ptr === "object" && typeof ptr.address === "bigint") {
      if (ptr._buffer) {
        return targetType.fromBuffer(ptr._buffer);
      }
      return targetType.fromAddress(ptr.address);
    }

    // ctypes object with _buffer — distinguish data objects from pointer-value objects
    // Note: array proxies are Buffer.isBuffer()==true but also have ._buffer, so don't exclude Buffers
    if (ptr && typeof ptr === "object" && ptr._buffer && Buffer.isBuffer(ptr._buffer)) {
      // SimpleCData storing a pointer/address value (c_void_p, c_char_p, etc.)
      // → read the stored address value from the buffer
      if (ptr.constructor && ptr.constructor._isSimpleCData && ptr.constructor._type === native.CType.POINTER) {
        // This is a pointer-valued SimpleCData — read address from buffer
        const buf = ptr._buffer;
        let addr;
        if (buf.length >= 8) {
          addr = buf.readBigUInt64LE(0);
        } else if (buf.length >= 4) {
          addr = BigInt(buf.readUInt32LE(0));
        } else {
          throw new TypeError("cast(): buffer too small to contain a pointer");
        }
        return targetType.fromAddress(addr);
      }
      // Array, Structure, Union — pointer to their data buffer
      // Python: cast(arr, POINTER(c_int32)) points to arr's memory
      return targetType.fromBuffer(ptr._buffer);
    }

    let addr;
    if (typeof ptr === "bigint") {
      addr = ptr;
    } else if (typeof ptr === "number") {
      addr = BigInt(ptr);
    } else if (Buffer.isBuffer(ptr)) {
      // Read the pointer value from the buffer
      if (ptr.length >= 8) {
        addr = ptr.readBigUInt64LE(0);
      } else if (ptr.length >= 4) {
        addr = BigInt(ptr.readUInt32LE(0));
      } else {
        throw new TypeError("cast(): buffer too small to contain a pointer");
      }
    } else {
      throw new TypeError("cast(): ptr must be a BigInt, number, Buffer, ctypes instance, or PointerInstance");
    }
    return targetType.fromAddress(addr);
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
  const typeName = typeof baseType === "object" ? "struct" : baseType._type || baseType.name || "unknown";

  /**
   * Helper to get buffer's memory address using native writeValue
   */
  function getBufferAddress(buf) {
    const tempBuf = alloc(native.POINTER_SIZE);
    native.writeValue(tempBuf, native.CType.POINTER, buf, 0);
    if (native.POINTER_SIZE === 8) return tempBuf.readBigUInt64LE(0);
    return BigInt(tempBuf.readUInt32LE(0));
  }

  /**
   * Creates a pointer instance with Python ctypes-compatible API.
   * Supports .contents property and [index] access for pointer arithmetic.
   */
  function createPointerInstance(addressOrBuffer) {
    let _address = 0n;
    let _buffer = null;

    if (addressOrBuffer === undefined || addressOrBuffer === null) {
      _address = 0n;
    } else if (typeof addressOrBuffer === "bigint") {
      _address = addressOrBuffer;
    } else if (typeof addressOrBuffer === "number") {
      _address = BigInt(addressOrBuffer);
    } else if (Buffer.isBuffer(addressOrBuffer)) {
      // This is a buffer we're pointing TO
      _buffer = addressOrBuffer;
      _address = getBufferAddress(addressOrBuffer);
    }

    const instance = {
      _pointerType: PointerType,
      _baseType: baseType,
      _baseSize: baseSize,

      /**
       * Get the raw address as BigInt
       */
      get address() {
        return _address;
      },

      /**
       * Python ctypes compatible: get/set the value at the pointed location.
       * In Python: p.contents returns the dereferenced value.
       */
      get contents() {
        if (_address === 0n && !_buffer) {
          throw new Error("NULL pointer access");
        }
        if (_buffer) {
          // We have the actual buffer, read from it
          return readValue(_buffer, baseType, 0);
        }
        // We only have address - need native support to read
        const buf = native.ptrToBuffer(_address, baseSize);
        return readValue(buf, baseType, 0);
      },

      set contents(value) {
        if (_address === 0n && !_buffer) {
          throw new Error("NULL pointer access");
        }
        if (_buffer) {
          writeValue(_buffer, baseType, value, 0);
        } else {
          const buf = native.ptrToBuffer(_address, baseSize);
          writeValue(buf, baseType, value, 0);
        }
      },

      /**
       * Returns the buffer this pointer points to (if available)
       */
      get _buffer() {
        return _buffer;
      },

      /**
       * Dereference - alias for contents getter
       */
      deref() {
        return this.contents;
      },

      /**
       * Set pointer to point to a new address/buffer
       */
      set(value) {
        if (Buffer.isBuffer(value)) {
          _buffer = value;
          _address = getBufferAddress(value);
        } else if (typeof value === "bigint") {
          _address = value;
          _buffer = null;
        } else if (typeof value === "number") {
          _address = BigInt(value);
          _buffer = null;
        }
      },

      /**
       * Check if pointer is NULL
       */
      get isNull() {
        return _address === 0n && !_buffer;
      },

      /**
       * For compatibility - get pointer as buffer (8 bytes containing address)
       */
      toBuffer() {
        const buf = alloc(native.POINTER_SIZE);
        writeValue(buf, c_void_p, _address);
        return buf;
      },

      toString() {
        return `<${typeName} pointer at 0x${_address.toString(16)}>`;
      },
    };

    // Use Proxy for [index] access (pointer arithmetic)
    return new Proxy(instance, {
      get(target, prop, receiver) {
        // Numeric index access: p[0], p[1], etc.
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          const index = parseInt(prop, 10);
          if (target.isNull) {
            throw new Error("NULL pointer access");
          }
          const offset = index * baseSize;
          if (_buffer && offset + baseSize <= _buffer.length) {
            return readValue(_buffer, baseType, offset);
          }
          // Use native to read at address + offset
          const addr = _address + BigInt(offset);
          const buf = native.ptrToBuffer(addr, baseSize);
          return readValue(buf, baseType, 0);
        }
        return Reflect.get(target, prop, receiver);
      },

      set(target, prop, value, receiver) {
        // Numeric index access: p[0] = value, p[1] = value, etc.
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          const index = parseInt(prop, 10);
          if (target.isNull) {
            throw new Error("NULL pointer access");
          }
          const offset = index * baseSize;
          if (_buffer && offset + baseSize <= _buffer.length) {
            writeValue(_buffer, baseType, value, offset);
            return true;
          }
          // Use native to write at address + offset
          const addr = _address + BigInt(offset);
          const buf = native.ptrToBuffer(addr, baseSize);
          writeValue(buf, baseType, value, 0);
          return true;
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });
  }

  /**
   * Pointer type factory - creates pointer instances
   */
  const PointerType = {
    _pointerTo: baseType,
    _baseSize: baseSize,
    size: native.POINTER_SIZE,

    /**
     * Creates a new pointer instance.
     * @param {Buffer|bigint|number} [value] - Initial value (buffer to point to, or address)
     * @returns {Object} Pointer instance with .contents and [index] access
     */
    create(value) {
      return createPointerInstance(value);
    },

    /**
     * Creates a pointer from an existing buffer (points to that buffer).
     * @param {Buffer} targetBuf - Buffer to point to
     * @returns {Object} Pointer instance
     */
    fromBuffer(targetBuf) {
      return createPointerInstance(targetBuf);
    },

    /**
     * Creates a pointer from a raw address.
     * @param {bigint|number} address - Memory address
     * @returns {Object} Pointer instance
     */
    fromAddress(address) {
      return createPointerInstance(typeof address === "bigint" ? address : BigInt(address));
    },

    /**
     * Legacy API: Dereferences a pointer buffer.
     * @deprecated Use pointer instance .contents instead
     */
    deref(ptrBuf) {
      const addr = readValue(ptrBuf, c_void_p);
      if (addr === 0n || addr === null) {
        return null;
      }
      if (typeof baseType === "object" && baseType.toObject) {
        return addr;
      }
      return addr;
    },

    /**
     * Legacy API: Sets pointer buffer value.
     * @deprecated Use pointer instance .set() instead
     */
    set(ptrBuf, value) {
      if (Buffer.isBuffer(value)) {
        writeValue(ptrBuf, c_void_p, value);
      } else {
        writeValue(ptrBuf, c_void_p, value);
      }
    },

    toString() {
      return `POINTER(${typeName})`;
    },
  };

  return PointerType;
}

/**
 * Creates a pointer to an existing ctypes object.
 * Python ctypes compatible: pointer(obj) returns a pointer to obj.
 *
 * @param {Object} obj - Object to create pointer to (must have ._buffer or be a Buffer)
 * @param {Function} POINTER_fn - POINTER function reference
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} alloc - alloc function reference
 * @param {Function} readValue - readValue function reference
 * @param {Function} writeValue - writeValue function reference
 * @param {Function} c_void_p - c_void_p type reference
 * @param {Object} native - Native module reference
 * @returns {Object} Pointer instance pointing to obj
 *
 * @example
 * ```javascript
 * const x = new c_int32(42);
 * const p = pointer(x);
 * console.log(p.contents); // 42
 * p.contents = 100;
 * console.log(x.value); // 100
 * ```
 */
export function pointer(obj, POINTER_fn, sizeof, alloc, readValue, writeValue, c_void_p, native) {
  let targetBuffer;
  let baseType;

  if (Buffer.isBuffer(obj)) {
    targetBuffer = obj;
    baseType = c_void_p; // Generic pointer
  } else if (obj && obj._buffer) {
    // Structure/Union instance or SimpleCData with _buffer
    targetBuffer = obj._buffer;
    // Get the base type for POINTER creation
    if (obj.constructor && obj.constructor._type) {
      // SimpleCData instance - use the class itself (c_int32, c_double, etc.)
      baseType = obj.constructor;
    } else if (obj._structDef) {
      // Structure/Union instance - use the struct def object
      // (obj.constructor is a bound function from Proxy, so we use _structDef directly)
      baseType = obj._structDef;
    } else {
      baseType = c_void_p;
    }
  } else {
    throw new TypeError("pointer() argument must be a ctypes instance or Buffer");
  }

  const PtrType = POINTER_fn(baseType, sizeof, alloc, readValue, writeValue, c_void_p, native);
  return PtrType.fromBuffer(targetBuffer);
}
