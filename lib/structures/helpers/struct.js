/**
 * @file struct.js
 * @module structures/struct
 * @description Struct type definition implementation for C-style structures.
 *
 * This module provides Python ctypes-compatible struct types with proper
 * alignment, padding, nested structures, arrays, and bitfields support.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `ctypes.Structure` class with `_fields_` definition.
 *
 * @example Basic struct
 * ```javascript
 * import { struct, c_int32, c_float } from 'node-ctypes';
 *
 * const Point = struct({
 *   x: c_int32,
 *   y: c_int32
 * });
 *
 * const point = Point.create({ x: 10, y: 20 });
 * console.log(point.x, point.y); // 10 20
 * ```
 *
 * @example Struct with nested types and bitfields
 * ```javascript
 * const Header = struct({
 *   magic: c_uint32,
 *   flags: bitfield(c_uint32, 8),
 *   version: bitfield(c_uint32, 8),
 *   reserved: bitfield(c_uint32, 16)
 * });
 * ```
 */

import { readArrayField } from "./array.js";
import { declareFields } from "./fields.js";
import { normalizePack } from "./layout.js";
import { buildWrapper } from "./wrap.js";
import { isMirror, syncDefinition } from "../../memory/mirror.js";
import { allocTransient } from "../../memory/buffer.js";
import { kFromBytes } from "../Structure.js";
import { copyInstance } from "../../memory/ownership.js";
import { compileFieldAccessors, fieldsOf, pointerOrNull, writePointerField } from "./common.js";
import { structArgumentFactories, structGetters, structResultReaders } from "../protocol.js";
import { isScalarSubclass } from "../../types/scalar-protocol.js";

/**
 * Creates a struct type definition with proper alignment and padding.
 *
 * Returns a struct definition object with methods to create instances,
 * read/write fields, and convert to/from JavaScript objects. Handles
 * alignment, padding, nested structures, arrays, and bitfields.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `Structure` class with `_fields_` attribute.
 *
 * @param {Object} fields - Field definitions { name: type, ... }
 * @param {Object} [options] - Options { packed: false }
 * @param {boolean} [options.packed=false] - If true, disable padding/alignment (pack 1)
 * @param {number} [options.pack] - Maximum field alignment (Python `_pack_`)
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} alloc - alloc function reference
 * @param {Function} readValue - readValue function reference
 * @param {Function} writeValue - writeValue function reference
 * @param {Function} _isStruct - _isStruct function reference
 * @param {Function} _isArrayType - _isArrayType function reference
 * @param {Function} _isBitField - _isBitField function reference
 * @param {Function} Structure - Structure class reference
 * @param {Function} Union - Union class reference
 * @param {Object} native - Native module reference
 * @returns {Object} Struct definition with create, get, set, toObject methods
 * @throws {TypeError} If fields are invalid or field names are duplicated
 *
 * @example Create struct with alignment
 * ```javascript
 * const Data = struct({
 *   a: c_uint8,   // offset 0, size 1
 *   // padding: 3 bytes for alignment
 *   b: c_uint32,  // offset 4, size 4
 *   c: c_uint16   // offset 8, size 2
 * });
 * console.log(Data.size); // 12 (with padding)
 * ```
 *
 * @example Packed struct (no padding)
 * ```javascript
 * const PackedData = struct({
 *   a: c_uint8,   // offset 0
 *   b: c_uint32,  // offset 1
 *   c: c_uint16   // offset 5
 * }, { packed: true });
 * console.log(PackedData.size); // 7 (no padding)
 * ```
 */
export function struct(fields, options = {}, sizeof, alloc, readValue, writeValue, _isStruct, _isArrayType, _isBitField, Structure, Union, native) {
  // Validate inputs
  // Un oggetto { name: type }, o le coppie [name, type] in ordine (Structure).
  if (!fields || typeof fields !== "object") {
    throw new TypeError("fields must be a non-null object");
  }

  // Python _pack_: `pack` (massimo allineamento), o `packed: true` (= pack 1).
  const packValue = normalizePack(options.pack ?? (options.packed ? 1 : 0));
  // `swapped` selects _readerBE/_writerBE on primitive SimpleCData fields and
  // lays out bitfields from the big end. Used by BigEndianStructure /
  // LittleEndianStructure (on LE host, swapped=true means "use BE").
  const swapped = options.swapped === true;
  const { base, fieldDefs, fieldMap, size: totalSize, alignment: maxAlignment } = declareFields(fields, options, { isStruct: true, pack: packValue, swapped, sizeof, _isStruct, _isArrayType, _isBitField, Structure, native });

  // Precalcola la lookup plana di tutti i nomi accessibili dal Proxy,
  // inclusi i sotto-campi dei campi _anonymous_. Il Proxy get/set/has
  // altrimenti scansionerebbe linearmente tutti i campi anonymous e i loro
  // subfields su ogni accesso. Usa un null-proto object per IC monomorfo.
  // Come Python, la promozione è ricorsiva: un campo anonimo dentro un campo
  // anonimo è raggiungibile dalla struct esterna.
  const anonymousFieldNames = Object.create(null); // subField.name -> true
  for (const field of fieldDefs) {
    if (field.isAnonymous && field.type && field.type.fields) {
      for (const subField of field.type.fields) {
        anonymousFieldNames[subField.name] = true;
      }
      for (const name of Object.keys(field.type.anonymousFieldNames ?? {})) {
        anonymousFieldNames[name] = true;
      }
    }
  }
  const promotes = (f, name) => f.type.fields.some((subField) => subField.name === name) || f.type.anonymousFieldNames?.[name] === true;
  const { fieldReaders, fieldWriters } = compileFieldAccessors(fieldDefs, native);

  function createBuffer(values) {
    const buf = alloc(totalSize);
    buf.fill(0);

    for (const field of fieldDefs) {
      if (Object.hasOwn(values, field.name) && values[field.name] !== undefined) {
        structDef.set(buf, field.name, values[field.name]);
      }
    }

    for (const field of fieldDefs) {
      if (field.isAnonymous && field.type && field.type.fields) {
        for (const subField of field.type.fields) {
          if (Object.hasOwn(values, subField.name) && values[subField.name] !== undefined) {
            structDef.set(buf, subField.name, values[subField.name]);
          }
        }
      }
    }
    return buf;
  }

  const structDef = {
    size: totalSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    fieldMap,
    fieldReaders,
    fieldWriters,
    anonymousFieldNames, // usato dai nested proxy per evitare ricostruzioni
    packed: packValue !== 0,
    swapped,
    base, // definizione della classe base (i suoi campi sono i primi di `fields`)
    _isStructType: true,

    /**
     * Alloca e inizializza una nuova istanza
     * @param {Object} [values] - Valori iniziali
     * @returns {Proxy} Proxy-based struct instance
     */
    create(values = {}) {
      return new Proxy(
        createBuffer(values),
        buildWrapper(structDef, {
          instanceTag: "StructInstance",
          exposeAnonymous: true,
        }),
      );
    },

    /**
     * Legge un campo dalla struttura
     * @param {Buffer|Object} bufOrObj - Buffer della struttura O object wrapper
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @returns {*} Valore del campo
     */
    get(bufOrObj, fieldName, owner) {
      // supporta sia buffer che object wrapper o plain object
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - gestisci dot notation
        if (fieldName.includes(".")) {
          const parts = fieldName.split(".");
          let current = bufOrObj;
          for (const part of parts) {
            current = current[part];
            if (current === undefined) return undefined;
          }
          return current;
        }
        // Accesso diretto tramite property
        return bufOrObj[fieldName];
      } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
        // Plain object (da toObject/create) - accesso diretto
        if (fieldName.includes(".")) {
          const parts = fieldName.split(".");
          let current = bufOrObj;
          for (const part of parts) {
            current = current[part];
            if (current === undefined) return undefined;
          }
          return current;
        }
        // Accesso diretto tramite property
        return bufOrObj[fieldName];
      } else {
        throw new TypeError("Expected Buffer or struct instance");
      }

      // Fast path: nome semplice senza dot notation
      // Lookup with Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          return field.readBits(buf);
        }

        // Nested struct (senza dot = ritorna intero oggetto)
        if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          // Classe Structure/Union: un'istanza sulla stessa memoria (Python).
          if (field.cls !== undefined) return field.cls[kFromBytes](nestedBuf, owner);
          return field.type.create
            ? new Proxy(
                nestedBuf,
                buildWrapper(field.type, {
                  instanceTag: "NestedStructInstance",
                  exposeAnonymous: true,
                  mirrored: isMirror(nestedBuf),
                }),
              )
            : field.type.toObject(nestedBuf);
        }

        // POINTER() field — return PointerInstance
        if (field.isPointer) {
          const addr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(field.offset) : BigInt(buf.readUInt32LE(field.offset));
          return pointerOrNull(field.type, addr, buf, field.offset);
        }

        // Array field (Python: c_char * n / c_wchar * n si leggono come stringa)
        if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          return readArrayField(field.type, arrayBuf, owner);
        }

        // Tipo base: stesso accessor del fast path (rispetta l'endianness)
        return fieldReaders[field.name](buf);
      }

      // supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            const hasField = promotes(f, firstPart);
            if (hasField) {
              const nestedBuf = buf.subarray(f.offset, f.offset + f.size);
              return f.type.get(nestedBuf, fieldName, owner);
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

      // Nested struct con dot notation
      if (field.isNested && parts.length > 1) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        return field.type.get(nestedBuf, parts.slice(1).join("."), owner);
      }

      throw new Error(`Unknown field: ${fieldName}`);
    },

    /**
     * Scrive un campo nella struttura
     * @param {Buffer|Object} bufOrObj - Buffer della struttura O object wrapper
     * @param {string} fieldName - Nome del campo (supporta 'outer.inner' per nested)
     * @param {*} value - Valore da scrivere
     */
    set(bufOrObj, fieldName, value) {
      // supporta sia buffer che object wrapper o plain object
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        bufOrObj[fieldName] = value;
        return;
      } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
        // Plain object (da toObject/create) - accesso diretto
        bufOrObj[fieldName] = value;
        return;
      } else {
        throw new TypeError("Expected Buffer or struct instance");
      }

      // Fast path: nome semplice senza dot notation
      // Lookup with Map
      let field = fieldMap.get(fieldName);

      if (field) {
        // Bit field
        if (field.isBitField) {
          field.writeBits(buf, value);
          return;
        }

        // Nested struct (senza dot = imposta da oggetto)
        if (field.isNested) {
          if (Buffer.isBuffer(value) || (value !== null && typeof value === "object" && Buffer.isBuffer(value._buffer))) {
            // Istanza struct/union: copia dei byte (Python), non campo per campo
            copyInstance(buf, field.offset, field.size, value, 0, field.type);
          } else if (typeof value === "object") {
            const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
            for (const [k, v] of Object.entries(value)) {
              field.type.set(nestedBuf, k, v);
            }
          }
          return;
        }

        // POINTER() field — write address
        if (field.isPointer) {
          writePointerField(buf, field.offset, value, native.POINTER_SIZE);
          return;
        }

        // Array field
        if (field.isArray) {
          // Python: bytes / str con il controllo di lunghezza ("bytes too long").
          if (field.type._charKind !== undefined && (typeof value === "string" || (field.type._charKind === "char" && Buffer.isBuffer(value) && value._buffer === undefined))) {
            field.type.setValue(buf.subarray(field.offset, field.offset + field.size), value, (len, max) => `${field.type._charKind === "char" ? "bytes" : "string"} too long (${len}, maximum length ${max})`);
          } else if (Buffer.isBuffer(value) || Buffer.isBuffer(value?._buffer)) {
            copyInstance(buf, field.offset, field.size, value, 0, field.type);
          } else if (Array.isArray(value)) {
            const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
            const wrapped = field.type.wrap(arrayBuf);
            for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
              wrapped[i] = value[i];
            }
          }
          return;
        }

        // Tipo base: stesso accessor del fast path (rispetta l'endianness)
        fieldWriters[field.name](buf, value);
        return;
      }

      // Slow path: supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            // Verifica se il campo esiste nel tipo anonimo
            const hasField = promotes(f, firstPart);
            if (hasField) {
              // Scrive nel campo dell'anonymous field
              const nestedBuf = buf.subarray(f.offset, f.offset + f.size);
              f.type.set(nestedBuf, fieldName, value);
              return;
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

      // Bit field
      if (field.isBitField) {
        field.writeBits(buf, value);
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (parts.length > 1) {
          // Accesso a campo annidato singolo
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          field.type.set(nestedBuf, parts.slice(1).join("."), value);
        } else if (Buffer.isBuffer(value) || (value !== null && typeof value === "object" && Buffer.isBuffer(value._buffer))) {
          // Istanza struct/union: copia dei byte (Python), non campo per campo
          copyInstance(buf, field.offset, field.size, value, 0, field.type);
        } else if (typeof value === "object") {
          // Imposta campi da oggetto
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          for (const [k, v] of Object.entries(value)) {
            field.type.set(nestedBuf, k, v);
          }
        }
        return;
      }

      // Array field
      if (field.isArray) {
        if (field.type._charKind !== undefined && typeof value === "string") {
          field.type.setValue(buf.subarray(field.offset, field.offset + field.size), value, (len, max) => `${field.type._charKind === "char" ? "bytes" : "string"} too long (${len}, maximum length ${max})`);
        } else if (Buffer.isBuffer(value) || Buffer.isBuffer(value?._buffer)) {
          copyInstance(buf, field.offset, field.size, value, 0, field.type);
        } else if (Array.isArray(value)) {
          // Inizializza da array JavaScript
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          const wrapped = field.type.wrap(arrayBuf);
          for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
            wrapped[i] = value[i];
          }
        }
        return;
      }

      // Tipo base
      fieldWriters[field.name](buf, value);
    },

    /**
     * Legge tutti i campi come oggetto (ricorsivo per nested)
     * @param {Buffer} buf - Buffer della struttura
     * @returns {Object} Oggetto con tutti i campi
     */
    /**
     * Converte buffer in plain object (KOFFI EAGER APPROACH)
     * Legge TUTTI i valori UNA VOLTA e crea PLAIN properties (no getters)
     * Molto più veloce! Sincronizzazione lazy quando serve _buffer
     */
    toObject(bufOrObj) {
      // Se è già un object (non buffer), controlla se ha _buffer
      if (!Buffer.isBuffer(bufOrObj)) {
        // Se ha _buffer, estrailo e ricarica i valori (utile dopo modifiche FFI)
        if (bufOrObj && bufOrObj._buffer && Buffer.isBuffer(bufOrObj._buffer)) {
          bufOrObj = bufOrObj._buffer; // Estrai buffer e procedi con il reload
        } else if (typeof bufOrObj === "object" && bufOrObj !== null) {
          // È già un plain object, restituiscilo così com'è
          return bufOrObj;
        } else {
          throw new TypeError("Expected Buffer or struct instance");
        }
      }

      const buf = bufOrObj;
      const result = {};

      // Leggi tutti i campi in una volta (eager approach)
      for (const field of fieldDefs) {
        if (field.name === "__proto__" && !field.isAnonymous) {
          Object.defineProperty(result, field.name, { value: undefined, writable: true, enumerable: true, configurable: true });
        }
        if (field.isBitField) {
          result[field.name] = field.readBits(buf);
        } else if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          const nestedObj = field.type.toObject(nestedBuf);
          if (field.isAnonymous) {
            // Anonymous fields: promote their fields to parent level
            if (Object.hasOwn(nestedObj, "__proto__")) {
              Object.defineProperty(result, "__proto__", { value: undefined, writable: true, enumerable: true, configurable: true });
            }
            Object.assign(result, nestedObj);
          } else {
            result[field.name] = nestedObj;
          }
        } else if (field.isPointer) {
          const addr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(field.offset) : BigInt(buf.readUInt32LE(field.offset));
          result[field.name] = pointerOrNull(field.type, addr, buf, field.offset);
        } else if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          result[field.name] = field.type._charKind !== undefined ? field.type.getValue(arrayBuf) : field.type.wrap(arrayBuf);
        } else {
          // Tipo base - lettura diretta
          result[field.name] = fieldReaders[field.name](buf);
        }
      }

      return result;
    },

    /**
     * Ottiene il buffer di una nested struct
     * @param {Buffer} buf - Buffer della struttura parent
     * @param {string} fieldName - Nome del campo nested
     * @returns {Buffer} Slice del buffer per la nested struct
     */
    getNestedBuffer(buf, fieldName) {
      // O(1) lookup con Map
      const field = fieldMap.get(fieldName);
      if (!field) throw new Error(`Unknown field: ${fieldName}`);
      if (!field.isNested) throw new Error(`Field ${fieldName} is not a nested struct`);
      return buf.subarray(field.offset, field.offset + field.size);
    },
  };

  // fromObject: write plain object values into buffer
  structDef.fromObject = function (buf, obj) {
    for (const [key, value] of Object.entries(fieldsOf(obj))) {
      if (this.fields.some((f) => f.name === key)) {
        this.set(buf, key, value);
      }
    }
  };

  // createRaw: return plain object without synchronization
  structDef.createRaw = function (values = {}) {
    return this.toObject(this.create(values)._buffer);
  };

  if (fieldDefs.every((field) => !field.isBitField && !field.isNested && !field.isArray && !field.isPointer && !field.type._isPointerValued && !isScalarSubclass(field.type))) {
    const create = structDef.create;
    const set = structDef.set;
    // Only scalar fields: `set` would resolve each name to its precompiled writer.
    const writers = fieldDefs.map((field) => [field.name, fieldWriters[field.name]]);
    const createScalar = (values) => {
      const buf = allocTransient(totalSize);
      for (let i = 0; i < writers.length; i++) {
        const [name, write] = writers[i];
        if (!Object.hasOwn(values, name)) continue;
        const value = values[name];
        if (value !== undefined) write(buf, value);
      }
      return buf;
    };
    const scalarWriters = writers.every(([, write]) => typeof write === "function");
    // The Buffer built here is fresh and passed as is; with `convert` the
    // result of a create override goes through it as any other argument.
    structArgumentFactories.set(structDef, (values, convert, owners) => {
      // A later create override must still run, with the definition as receiver.
      const current = structDef.create;
      if (current !== create) {
        const value = current.call(structDef, values);
        return convert === undefined ? value : convert(value, owners);
      }
      if (structDef.set === set && scalarWriters) return createScalar(values);
      // A custom setter receives the buffer and may publish it to a later adapter.
      const bytes = createBuffer(values);
      return convert === undefined ? bytes : convert(bytes, owners);
    });
    const toObject = structDef.toObject;
    const readers = fieldDefs.map((field) => [field.name, fieldReaders[field.name]]);
    if (readers.every(([name, read]) => name !== "__proto__" && typeof read === "function")) {
      // Scalar readers return primitives without reentering, so the native
      // result buffer can be read in place; a toObject override gets a copy.
      structResultReaders.set(structDef, (bytes) => {
        if (structDef.toObject !== toObject) return structDef.toObject(Buffer.from(bytes));
        const result = {};
        for (let i = 0; i < readers.length; i++) {
          const [name, read] = readers[i];
          result[name] = read(bytes);
        }
        return result;
      });
    }
  }

  syncDefinition(structDef);
  structGetters.set(structDef, structDef.get);
  return structDef;
}
