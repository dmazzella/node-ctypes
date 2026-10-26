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

import { byrefOwners, isScalarSubclass, keepAlive, keepFunctionOwner, keptObject, kPointerMemory, memoryDomain, pointerOwner, scalarView, shareMemory, writePointerField } from "../structures/helpers/common.js";
import { flush, mirrorAddress, mirrorsActive, refresh } from "./mirror.js";

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

// Indice per chiavi composte solo da cifre ("0", "12"); -1 altrimenti.
// Equivale a /^\d+$/ + parseInt senza eseguire una regex ad ogni accesso.
function digitIndex(prop) {
  if (typeof prop !== "string" || prop.length === 0) return -1;
  for (let i = 0; i < prop.length; i++) {
    const c = prop.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
  }
  return parseInt(prop, 10);
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
  // Python ctypes parity: linked-list style `class Node extends Structure {
  // static _fields_ = [['next', POINTER(Node)]] }` fallisce perché `Node`
  // è in binding parziale al tempo della valutazione dello static field.
  // Accettiamo un thunk `POINTER(() => Node)` che viene risolto lazy al
  // primo accesso (quando la classe è ormai completamente definita).
  //
  // Un thunk è una function "pura": NON è una SimpleCData class, NON è
  // una Structure/Union subclass (non ha _buildStruct/_buildUnion), NON
  // è un altro POINTER (_pointerTo), NON è un StructType nativo.
  const isLazyThunk =
    typeof baseType === "function" &&
    !baseType._isSimpleCData &&
    typeof baseType._buildStruct !== "function" &&
    typeof baseType._buildUnion !== "function" &&
    !baseType._pointerTo &&
    !baseType._isStructType &&
    !baseType._isArrayType &&
    !baseType._isFuncPtr;

  const isAggregate = (type) => typeof type === "function" && (typeof type._buildStruct === "function" || typeof type._buildUnion === "function");
  // A pointer does not materialize or finalize its incomplete pointee.
  let baseSize;
  let scalarSubclass = isScalarSubclass(baseType);
  let _lazyResolved = false;
  function resolveType() {
    if (!isLazyThunk || _lazyResolved) return;
    baseType = baseType();
    scalarSubclass = isScalarSubclass(baseType);
    _lazyResolved = true;
    if (!isAggregate(baseType)) baseSize = typeof baseType === "object" ? baseType.size : sizeof(baseType);
  }
  function resolveSize() {
    resolveType();
    baseSize ??= typeof baseType === "object" ? baseType.size : sizeof(baseType);
  }
  if (!isLazyThunk && !isAggregate(baseType)) {
    baseSize = typeof baseType === "object" ? baseType.size : sizeof(baseType);
  }

  const typeName = isLazyThunk ? "lazy" : typeof baseType === "object" ? "struct" : baseType._type || baseType.name || "unknown";

  /**
   * Helper to get buffer's memory address using native writeValue
   */
  function getBufferAddress(buf) {
    // Direct native.addressOf (single V8 boundary).
    if (native.addressOf) return native.addressOf(buf);
    const tempBuf = alloc(native.POINTER_SIZE);
    native.writeValue(tempBuf, native.CType.POINTER, buf, 0);
    if (native.POINTER_SIZE === 8) return tempBuf.readBigUInt64LE(0);
    return BigInt(tempBuf.readUInt32LE(0));
  }

  // Python: per tipi semplici e Structure/Union `contents` (e p[i] per le struct)
  // è un'istanza viva sulla memoria puntata, non una copia del valore.
  // Array (Python POINTER(c_int * 3)): contents e p[i] sono istanze dell'array.
  const isArrayBase = () => baseType !== null && (typeof baseType === "function" || typeof baseType === "object") && baseType._isArrayType === true;
  const hasInstances = () => isArrayBase() || (typeof baseType === "function" && (baseType._isSimpleCData === true || typeof baseType._buildStruct === "function" || typeof baseType._buildUnion === "function"));
  const isStructBase = () => scalarSubclass || isArrayBase() || (typeof baseType === "function" && (typeof baseType._buildStruct === "function" || typeof baseType._buildUnion === "function"));

  // POINTER(POINTER(T)) / POINTER(CFUNCTYPE): elementi puntatore, letti come
  // oggetto puntatore / funzione (NULL → null) e scritti come indirizzo.
  const isPointerBase = () => (typeof baseType === "object" && baseType !== null && baseType._pointerTo !== undefined) || (typeof baseType === "function" && baseType._isFuncPtr === true);

  function readPointerAt(buffer, address, offset, owner) {
    const inBuffer = buffer && offset + baseSize <= buffer.length;
    const src = inBuffer ? buffer : native.ptrToBuffer(address + BigInt(offset), baseSize);
    const off = inBuffer ? offset : 0;
    if (!inBuffer) shareMemory(src, owner, address + BigInt(offset) - owner.origin);
    if (mirrorsActive) refresh(src, off, baseSize);
    const target = baseSize === 8 ? src.readBigUInt64LE(off) : BigInt(src.readUInt32LE(off));
    const keep = pointerOwner(src, off, target);
    if (target === 0n) return null;
    if (typeof baseType !== "function") return baseType.fromAddress(target, keep);
    return keepFunctionOwner(baseType(target), keep);
  }

  function writePointerAt(buffer, address, offset, value, owner) {
    if (buffer && offset + baseSize <= buffer.length) {
      writePointerField(buffer, offset, value, baseSize);
      if (mirrorsActive) flush(buffer, offset, baseSize);
      return;
    }
    const target = native.ptrToBuffer(address + BigInt(offset), baseSize);
    shareMemory(target, owner, address + BigInt(offset) - owner.origin);
    writePointerField(target, 0, value, baseSize);
    if (mirrorsActive) flush(target);
  }

  function instanceAt(buffer, address, offset, owner) {
    if (scalarSubclass) {
      if (buffer && offset + baseSize <= buffer.length) return scalarView(baseType, buffer.subarray(offset, offset + baseSize));
      const view = native.ptrToBuffer(address + BigInt(offset), baseSize);
      shareMemory(view, owner, address + BigInt(offset) - owner.origin);
      return scalarView(baseType, view);
    }
    if (buffer && offset + baseSize <= buffer.length) {
      return baseType.from_buffer(buffer, offset);
    }
    const result = baseType.from_address(address + BigInt(offset));
    shareMemory(result._buffer, owner, address + BigInt(offset) - owner.origin);
    return result;
  }

  // Scrittura a un indirizzo senza Buffer associato: per le primitive il
  // valore va in un Buffer V8 (uno per tipo puntatore, riusato) e il nativo
  // lo copia all'indirizzo, invece di creare un Buffer esterno (~400 ns,
  // vietato in Electron).
  let scratch = null;
  function writeAtAddress(addr, value, owner) {
    if (typeof baseType === "function" && baseType._isSimpleCData && !baseType._isPointerValued) {
      scratch ??= alloc(baseSize);
      baseType._writer(scratch, 0, value);
      native.writeMemory(scratch, 0, baseSize, addr);
      return;
    }
    const buf = native.ptrToBuffer(addr, baseSize);
    shareMemory(buf, owner, addr - owner.origin);
    writeValue(buf, baseType, value, 0);
  }

  // Lettura a un indirizzo senza Buffer associato: per le primitive
  // readValue(indirizzo) evita il Buffer esterno di ptrToBuffer.
  function readAtAddress(addr, owner) {
    if (typeof baseType === "function" && baseType._isSimpleCData) {
      return readValue(addr, baseType, 0);
    }
    const buf = native.ptrToBuffer(addr, baseSize);
    shareMemory(buf, owner, addr - owner.origin);
    return readValue(buf, baseType, 0);
  }

  /**
   * Creates a pointer instance with Python ctypes-compatible API.
   * Supports .contents property and [index] access for pointer arithmetic.
   */
  function createPointerInstance(addressOrBuffer, keep, memory) {
    resolveType();

    let _address = 0n;
    let _buffer = null;
    // Python `_objects`: ciò che deve restare vivo finché il puntatore punta
    // lì (la sorgente di cast(), il puntatore da cui deriva add()).
    let _objects = keep;
    let _memory = memory;
    if (keep?._pointerType !== undefined) _objects = keep._buffer ?? keep._objects;
    if (_memory === undefined && _objects?.[kPointerMemory]) _memory = _objects;
    // Memoria del puntatore (Python: un puntatore è un oggetto ctypes di
    // POINTER_SIZE byte), creata alla prima richiesta di byref(p) /
    // addressof(p). Da allora è lei a dare l'indirizzo: una funzione C che ci
    // scrive (f(byref(p))) ri-punta p.
    let _slot = null;

    function sync() {
      if (_slot === null) return;
      const addr = native.POINTER_SIZE === 8 ? _slot.readBigUInt64LE(0) : BigInt(_slot.readUInt32LE(0));
      if (addr !== _address) {
        _address = addr;
        _buffer = null;
        _objects = undefined;
        _memory = undefined;
        keepAlive(_slot, 0, null);
      }
    }

    function store() {
      if (_slot === null) return;
      if (native.POINTER_SIZE === 8) _slot.writeBigUInt64LE(BigInt.asUintN(64, _address), 0);
      else _slot.writeUInt32LE(Number(BigInt.asUintN(32, _address)), 0);
      keepAlive(_slot, 0, _memory ?? _buffer ?? _objects);
    }

    if (addressOrBuffer === undefined || addressOrBuffer === null) {
      _address = 0n;
    } else if (typeof addressOrBuffer === "bigint") {
      _address = addressOrBuffer;
    } else if (typeof addressOrBuffer === "number") {
      _address = BigInt(addressOrBuffer);
    } else if (typeof addressOrBuffer === "object" && Buffer.isBuffer(addressOrBuffer._buffer)) {
      // Istanza ctypes (array, struct): la sua memoria.
      pointTo(addressOrBuffer._buffer);
    } else if (Buffer.isBuffer(addressOrBuffer)) {
      pointTo(addressOrBuffer);
    }

    // Puntare a un Buffer; una copia di memoria nativa (memory/mirror.js)
    // vale il suo indirizzo originale, come un puntatore creato da indirizzo.
    function pointTo(buf) {
      _objects = undefined;
      _memory = undefined;
      const mirrored = mirrorAddress(buf);
      if (mirrored !== undefined) {
        _buffer = null;
        _address = mirrored;
        _objects = buf;
        const domain = memoryDomain(buf);
        _memory = { owner: buf, root: domain.root, origin: mirrored - domain.offset - BigInt(buf.byteOffset) };
        _memory[kPointerMemory] = true;
      } else {
        _buffer = buf;
        _address = getBufferAddress(buf);
      }
      store();
    }

    function getMemory() {
      if (_memory === undefined) {
        let buffer = _buffer;
        let address = _address;
        if (buffer === null && _objects !== null && typeof _objects === "object") {
          const known = _objects.constructor?._isPointerValued ? keptObject(_objects._buffer, 0) : _objects;
          const candidate = Buffer.isBuffer(known) ? known : known?._buffer;
          if (Buffer.isBuffer(candidate)) {
            const base = getBufferAddress(candidate);
            if (_address >= base && _address < base + BigInt(candidate.length)) {
              buffer = candidate;
              address = base;
            }
          }
        }
        const domain = buffer === null ? { root: {}, offset: 0n } : memoryDomain(buffer);
        _memory = {
          owner: buffer ?? _objects,
          root: domain.root,
          origin: buffer === null ? 0n : address - domain.offset - BigInt(buffer.byteOffset),
        };
        _memory[kPointerMemory] = true;
        if (_slot !== null) keepAlive(_slot, 0, _memory);
      }
      return _memory;
    }

    const instance = {
      _pointerType: PointerType,
      _baseType: baseType,
      get _baseSize() {
        resolveSize();
        return baseSize;
      },

      /**
       * Get the raw address as BigInt
       */
      get address() {
        sync();
        return _address;
      },

      /**
       * Memoria del puntatore (POINTER_SIZE byte con l'indirizzo): ciò che
       * byref(p) / addressof(p) passano al C.
       */
      get _pointerSlot() {
        if (_slot === null) {
          _slot = alloc(native.POINTER_SIZE);
          store();
        }
        return _slot;
      },

      /** Oggetti tenuti vivi dal puntatore (Python `_objects`). */
      get _objects() {
        sync();
        return getMemory();
      },

      /**
       * Python ctypes compatible: the pointed object. For simple types and
       * Structure/Union classes it is a live instance on the pointed memory
       * (`p.contents.value`, `p.contents.x`); assigning an instance re-points
       * the pointer to it, assigning a plain value writes it.
       */
      get contents() {
        sync();
        if (_address === 0n && !_buffer) {
          throw new Error("NULL pointer access");
        }
        resolveSize();
        if (isPointerBase()) {
          return readPointerAt(_buffer, _address, 0, getMemory());
        }
        if (hasInstances()) {
          return instanceAt(_buffer, _address, 0, getMemory());
        }
        if (_buffer) {
          // We have the actual buffer, read from it
          return readValue(_buffer, baseType, 0);
        }
        return readAtAddress(_address, getMemory());
      },

      set contents(value) {
        sync();
        // Python: assegnare un'istanza ri-punta il puntatore a quell'istanza.
        if (value !== null && typeof value === "object" && (value._isSimpleCDataInstance === true || value._structDef !== undefined || value._arrayType !== undefined) && Buffer.isBuffer(value._buffer)) {
          resolveSize();
          // Python accetta anche un'istanza di un altro tipo; una più piccola
          // del tipo puntato farebbe leggere e scrivere oltre la sua memoria.
          if (value._buffer.length < baseSize) {
            throw new TypeError(`contents: ${value.constructor?.name ?? "instance"} (${value._buffer.length} bytes) is smaller than the pointed type (${baseSize} bytes)`);
          }
          pointTo(value._buffer);
          return;
        }
        if (_address === 0n && !_buffer) {
          throw new Error("NULL pointer access");
        }
        resolveSize();
        if (isPointerBase()) {
          writePointerAt(_buffer, _address, 0, value, getMemory());
        } else if (_buffer) {
          writeValue(_buffer, baseType, value, 0);
        } else {
          writeAtAddress(_address, value, getMemory());
        }
      },

      /**
       * Returns the buffer this pointer points to (if available)
       */
      get _buffer() {
        sync();
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
          pointTo(value);
        } else if (typeof value === "bigint" || typeof value === "number") {
          _address = BigInt(value);
          _buffer = null;
          _objects = undefined;
          _memory = undefined;
          store();
        }
      },

      /**
       * Check if pointer is NULL
       */
      get isNull() {
        sync();
        return _address === 0n && !_buffer;
      },

      /**
       * For compatibility - get pointer as buffer (8 bytes containing address)
       */
      toBuffer() {
        sync();
        const buf = alloc(native.POINTER_SIZE);
        writeValue(buf, c_void_p, _address);
        keepAlive(buf, 0, _memory ?? _buffer ?? _objects);
        return buf;
      },

      toString() {
        sync();
        return `<${typeName} pointer at 0x${_address.toString(16)}>`;
      },

      /**
       * Return a new pointer offset by `n` elements (not bytes), matching C's
       * `ptr + n`. The pointer keeps the same element type.
       */
      add(n) {
        sync();
        resolveSize();
        const offsetBytes = BigInt(n) * BigInt(baseSize);
        // Il nuovo puntatore tiene viva la memoria di questo (Python _objects).
        return createPointerInstance(_address + offsetBytes, _buffer ?? _objects, getMemory());
      },

      /**
       * Return a JS array of `end - start` values read from consecutive
       * elements, analogous to Python's `p[start:end]` on a POINTER(T).
       */
      slice(start, end) {
        if (this.isNull) throw new Error("NULL pointer access");
        const out = new Array(Math.max(0, end - start));
        for (let i = start; i < end; i++) {
          out[i - start] = this[i];
        }
        return out;
      },
    };

    // Use Proxy for [index] access (pointer arithmetic)
    return new Proxy(instance, {
      get(target, prop, receiver) {
        // Numeric index access: p[0], p[1], etc.
        const index = digitIndex(prop);
        if (index >= 0) {
          if (target.isNull) {
            throw new Error("NULL pointer access");
          }
          resolveSize();
          const offset = index * baseSize;
          if (isPointerBase()) {
            return readPointerAt(_buffer, _address, offset, getMemory());
          }
          if (isStructBase()) {
            return instanceAt(_buffer, _address, offset, getMemory());
          }
          if (_buffer && offset + baseSize <= _buffer.length) {
            if (typeof baseType === "function" && baseType._isSimpleCData) {
              return baseType._reader(_buffer, offset);
            }
            return readValue(_buffer, baseType, offset);
          }
          return readAtAddress(_address + BigInt(offset), getMemory());
        }
        return Reflect.get(target, prop, receiver);
      },

      set(target, prop, value, receiver) {
        // Numeric index access: p[0] = value, p[1] = value, etc.
        const index = digitIndex(prop);
        if (index >= 0) {
          if (target.isNull) {
            throw new Error("NULL pointer access");
          }
          resolveSize();
          const offset = index * baseSize;
          if (isPointerBase()) {
            writePointerAt(_buffer, _address, offset, value, getMemory());
            return true;
          }
          if (_buffer && offset + baseSize <= _buffer.length) {
            writeValue(_buffer, baseType, value, offset);
            return true;
          }
          writeAtAddress(_address + BigInt(offset), value, getMemory());
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
    // Getter dinamici: se `baseType` è un thunk, viene risolto al primo
    // accesso — così l'uso come `POINTER(() => Node)` in field type resta
    // Python-compatibile senza forzare l'utente a invalidare manualmente.
    get _pointerTo() {
      resolveType();
      return baseType;
    },
    get _type_() {
      resolveType();
      return baseType;
    },
    get _baseSize() {
      resolveSize();
      return baseSize;
    },
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
    fromAddress(address, keep) {
      return createPointerInstance(typeof address === "bigint" ? address : BigInt(address), keep);
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
 * console.log(p.contents.value); // 42
 * p.contents = 100;
 * console.log(x.value); // 100
 * ```
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
