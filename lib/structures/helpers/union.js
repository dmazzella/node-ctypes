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

import { _readBitField, _writeBitField } from "./bitfield.js";

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
export function union(fields, sizeof, alloc, readValue, writeValue, _isStruct, _isArrayType, _isBitField, Structure, Union, native) {
  let maxSize = 0;
  let maxAlignment = 1;
  const fieldDefs = [];

  for (const [name, type] of Object.entries(fields)) {
    let size, alignment;
    let fieldDef = { name, type, offset: 0 };

    // Nested struct (object form or class form)
    if (_isStruct(type)) {
      // Normalize type: if it's a Structure/Union class, get its _structDef
      let nestedStruct = type;
      if (typeof type === "function" && typeof type._buildStruct === "function") {
        nestedStruct = type._structDef || type._buildStruct();
        fieldDef.type = nestedStruct;
      }
      size = nestedStruct.size;
      alignment = nestedStruct.alignment;
      fieldDef.isNested = true;
    }
    // Array type
    else if (_isArrayType(type)) {
      size = type.getSize();
      const elemSize = sizeof(type.elementType);
      alignment = Math.min(elemSize, native.POINTER_SIZE);
      fieldDef.isArray = true;
    }
    // Bit field - in union ogni bitfield occupa l'intero baseType
    else if (_isBitField(type)) {
      size = type.baseSize;
      alignment = Math.min(size, native.POINTER_SIZE);
      fieldDef.isBitField = true;
      fieldDef.bitOffset = 0;
      fieldDef.bitSize = type.bits;
      fieldDef.baseSize = type.baseSize;
      fieldDef.type = type.baseType; // Usa il tipo base per lettura/scrittura
    }
    // Tipo base (SimpleCData)
    else {
      // Validate type is a SimpleCData class
      if (!(typeof type === "function" && type._isSimpleCData)) {
        throw new TypeError(`union field "${name}": type must be a SimpleCData class, struct, union, or array`);
      }
      size = type._size;
      alignment = Math.min(size, native.POINTER_SIZE);
      fieldDef.type = type;
    }

    fieldDef.size = size;
    fieldDef.alignment = alignment;
    fieldDefs.push(fieldDef);

    if (size > maxSize) {
      maxSize = size;
    }
    if (alignment > maxAlignment) {
      maxAlignment = alignment;
    }
  }

  // Padding finale per allineamento
  if (maxSize % maxAlignment !== 0) {
    maxSize += maxAlignment - (maxSize % maxAlignment);
  }

  // Crea Map per lookup O(1)
  const fieldMap = new Map();
  for (const field of fieldDefs) {
    fieldMap.set(field.name, field);
  }

  const unionDef = {
    size: maxSize,
    alignment: maxAlignment,
    fields: fieldDefs,
    isUnion: true,
    _isStructType: true, // Per compatibilità con _isStruct()

    create(values = {}) {
      const buf = alloc(maxSize);
      buf.fill(0);

      // Prima imposta i campi diretti
      for (const field of fieldDefs) {
        if (values[field.name] !== undefined) {
          unionDef.set(buf, field.name, values[field.name]);
        }
      }

      // Proxy-based instance (single Proxy instead of N defineProperty calls)
      return new Proxy(buf, {
        get(target, prop, receiver) {
          // Special properties
          if (prop === "_buffer") return target;
          if (prop === "toObject") return () => unionDef.toObject(target);
          if (prop === Symbol.toStringTag) return "UnionInstance";
          if (prop === Symbol.iterator) return undefined;

          // Handle Buffer/TypedArray properties FIRST before field checks
          if (prop === "length" || prop === "byteLength" || prop === "byteOffset" || prop === "buffer" || prop === "BYTES_PER_ELEMENT") {
            return target[prop];
          }

          // Check if it's a known field
          if (typeof prop === "string" && fieldMap.has(prop)) {
            return unionDef.get(target, prop);
          }

          // Fallback to buffer properties and methods
          const value = target[prop];
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
        set(target, prop, value, receiver) {
          // Check if it's a known field
          if (typeof prop === "string" && fieldMap.has(prop)) {
            unionDef.set(target, prop, value);
            return true;
          }

          // Fallback
          return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
          if (prop === "_buffer" || prop === "toObject") return true;
          if (typeof prop === "string" && fieldMap.has(prop)) return true;
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          return fieldDefs.map((f) => f.name);
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === "string" && (fieldMap.has(prop) || prop === "_buffer" || prop === "toObject")) {
            return {
              enumerable: prop !== "_buffer" && prop !== "toObject",
              configurable: true,
              writable: true,
            };
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    get(bufOrObj, fieldName) {
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
      if (!field) throw new Error(`Unknown field: ${fieldName}`);

      // Bit field
      if (field.isBitField) {
        return _readBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, sizeof);
      }

      // Nested struct
      if (field.isNested) {
        const nestedBuf = buf.subarray(field.offset, field.offset + field.size);
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
            if (typeof prop === "string" && field.type.fields) {
              if (field.type.fields.some((f) => f.name === prop && !f.isAnonymous)) {
                return field.type.get(target, prop);
              }
            }
            const value = target[prop];
            if (typeof value === "function") return value.bind(target);
            return value;
          },
          set(target, prop, value, receiver) {
            if (typeof prop === "string" && field.type.fields) {
              if (field.type.fields.some((f) => f.name === prop && !f.isAnonymous)) {
                field.type.set(target, prop, value);
                return true;
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
            return (field.type.fields || []).filter((f) => !f.isAnonymous).map((f) => f.name);
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
        });
      }

      // Array
      if (field.isArray) {
        return field.type.wrap(buf.subarray(field.offset, field.offset + field.size));
      }

      // Tipo base
      return readValue(buf, field.type, field.offset);
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
      if (!field) throw new Error(`Unknown field: ${fieldName}`);

      // Bit field
      if (field.isBitField) {
        _writeBitField(buf, field.offset, field.type, field.bitOffset, field.bitSize, value, sizeof);
        return;
      }

      // Nested struct
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

      // Array
      if (field.isArray) {
        if (Buffer.isBuffer(value)) {
          value.copy(buf, field.offset, 0, field.size);
        } else if (Array.isArray(value)) {
          const wrapped = field.type.wrap(buf.subarray(field.offset, field.offset + field.size));
          for (let i = 0; i < Math.min(value.length, field.type.length); i++) {
            wrapped[i] = value[i];
          }
        } else if (value && value._buffer && Buffer.isBuffer(value._buffer)) {
          // Handle array proxy instances
          value._buffer.copy(buf, field.offset, 0, field.size);
        }
        return;
      }

      // Tipo base
      writeValue(buf, field.type, value, field.offset);
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
              return _readBitField(buf, 0, field.type, field.bitOffset, field.bitSize, sizeof);
            } else if (field.isNested) {
              // Cache nested objects per evitare di ricrearli ogni volta
              if (!nestedCache.has(field.name)) {
                const nestedBuf = buf.subarray(0, field.size);
                const nestedObj = field.type.toObject(nestedBuf);
                nestedCache.set(field.name, nestedObj);
              }
              return nestedCache.get(field.name);
            } else if (field.isArray) {
              const wrapped = field.type.wrap(buf.subarray(0, field.size));
              return [...wrapped];
            } else {
              return readValue(buf, field.type, 0);
            }
          },
          set(value) {
            if (field.isBitField) {
              _writeBitField(buf, 0, field.type, field.bitOffset, field.bitSize, value, sizeof);
            } else {
              writeValue(buf, field.type, value, 0);
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
      for (const [key, value] of Object.entries(obj)) {
        if (this.fields.some((f) => f.name === key)) {
          this.set(buf, key, value);
        }
      }
    },
  };

  return unionDef;
}
