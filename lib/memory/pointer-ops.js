/**
 * @file pointer-ops.js
 * @module memory/pointer-ops
 * @description Pointer operations: addressOf, byref, cast, ptrToBuffer and pointer().
 */

import { byrefOwners } from "../core/parameters.js";
import { keepAlive, keepFunctionOwner, keptObject, memoryDomain, pointerOwner, shareMemory } from "./ownership.js";
import { writePointerField } from "../structures/helpers/common.js";
import { isScalarSubclass, scalarView } from "../types/scalar-protocol.js";
import { flush, mirrorAddress, mirrorsActive, refresh } from "./mirror.js";

export const kPointerMemory = Symbol("pointerMemory");

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
  // Puntatore: l'indirizzo del puntatore stesso (Python addressof(p)), non
  // quello della memoria puntata.
  if (ptr && typeof ptr === "object" && ptr._pointerType !== undefined) {
    ptr = ptr._pointerSlot;
  }
  // Object wrapper (SimpleCData, Structure, Union, array proxy) → unwrap al Buffer.
  // Le istanze di array sono Proxy su un Buffer: Buffer.isBuffer() è vero in JS
  // ma il nativo non vede un Buffer, quindi si usa sempre `_buffer` se presente.
  if (ptr && typeof ptr === "object" && Buffer.isBuffer(ptr._buffer)) {
    ptr = ptr._buffer;
  }
  if (Buffer.isBuffer(ptr) || ArrayBuffer.isView(ptr) || ptr instanceof ArrayBuffer) {
    // Native API returns the buffer's memory address in one V8 boundary
    // crossing. The fallback path below (tempBuf + writeValue) is kept
    // for backward compatibility with older .node binaries that do not
    // expose `addressOf`.
    if (native.addressOf) return native.addressOf(ptr);
    const tempBuf = alloc(native.POINTER_SIZE);
    native.writeValue(tempBuf, native.CType.POINTER, ptr, 0);
    if (native.POINTER_SIZE === 8) return tempBuf.readBigUInt64LE(0);
    return BigInt(tempBuf.readUInt32LE(0));
  }
  if (typeof ptr === "bigint") return ptr;
  return BigInt(ptr);
}

/**
 * Passes an object by reference (Python byref equivalent).
 *
 * Returns an owner-retaining byte view, or an address carrier for offsets
 * outside the known buffer range.
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
 * @param {number} [offset=0] - Signed byte offset
 * @returns {Buffer|Object} Buffer view or owner-retaining address carrier
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
export function byref(obj, offset = 0, native) {
  if (!Number.isSafeInteger(offset)) throw new TypeError("byref() offset must be a safe integer");
  let buffer;
  // Puntatore: la memoria del puntatore (T**), così una funzione C può
  // scriverci un indirizzo e ri-puntarlo (Python byref(p)).
  if (obj && typeof obj === "object" && obj._pointerType !== undefined) {
    buffer = obj._pointerSlot;
  }
  // SimpleCData instance or Structure instance - return its buffer
  else if (obj && obj._buffer && Buffer.isBuffer(obj._buffer)) buffer = obj._buffer;
  // Buffer - return as-is
  else if (Buffer.isBuffer(obj)) buffer = obj;
  if (buffer === undefined) throw new TypeError("byref() argument must be a ctypes instance or Buffer");
  const type = obj._pointerType ?? obj._arrayType ?? (obj.constructor?._isSimpleCData || typeof obj.constructor?._buildStruct === "function" ? obj.constructor : obj._structDef);
  const view = offset >= 0 && offset <= buffer.length ? buffer.subarray(offset) : { address: (mirrorAddress(buffer) ?? native.addressOf(buffer)) + BigInt(offset) };
  if (!Buffer.isBuffer(view)) Object.defineProperty(view, "_as_parameter_", { value: view.address });
  byrefOwners.set(view, { owner: obj, type, offset });
  return view;
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
  if (!ptr && !(targetType?._pointerTo !== undefined || targetType?._isPointerValued === true)) {
    throw new TypeError("cast() requires a non-null pointer");
  }
  if (!targetType) {
    throw new TypeError("cast() requires a target type");
  }
  if (ArrayBuffer.isView(ptr) && !Buffer.isBuffer(ptr)) ptr = Buffer.from(ptr.buffer, ptr.byteOffset, ptr.byteLength);
  else if (ptr instanceof ArrayBuffer) ptr = Buffer.from(ptr);

  // PointerTypeDef — return a PointerInstance via fromAddress() or fromBuffer()
  // Python equivalent: cast(c_void_p(addr), POINTER(c_int32)) — read stored address
  // Python equivalent: cast(arr, POINTER(c_int32))  — pointer to arr's memory
  // Python equivalent: cast(p, POINTER(c_double))   — pointer to same memory as p
  if (typeof targetType === "object" && targetType._pointerTo !== undefined) {
    if (!ptr) return targetType.fromAddress(0n);
    // PointerInstance — use its address/buffer (Python: cast(p, POINTER(OtherType)))
    if (ptr && typeof ptr === "object" && typeof ptr.address === "bigint") {
      if (ptr._buffer) {
        return targetType.fromBuffer(ptr._buffer);
      }
      return targetType.fromAddress(ptr.address, ptr);
    }

    // ctypes object with _buffer — distinguish data objects from pointer-value objects
    // Note: array proxies are Buffer.isBuffer()==true but also have ._buffer, so don't exclude Buffers
    if (ptr && typeof ptr === "object" && ptr._buffer && Buffer.isBuffer(ptr._buffer)) {
      // SimpleCData storing a pointer/address value (c_void_p, c_char_p,
      // c_wchar_p) → read the stored address value from the buffer
      const pointerValued = new Set([native.CType.POINTER, native.CType.STRING, native.CType.WSTRING]);
      if (ptr.constructor && ptr.constructor._isSimpleCData && pointerValued.has(ptr.constructor._type)) {
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
        // Python: il risultato tiene viva la sorgente (la stringa di un c_char_p).
        return targetType.fromAddress(addr, ptr);
      }
      // Array, Structure, Union — pointer to their data buffer
      // Python: cast(arr, POINTER(c_int32)) points to arr's memory
      return targetType.fromBuffer(ptr._buffer);
    }

    // Buffer generico → Python ctypes semantic: `cast(buf, POINTER(T))`
    // ritorna un pointer ALLA memoria del buffer (fromBuffer), NON legge
    // i byte del buffer come valore pointer.
    //
    // Il ramo "buffer letto come address" sopra resta per i soli SimpleCData
    // di tipo CTYPES_POINTER (c_void_p, c_char_p, ecc.) dove il buffer
    // interno memorizza davvero un pointer.
    if (Buffer.isBuffer(ptr)) {
      return targetType.fromBuffer(ptr);
    }

    return targetType.fromAddress(castSourceAddress(ptr, native), ptr);
  }

  if (typeof targetType === "function" && targetType._isFuncPtr === true) {
    return keepFunctionOwner(targetType(castSourceAddress(ptr, native)), ptr);
  }

  // c_void_p / c_char_p / c_wchar_p: an instance pointing to the source,
  // which it keeps alive (Python: cast(buf, c_void_p).value == addressof(buf)).
  if (typeof targetType === "function" && targetType._isSimpleCData === true && isPointerValued(targetType, native)) {
    const result = new targetType();
    writePointerField(result._buffer, 0, ptr == null || ptr === 0 || ptr === 0n ? 0n : castSourceAddress(ptr, native), native.POINTER_SIZE);
    if (typeof ptr === "object" || typeof ptr === "function") keepAlive(result._buffer, 0, ptr);
    return result;
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

function isPointerValued(type, native) {
  return type._type === native.CType.POINTER || type._type === native.CType.STRING || type._type === native.CType.WSTRING;
}

// Address given by a cast() source, as Python's c_void_p.from_param: the value
// of pointers, c_void_p, c_char_p and c_wchar_p, the memory of the others.
function castSourceAddress(ptr, native) {
  if (typeof ptr === "bigint") return ptr;
  if (typeof ptr === "number") return BigInt(ptr);
  if (ptr !== null && (typeof ptr === "object" || typeof ptr === "function")) {
    if (ptr._pointerType !== undefined) return ptr.address;
    const T = ptr.constructor;
    if (T?._isSimpleCData === true && isPointerValued(T, native)) {
      return native.POINTER_SIZE === 8 ? ptr._buffer.readBigUInt64LE(0) : BigInt(ptr._buffer.readUInt32LE(0));
    }
    if (Buffer.isBuffer(ptr._buffer)) return addressOf(ptr._buffer, null, native);
    if (Buffer.isBuffer(ptr)) return addressOf(ptr, null, native);
    const parameter = ptr._as_parameter_;
    if (parameter !== undefined) return castSourceAddress(parameter, native);
  }
  throw new TypeError("cast(): ptr must be a BigInt, number, Buffer, ctypes instance, or PointerInstance");
}

/**
 * Buffer over the memory at an address, used by `from_address`, `cast` and
 * pointers (not exported: the public, Python-compatible way is
 * `array(c_uint8, n).from_address(address)`). Where external buffers are not
 * allowed it is a synchronized copy (see memory/mirror.js).
 *
 * @param {bigint|number} address - Memory address
 * @param {number} size - Size in bytes
 * @param {Object} native - Native module reference
 * @returns {Buffer|null} Buffer over the address, `null` for NULL
 * @private
 */
export function ptrToBuffer(address, size, native) {
  return native.ptrToBuffer(address, size);
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
 */
export function pointer(obj, POINTER_fn, sizeof, alloc, readValue, writeValue, c_void_p, native) {
  let targetBuffer;
  let baseType;

  if (obj !== null && typeof obj === "object" && obj._pointerType !== undefined) {
    targetBuffer = obj._pointerSlot;
    baseType = obj._pointerType;
  }
  // Array proxies expose their actual memory through _buffer.
  else if (obj !== null && typeof obj === "object" && Buffer.isBuffer(obj._buffer)) {
    // Structure/Union instance, array or SimpleCData with _buffer
    targetBuffer = obj._buffer;
    // Get the base type for POINTER creation
    if (obj._arrayType !== undefined) {
      // Python: pointer(c_int * 3 instance) è un POINTER(c_int * 3).
      baseType = obj._arrayType;
    } else if (obj.constructor && obj.constructor._type) {
      // SimpleCData instance - use the class itself (c_int32, c_double, etc.)
      baseType = obj.constructor;
    } else if (obj._structDef) {
      // Structure/Union instance: the class, so `.contents` is an instance of it (Python parity)
      baseType = typeof obj.constructor === "function" && obj.constructor._fields_ !== undefined ? obj.constructor : obj._structDef;
    } else {
      baseType = c_void_p;
    }
  } else if (Buffer.isBuffer(obj)) {
    targetBuffer = obj;
    baseType = c_void_p; // Generic pointer
  } else {
    throw new TypeError("pointer() argument must be a ctypes instance or Buffer");
  }

  const PtrType = POINTER_fn(baseType, sizeof, alloc, readValue, writeValue, c_void_p, native);
  return PtrType.fromBuffer(targetBuffer);
}
