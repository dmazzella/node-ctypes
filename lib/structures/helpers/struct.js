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

import { _readBitField, _writeBitField } from "./bitfield.js";

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
 * @param {boolean} [options.packed=false] - If true, disable padding/alignment
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
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("fields must be a non-null object");
  }

  const packed = options.packed || false;
  let totalSize = 0;
  const fieldDefs = [];
  let maxAlignment = 1;

  // Track field names to detect duplicates
  const fieldNames = new Set();

  // Stato per bit fields consecutivi
  let currentBitFieldBase = null;
  let currentBitFieldOffset = 0;
  let currentBitOffset = 0;

  for (const [name, type] of Object.entries(fields)) {
    // Validate field name
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("Field name must be a non-empty string");
    }
    if (fieldNames.has(name)) {
      throw new TypeError(`Duplicate field name: ${name}`);
    }
    fieldNames.add(name);
    let fieldDef;

    // Caso 0: Anonymous field - { type: SomeStruct, anonymous: true }
    if (typeof type === "object" && type !== null && type.anonymous === true && type.type) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const actualType = type.type;
      const size = actualType.size;
      const alignment = packed ? 1 : actualType.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: actualType,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
        isAnonymous: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 1: Bit field
    else if (_isBitField(type)) {
      const { baseType, bits, baseSize } = type;
      const alignment = packed ? 1 : Math.min(baseSize, native.POINTER_SIZE);

      // Verifica se possiamo continuare nel bit field corrente
      const canContinue = currentBitFieldBase === baseType && currentBitOffset + bits <= baseSize * 8;

      if (!canContinue) {
        // Inizia un nuovo bit field
        // Applica padding per allineamento
        if (!packed && totalSize % alignment !== 0) {
          totalSize += alignment - (totalSize % alignment);
        }

        currentBitFieldBase = baseType;
        currentBitFieldOffset = totalSize;
        currentBitOffset = 0;
        totalSize += baseSize;
      }

      fieldDef = {
        name,
        type: baseType,
        offset: currentBitFieldOffset,
        size: 0, // Bit fields non aggiungono size extra
        alignment,
        isBitField: true,
        bitOffset: currentBitOffset,
        bitSize: bits,
        baseSize,
      };

      currentBitOffset += bits;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 2a: Struct class (declarata come `class X extends Structure`)
    else if (typeof type === "function" && type.prototype instanceof Structure) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const nestedStruct = type._structDef || type._buildStruct();
      const size = nestedStruct.size;
      const alignment = packed ? 1 : nestedStruct.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: nestedStruct,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 2b: Union class (declarata come `class X extends Union`)
    else if (typeof type === "function" && type.prototype instanceof Union) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const nestedUnion = type._unionDef || type._buildUnion();
      const size = nestedUnion.size;
      const alignment = packed ? 1 : nestedUnion.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: nestedUnion,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 2: Nested struct
    else if (_isStruct(type)) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const nestedStruct = type;
      const size = nestedStruct.size;
      const alignment = packed ? 1 : nestedStruct.alignment;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type: nestedStruct,
        offset: totalSize,
        size,
        alignment,
        isNested: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 3: Array type
    else if (_isArrayType(type)) {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      const size = type.getSize();
      const elemSize = sizeof(type.elementType);
      const alignment = packed ? 1 : Math.min(elemSize, native.POINTER_SIZE);

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type,
        offset: totalSize,
        size,
        alignment,
        isArray: true,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }
    // Caso 4: Tipo base (SimpleCData)
    else {
      // Reset bit field state
      currentBitFieldBase = null;
      currentBitOffset = 0;

      // Validate type is a SimpleCData class
      if (!(typeof type === "function" && type._isSimpleCData)) {
        throw new TypeError(`struct field "${name}": type must be a SimpleCData class, struct, union, or array`);
      }

      const size = type._size;
      const naturalAlign = Math.min(size, native.POINTER_SIZE);
      const alignment = packed ? 1 : naturalAlign;

      // Applica padding per allineamento
      if (!packed && totalSize % alignment !== 0) {
        totalSize += alignment - (totalSize % alignment);
      }

      fieldDef = {
        name,
        type,
        offset: totalSize,
        size,
        alignment,
      };

      totalSize += size;

      if (alignment > maxAlignment) {
        maxAlignment = alignment;
      }
    }

    fieldDefs.push(fieldDef);
  }

  // Padding finale per allineamento della struct
  if (!packed && totalSize % maxAlignment !== 0) {
    totalSize += maxAlignment - (totalSize % maxAlignment);
  }

  // Crea Map per lookup O(1) invece di find() O(n)
  const fieldMap = new Map();
  for (const field of fieldDefs) {
    fieldMap.set(field.name, field);
  }

  // Pre-compile reader/writer functions for each field
  const fieldReaders = new Map();
  const fieldWriters = new Map();

  for (const field of fieldDefs) {
    const offset = field.offset;
    const name = field.name;

    // Skip complex types - they need special handling
    if (field.isBitField || field.isNested || field.isArray) {
      continue;
    }

    // Pre-compile based on SimpleCData type
    // Use the type's _reader and _writer directly for optimization
    const fieldType = field.type;
    if (fieldType && fieldType._isSimpleCData) {
      const fieldOffset = offset; // Capture offset for closure
      fieldReaders.set(name, (buf) => fieldType._reader(buf, fieldOffset));
      fieldWriters.set(name, (buf, val) => fieldType._writer(buf, fieldOffset, val));
    }
  }

  const structDef = {
    size: totalSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    packed: packed,
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

      // Proxy-based instance with pre-compiled readers/writers
      return new Proxy(buf, {
        get(target, prop, receiver) {
          // Special properties
          if (prop === "_buffer") return target;
          if (prop === "toObject") return () => structDef.toObject(target);
          if (prop === Symbol.toStringTag) return "StructInstance";
          if (prop === Symbol.iterator) return undefined;

          // Handle Buffer/TypedArray properties FIRST before field checks
          // TypedArray methods need direct access to avoid Proxy interference
          if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
            return target[prop];
          }

          // Use pre-compiled reader if available
          if (typeof prop === "string") {
            const reader = fieldReaders.get(prop);
            if (reader) return reader(target);

            // Fallback to general get for complex types
            if (fieldMap.has(prop)) {
              return structDef.get(target, prop);
            }
          }

          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                return structDef.get(target, prop);
              }
            }
          }

          // Fallback to buffer properties and methods
          const value = target[prop];
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
        set(target, prop, value, receiver) {
          // FAST PATH: Use pre-compiled writer if available
          if (typeof prop === "string") {
            const writer = fieldWriters.get(prop);
            if (writer) {
              writer(target, value);
              return true;
            }

            // Fallback to general set for complex types
            if (fieldMap.has(prop)) {
              structDef.set(target, prop, value);
              return true;
            }
          }

          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                structDef.set(target, prop, value);
                return true;
              }
            }
          }

          // Fallback
          return Reflect.set(target, prop, value, target);
        },
        has(target, prop) {
          if (prop === "_buffer" || prop === "toObject") return true;
          if (typeof prop === "string" && fieldMap.has(prop)) return true;
          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) return true;
            }
          }
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          const keys = [];
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              for (const sf of f.type.fields) {
                keys.push(sf.name);
              }
            } else {
              keys.push(f.name);
            }
          }
          return keys;
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === "string" && (fieldMap.has(prop) || prop === "_buffer" || prop === "toObject")) {
            return {
              enumerable: prop !== "_buffer" && prop !== "toObject",
              configurable: true,
              writable: true,
            };
          }
          // Check anonymous fields
          for (const f of fieldDefs) {
            if (f.isAnonymous && f.type && f.type.fields) {
              if (f.type.fields.some((sf) => sf.name === prop)) {
                return {
                  enumerable: true,
                  configurable: true,
                  writable: true,
                };
              }
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
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
          return _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, sizeof);
        }

        // Nested struct (senza dot = ritorna intero oggetto)
        if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          // Proxy-based nested instance
          return field.type.create
            ? // Se ha create(), usa quello per creare il proxy
              new Proxy(nestedBuf, {
                get(target, prop, receiver) {
                  if (prop === "_buffer") return target;
                  if (prop === "toObject") return () => field.type.toObject(target);
                  if (prop === Symbol.toStringTag) return "NestedStructInstance";
                  if (prop === Symbol.iterator) return undefined;
                  // Handle Buffer/TypedArray properties
                  if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
                    return target[prop];
                  }
                  if (typeof prop === "string") {
                    // Check direct fields
                    const nestedFieldMap = field.type.fields ? new Map(field.type.fields.map((f) => [f.name, f])) : new Map();
                    if (nestedFieldMap.has(prop)) {
                      return field.type.get(target, prop);
                    }
                    // Check anonymous fields
                    for (const sf of field.type.fields || []) {
                      if (sf.isAnonymous && sf.type && sf.type.fields) {
                        if (sf.type.fields.some((ssf) => ssf.name === prop)) {
                          return field.type.get(target, prop);
                        }
                      }
                    }
                  }
                  const value = target[prop];
                  if (typeof value === "function") return value.bind(target);
                  return value;
                },
                set(target, prop, value, receiver) {
                  if (typeof prop === "string") {
                    const nestedFieldMap = field.type.fields ? new Map(field.type.fields.map((f) => [f.name, f])) : new Map();
                    if (nestedFieldMap.has(prop)) {
                      field.type.set(target, prop, value);
                      return true;
                    }
                    // Check anonymous fields
                    for (const sf of field.type.fields || []) {
                      if (sf.isAnonymous && sf.type && sf.type.fields) {
                        if (sf.type.fields.some((ssf) => ssf.name === prop)) {
                          field.type.set(target, prop, value);
                          return true;
                        }
                      }
                    }
                  }
                  return Reflect.set(target, prop, value, receiver);
                },
                has(target, prop) {
                  if (prop === "_buffer" || prop === "toObject") return true;
                  if (typeof prop === "string" && field.type.fields) {
                    if (field.type.fields.some((f) => f.name === prop)) return true;
                  }
                  return Reflect.has(target, prop);
                },
                ownKeys(target) {
                  return (field.type.fields || []).map((f) => f.name);
                },
                getOwnPropertyDescriptor(target, prop) {
                  if (typeof prop === "string" && field.type.fields && field.type.fields.some((f) => f.name === prop)) {
                    return {
                      enumerable: true,
                      configurable: true,
                      writable: true,
                    };
                  }
                  return Reflect.getOwnPropertyDescriptor(target, prop);
                },
              })
            : field.type.toObject(nestedBuf);
        }

        // Array field
        if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          return field.type.wrap(arrayBuf);
        }

        // Tipo base - fast path!
        return readValue(buf, field.type, field.offset);
      }

      // supporto per accesso nested 'outer.inner' o anonymous fields
      const parts = fieldName.split(".");
      const firstPart = parts[0];

      field = fieldMap.get(firstPart);

      // Se non trovato, cerca negli anonymous fields
      if (!field) {
        for (const f of fieldDefs) {
          if (f.isAnonymous && f.type && f.type.fields) {
            const hasField = f.type.fields.some((subField) => subField.name === firstPart);
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
          _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value, sizeof);
          return;
        }

        // Nested struct (senza dot = imposta da oggetto)
        if (field.isNested) {
          if (Buffer.isBuffer(value)) {
            value.copy(buf, field.offset, 0, field.size);
          } else if (typeof value === "object") {
            const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
            for (const [k, v] of Object.entries(value)) {
              field.type.set(nestedBuf, k, v);
            }
          }
          return;
        }

        // Array field
        if (field.isArray) {
          if (Buffer.isBuffer(value)) {
            value.copy(buf, field.offset, 0, field.size);
          } else if (Array.isArray(value)) {
            const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
            const wrapped = field.type.wrap(arrayBuf);
            for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
              wrapped[i] = value[i];
            }
          }
          return;
        }

        // Tipo base - fast path!
        writeValue(buf, field.type, value, field.offset);
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
            const hasField = f.type.fields.some((subField) => subField.name === firstPart);
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
        _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value, sizeof);
        return;
      }

      // Nested struct
      if (field.isNested) {
        if (parts.length > 1) {
          // Accesso a campo annidato singolo
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          field.type.set(nestedBuf, parts.slice(1).join("."), value);
        } else if (Buffer.isBuffer(value)) {
          // Copia buffer
          value.copy(buf, field.offset, 0, field.size);
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
        if (Buffer.isBuffer(value)) {
          // Copia buffer array
          value.copy(buf, field.offset, 0, field.size);
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
      writeValue(buf, field.type, value, field.offset);
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
          result[field.name] = _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, sizeof);
        } else if (field.isNested) {
          const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
          const nestedObj = field.type.toObject(nestedBuf);
          if (field.isAnonymous) {
            // Anonymous fields: promote their fields to parent level
            Object.assign(result, nestedObj);
          } else {
            result[field.name] = nestedObj;
          }
        } else if (field.isArray) {
          const arrayBuf = buf.subarray(field.offset, field.offset + field.size);
          result[field.name] = field.type.wrap(arrayBuf);
        } else {
          // Tipo base - lettura diretta
          result[field.name] = readValue(buf, field.type, field.offset);
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

  // Crea un'istanza C++ StructType per le operazioni native
  try {
    const cppStructType = new StructType();
    // Per ora non aggiungiamo campi - testiamo se ToObject funziona senza
    structDef._cppStructType = cppStructType;
  } catch (e) {
    // Se fallisce, continua senza C++ (fallback a JS)
    console.warn("Failed to create C++ StructType, using JavaScript fallback:", e.message);
  }

  // fromObject: write plain object values into buffer
  structDef.fromObject = function (buf, obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (this.fields.some((f) => f.name === key)) {
        this.set(buf, key, value);
      }
    }
  };

  // createRaw: return plain object without synchronization
  structDef.createRaw = function (values = {}) {
    return this.toObject(this.create(values)._buffer);
  };

  return structDef;
}
