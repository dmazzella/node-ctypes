/**
 * @file Structure.js
 * @module structures/Structure
 * @description Structure base class for Python ctypes-compatible structures.
 *
 * This module provides the `Structure` base class that users extend to create
 * custom struct types with automatic field management, memory layout, and
 * proxy-based field access.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.Structure` class with `_fields_` attribute.
 *
 * @example Basic Structure subclass
 * ```javascript
 * import { Structure, c_int32, c_float } from 'node-ctypes';
 *
 * class Point extends Structure {
 *   static _fields_ = [
 *     ['x', c_int32],
 *     ['y', c_int32]
 *   ];
 * }
 *
 * const pt = new Point({ x: 10, y: 20 });
 * console.log(pt.x, pt.y); // 10 20
 * pt.x = 42;
 * console.log(pt.x); // 42
 * ```
 *
 * @example Positional arguments
 * ```javascript
 * const pt = new Point(10, 20); // x=10, y=20
 * ```
 *
 * @example Wrapping existing buffer
 * ```javascript
 * const buffer = Buffer.alloc(8);
 * const pt = new Point(buffer);
 * pt.x = 100;
 * ```
 *
 * @example Array-style _fields_ (Python ctypes compatible)
 * ```javascript
 * class Rect extends Structure {
 *   static _fields_ = [
 *     ['x', c_int32],
 *     ['y', c_int32],
 *     ['width', c_int32],
 *     ['height', c_int32]
 *   ];
 * }
 * ```
 *
 * @example Object-style _fields_ (alternative syntax)
 * ```javascript
 * class Rect extends Structure {
 *   static _fields_ = {
 *     x: c_int32,
 *     y: c_int32,
 *     width: c_int32,
 *     height: c_int32
 *   };
 * }
 * ```
 */

/**
 * Creates the Structure base class with required dependencies injected.
 *
 * @param {Function} alloc - Memory allocation function
 * @param {Function} struct - Struct definition function
 * @param {Function} bitfield - Bitfield helper function for Python-style [name, type, bits] syntax
 * @returns {Class} Structure base class
 * @private
 */
export function createStructureClass(alloc, struct, bitfield) {
  /**
   * Structure base class for creating C-style structures.
   *
   * Users extend this class and define static `_fields_` to specify the struct layout.
   * The constructor handles memory allocation, field initialization, and returns a
   * Proxy for transparent field access.
   *
   * **Key Features**:
   * - Automatic memory layout based on `_fields_`
   * - Proxy-based transparent field access
   * - Support for positional arguments in constructor
   * - Buffer wrapping for zero-copy operations
   * - Anonymous field support via `_anonymous_`
   * - Packed mode via `_pack_`
   *
   * **Python ctypes Compatibility**:
   * Similar to Python's `ctypes.Structure` with:
   * - `_fields_` attribute (array or object)
   * - `_anonymous_` attribute for anonymous fields
   * - `_pack_` attribute for packed structures
   *
   * @class Structure
   *
   * @example Extending Structure
   * ```javascript
   * class Vec3 extends Structure {
   *   static _fields_ = [
   *     ['x', c_float],
   *     ['y', c_float],
   *     ['z', c_float]
   *   ];
   *
   *   // Add custom methods
   *   length() {
   *     return Math.sqrt(this.x**2 + this.y**2 + this.z**2);
   *   }
   * }
   *
   * const v = new Vec3(1.0, 2.0, 3.0);
   * console.log(v.length()); // 3.7416573867739413
   * ```
   *
   * @example Anonymous fields
   * ```javascript
   * class Point extends Structure {
   *   static _fields_ = [['x', c_int32], ['y', c_int32]];
   * }
   *
   * class Circle extends Structure {
   *   static _fields_ = [
   *     ['center', Point],
   *     ['radius', c_int32]
   *   ];
   *   static _anonymous_ = ['center'];
   * }
   *
   * const c = new Circle();
   * c.x = 10; // Access Point.x directly
   * c.y = 20; // Access Point.y directly
   * c.radius = 5;
   * ```
   */
  class Structure {
    constructor(...args) {
      const Ctor = this.constructor;
      const def = Ctor._structDef || Ctor._buildStruct();
      // Allocate buffer for instance
      let buf = alloc(def.size);
      buf.fill(0);

      // Support positional args: new Point(10,20)
      if (args.length === 1 && typeof args[0] === "object" && !Array.isArray(args[0]) && !Buffer.isBuffer(args[0])) {
        const initial = args[0];
        for (const [k, v] of Object.entries(initial)) {
          def.set(buf, k, v);
        }
      } else if (args.length === 1 && Buffer.isBuffer(args[0])) {
        // new Point(buffer) - wrap existing buffer
        buf = args[0];
        // Validate buffer size matches struct size
        if (buf.length < def.size) {
          throw new RangeError(`Buffer size (${buf.length}) is smaller than struct size (${def.size})`);
        }
      } else if (args.length > 0) {
        // Positional mapping to non-anonymous declared fields order
        const ordered = def.fields.filter((f) => !f.isAnonymous);
        for (let i = 0; i < Math.min(args.length, ordered.length); i++) {
          def.set(buf, ordered[i].name, args[i]);
        }
      }

      // Store internal references on this (needed for methods like toObject)
      this.__buffer = buf;
      this.__structDef = def;

      // Build field map for O(1) lookup
      const fieldMap = new Map();
      const anonFieldNames = new Set();
      for (const field of def.fields) {
        fieldMap.set(field.name, field);
        if (field.isAnonymous && field.type && Array.isArray(field.type.fields)) {
          for (const subField of field.type.fields) {
            anonFieldNames.add(subField.name);
          }
        }
      }

      // Return Proxy instead of using Object.defineProperty for each field
      // Pre-compute fast lookup set for all field names (including anonymous)
      const allFieldNames = new Set(fieldMap.keys());
      for (const name of anonFieldNames) allFieldNames.add(name);

      return new Proxy(this, {
        get(target, prop, receiver) {
          // FAST PATH: struct field access (most common case)
          // Check string type first, then Set lookup - both are O(1)
          if (typeof prop === "string" && allFieldNames.has(prop)) {
            return def.get(buf, prop);
          }

          // SLOW PATH: special properties and methods
          // Symbol check (Symbol.toStringTag, Symbol.iterator)
          if (typeof prop === "symbol") {
            if (prop === Symbol.toStringTag) return Ctor.name || "Structure";
            return undefined;
          }

          // Internal buffer access
          if (prop === "_buffer" || prop === "__buffer") return buf;
          if (prop === "_structDef" || prop === "__structDef") return def;

          // Methods defined on the prototype
          const method = target[prop];
          if (typeof method === "function") {
            return method.bind(target);
          }

          // Fallback to target properties
          return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
          // FAST PATH: struct field access (most common case)
          if (typeof prop === "string" && allFieldNames.has(prop)) {
            def.set(buf, prop, value);
            return true;
          }

          // Fallback
          return Reflect.set(target, prop, value, receiver);
        },
        has(target, prop) {
          if (typeof prop === "string" && allFieldNames.has(prop)) return true;
          if (prop === "_buffer" || prop === "_structDef" || prop === "toObject") return true;
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          const keys = [];
          for (const f of def.fields) {
            if (f.isAnonymous && f.type && Array.isArray(f.type.fields)) {
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
          if (typeof prop === "string" && allFieldNames.has(prop)) {
            return {
              enumerable: true,
              configurable: true,
              writable: true,
            };
          }
          if (prop === "_buffer" || prop === "_structDef") {
            return {
              enumerable: false,
              configurable: true,
              writable: true,
            };
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    }

    // Static getters for size, alignment, and fields (enables use as nested type)
    static get size() {
      const def = this._structDef || this._buildStruct();
      return def.size;
    }

    static get alignment() {
      const def = this._structDef || this._buildStruct();
      return def.alignment;
    }

    static get fields() {
      const def = this._structDef || this._buildStruct();
      return def.fields;
    }

    static get create() {
      const def = this._structDef || this._buildStruct();
      return def.create.bind(def);
    }

    // Build the underlying struct definition and cache it on the constructor
    static _buildStruct() {
      // Accept either array _fields_ (Python style) or object map
      const fields = this._fields_ || {};
      let mapFields = {};

      if (Array.isArray(fields)) {
        for (const entry of fields) {
          if (Array.isArray(entry) && entry.length >= 2) {
            const name = entry[0];
            const type = entry[1];
            // Python-style bitfield: [name, type, bits]
            if (entry.length >= 3 && typeof entry[2] === "number") {
              mapFields[name] = bitfield(type, entry[2]);
            } else {
              mapFields[name] = type;
            }
          }
        }
      } else if (typeof fields === "object" && fields !== null) {
        mapFields = { ...fields };
      }

      // Handle anonymous fields list: convert to { anonymous: true, type: T }
      if (Array.isArray(this._anonymous_)) {
        for (const anonName of this._anonymous_) {
          if (mapFields[anonName] !== undefined) {
            let anonType = mapFields[anonName];
            // Normalize type: if it's a Structure/Union class, get its _structDef
            if (typeof anonType === "function" && typeof anonType._buildStruct === "function") {
              anonType = anonType._structDef || anonType._buildStruct();
            }
            mapFields[anonName] = {
              anonymous: true,
              type: anonType,
            };
          }
        }
      }

      const options = {};
      if (this._pack_ !== undefined) options.packed = !!this._pack_;

      const def = struct(mapFields, options);
      this._structDef = def;
      return def;
    }

    // Create returns an instance of the JS class (not a plain object)
    static create(values = {}) {
      const def = this._structDef || this._buildStruct();
      // If a Buffer provided, wrap it
      if (Buffer.isBuffer(values)) {
        const inst = new this(values);
        return inst;
      }
      // If values is instance of this class, return it
      if (values && values._buffer && values._structDef === def) {
        return values;
      }
      return new this(values);
    }

    // Create raw plain object without synchronization (for performance)
    static createRaw(values = {}) {
      const def = this._structDef || this._buildStruct();
      return def.toObject(def.create(values)._buffer);
    }

    // Synchronize plain object into instance buffer
    syncFromObject(obj) {
      const plain = this.__structDef.toObject(this.__buffer);
      Object.assign(plain, obj);
      this.__structDef.fromObject(this.__buffer, plain);
    }

    // toObject: accept Buffer, instance or plain buffer
    static toObject(bufOrInst) {
      const def = this._structDef || this._buildStruct();
      if (bufOrInst && bufOrInst._buffer) {
        return def.toObject(bufOrInst._buffer);
      }
      return def.toObject(bufOrInst);
    }

    // fromObject: write plain object into buffer
    static fromObject(bufOrInst, obj) {
      const def = this._structDef || this._buildStruct();
      const buf = bufOrInst && bufOrInst._buffer ? bufOrInst._buffer : bufOrInst;
      return def.fromObject(buf, obj);
    }

    // Instance convenience
    get(fieldName) {
      return this.__structDef.get(this.__buffer, fieldName);
    }

    set(fieldName, value) {
      return this.__structDef.set(this.__buffer, fieldName, value);
    }

    // Bulk operations for better performance
    setFields(fields) {
      for (const [name, value] of Object.entries(fields)) {
        this.__structDef.set(this.__buffer, name, value);
      }
    }

    getFields(fieldNames) {
      const result = {};
      for (const name of fieldNames) {
        result[name] = this.__structDef.get(this.__buffer, name);
      }
      return result;
    }

    // bulk operations (Proxy reads directly from buffer - no cache needed)
    withBulkUpdate(callback) {
      return callback(this);
    }

    // Direct typed array access for numeric fields (maximum performance)
    getInt32Array(offset = 0, length) {
      return new Int32Array(this.__buffer.buffer, this.__buffer.byteOffset + offset, length);
    }

    getFloat64Array(offset = 0, length) {
      return new Float64Array(this.__buffer.buffer, this.__buffer.byteOffset + offset, length);
    }

    // Get raw buffer slice for external operations
    getBufferSlice(offset = 0, size = this.__buffer.length - offset) {
      return this.__buffer.subarray(offset, offset + size);
    }

    // Vectorized operations for arrays of structs
    static createArray(count, initialValues = []) {
      const instances = [];
      for (let i = 0; i < count; i++) {
        instances.push(this.create(initialValues[i] || {}));
      }
      return instances;
    }

    // Bulk update all instances in array
    static updateArray(instances, updates) {
      for (let i = 0; i < instances.length && i < updates.length; i++) {
        if (updates[i] && typeof updates[i] === "object") {
          instances[i].setFields(updates[i]);
        }
      }
    }

    toObject() {
      return this.__structDef.toObject(this.__buffer);
    }
  }

  return Structure;
}
