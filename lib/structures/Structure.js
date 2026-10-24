/**
 * @file Structure.js
 * @module structures/Structure
 * @description Structure base class for Python ctypes-compatible structures.
 *
 * This module provides the `Structure` base class that users extend to create
 * custom struct types with automatic field management, memory layout, and
 * field accessors on the class prototype (as Python field descriptors).
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

import { kMirrorBase, mirrorBase, mirroredAccessors, mirrorsActive } from "../memory/mirror.js";
import { copyInstance, fieldsOf, inDllBuffer, sourceBytes } from "./helpers/common.js";
import { normalizePack } from "./helpers/layout.js";

/**
 * Creates the Structure base class with required dependencies injected.
 *
 * @param {Function} alloc - Memory allocation function
 * @param {Function} struct - Struct definition function
 * @param {Function} bitfield - Bitfield helper function for Python-style [name, type, bits] syntax
 * @returns {Class} Structure base class
 * @private
 */
function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createStructureClass(alloc, struct, bitfield, ptrToBuffer) {
  // Buffer dell'istanza, letto dall'handler condiviso. Chiave privata e non
  // `__buffer`, così riassegnare `__buffer` non cambia i campi (come prima).
  const kBuffer = Symbol("buffer");
  // Definizione (layout) propria di ogni classe, vedi `static get _structDef`.
  const kStructDef = Symbol("structDef");

  // Definizione con cui è stata creata l'istanza (layout dei suoi byte).
  const kDef = Symbol("def");
  // Istanze dei campi struct/union annidati, create al primo accesso: sono
  // viste sulla memoria dell'istanza, quindi restano valide.
  const kViews = Symbol("views");
  // Nomi dei campi con un accessor installato da noi, per prototipo.
  const installedNames = new WeakMap();
  // Nomi che restano proprietà della libreria anche se usati come campi.
  const reservedNames = new Set(["constructor", "_buffer", "__buffer", "_structDef", "__structDef"]);

  // Percorso generale di un campo: istanza con un'altra definizione (creata
  // prima di un'invalidazione del layout), copia di memoria nativa (Electron,
  // memory/mirror.js), campi senza lettore precompilato (struct annidate,
  // array, sotto-campi di _anonymous_).
  function readField(inst, name) {
    const def = inst[kDef];
    const base = inst[kMirrorBase];
    const read = (base !== undefined ? mirroredAccessors(def) : def).fieldReaders?.[name];
    return read !== undefined ? read(inst[kBuffer], base) : def.get(inst[kBuffer], name);
  }

  function writeField(inst, name, value) {
    const def = inst[kDef];
    const base = inst[kMirrorBase];
    const write = (base !== undefined ? mirroredAccessors(def) : def).fieldWriters?.[name];
    if (write !== undefined) write(inst[kBuffer], value, base);
    else def.set(inst[kBuffer], name, value);
  }

  // Python: i campi sono descrittori della classe (CField), non attributi
  // dell'istanza. Qui accessor sul prototipo della classe, condivisi da tutte
  // le istanze: un Proxy per istanza costava ~20 ns per accesso. Il percorso
  // veloce usa il lettore/scrittore precompilato della definizione della classe.
  function installFieldAccessors(Ctor, def) {
    const proto = Ctor.prototype;
    for (const name of installedNames.get(proto) ?? []) {
      delete proto[name];
    }
    const names = [];
    for (const field of def.fields) {
      names.push(field.name);
      if (field.isAnonymous && field.type && Array.isArray(field.type.fields)) {
        // Campi promossi (anche da campi anonimi annidati), come Python.
        for (const subField of field.type.fields) names.push(subField.name);
        for (const name of Object.keys(field.type.anonymousFieldNames ?? {})) names.push(name);
      }
    }
    const installed = [];
    const nestedClasses = new Map();
    for (const field of def.fields) {
      if (field.isNested && !field.isAnonymous && field.cls !== undefined) nestedClasses.set(field.name, field);
    }
    for (const name of names) {
      if (reservedNames.has(name)) continue;
      const nested = nestedClasses.get(name);
      if (nested !== undefined) {
        const { cls, offset, size } = nested;
        Object.defineProperty(proto, name, {
          get() {
            if (this[kDef] !== def) return readField(this, name);
            let views = this[kViews];
            if (views === undefined) views = this[kViews] = new Map();
            let view = views.get(name);
            if (view === undefined) {
              view = new cls(this[kBuffer].subarray(offset, offset + size));
              views.set(name, view);
            }
            return view;
          },
          set(value) {
            writeField(this, name, value);
          },
          enumerable: false,
          configurable: true,
        });
        installed.push(name);
        continue;
      }
      const read = def.fieldReaders?.[name];
      const write = def.fieldWriters?.[name];
      Object.defineProperty(proto, name, {
        get:
          read !== undefined
            ? function () {
                if (this[kDef] === def && this[kMirrorBase] === undefined) return read(this[kBuffer]);
                return readField(this, name);
              }
            : function () {
                return readField(this, name);
              },
        set:
          write !== undefined
            ? function (value) {
                if (this[kDef] === def && this[kMirrorBase] === undefined) write(this[kBuffer], value);
                else writeField(this, name, value);
              }
            : function (value) {
                writeField(this, name, value);
              },
        enumerable: false,
        configurable: true,
      });
      installed.push(name);
    }
    installedNames.set(proto, installed);
  }

  // Scrittore precompilato del campo quando esiste, altrimenti def.set generico.
  function setField(def, buf, name, value) {
    const writer = def.fieldWriters !== undefined ? def.fieldWriters[name] : undefined;
    if (writer !== undefined) {
      writer(buf, value);
    } else {
      def.set(buf, name, value);
    }
  }

  // Campi assegnati dagli argomenti posizionali (new Point(10, 20)).
  const positionalCache = new WeakMap();

  function getPositionalFields(def) {
    let ordered = positionalCache.get(def);
    if (ordered === undefined) {
      ordered = def.fields.filter((f) => !f.isAnonymous);
      positionalCache.set(def, ordered);
    }
    return ordered;
  }
  /**
   * Structure base class for creating C-style structures.
   *
   * Users extend this class and define static `_fields_` to specify the struct layout.
   * The constructor handles memory allocation and field initialization; the
   * fields are accessors of the class prototype (Python: field descriptors).
   *
   * **Key Features**:
   * - Automatic memory layout based on `_fields_`
   * - Field accessors shared by all instances of the class
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
      // Definizione propria della classe (percorso caldo di `new`: una lettura
      // di proprietà invece di Object.hasOwn).
      const own = Ctor[kStructDef];
      const def = own !== undefined && own.owner === Ctor ? own.def : Ctor._buildStruct();
      let buf;

      // Support positional args: new Point(10,20)
      // Un'istanza di struct/union come unico argomento è posizionale
      // (Python: RECT(point)), non un oggetto di inizializzazione per nome.
      const single = args.length === 1 ? args[0] : undefined;
      // Solo un oggetto semplice è un'inizializzazione per nome: istanze
      // ctypes (anche SimpleCData, Python: P(c_int(5))) sono posizionali.
      const isNamedInit = typeof single === "object" && single !== null && isPlainObject(single);
      if (isNamedInit) {
        // alloc() restituisce un buffer già azzerato (Buffer.alloc)
        buf = alloc(def.size);
        const initial = args[0];
        for (const [k, v] of Object.entries(initial)) {
          setField(def, buf, k, v);
        }
      } else if (args.length === 1 && Buffer.isBuffer(args[0])) {
        // new Point(buffer) - wrap existing buffer
        buf = args[0];
        // Validate buffer size matches struct size
        if (buf.length < def.size) {
          throw new RangeError(`Buffer size (${buf.length}) is smaller than struct size (${def.size})`);
        }
      } else {
        buf = alloc(def.size);
        if (args.length > 0) {
          // Positional mapping to non-anonymous declared fields order
          const ordered = getPositionalFields(def);
          if (args.length > ordered.length) throw new TypeError("too many initializers");
          for (let i = 0; i < args.length; i++) {
            setField(def, buf, ordered[i].name, args[i]);
          }
        }
      }

      this[kBuffer] = buf;
      this[kDef] = def;
      this[kViews] = undefined;
      // Indirizzo di una copia di memoria nativa (Electron), undefined altrimenti.
      this[kMirrorBase] = mirrorsActive ? mirrorBase(buf) : undefined;
    }

    // Memoria e definizione dell'istanza. Riassegnare `__buffer` crea una
    // proprietà propria e non cambia la memoria dei campi.
    get _buffer() {
      return this[kBuffer];
    }

    get __buffer() {
      return this[kBuffer];
    }

    set __buffer(value) {
      Object.defineProperty(this, "__buffer", { value, writable: true, configurable: true });
    }

    get _structDef() {
      return this[kDef];
    }

    get __structDef() {
      return this[kDef];
    }

    get [Symbol.toStringTag]() {
      return this.constructor.name || "Structure";
    }

    // I campi non sono proprietà proprie (come in Python): JSON.stringify e
    // util.inspect li mostrano tramite toObject().
    toJSON() {
      return this.toObject();
    }

    [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
      return `${this.constructor.name || "Structure"} ${inspect(this.toObject(), options)}`;
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

    /**
     * Create a Structure instance that shares memory with an existing Buffer.
     * Writes through the instance propagate to the source buffer.
     *
     * Python ctypes parity: `Structure.from_buffer(source, offset=0)`.
     *
     * @param {Buffer} source - Existing Buffer to alias.
     * @param {number} [offset=0] - Byte offset into source.
     * @returns {Structure} A new instance sharing memory with source.
     */
    static from_buffer(source, offset = 0) {
      const def = this._structDef || this._buildStruct();
      const bytes = sourceBytes(source, offset, def.size, "from_buffer");
      // Buffer: subarray (conserva la sincronizzazione delle copie native).
      return new this(Buffer.isBuffer(bytes) ? bytes.subarray(offset, offset + def.size) : Buffer.from(bytes.buffer, bytes.byteOffset + offset, def.size));
    }

    /**
     * Create a Structure instance whose buffer is a copy of the source bytes.
     * Writes to the instance do NOT affect the source.
     *
     * Python ctypes parity: `Structure.from_buffer_copy(source, offset=0)`.
     *
     * @param {Buffer|Uint8Array} source - Bytes to copy from.
     * @param {number} [offset=0] - Byte offset into source.
     * @returns {Structure} A new instance with its own buffer.
     */
    static from_buffer_copy(source, offset = 0) {
      const def = this._structDef || this._buildStruct();
      const bytes = sourceBytes(source, offset, def.size, "from_buffer_copy");
      const copy = Buffer.alloc(def.size);
      copyInstance(copy, 0, def.size, bytes, offset, def);
      return new this(copy);
    }

    /**
     * Create a Structure instance that maps an existing memory address.
     * Caller is responsible for ensuring the memory at `address` stays valid
     * and is at least `sizeof(this)` bytes.
     *
     * Python ctypes parity: `Structure.from_address(address)`.
     *
     * @param {bigint|number} address - Raw memory address.
     * @returns {Structure} A new instance viewing the memory at address.
     */
    static from_address(address) {
      if (!ptrToBuffer) {
        throw new Error("from_address requires the native module (not loaded)");
      }
      const addr = typeof address === "bigint" ? address : BigInt(address);
      const def = this._structDef || this._buildStruct();
      const buf = ptrToBuffer(addr, def.size);
      return new this(buf);
    }

    /**
     * Bind the Structure to an exported global variable in a shared library.
     * Python ctypes parity: `S.in_dll(library, name)`.
     */
    static in_dll(library, name) {
      const def = this._structDef || this._buildStruct();
      return new this(inDllBuffer(library, name, def.size, ptrToBuffer));
    }

    // Build the underlying struct definition and cache it on the constructor
    // Definizione della classe stessa: una sottoclasse non eredita quella
    // della base (ha un layout proprio, vedi _buildStruct).
    static get _structDef() {
      const own = this[kStructDef];
      return own !== undefined && own.owner === this ? own.def : undefined;
    }

    static set _structDef(def) {
      // null/undefined invalida la cache (il layout viene ricostruito).
      if (def === null || def === undefined) {
        delete this[kStructDef];
        return;
      }
      // { owner, def }: una sottoclasse eredita la proprietà ma non è `owner`.
      Object.defineProperty(this, kStructDef, { value: { owner: this, def }, configurable: true, writable: true });
      installFieldAccessors(this, def);
    }

    // Classe base con un layout (Python: la sottoclasse ne estende i campi),
    // null per le basi della libreria (Structure, Union, BigEndianStructure...).
    static _baseLayoutClass() {
      const parent = Object.getPrototypeOf(this);
      for (let c = parent; typeof c === "function" && c.prototype instanceof Structure; c = Object.getPrototypeOf(c)) {
        if (Object.hasOwn(c, "_fields_") || c._structDef !== undefined) return parent;
      }
      return null;
    }

    // `_fields_` della classe come coppie [name, type] nell'ordine dichiarato
    // (un oggetto metterebbe prima i nomi come "1"), con i bitfield
    // `[name, type, bits]` e (se `withAnonymous`) i campi di `_anonymous_`
    // come { anonymous: true, type, cls }.
    static _fieldMap(withAnonymous = true) {
      const fields = Object.hasOwn(this, "_fields_") ? this._fields_ : {};
      let entries;
      if (Array.isArray(fields)) {
        entries = fields.map((entry) => {
          const valid = Array.isArray(entry) && typeof entry[0] === "string" && entry[1] != null && (entry.length === 2 || (entry.length === 3 && typeof entry[2] === "number"));
          if (!valid) {
            throw new TypeError("_fields_ must be a sequence of (name, C type) pairs or (name, C type, bit size) triples");
          }
          return entry.length === 3 ? [entry[0], bitfield(entry[1], entry[2])] : [entry[0], entry[1]];
        });
      } else if (typeof fields === "object" && fields !== null) {
        entries = Object.entries(fields);
      } else {
        entries = [];
      }

      if (withAnonymous && Array.isArray(this._anonymous_)) {
        const anonymous = new Set(this._anonymous_);
        entries = entries.map(([name, type]) => {
          if (!anonymous.has(name)) return [name, type];
          // Classe Structure/Union: la sua definizione, e la classe per le istanze.
          if (typeof type === "function" && typeof type._buildStruct === "function") {
            return [name, { anonymous: true, type: type._structDef || type._buildStruct(), cls: type }];
          }
          return [name, { anonymous: true, type }];
        });
      }
      return entries;
    }

    // Opzioni di layout della classe (ereditate, come getattr in Python):
    // `_pack_`, `_layout_`, `_align_` e byte order.
    static _layoutOptions() {
      const options = {};
      if (this._pack_ !== undefined && this._pack_ !== null) {
        options.pack = normalizePack(this._pack_);
        options.packed = options.pack !== 0;
      }
      // Python ctypes: "ms" (Windows, or with _pack_) or "gcc-sysv" bitfield layout.
      if (this._layout_ !== undefined) options.layout = this._layout_;
      // Python ctypes: `_align_` raises the minimum alignment of the type.
      if (this._align_ !== undefined) options.align = this._align_;
      // Python ctypes: `_swappedbytes_` (or the BigEndianStructure /
      // LittleEndianStructure base class) requests byte-swapped fields.
      // We only officially support LE hosts, so `swapped: true` ⇒ BE layout.
      if (this._swappedbytes_ === true || this._swapped_ === true) {
        options.swapped = true;
      }
      return options;
    }

    // Build the underlying struct definition and cache it on the constructor
    static _buildStruct() {
      const own = this._structDef;
      if (own !== undefined) return own;
      const Base = this._baseLayoutClass();
      const base = Base === null ? null : Base._structDef || Base._buildStruct();
      // Python: una sottoclasse senza _fields_ propri ha il layout della base.
      if (base !== null && !Object.hasOwn(this, "_fields_")) {
        this._structDef = base;
        return base;
      }
      if (base !== null && base.isUnion) {
        throw new TypeError("a Structure cannot extend a Union");
      }
      const def = struct(this._fieldMap(), { ...this._layoutOptions(), base });
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
      for (const [name, value] of Object.entries(fieldsOf(fields))) {
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

    // bulk operations (fields read directly from the buffer - no cache needed)
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

  /**
   * Structure subclass that stores fields in big-endian byte order.
   * Python ctypes parity: `ctypes.BigEndianStructure`.
   *
   * Scalar primitive fields (int*, uint*, float, double, long, size_t, ssize_t,
   * wchar) are byte-swapped transparently on read/write. 1-byte fields (int8,
   * uint8, bool, char) are unaffected. Pointers and bitfields keep native
   * layout — same caveat as CPython.
   */
  class BigEndianStructure extends Structure {
    static _swapped_ = true;
  }

  /**
   * Structure subclass with explicit little-endian layout. On the LE hosts we
   * officially support this is identical to plain Structure; it exists for
   * API symmetry and to document intent.
   * Python ctypes parity: `ctypes.LittleEndianStructure`.
   */
  class LittleEndianStructure extends Structure {
    static _swapped_ = false;
  }

  return { Structure, BigEndianStructure, LittleEndianStructure };
}
