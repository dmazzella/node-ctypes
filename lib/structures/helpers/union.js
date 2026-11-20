/**
 * @file union.js
 * @module structures/union
 * @description Union type definition implementation for C-style unions.
 *
 * This module provides Python ctypes-compatible union types where all fields
 * share the same memory location (offset 0). The union size is the maximum
 * size of all fields, with proper alignment.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `ctypes.Union` class with `_fields_` definition.
 *
 * @example Basic union
 * ```javascript
 * import { union, c_int32, c_float } from 'node-ctypes';
 *
 * const Value = union({
 *   asInt: c_int32,
 *   asFloat: c_float
 * });
 *
 * const val = Value.create();
 * val.asInt = 0x3F800000;
 * console.log(val.asFloat); // 1.0 (same memory, different interpretation)
 * ```
 *
 * @example Union with nested types
 * ```javascript
 * const Data = union({
 *   bytes: array(c_uint8, 8),
 *   int64: c_int64,
 *   floats: array(c_float, 2)
 * });
 * ```
 */

import { bitFieldAccessors } from "./bitfield.js";
import { readArrayField } from "./array.js";
import { declareFields } from "./fields.js";
import { normalizePack } from "./layout.js";
import { buildWrapper } from "./wrap.js";
import { syncDefinition } from "../../memory/mirror.js";
import { kFromBytes } from "../Structure.js";
import { clearKeepAlives, copyInstance, pointerOwner } from "../../memory/ownership.js";
import { fieldsOf, simpleFieldWriter, writePointerField } from "./common.js";
import { structGetters } from "../protocol.js";
import { scalarReader } from "../../types/scalar-protocol.js";

/**
 * Creates a union type definition where all fields share offset 0.
 *
 * Returns a union definition object with methods to create instances,
 * read/write fields, and convert to/from JavaScript objects. All fields
 * in a union share the same memory location.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `Union` class with `_fields_` attribute.
 *
 * @param {Object} fields - Field definitions { name: type, ... }
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
 * @returns {Object} Union definition with create, get, set, toObject methods
 * @throws {TypeError} If field types are invalid
 *
 * @example Create union with different interpretations
 * ```javascript
 * const Value = union({
 *   asInt: c_int32,
 *   asFloat: c_float,
 *   bytes: array(c_uint8, 4)
 * });
 *
 * const val = Value.create({ asInt: 1065353216 });
 * console.log(val.asFloat); // 1.0
 * console.log([...val.bytes]); // [0, 0, 128, 63]
 * ```
 *
 * @example Union with structs
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const Variant = union({
 *   point: Point,
 *   int64: c_int64
 * });
 * ```
 */
// Python: un campo POINTER(T) NULL è un puntatore falsy; in JS `null`.
const pointerOrNull = (ptrType, address, buf, offset) => {
  const owner = pointerOwner(buf, offset, address);
  return address === 0n ? null : ptrType.fromAddress(address, owner);
};

export function union(fields, options, sizeof, alloc, readValue, writeValue, _isStruct, _isArrayType, _isBitField, Structure, Union, native) {
  // Backward-compat: legacy positional signature (fields, sizeof, alloc, ...)
  // had `options` missing. Detect that shape and shift arguments.
  if (typeof options === "function") {
    native = Union;
    Union = Structure;
    Structure = _isBitField;
    _isBitField = _isArrayType;
    _isArrayType = _isStruct;
    _isStruct = writeValue;
    writeValue = readValue;
    readValue = alloc;
    alloc = sizeof;
    sizeof = options;
    options = {};
  }
  options = options || {};
  const swapped = options.swapped === true;
  // Python _pack_: `pack` da solo, o `packed: true` (= pack 1).
  const packValue = normalizePack(options.pack ?? (options.packed ? 1 : 0));
  const { base, fieldDefs, fieldMap, size: maxSize, alignment: maxAlignment } = declareFields(fields, options, { isStruct: false, pack: packValue, swapped, sizeof, _isStruct, _isArrayType, _isBitField, Structure, native });

  // Pre-compile reader/writer per campi primitivi e POINTER — evita il
  // dispatch completo in unionDef.get/set a ogni accesso. Per i tipi
  // complessi (bitfield/nested/array) si continua a passare dal percorso
  // generico.
  const fieldReaders = Object.create(null);
  const fieldWriters = Object.create(null);
  const mayKeepObjects = fieldDefs.some((field) => field.isPointer || field.type?._isPointerValued || field.isNested || field.isArray);
  // Risolvi POINTER_SIZE una sola volta (costante di processo).
  const is64 = native.POINTER_SIZE === 8;
  for (const field of fieldDefs) {
    if (field.isNested || field.isArray) continue;
    const offset = field.offset;
    const name = field.name;

    // Bitfield precompilato (parity con struct.js).
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
    if (field.isPointer) {
      const ptrType = field.type;
      if (is64) {
        fieldReaders[name] = (buf) => pointerOrNull(ptrType, buf.readBigUInt64LE(offset), buf, offset);
        fieldWriters[name] = (buf, val) => {
          writePointerField(buf, offset, val, 8);
        };
      } else {
        fieldReaders[name] = (buf) => pointerOrNull(ptrType, BigInt(buf.readUInt32LE(offset)), buf, offset);
        fieldWriters[name] = (buf, val) => {
          writePointerField(buf, offset, val, 4);
        };
      }
      continue;
    }

    const fieldType = field.type;
    if (fieldType && fieldType._isSimpleCData) {
      const reader = scalarReader(fieldType, field.swapped && fieldType._readerBE ? fieldType._readerBE : fieldType._reader, field.swapped);
      const writer = field.swapped && fieldType._writerBE ? fieldType._writerBE : fieldType._writer;
      if (reader && writer) {
        fieldReaders[name] = (buf) => reader(buf, offset);
        const write = simpleFieldWriter(fieldType, writer, offset);
        fieldWriters[name] =
          mayKeepObjects && !fieldType._isPointerValued
            ? (buf, value) => {
                write(buf, value);
                clearKeepAlives(buf, offset, fieldType._size);
              }
            : write;
      }
    }
  }

  // Campi raggiungibili attraverso i campi di _anonymous_ (anche annidati).
  const anonymousFieldNames = Object.create(null);
  const anonymousOwner = new Map();
  for (const field of fieldDefs) {
    if (!field.isAnonymous) continue;
    for (const sub of field.type.fields) {
      anonymousFieldNames[sub.name] = true;
      anonymousOwner.set(sub.name, field);
    }
    for (const name of Object.keys(field.type.anonymousFieldNames ?? {})) {
      anonymousFieldNames[name] = true;
      anonymousOwner.set(name, field);
    }
  }
  const anonymousView = (buf, fieldName) => {
    const owner = anonymousOwner.get(fieldName);
    return owner === undefined ? undefined : { def: owner.type, buf: buf.subarray(owner.offset, owner.offset + owner.size) };
  };

  const unionDef = {
    size: maxSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    fieldMap,
    fieldReaders,
    fieldWriters,
    anonymousFieldNames,
    isUnion: true,
    swapped,
    base, // definizione della union base (i suoi campi sono i primi di `fields`)
    _isStructType: true, // Per compatibilità con _isStruct()

    create(values = {}) {
      const buf = alloc(maxSize);
      buf.fill(0);

      // Prima imposta i campi diretti
      for (const field of fieldDefs) {
        if (Object.hasOwn(values, field.name) && values[field.name] !== undefined) {
          unionDef.set(buf, field.name, values[field.name]);
        }
      }

      // Come Python, i campi di _anonymous_ sono raggiungibili dall'istanza.
      return new Proxy(
        buf,
        buildWrapper(unionDef, {
          instanceTag: "UnionInstance",
          exposeAnonymous: true,
        }),
      );
    },

    get(bufOrObj, fieldName, owner) {
      // NUOVO: supporta sia buffer che object wrapper
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        return bufOrObj[fieldName];
      } else {
        throw new TypeError("Expected Buffer or union instance");
      }

      // O(1) lookup con Map
      const field = fieldMap.get(fieldName);
      if (!field) {
        const view = anonymousView(buf, fieldName);
        if (view === undefined) throw new Error(`Unknown field: ${fieldName}`);
        return view.def.get(view.buf, fieldName, owner);
      }

      // Bit field
      if (field.isBitField) {
        return field.readBits(buf);
      }

      // Nested struct
      if (field.isNested) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
        // Classe Structure/Union: un'istanza sulla stessa memoria (Python).
        if (field.cls !== undefined) return field.cls[kFromBytes](nestedBuf, owner);
        // Proxy-based nested instance
        return new Proxy(nestedBuf, {
          get(target, prop, receiver) {
            if (prop === "_buffer") return target;
            if (prop === "toObject") return () => field.type.toObject(target);
            if (prop === Symbol.toStringTag) return "NestedUnionInstance";
            if (prop === Symbol.iterator) return undefined;
            // Handle Buffer/TypedArray properties
            if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
              return target[prop];
            }
            if (typeof prop === "string") {
              // fieldMap precalcolato: sostituisce i `.some((f)=>f.name===prop)`
              // lineari che giravano a ogni accesso.
              const nMap = field.type.fieldMap;
              if (nMap && nMap.has(prop)) {
                const f = nMap.get(prop);
                if (!f.isAnonymous) return field.type.get(target, prop);
              }
            }
            const value = target[prop];
            if (typeof value === "function") return value.bind(target);
            return value;
          },
          set(target, prop, value, receiver) {
            if (typeof prop === "string") {
              const nMap = field.type.fieldMap;
              if (nMap && nMap.has(prop)) {
                const f = nMap.get(prop);
                if (!f.isAnonymous) {
                  field.type.set(target, prop, value);
                  return true;
                }
              }
            }
            return Reflect.set(target, prop, value, receiver);
          },
          has(target, prop) {
            if (prop === "_buffer" || prop === "toObject") return true;
            if (typeof prop === "string") {
              const nMap = field.type.fieldMap;
              if (nMap && nMap.has(prop)) return true;
            }
            return Reflect.has(target, prop);
          },
          ownKeys(target) {
            return (field.type.fields || []).filter((f) => !f.isAnonymous).map((f) => f.name);
          },
          getOwnPropertyDescriptor(target, prop) {
            if (typeof prop === "string") {
              const nMap = field.type.fieldMap;
              if (nMap && nMap.has(prop)) {
                return { enumerable: true, configurable: true, writable: true };
              }
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
          },
        });
      }

      // Array (Python: c_char * n / c_wchar * n si leggono come stringa)
      if (field.isArray) {
        const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
        return readArrayField(field.type, arrayBuf, owner);
      }

      // POINTER() field — return PointerInstance
      if (field.isPointer) {
        const addr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(field.offset) : BigInt(buf.readUInt32LE(field.offset));
        return pointerOrNull(field.type, addr, buf, field.offset);
      }

      // Tipo base: stesso accessor del fast path (rispetta l'endianness)
      return fieldReaders[field.name](buf);
    },

    set(bufOrObj, fieldName, value) {
      // NUOVO: supporta sia buffer che object wrapper
      let buf;
      if (Buffer.isBuffer(bufOrObj)) {
        buf = bufOrObj;
      } else if (bufOrObj && bufOrObj._buffer) {
        // Object wrapper - accesso diretto tramite property
        bufOrObj[fieldName] = value;
        return;
      } else {
        throw new TypeError("Expected Buffer or union instance");
      }

      // Lookup with Map
      const field = fieldMap.get(fieldName);
      if (!field) {
        const view = anonymousView(buf, fieldName);
        if (view === undefined) throw new Error(`Unknown field: ${fieldName}`);
        view.def.set(view.buf, fieldName, value);
        return;
      }

      // Bit field
      if (field.isBitField) {
        field.writeBits(buf, value);
        return;
      }

      // Nested struct
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

      // Array
      if (field.isArray) {
        // Python: bytes / str con il controllo di lunghezza ("bytes too long").
        if (field.type._charKind !== undefined && (typeof value === "string" || (field.type._charKind === "char" && Buffer.isBuffer(value) && value._buffer === undefined))) {
          field.type.setValue(buf.subarray(field.offset, field.offset + field.size), value, (len, max) => `${field.type._charKind === "char" ? "bytes" : "string"} too long (${len}, maximum length ${max})`);
        } else if (Buffer.isBuffer(value) || Buffer.isBuffer(value?._buffer)) {
          copyInstance(buf, field.offset, field.size, value, 0, field.type);
        } else if (Array.isArray(value)) {
          const wrapped = field.type.wrap(buf.subarray(field.offset, field.offset + field.size));
          for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
            wrapped[i] = value[i];
          }
        }
        return;
      }

      // POINTER() field — write address
      if (field.isPointer) {
        writePointerField(buf, field.offset, value, native.POINTER_SIZE);
        return;
      }

      // Tipo base: stesso accessor del fast path (rispetta l'endianness)
      fieldWriters[field.name](buf, value);
    },

    toObject(bufOrObj) {
      // Se è già un object (non buffer), ritorna così com'è
      if (!Buffer.isBuffer(bufOrObj)) {
        if (bufOrObj && bufOrObj._buffer && bufOrObj._buffer.length === maxSize) {
          return bufOrObj; // Già convertito
        }
        // Se è un plain object, convertilo in union
        if (typeof bufOrObj === "object") {
          const buf = alloc(maxSize);
          buf.fill(0);
          for (const [name, value] of Object.entries(bufOrObj)) {
            unionDef.set(buf, name, value);
          }
          return unionDef.toObject(buf);
        }
        throw new TypeError("Expected Buffer or union instance");
      }

      const buf = bufOrObj;
      const obj = {};

      // Cache per oggetti nested (struct/union) per evitare di ricrearli ogni volta
      const nestedCache = new Map();

      // Aggiungi _buffer come property nascosta
      Object.defineProperty(obj, "_buffer", {
        value: buf,
        writable: false,
        enumerable: false,
        configurable: false,
      });

      // Per union, tutte le properties leggono/scrivono all'offset 0
      for (const field of fieldDefs) {
        Object.defineProperty(obj, field.name, {
          get() {
            if (field.isBitField) {
              return field.readBits(buf);
            } else if (field.isNested) {
              // Cache nested objects per evitare di ricrearli ogni volta
              if (!nestedCache.has(field.name)) {
                const nestedBuf = buf.subarray(0, field.size);
                const nestedObj = field.type.toObject(nestedBuf);
                nestedCache.set(field.name, nestedObj);
              }
              return nestedCache.get(field.name);
            } else if (field.isArray) {
              if (field.type._charKind !== undefined) return field.type.getValue(buf.subarray(0, field.size));
              const wrapped = field.type.wrap(buf.subarray(0, field.size));
              return [...wrapped];
            } else if (field.isPointer) {
              const addr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
              return pointerOrNull(field.type, addr, buf, 0);
            } else {
              return fieldReaders[field.name](buf);
            }
          },
          set(value) {
            if (field.isBitField) {
              field.writeBits(buf, value);
            } else if (field.isArray) {
              unionDef.set(buf, field.name, value);
            } else if (field.isPointer) {
              writePointerField(buf, 0, value, native.POINTER_SIZE);
            } else {
              fieldWriters[field.name](buf, value);
            }
          },
          enumerable: true,
          configurable: false,
        });
      }

      return obj;
    },

    // fromObject: write plain object values into buffer
    fromObject: function (buf, obj) {
      for (const [key, value] of Object.entries(fieldsOf(obj))) {
        if (this.fields.some((f) => f.name === key)) {
          this.set(buf, key, value);
        }
      }
    },
  };

  syncDefinition(unionDef);
  structGetters.set(unionDef, unionDef.get);
  return unionDef;
}
