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

import { bitFieldAccessors } from "./bitfield.js";
import { computeLayout, isGccLayout, normalizePack } from "./layout.js";
import { buildWrapper } from "./wrap.js";
import { isMirror, syncDefinition } from "../../memory/mirror.js";
import { copyInstance, fieldEntries, fieldsOf, funcPtrFieldType, pointerOwner, scalarReader, simpleFieldWriter, writePointerField } from "./common.js";

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
// Python: un campo POINTER(T) NULL è un puntatore falsy; in JS `null`.
const pointerOrNull = (ptrType, address, buf, offset) => {
  const owner = pointerOwner(buf, offset, address);
  return address === 0n ? null : ptrType.fromAddress(address, owner);
};

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
  const gccLayout = isGccLayout(options.layout, packValue, options.pack != null || options.packed === true);
  // Python: una sottoclasse con _fields_ estende il layout della base, i cui
  // campi restano agli stessi offset.
  const base = options.base ?? null;
  const fieldDefs = base ? base.fields.map((f) => ({ ...f })) : [];
  const fieldNames = new Set(fieldDefs.map((f) => f.name));

  // Tipo, dimensione e allineamento naturale di ogni campo; gli offset sono
  // calcolati dopo, tutti insieme, da computeLayout (come Python).
  const ownDefs = [];
  for (const [name, type] of fieldEntries(fields)) {
    // Validate field name
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("Field name must be a non-empty string");
    }
    if (fieldNames.has(name)) {
      throw new TypeError(`Duplicate field name: ${name}`);
    }
    fieldNames.add(name);
    ownDefs.push(describeField(name, type));
  }

  // Campo di _anonymous_: una struct/union (classe o definizione), i cui
  // campi sono raggiungibili dalla struct esterna.
  function anonymousField(name, { type, cls }) {
    let def = type;
    if (typeof type === "function" && typeof type._buildStruct === "function") {
      cls = type;
      def = type._structDef || type._buildStruct();
    }
    if (def === null || typeof def !== "object" || !Array.isArray(def.fields)) {
      throw new TypeError(`anonymous field "${name}" must be a structure or union`);
    }
    return { name, type: def, cls, size: def.size, alignment: def.alignment, isNested: true, isAnonymous: true };
  }

  function describeField(name, type) {
    // Anonymous field - { type: SomeStruct, anonymous: true }
    if (typeof type === "object" && type !== null && type.anonymous === true && type.type) {
      return anonymousField(name, type);
    }
    // Bit field
    if (_isBitField(type)) {
      const { baseType, bits, baseSize } = type;
      return { name, type: baseType, size: 0, alignment: Math.min(baseSize, native.POINTER_SIZE), isBitField: true, bitSize: bits, baseSize };
    }
    // Structure / Union class (Union estende Structure)
    if (typeof type === "function" && type.prototype instanceof Structure) {
      const nested = type._structDef || type._buildStruct();
      // `cls`: Python restituisce un'istanza della classe annidata, sulla
      // stessa memoria.
      return { name, type: nested, cls: type, size: nested.size, alignment: nested.alignment, isNested: true };
    }
    // struct() / union() definition
    if (_isStruct(type)) {
      return { name, type, size: type.size, alignment: type.alignment, isNested: true };
    }
    // Array type: alignment == element alignment (C standard).
    if (_isArrayType(type)) {
      if (swapped) type = type._swappedType ?? type;
      const elemSize = sizeof(type.elementType);
      const alignment = typeof type.getAlignment === "function" ? type.getAlignment() : Math.min(elemSize, native.POINTER_SIZE);
      return { name, type, size: type.getSize(), alignment, isArray: true };
    }
    // POINTER() / CFUNCTYPE — pointer-sized field with typed access
    if ((typeof type === "object" && type !== null && type._pointerTo !== undefined) || (typeof type === "function" && type._isFuncPtr === true)) {
      // CFUNCTYPE: campo puntatore letto come funzione chiamabile (Python parity)
      return { name, type: typeof type === "function" ? funcPtrFieldType(type) : type, size: native.POINTER_SIZE, alignment: native.POINTER_SIZE, isPointer: true };
    }
    // Tipo base (SimpleCData)
    if (!(typeof type === "function" && type._isSimpleCData)) {
      throw new TypeError(`struct field "${name}": type must be a SimpleCData class, struct, union, or array`);
    }
    return { name, type, size: type._size, alignment: Math.min(type._size, native.POINTER_SIZE) };
  }

  const layout = computeLayout(
    ownDefs.map((f) => (f.isBitField ? { name: f.name, size: f.baseSize, align: f.alignment, bitSize: f.bitSize } : { name: f.name, size: f.size, align: f.alignment })),
    { isStruct: true, gccLayout, pack: packValue, align: options.align ?? 1, base, bigEndian: swapped },
  );
  ownDefs.forEach((f, i) => {
    f.offset = layout.offsets[i].offset;
    if (f.isBitField) f.bitOffset = layout.offsets[i].bitOffset;
    // Allineamento del tipo in C, prima di _pack_ (usato per le struct native
    // passate per valore, lib/core/types.js).
    f.naturalAlignment = f.alignment;
    if (packValue) f.alignment = Math.min(f.alignment, packValue);
    f.swapped = swapped;
    fieldDefs.push(f);
  });
  const totalSize = layout.size;
  const maxAlignment = layout.alignment;

  // Crea Map per lookup O(1) invece di find() O(n)
  const fieldMap = new Map();
  for (const field of fieldDefs) {
    fieldMap.set(field.name, field);
  }

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

  // Pre-compile reader/writer functions for each field.
  // We use null-prototype plain objects rather than `Map` because V8 builds
  // inline caches for monomorphic property accesses but not for `Map.get`,
  // and field access on a Structure Proxy is very hot. Null proto avoids
  // collisions with builtins like "constructor" or "toString".
  const fieldReaders = Object.create(null);
  const fieldWriters = Object.create(null);

  // `native.POINTER_SIZE` è una costante di processo: risolvo il branch una
  // once at reader/writer build time invece che a ogni accesso.
  const is64 = native.POINTER_SIZE === 8;

  for (const field of fieldDefs) {
    const offset = field.offset;
    const name = field.name;

    // Bitfield: accessor precompilati (sign-extension per base type signed,
    // come Python: `c_int8, 3` con valore -1 rilegge -1, non 7).
    if (field.isBitField) {
      const { read, write } = bitFieldAccessors({
        offset,
        baseSize: field.baseSize,
        bitOffset: field.bitOffset,
        bitSize: field.bitSize,
        signed: field.type?._signed === true,
        bigEndian: field.swapped === true,
        boolean: field.type?._isBoolean === true,
      });
      field.readBits = read;
      field.writeBits = simpleFieldWriter(field.type, (buf, offset, value) => write(buf, value), 0);
      fieldReaders[name] = read;
      fieldWriters[name] = field.writeBits;
      continue;
    }

    // Skip complex types — gestiti dal percorso generico def.get/set
    if (field.isNested || field.isArray) {
      continue;
    }

    // POINTER() type field — read returns PointerInstance, write accepts BigInt/PointerInstance
    if (field.isPointer) {
      const fieldOffset = offset;
      const ptrType = field.type;
      if (is64) {
        fieldReaders[name] = (buf) => pointerOrNull(ptrType, buf.readBigUInt64LE(fieldOffset), buf, fieldOffset);
        fieldWriters[name] = (buf, val) => {
          writePointerField(buf, fieldOffset, val, 8);
        };
      } else {
        fieldReaders[name] = (buf) => pointerOrNull(ptrType, BigInt(buf.readUInt32LE(fieldOffset)), buf, fieldOffset);
        fieldWriters[name] = (buf, val) => {
          writePointerField(buf, fieldOffset, val, 4);
        };
      }
      continue;
    }

    // Pre-compile based on SimpleCData type
    // Use the type's _reader and _writer directly for optimization
    const fieldType = field.type;
    if (fieldType && fieldType._isSimpleCData) {
      const fieldOffset = offset; // Capture offset for closure
      const reader = scalarReader(fieldType, field.swapped && fieldType._readerBE ? fieldType._readerBE : fieldType._reader, field.swapped);
      const writer = field.swapped && fieldType._writerBE ? fieldType._writerBE : fieldType._writer;
      fieldReaders[name] = (buf) => reader(buf, fieldOffset);
      fieldWriters[name] = simpleFieldWriter(fieldType, writer, fieldOffset);
    }
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
      const buf = alloc(totalSize);
      buf.fill(0); // Inizializza a zero

      // Prima imposta i campi diretti
      for (const field of fieldDefs) {
        if (values[field.name] !== undefined) {
          structDef.set(buf, field.name, values[field.name]);
        }
      }

      // Poi gestisci i campi anonymous - i loro campi possono essere passati direttamente nell'oggetto values
      for (const field of fieldDefs) {
        if (field.isAnonymous && field.type && field.type.fields) {
          for (const subField of field.type.fields) {
            if (values[subField.name] !== undefined) {
              structDef.set(buf, subField.name, values[subField.name]);
            }
          }
        }
      }

      return new Proxy(
        buf,
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
    get(bufOrObj, fieldName) {
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
          if (field.cls !== undefined) return new field.cls(nestedBuf);
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
          if (field.type._charKind !== undefined) return field.type.getValue(arrayBuf);
          return field.type.wrap(arrayBuf);
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
              return f.type.get(nestedBuf, fieldName);
            }
          }
        }
        throw new Error(`Unknown field: ${firstPart}`);
      }

      // Nested struct con dot notation
      if (field.isNested && parts.length > 1) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        return field.type.get(nestedBuf, parts.slice(1).join("."));
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
        if (field.isBitField) {
          result[field.name] = field.readBits(buf);
        } else if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          const nestedObj = field.type.toObject(nestedBuf);
          if (field.isAnonymous) {
            // Anonymous fields: promote their fields to parent level
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

  return syncDefinition(structDef);
}
