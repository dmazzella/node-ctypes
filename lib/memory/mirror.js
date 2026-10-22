/**
 * @file mirror.js
 * @module memory/mirror
 * @description Memory access where external buffers are not allowed.
 *
 * Electron (V8 memory cage) forbids Buffers over memory not allocated by V8,
 * so the library cannot create a view of native memory. There, the view
 * is replaced by a "mirror": a V8 Buffer with a copy of the bytes, registered
 * with the address it mirrors. ctypes instances on a mirror (`from_address`,
 * `in_dll`, `pointer.contents`, ...) stay live: every read refreshes the
 * bytes from native memory, every write is copied back, and FFI arguments,
 * `addressof()` and pointers use the original address.
 *
 * On Node.js the mirrors are never created and every function here returns
 * immediately.
 */

// Indirizzo nativo di ogni ArrayBuffer specchio. Buffer.alloc non usa il pool,
// quindi l'ArrayBuffer è solo della copia e le sotto-view (subarray) la
// ritrovano con l'indirizzo base + byteOffset. L'indirizzo è un Number quando
// è esatto (sotto 2^53, cioè sempre in user space), altrimenti un BigInt: la
// somma di Number non alloca.
const bases = new WeakMap();

let raw = null;

/**
 * True when external buffers are not allowed and mirrors are used.
 * @type {boolean}
 */
export let mirrorsActive = false;

/**
 * Enable mirrors for the given native module.
 *
 * @param {Object} native - Native module (unwrapped)
 */
export function enableMirrors(native) {
  raw = native;
  mirrorsActive = true;
}

const toBase = (address) => {
  const n = Number(address);
  return Number.isSafeInteger(n) ? n : BigInt(address);
};
const at = (base, offset) => (typeof base === "number" ? base + offset : base + BigInt(offset));

/**
 * Wrap the native module: `ptrToBuffer` returns a mirror, the address of a
 * mirror is the native one. Reads and writes on a mirror stay on the copy,
 * like the JS readers/writers, and are synchronized by refresh()/flush().
 *
 * @param {Object} native - Native module
 * @returns {Object} Native module with mirror-aware memory functions
 */
export function wrapNative(native) {
  return Object.create(native, {
    ptrToBuffer: { value: (address, size) => mirrorBuffer(address, size) },
    addressOf: { value: (buf) => mirrorAddress(buf) ?? native.addressOf(buf) },
    // Un Buffer specchio scritto come valore puntatore vale il suo indirizzo.
    writeValue: { value: (ptr, type, value, offset) => native.writeValue(ptr, type, mirrorAddress(value) ?? value, offset) },
  });
}

/**
 * Copy `size` bytes at `address` into a new mirror Buffer.
 *
 * @param {bigint|number} address - Native address
 * @param {number} size - Size in bytes
 * @returns {Buffer|null} Mirror, `null` for a NULL address
 */
export function mirrorBuffer(address, size) {
  const base = toBase(address);
  if (base === 0 || base === 0n) return null;
  if (typeof size !== "number" || !(size > 0)) throw new RangeError("Invalid buffer size");
  const buf = Buffer.alloc(size);
  raw.readMemory(buf, 0, size, base);
  bases.set(buf.buffer, base);
  return buf;
}

/**
 * True if `buf` is a mirror (or a subarray of one).
 *
 * @param {*} buf - Any value
 * @returns {boolean}
 */
export function isMirror(buf) {
  return mirrorsActive && buf instanceof Uint8Array && bases.has(buf.buffer);
}

/**
 * Native address mirrored by a Buffer (or a subarray of a mirror).
 *
 * @param {*} buf - Any value
 * @returns {bigint|undefined} Address, `undefined` if not a mirror
 */
export function mirrorAddress(buf) {
  if (!mirrorsActive || !(buf instanceof Uint8Array)) return undefined;
  const base = bases.get(buf.buffer);
  return base === undefined ? undefined : BigInt(at(base, buf.byteOffset));
}

/**
 * Symbol of the native address of an instance on a mirror, saved when the
 * instance is created so that each access skips the lookup.
 */
export const kMirrorBase = Symbol("mirrorBase");

/**
 * Native address of the first byte of a mirror, as stored (Number when
 * exact, otherwise BigInt).
 *
 * @param {*} buf - Any value
 * @returns {number|bigint|undefined} Address, `undefined` if not a mirror
 */
export function mirrorBase(buf) {
  if (!(buf instanceof Uint8Array)) return undefined;
  const base = bases.get(buf.buffer);
  return base === undefined ? undefined : at(base, buf.byteOffset);
}

/**
 * Refresh a mirror (or a range of it) with the current native bytes.
 *
 * @param {Buffer} buf - Buffer, ignored if not a mirror
 * @param {number} [offset=0] - Start of the range in `buf`
 * @param {number} [length] - Length of the range (default: to the end)
 */
export function refresh(buf, offset = 0, length = buf.length - offset) {
  if (!mirrorsActive || length <= 0) return;
  const base = bases.get(buf.buffer);
  if (base !== undefined) raw.readMemory(buf, offset, length, at(base, buf.byteOffset + offset));
}

/**
 * Copy a mirror (or a range of it) back to native memory.
 *
 * @param {Buffer} buf - Buffer, ignored if not a mirror
 * @param {number} [offset=0] - Start of the range in `buf`
 * @param {number} [length] - Length of the range (default: to the end)
 */
export function flush(buf, offset = 0, length = buf.length - offset) {
  if (!mirrorsActive || length <= 0) return;
  const base = bases.get(buf.buffer);
  if (base !== undefined) raw.writeMemory(buf, offset, length, at(base, buf.byteOffset + offset));
}

// Byte di un campo da sincronizzare: l'unità di memoria per i bitfield.
const fieldSize = (field) => (field.isBitField ? field.baseSize : field.size);

const mirroredCache = new WeakMap();

/**
 * Field readers and writers of a struct/union definition for instances on a
 * mirror: a read refreshes the bytes of the field, a write copies them back
 * (a bitfield refreshes its storage unit first). Instances on ordinary
 * Buffers keep using `def.fieldReaders` / `def.fieldWriters` unchanged.
 *
 * @param {Object} def - structDef / unionDef
 * @returns {{fieldReaders: Object, fieldWriters: Object}}
 */
export function mirroredAccessors(def) {
  let accessors = mirroredCache.get(def);
  if (accessors !== undefined) return accessors;
  const fieldReaders = Object.create(null);
  const fieldWriters = Object.create(null);
  for (const field of def.fields) {
    const read = def.fieldReaders?.[field.name];
    const write = def.fieldWriters?.[field.name];
    const offset = field.offset;
    const size = fieldSize(field);
    // `base` è l'indirizzo del Buffer, salvato nell'istanza (Structure) o
    // cercato (struct annidate).
    if (read !== undefined) {
      fieldReaders[field.name] = (buf, base = mirrorBase(buf)) => {
        raw.readMemory(buf, offset, size, at(base, offset));
        return read(buf);
      };
    }
    if (write !== undefined) {
      // Un campo intero viene sovrascritto, quindi basta ricopiarlo; un
      // bitfield cambia solo alcuni bit dell'unità, che va prima riletta.
      fieldWriters[field.name] = field.isBitField
        ? (buf, value, base = mirrorBase(buf)) => {
            raw.readMemory(buf, offset, size, at(base, offset));
            write(buf, value);
            raw.writeMemory(buf, offset, size, at(base, offset));
          }
        : (buf, value, base = mirrorBase(buf)) => {
            write(buf, value);
            raw.writeMemory(buf, offset, size, at(base, offset));
          };
    }
  }
  accessors = { fieldReaders, fieldWriters };
  mirroredCache.set(def, accessors);
  return accessors;
}

/**
 * Make `get` / `set` / `toObject` of a struct/union definition mirror-aware
 * (the generic paths: nested fields, arrays, instance methods, readValue).
 * A named field syncs only its bytes; nested structures and arrays sync
 * themselves on access. Applied only when mirrors are active; Buffers that
 * are not mirrors cost one lookup.
 *
 * @param {Object} def - structDef / unionDef
 * @returns {Object} The same definition
 */
export function syncDefinition(def) {
  if (!mirrorsActive) return def;
  const size = def.size;
  const fieldMap = def.fieldMap;
  const { get, set, toObject } = def;
  def.get = function (bufOrObj, fieldName) {
    if (isMirror(bufOrObj)) {
      const field = fieldMap?.get(fieldName);
      if (field === undefined) refresh(bufOrObj, 0, size);
      else if (!field.isNested && !field.isArray) refresh(bufOrObj, field.offset, fieldSize(field));
    }
    return get.call(this, bufOrObj, fieldName);
  };
  def.set = function (bufOrObj, fieldName, value) {
    if (!isMirror(bufOrObj)) return set.call(this, bufOrObj, fieldName, value);
    const field = fieldMap?.get(fieldName);
    const whole = field === undefined || field.isNested || field.isArray || field.isBitField;
    const offset = whole ? 0 : field.offset;
    const length = whole ? size : fieldSize(field);
    if (whole) refresh(bufOrObj, offset, length);
    const result = set.call(this, bufOrObj, fieldName, value);
    flush(bufOrObj, offset, length);
    return result;
  };
  def.toObject = function (bufOrObj) {
    if (isMirror(bufOrObj)) refresh(bufOrObj, 0, size);
    return toObject.call(this, bufOrObj);
  };
  return def;
}

const simpleCache = new WeakMap();

// Accessor `value` ereditato (le sottoclassi possono ridefinirlo).
function inheritedValue(proto) {
  for (let p = proto; p !== null; p = Object.getPrototypeOf(p)) {
    const descriptor = Object.getOwnPropertyDescriptor(p, "value");
    if (descriptor !== undefined) return descriptor;
  }
  return undefined;
}

/**
 * Prototype for SimpleCData instances on a mirror (with `kMirrorBase` set):
 * `value` refreshes the bytes before reading and copies them back after
 * writing. Instances on ordinary Buffers keep the class prototype, without
 * any check.
 *
 * @param {Function} Ctor - SimpleCData class
 * @returns {Object} Prototype inheriting from `Ctor.prototype`
 */
export function mirroredPrototype(Ctor) {
  let proto = simpleCache.get(Ctor);
  if (proto !== undefined) return proto;
  const { get, set } = inheritedValue(Ctor.prototype);
  const size = Ctor._size;
  proto = Object.create(Ctor.prototype, {
    value: {
      configurable: true,
      get() {
        raw.readMemory(this._buffer, 0, size, this[kMirrorBase]);
        return get.call(this);
      },
      set(value) {
        set.call(this, value);
        raw.writeMemory(this._buffer, 0, size, this[kMirrorBase]);
      },
    },
  });
  simpleCache.set(Ctor, proto);
  return proto;
}
