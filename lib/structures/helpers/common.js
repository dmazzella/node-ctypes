import { flush, kMirrorBase, mirrorBase, mirroredPrototype, mirrorsActive, refresh } from "../../memory/mirror.js";
import { POINTER_SIZE } from "../../platform/constants.js";

const simpleTypes = new WeakSet();
export const byrefOwners = new WeakMap();

export function resolveParameter(value, owners) {
  let seen;
  for (let depth = 0; value !== null && (typeof value === "object" || typeof value === "function"); depth++) {
    if (owners !== undefined) owners.push(value);
    if (ArrayBuffer.isView(value) && !("_as_parameter_" in value)) return value;
    if (value._isSimpleCDataInstance === true || value._pointerType !== undefined || value._arrayType !== undefined || value._structDef !== undefined || byrefOwners.has(value)) return value;
    const parameter = value._as_parameter_;
    if (parameter === undefined) return value;
    if (depth >= 128) throw new RangeError("_as_parameter_ maximum depth exceeded");
    seen ??= new Set();
    if (seen.has(value)) throw new TypeError("_as_parameter_ cycle detected");
    seen.add(value);
    value = parameter;
  }
  return value;
}

export function sourceBytes(source, offset, size, name) {
  const bytes = source !== null && typeof source === "object" && !ArrayBuffer.isView(source) && Buffer.isBuffer(source._buffer) ? source._buffer : source;
  if (!ArrayBuffer.isView(bytes)) throw new TypeError(`${name}: source must be a Buffer, a typed array or a ctypes instance`);
  if (!Number.isSafeInteger(offset)) throw new TypeError(`${name}: offset must be a safe integer`);
  if (offset < 0) throw new RangeError(`${name}: offset cannot be negative`);
  if (bytes.byteLength - offset < size) throw new RangeError(`${name}: Buffer size too small (${bytes.byteLength} instead of at least ${size + offset} bytes)`);
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function registerSimpleType(type) {
  simpleTypes.add(type);
}

export function isScalarSubclass(type) {
  return typeof type === "function" && type._isSimpleCData === true && !simpleTypes.has(type);
}

export function scalarView(type, buffer, swapped = false) {
  // C-owned representations must bypass application constructors and writers.
  const base = mirrorsActive ? mirrorBase(buffer) : undefined;
  const value = Object.create(base === undefined ? type.prototype : mirroredPrototype(type));
  value._buffer = buffer;
  if (base !== undefined) value[kMirrorBase] = base;
  if (swapped && type._readerBE && type._writerBE) {
    Object.defineProperty(value, "value", {
      get() {
        if (base !== undefined) refresh(buffer);
        return type._readerBE(buffer, 0);
      },
      set(v) {
        type._writerBE(buffer, 0, v);
        if (base !== undefined) flush(buffer);
      },
    });
  }
  return value;
}

export function scalarReader(type, reader, swapped = false) {
  return isScalarSubclass(type) ? (buffer, offset) => scalarView(type, buffer.subarray(offset, offset + type._size), swapped) : reader;
}

export function scalarOutparam() {
  return isScalarSubclass(this.constructor) ? this : this.value;
}

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
 * Python: a float is not an integer ("'float' object cannot be interpreted as
 * an integer"); in JS, numbers that are not integral (or not finite).
 *
 * @throws {TypeError}
 */
export function notIntegral() {
  throw new TypeError("'float' object cannot be interpreted as an integer");
}

export function booleanValue(value) {
  return !!(value !== null && typeof value === "object" && value._isSimpleCDataInstance === true ? value.value : value);
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

export function keepFunctionOwner(fn, owner) {
  if (owner !== undefined) {
    Object.defineProperty(fn, "_objects", { value: owner });
    // AsyncWorker pins the native handle, not its public JS function.
    Object.defineProperty(fn._ffi, "_objects", { value: owner });
  }
  return fn;
}

// Oggetti tenuti vivi dalla memoria che contiene i loro indirizzi, per
// ArrayBuffer e offset assoluto: tutte le view sulla stessa memoria (istanza,
// struct annidata, from_buffer) condividono la stessa tabella.
const keptObjects = new WeakMap();
const memoryOwners = new WeakMap();
// Address-backed aliases share the reference table of their known owner.
const memoryDomains = new WeakMap();
export const kPointerMemory = Symbol("pointerMemory");

export function memoryDomain(buf) {
  return memoryDomains.get(buf.buffer) ?? { root: buf.buffer, offset: 0n };
}

function memoryPosition(buf, offset) {
  return BigInt(buf.byteOffset + offset) + (memoryDomains.get(buf.buffer)?.offset ?? 0n);
}

export function shareMemory(buf, memory, position) {
  memoryDomains.set(buf.buffer, { root: memory.root, offset: position - BigInt(buf.byteOffset) });
  return keepMemoryOwner(buf, memory);
}

// Attach to the backing store, so subarrays and typed arrays keep the lease too.
export function keepMemoryOwner(buf, owner) {
  if (owner === undefined || owner === null) return buf;
  let owners = memoryOwners.get(buf.buffer);
  if (owners === undefined) memoryOwners.set(buf.buffer, (owners = new Set()));
  owners.add(owner);
  return buf;
}

function storedAddress(buf, offset) {
  return POINTER_SIZE === 8 ? buf.readBigUInt64LE(offset) : BigInt(buf.readUInt32LE(offset));
}

export function pointerOwner(buf, offset, address) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  const kept = keptObjects.get(root);
  if (kept === undefined) return buf;
  const position = memoryPosition(buf, offset);
  const reference = kept.get(position);
  if (reference !== undefined && reference.address !== (address ?? storedAddress(buf, offset))) {
    kept.delete(position);
    return buf;
  }
  return reference?.owner ?? buf;
}

export function inDllBuffer(library, name, size, ptrToBuffer) {
  const lib = library?._lib ?? library;
  if (typeof lib?._symbolView !== "function") throw new TypeError("in_dll: first arg must be a Library (CDLL/WinDLL)");
  const { address, owner } = lib._symbolView(name);
  return keepMemoryOwner(ptrToBuffer(address, size), owner);
}

function pointerSlots(type, offset = 0, size) {
  if (type?._isPointerValued || type?._isFuncPtr || type?._pointerTo !== undefined) return [[offset, type._size ?? type.size ?? size]];
  if (type?._isArrayType) {
    const slots = [];
    const elementSize = type.length === 0 ? 0 : type.getSize() / type.length;
    const elements = pointerSlots(type.elementType, 0, elementSize);
    if (elements.length === 0) return slots;
    for (let i = 0; i < type.length; i++) {
      for (const [position, width] of elements) slots.push([offset + i * elementSize + position, width]);
    }
    return slots;
  }
  const def = typeof type?._buildStruct === "function" ? (type._structDef ?? type._buildStruct()) : type;
  const slots = [];
  for (const field of def?.fields ?? []) {
    if (field.isPointer) slots.push([offset + field.offset, field.size]);
    else slots.push(...pointerSlots(field.type, offset + field.offset, field.size));
  }
  return slots;
}

/**
 * Keep `value` alive as long as the memory of `targetBuf`, like Python ctypes
 * `_objects`: an object whose address is stored in the buffer (string,
 * pointer, callback) must not be garbage collected while native code can
 * still read that address. The table belongs to the memory, not to the view,
 * so assigning through a nested structure keeps the object alive with the
 * outer one.
 *
 * @param {Uint8Array} targetBuf - Buffer holding the address
 * @param {number} offset - Offset of the slot in `targetBuf`
 * @param {*} value - Referenced object (or null to clear the slot)
 */
export function keepAlive(targetBuf, offset, value) {
  const position = memoryPosition(targetBuf, offset);
  const root = memoryDomains.get(targetBuf.buffer)?.root ?? targetBuf.buffer;
  let kept = keptObjects.get(root);
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    kept?.delete(position);
    return;
  }
  if (kept === undefined) {
    kept = new Map();
    keptObjects.set(root, kept);
  }
  // A pointer wrapper can later be repointed; retain its current memory.
  if (value._pointerType !== undefined) value = value._buffer ?? value._objects ?? value;
  else if (value._isSimpleCDataInstance && value.constructor._isPointerValued) value = pointerOwner(value._buffer, 0);
  kept.set(position, { owner: value, address: storedAddress(targetBuf, offset) });
}

/**
 * Object kept alive at `offset` of `buf` (see {@link keepAlive}).
 *
 * @param {Uint8Array} buf - Buffer
 * @param {number} offset - Offset in `buf`
 * @returns {*} The object, or undefined
 */
export function keptObject(buf, offset) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  return keptObjects.get(root)?.get(memoryPosition(buf, offset))?.owner;
}

export function clearKeepAlives(buf, offset, size) {
  const root = memoryDomains.get(buf.buffer)?.root ?? buf.buffer;
  const kept = keptObjects.get(root);
  if (kept === undefined) return;
  const start = BigInt(memoryPosition(buf, offset));
  const end = start + BigInt(size);
  for (const position of kept.keys()) {
    if (position >= start && position < end) kept.delete(position);
  }
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

/**
 * Copy a struct/union instance into a nested field: the bytes (as Python
 * does) plus the objects it keeps alive (strings, pointers, callbacks), so
 * the addresses copied with them stay valid.
 *
 * @param {Buffer} buf - Target buffer
 * @param {number} offset - Field offset
 * @param {number} size - Field size
 * @param {Object|Buffer} value - Instance with a `_buffer`, or source bytes
 * @param {number} [sourceOffset=0] - Byte offset in the source
 * @param {Function|Object} [type] - Layout used to retain references into leased memory
 */
export function copyInstance(buf, offset, size, value, sourceOffset = 0, type) {
  const bytes = value._buffer ?? value;
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mirrorsActive) refresh(source, sourceOffset, size);
  const start = memoryPosition(source, sourceOffset);
  const sourceRoot = memoryDomains.get(source.buffer)?.root ?? source.buffer;
  const sourceKept = keptObjects.get(sourceRoot);
  const snapshot = new Map();
  if (sourceKept !== undefined) {
    for (const [position, reference] of sourceKept) {
      if (position < start || position + BigInt(POINTER_SIZE) > start + BigInt(size)) continue;
      const relative = Number(position - start);
      if (reference.address === storedAddress(source, sourceOffset + relative)) snapshot.set(relative, reference.owner);
    }
  }
  if (type !== undefined && memoryOwners.has(source.buffer)) {
    for (const [position, width] of pointerSlots(type)) {
      if (snapshot.has(position) || position + width > size) continue;
      for (let i = 0; i < width; i++) {
        if (source[sourceOffset + position + i] !== 0) {
          snapshot.set(position, source);
          break;
        }
      }
    }
  }
  source.copy(buf, offset, sourceOffset, sourceOffset + size);
  clearKeepAlives(buf, offset, size);
  for (const [relative, object] of snapshot) keepAlive(buf, offset + relative, object);
  if (mirrorsActive) flush(buf, offset, size);
}
