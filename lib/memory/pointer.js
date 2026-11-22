/**
 * @file pointer.js
 * @module memory/pointer
 * @description Pointer type factory (POINTER(T)) and re-exports of pointer operations.
 */

import { keepAlive, keepFunctionOwner, keptObject, memoryDomain, pointerOwner, shareMemory } from "./ownership.js";
import { writePointerField } from "../structures/helpers/common.js";
import { isScalarSubclass, scalarView } from "../types/scalar-protocol.js";
import { flush, mirrorAddress, mirrorsActive, refresh } from "./mirror.js";
import { addressOf, kPointerMemory, ptrToBuffer } from "./pointer-ops.js";

export { addressOf, byref, cast, pointer, ptrToBuffer } from "./pointer-ops.js";

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
