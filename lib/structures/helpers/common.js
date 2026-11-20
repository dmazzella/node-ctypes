/** Field declarations, accessors and value assignment for aggregate types. */
import { resolveParameter } from "../../core/parameters.js";
import { copyInstance, keepAlive, keepFunctionOwner } from "../../memory/ownership.js";

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
 * Writer of a SimpleCData field of a struct/union. An instance assigned to the
 * field (or given as positional initializer) is copied when it has the same
 * type, as Python (pointers keep the instance alive); another SimpleCData type
 * is "incompatible types" (c_void_p fields accept the pointer types).
 *
 * @param {Function} fieldType - SimpleCData class of the field
 * @param {Function} writer - `(buf, offset, value)` writer
 * @param {number} offset - Field offset
 * @returns {Function} `(buf, value, relativeOffset = 0)` writer
 */
export function simpleFieldWriter(fieldType, writer, offset) {
  const pointerValued = fieldType._isPointerValued === true;
  return (buf, val, relativeOffset = 0) => {
    const fieldOffset = offset + relativeOffset;
    if (typeof val === "object" && val !== null && val.constructor?._isSimpleCData === true) {
      const T = val.constructor;
      if (T._type === fieldType._type && T._size === fieldType._size && T._isBoolean === fieldType._isBoolean) {
        if (!pointerValued) return writer(buf, fieldOffset, val.value);
        copyInstance(buf, fieldOffset, T._size, val, 0, fieldType);
        return;
      }
      if (!(fieldType._acceptsPointerValues === true && T._isPointerValued === true)) {
        throw new TypeError(`incompatible types, ${T.name} instance instead of ${fieldType.name} instance`);
      }
    }
    writer(buf, fieldOffset, val);
  };
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
  value = resolveParameter(value);
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value === null || value === undefined) return 0n;
  if (typeof value === "object" || typeof value === "function") {
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
    fieldType = {
      _pointerTo: prototype,
      _isFuncPtrField: true,
      fromAddress: (address, owner) => keepFunctionOwner(prototype(address), owner),
    };
    funcPtrFieldTypes.set(prototype, fieldType);
  }
  return fieldType;
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
 * Fields given to struct() / union(): `[name, type]` pairs in declaration
 * order (Structure._fieldMap; an object would put integer-like names such as
 * "1" first), a Map or a `{ name: type }` object.
 *
 * @param {Array|Map|Object} fields - Field declarations
 * @returns {Array} `[name, type]` pairs
 */
export function fieldEntries(fields) {
  if (Array.isArray(fields)) return fields;
  if (fields instanceof Map) return [...fields];
  return Object.entries(fields);
}

/**
 * Fields of a value used as "name → value" map: a struct/union instance (its
 * fields are accessors of its class, not own properties) becomes the object
 * of its fields, any other value is returned as is.
 *
 * @param {*} value - Plain object or instance
 * @returns {*} Object whose own properties are the fields
 */
export function fieldsOf(value) {
  if (value !== null && typeof value === "object" && Buffer.isBuffer(value._buffer) && typeof value.toObject === "function") {
    return value.toObject();
  }
  return value;
}
