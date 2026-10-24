/**
 * @file operations.js
 * @module memory/operations
 * @description Memory operations factory: readValue, writeValue, sizeof.
 *
 * Python ctypes-compatible typed memory access.
 *
 * **Design note**: queste tre funzioni hanno dipendenze (Structure, Union,
 * ptrToBuffer) che nel vecchio design venivano passate come ultimi 4
 * parametri positional ad ogni call-site — risultando in signature tipo
 * `readValue(buf, type, 0, sizeof, ptrToBuffer, Structure, Union)` molto
 * difficili da leggere e facili da sbagliare.
 *
 * Ora espongono un unico entry `createMemoryOps({deps})` che cattura le
 * dipendenze in closure e restituisce le 3 funzioni bound con la signature
 * logica pulita (ptr/type/value/offset).
 *
 * @example
 * ```javascript
 * import { createMemoryOps } from './memory/operations.js';
 * const { readValue, writeValue, sizeof } = createMemoryOps({
 *   ptrToBuffer, Structure, Union,
 * });
 * readValue(buf, c_int32, 0);           // clean signature
 * writeValue(buf, c_int32, 42, 4);
 * sizeof(c_int32);                       // 4
 * ```
 */

import { flush, mirrorsActive, refresh } from "./mirror.js";
import { copyInstance, isScalarSubclass, scalarView } from "../structures/helpers/common.js";

/**
 * Factory che cattura le dipendenze in closure e restituisce un bundle di
 * funzioni memory-op con signature logica pulita.
 *
 * **NB late binding**: `Structure` e `Union` sono letti sul `deps` object
 * a ogni chiamata, NON catturati per valore. L'ordine di init di index.js
 * crea le memory-ops prima delle classi Structure/Union — è sufficiente
 * che `deps.Structure` / `deps.Union` vengano popolati prima di chiamare
 * effettivamente `readValue` / `sizeof` / ecc.
 *
 * @param {Object} deps
 * @param {Function} deps.ptrToBuffer - Address → Buffer viewing external memory.
 * @param {Function} deps.Structure - Structure base class (per instanceof).
 * @param {Function} deps.Union - Union base class (per instanceof).
 * @returns {{ readValue: Function, writeValue: Function, sizeof: Function }}
 */
export function createMemoryOps(deps) {
  // Indirezione via `deps.X` per supportare late binding senza mutare i
  // call-site.
  const getStructure = () => deps.Structure;
  const getUnion = () => deps.Union;
  const { ptrToBuffer } = deps;
  /**
   * Size in bytes di un tipo/istanza. Python: `ctypes.sizeof()`.
   */
  function sizeof(type) {
    // SimpleCData class (e.g., sizeof(c_uint64))
    if (typeof type === "function" && type._isSimpleCData) {
      return type._size;
    }
    // SimpleCData instance
    if (type && type._buffer && type.constructor && type.constructor._isSimpleCData) {
      return type.constructor._size;
    }
    // Structure/Union instance (Python: sizeof(instance))
    if (type && typeof type === "object" && type._structDef !== undefined && typeof type._structDef.size === "number") {
      return type._structDef.size;
    }
    // Buffer, create_string_buffer(), istanza di array, TypedArray/DataView:
    // dimensione in byte
    if (Buffer.isBuffer(type) || ArrayBuffer.isView(type)) {
      return type.byteLength;
    }
    // Structure class
    if (typeof type === "function" && type.prototype instanceof getStructure()) {
      const def = type._structDef || type._buildStruct();
      return def.size;
    }
    // Union class
    if (typeof type === "function" && type.prototype instanceof getUnion()) {
      const def = type._unionDef || type._buildUnion();
      return def.size;
    }
    // structDef / unionDef
    if (typeof type === "object" && type !== null && typeof type.size === "number") {
      return type.size;
    }
    // Array type wrapper
    if ((typeof type === "object" || (typeof type === "function" && type._isArrayType === true)) && type !== null && typeof type.getSize === "function") {
      return type.getSize();
    }
    // CFUNCTYPE type: function pointer
    if (typeof type === "function" && type._isFuncPtr === true) {
      return deps.native.POINTER_SIZE;
    }
    throw new TypeError("sizeof: unsupported type. Use SimpleCData classes like c_int32, c_uint64, etc.");
  }

  /**
   * Legge un valore tipato da buffer o da address raw.
   * Python: analogo a dereferenziare `pointer.contents`.
   */
  // Un oggetto puntatore (POINTER(T)) vale il suo Buffer o il suo indirizzo:
  // es. gli argomenti POINTER dei callback passati a readValue/writeValue.
  const pointerTarget = (ptr) => (ptr._buffer !== null ? ptr._buffer : ptr.address);

  // Memoria di readValue/writeValue: Buffer, istanza ctypes, puntatore,
  // TypedArray/DataView o indirizzo (Buffer su `offset + size()` byte).
  const memoryAt = (ptr, offset, size, name) => {
    if (ptr !== null && typeof ptr === "object") {
      if (ptr._pointerType !== undefined) {
        ptr = pointerTarget(ptr);
      } else if (Buffer.isBuffer(ptr._buffer)) {
        ptr = ptr._buffer;
      } else if (ArrayBuffer.isView(ptr) && !Buffer.isBuffer(ptr)) {
        return Buffer.from(ptr.buffer, ptr.byteOffset, ptr.byteLength);
      }
    }
    if (typeof ptr === "bigint" || typeof ptr === "number") {
      if (!ptr) throw new TypeError(`${name}: NULL pointer`);
      return ptrToBuffer(ptr, offset + size());
    }
    if (!Buffer.isBuffer(ptr)) throw new TypeError(`${name} requires a Buffer, a ctypes instance or a pointer address`);
    return ptr;
  };
  const checkBounds = (ptr, offset, size, verb) => {
    if (offset + size > ptr.length) {
      throw new RangeError(`${verb} would exceed buffer bounds (offset: ${offset}, size: ${size}, buffer length: ${ptr.length})`);
    }
  };

  function readValue(ptr, type, offset = 0) {
    if (typeof offset !== "number" || offset < 0) {
      throw new RangeError("offset must be a non-negative number");
    }
    if (ptr !== null && typeof ptr === "object" && ptr._pointerType !== undefined) {
      ptr = pointerTarget(ptr);
    }

    // SimpleCData class: usa _reader diretto
    if (typeof type === "function" && type._isSimpleCData) {
      const size = type._size || sizeof(type);
      if ((typeof ptr === "bigint" || typeof ptr === "number") && ptr !== 0n && ptr !== 0) {
        const nativeType = deps.nativeReadTypes !== undefined ? deps.nativeReadTypes.get(type) : undefined;
        if (nativeType !== undefined) {
          return deps.native.readValue(ptr, nativeType, offset);
        }
      }
      ptr = memoryAt(ptr, offset, () => size, "readValue");
      checkBounds(ptr, offset, size, "Read");
      if (mirrorsActive) refresh(ptr, offset, size);
      if (isScalarSubclass(type)) return scalarView(type, ptr.subarray(offset, offset + size));
      return type._reader(ptr, offset);
    }

    let def;
    if (typeof type === "function" && type.prototype instanceof getStructure()) {
      def = type._structDef || type._buildStruct();
    } else if (typeof type === "function" && type.prototype instanceof getUnion()) {
      def = type._unionDef || type._buildUnion();
    } else if (typeof type === "object" && type !== null && type._isStructType && typeof type.toObject === "function") {
      def = type;
    } else {
      throw new TypeError(`readValue: unsupported type ${type}`);
    }
    ptr = memoryAt(ptr, offset, () => def.size, "readValue");
    checkBounds(ptr, offset, def.size, "Read");
    return def.toObject(ptr.subarray(offset, offset + def.size));
  }

  /**
   * Scrive un valore tipato in un buffer.
   */
  function writeValue(ptr, type, value, offset = 0) {
    if (typeof offset !== "number" || offset < 0) {
      throw new RangeError("offset must be a non-negative number");
    }
    ptr = memoryAt(ptr, offset, () => sizeof(type), "writeValue");

    // SimpleCData class: usa _writer diretto
    if (typeof type === "function" && type._isSimpleCData) {
      const size = type._size || sizeof(type);
      checkBounds(ptr, offset, size, "Write");
      type._writer(ptr, offset, value);
      if (mirrorsActive) flush(ptr, offset, size);
      return type._size;
    }

    // Structure/Union class o def — tutti gestiti con la stessa logica:
    // o value è un Buffer (copia raw) o è un object (set field-by-field).
    const writeComposite = (def) => {
      checkBounds(ptr, offset, def.size, "Write");
      const tempBuf = ptr.subarray(offset, offset + def.size);
      if (Buffer.isBuffer(value) || (value !== null && typeof value === "object" && Buffer.isBuffer(value._buffer))) {
        // Istanza struct/union: copia dei byte (Python), non campo per campo.
        copyInstance(tempBuf, 0, def.size, value, 0, def);
        if (mirrorsActive) flush(tempBuf);
      } else if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          def.set(tempBuf, k, v);
        }
      }
      return def.size;
    };
    if (typeof type === "function" && type.prototype instanceof getStructure()) {
      return writeComposite(type._structDef || type._buildStruct());
    }
    if (typeof type === "function" && type.prototype instanceof getUnion()) {
      return writeComposite(type._unionDef || type._buildUnion());
    }
    if (typeof type === "object" && type !== null && type._isStructType && typeof type.set === "function") {
      return writeComposite(type);
    }

    throw new TypeError(`writeValue: unsupported type ${type}`);
  }

  return { readValue, writeValue, sizeof };
}
