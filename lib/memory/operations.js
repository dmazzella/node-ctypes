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
    if (typeof type === "object" && type !== null && typeof type.getSize === "function") {
      return type.getSize();
    }
    throw new TypeError("sizeof: unsupported type. Use SimpleCData classes like c_int32, c_uint64, etc.");
  }

  /**
   * Legge un valore tipato da buffer o da address raw.
   * Python: analogo a dereferenziare `pointer.contents`.
   */
  function readValue(ptr, type, offset = 0) {
    if (typeof offset !== "number" || offset < 0) {
      throw new RangeError("offset must be a non-negative number");
    }

    // SimpleCData class: usa _reader diretto
    if (typeof type === "function" && type._isSimpleCData) {
      if (Buffer.isBuffer(ptr)) {
        const size = type._size || sizeof(type);
        if (offset + size > ptr.length) {
          throw new RangeError(
            `Read would exceed buffer bounds (offset: ${offset}, size: ${size}, buffer length: ${ptr.length})`,
          );
        }
        return type._reader(ptr, offset);
      }
      if (typeof ptr === "bigint" || typeof ptr === "number") {
        const size = type._size || sizeof(type);
        const buf = ptrToBuffer(ptr, size + offset);
        return type._reader(buf, offset);
      }
      throw new TypeError("readValue requires a Buffer or pointer address");
    }

    // Structure class
    if (typeof type === "function" && type.prototype instanceof getStructure()) {
      const def = type._structDef || type._buildStruct();
      return def.toObject(ptr.subarray(offset, offset + def.size));
    }
    // Union class
    if (typeof type === "function" && type.prototype instanceof getUnion()) {
      const def = type._unionDef || type._buildUnion();
      return def.toObject(ptr.subarray(offset, offset + def.size));
    }
    // structDef / unionDef object
    if (typeof type === "object" && type !== null && type._isStructType && typeof type.toObject === "function") {
      return type.toObject(ptr.subarray(offset, offset + type.size));
    }

    throw new TypeError(`readValue: unsupported type ${type}`);
  }

  /**
   * Scrive un valore tipato in un buffer.
   */
  function writeValue(ptr, type, value, offset = 0) {
    if (typeof offset !== "number" || offset < 0) {
      throw new RangeError("offset must be a non-negative number");
    }

    // SimpleCData class: usa _writer diretto
    if (typeof type === "function" && type._isSimpleCData) {
      if (!Buffer.isBuffer(ptr)) {
        throw new TypeError("writeValue requires a Buffer");
      }
      const size = type._size || sizeof(type);
      if (offset + size > ptr.length) {
        throw new RangeError(
          `Write would exceed buffer bounds (offset: ${offset}, size: ${size}, buffer length: ${ptr.length})`,
        );
      }
      type._writer(ptr, offset, value);
      return type._size;
    }

    // Structure/Union class o def — tutti gestiti con la stessa logica:
    // o value è un Buffer (copia raw) o è un object (set field-by-field).
    const writeComposite = (def) => {
      const tempBuf = ptr.subarray(offset, offset + def.size);
      if (Buffer.isBuffer(value)) {
        value.copy(tempBuf, 0, 0, def.size);
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
