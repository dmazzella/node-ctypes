/**
 * @file wrap.js
 * @module structures/helpers/wrap
 * @description Factory del Proxy handler che avvolge il Buffer di una
 * Structure/Union instance (sia top-level che nested) ed espone i field
 * come property access Python-like.
 *
 * `buildWrapper(def, { instanceTag, exposeAnonymous })` ritorna un
 * `ProxyHandler` con 6 trap (get/set/has/ownKeys/getOwnPropertyDescriptor
 * + `Symbol.toStringTag`). I due flag discriminano:
 *   - `instanceTag`     — stringa per `Symbol.toStringTag`
 *     ("StructInstance", "UnionInstance", "NestedStructInstance", ...)
 *   - `exposeAnonymous` — `true` per Structure (campi di `_anonymous_`
 *     elevati come top-level), `false` per Union.
 *
 * È usato da 3 call site: outer struct, nested struct, outer union.
 * Il nested union ha semantiche residue (filtro per-field
 * `!f.isAnonymous`) gestite inline in `union.js`.
 */

import { mirroredAccessors } from "../../memory/mirror.js";
import { structGetters } from "../protocol.js";
import { isScalarSubclass } from "../../types/scalar-protocol.js";
import { directBytesReader, ensureBuffer } from "./common.js";

// Buffer metadata properties that must never be shadowed by struct field names.
const BUFFER_META_PROPS = new Set(["length", "byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"]);
const RESERVED_STRUCT_PROPS = new Set(["_buffer", "toObject", ...BUFFER_META_PROPS]);

const kStructBytes = Symbol("structBytes");
const kStructBuf = Symbol("structBuf");
const callbackStructViewCache = new WeakMap();

function makeArrayFieldGetter(def, defaultGet, field) {
  const { name, offset, size, type: arrType } = field;
  const end = offset + size;
  const fullSpan = offset === 0 && size === def.size;
  if (arrType._charKind !== undefined) {
    return function () {
      if (def.get !== defaultGet) return def.get(this._buffer, name);
      const buf = this._buffer;
      return arrType.getValue(fullSpan ? buf : buf.subarray(offset, end));
    };
  }
  const wrapFast = arrType._wrapFast;
  if (wrapFast !== undefined) {
    return function () {
      if (def.get !== defaultGet) return def.get(this._buffer, name);
      const bytes = this[kStructBytes];
      return wrapFast(fullSpan ? bytes : bytes.subarray(offset, end));
    };
  }
  return function () {
    if (def.get !== defaultGet) return def.get(this._buffer, name);
    const buf = this._buffer;
    return arrType.wrap(fullSpan ? buf : buf.subarray(offset, end));
  };
}

/**
 * Builds a non-Proxy prototype-backed view factory for functional `struct()`
 * callback arguments. Preserves lazy `Buffer` materialization on `_buffer`,
 * live byte aliasing, and full CPython write validation.
 *
 * @param {object} def - structDef
 * @returns {(bytes: Uint8Array) => object}
 */
export function buildCallbackStructView(def) {
  let factory = callbackStructViewCache.get(def);
  if (factory !== undefined) return factory;

  const { fieldReaders, fieldWriters, anonymousFieldNames } = def;
  const defaultGet = structGetters.get(def);

  class StructCallbackView {
    constructor(bytes) {
      this[kStructBytes] = bytes;
      this[kStructBuf] = undefined;
    }
    get _buffer() {
      return (this[kStructBuf] ??= ensureBuffer(this[kStructBytes]));
    }
    toObject() {
      return def.toObject(this._buffer);
    }
    get [Symbol.toStringTag]() {
      return "StructInstance";
    }
    get length() {
      return this[kStructBytes].byteLength;
    }
    get byteLength() {
      return this[kStructBytes].byteLength;
    }
    get byteOffset() {
      return this[kStructBytes].byteOffset;
    }
    get buffer() {
      return this[kStructBytes].buffer;
    }
    get BYTES_PER_ELEMENT() {
      return 1;
    }
    subarray(start, end) {
      return this._buffer.subarray(start, end);
    }
    slice(start, end) {
      return this._buffer.slice(start, end);
    }
    copy(target, targetStart, sourceStart, sourceEnd) {
      return this._buffer.copy(target, targetStart, sourceStart, sourceEnd);
    }
  }

  const proto = StructCallbackView.prototype;
  const defined = new Set();

  for (const field of def.fields) {
    const name = field.name;
    defined.add(name);
    if (RESERVED_STRUCT_PROPS.has(name)) continue;
    if (field.isArray) {
      Object.defineProperty(proto, name, {
        get: makeArrayFieldGetter(def, defaultGet, field),
        set(value) {
          def.set(this._buffer, name, value);
        },
        enumerable: !field.isAnonymous,
        configurable: true,
      });
      continue;
    }

    const offset = field.offset;
    const writer = fieldWriters?.[name];
    const directRead = !field.isBitField && !field.isNested && !field.isPointer && !field.swapped && field.type?._isSimpleCData === true && !isScalarSubclass(field.type) ? directBytesReader(field.type) : null;
    const reader = fieldReaders?.[name];
    Object.defineProperty(proto, name, {
      get:
        directRead !== null
          ? function () {
              return directRead(this[kStructBytes], offset);
            }
          : reader !== undefined
            ? function () {
                return reader(this._buffer);
              }
            : function () {
                return def.get(this._buffer, name);
              },
      set:
        writer !== undefined
          ? function (value) {
              writer(this._buffer, value);
            }
          : function (value) {
              def.set(this._buffer, name, value);
            },
      enumerable: !field.isAnonymous,
      configurable: true,
    });
  }

  if (anonymousFieldNames !== undefined) {
    for (const subName of Object.keys(anonymousFieldNames)) {
      if (defined.has(subName) || RESERVED_STRUCT_PROPS.has(subName)) continue;
      Object.defineProperty(proto, subName, {
        get() {
          return def.get(this._buffer, subName);
        },
        set(value) {
          def.set(this._buffer, subName, value);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  factory = (bytes) => new StructCallbackView(bytes);
  callbackStructViewCache.set(def, factory);
  return factory;
}

// L'handler dipende solo da def e opzioni (il Buffer è il target): uno per
// combinazione, invece di ricrearlo a ogni accesso a un campo annidato.
const wrapperCache = new WeakMap();

/**
 * Costruisce un Proxy handler per un'istanza Structure/Union.
 *
 * @param {object} def - structDef o unionDef. Deve esporre:
 *   - `fieldMap`            Map<string, FieldInfo>
 *   - `fieldReaders`        null-proto obj   name → (buf) => value
 *   - `fieldWriters`        null-proto obj   name → (buf, val) => void
 *   - `anonymousFieldNames` null-proto obj   subName → true
 *   - `fields`              Array<FieldInfo>
 *   - `get(buf, name)`      dispatcher generico (bitfield, nested, ecc.)
 *   - `set(buf, name, val)` dispatcher generico
 *   - `toObject(buf)`       serializzazione in plain object
 *
 * @param {object} opts
 * @param {string}  opts.instanceTag      — valore restituito per Symbol.toStringTag
 * @param {boolean} opts.exposeAnonymous  — true per struct (sotto-campi `_anonymous_`
 *                                           visibili come top-level), false per union.
 * @param {boolean} [opts.mirrored]       — Buffer copia di memoria nativa (Electron):
 *                                           lettori e scrittori che sincronizzano il campo.
 * @returns {ProxyHandler<Buffer>}
 */
export function buildWrapper(def, { instanceTag, exposeAnonymous, mirrored = false }) {
  let byOptions = wrapperCache.get(def);
  if (byOptions === undefined) {
    byOptions = new Map();
    wrapperCache.set(def, byOptions);
  }
  const key = `${instanceTag}|${exposeAnonymous}|${mirrored}`;
  let handler = byOptions.get(key);
  if (handler === undefined) {
    handler = createWrapper(def, instanceTag, exposeAnonymous, mirrored);
    byOptions.set(key, handler);
  }
  return handler;
}

function createWrapper(def, instanceTag, exposeAnonymous, mirrored) {
  const { fieldMap, anonymousFieldNames } = def;
  const { fieldReaders, fieldWriters } = mirrored ? mirroredAccessors(def) : def;
  const get = structGetters.get(def);
  const arrayReaders = Object.create(null);
  if (!mirrored && get !== undefined) {
    for (const field of def.fields) {
      if (field.isArray) {
        arrayReaders[field.name] = (buf) => {
          const view = buf.subarray(field.offset, field.offset + field.size);
          return field.type._charKind !== undefined ? field.type.getValue(view) : field.type.wrap(view);
        };
      }
    }
  }

  // Precalcola la lista di chiavi visibili (stabile durante tutta la vita
  // del def). Evita di ricostruirla a ogni Object.keys / {...spread} / ecc.
  const visibleKeys = [];
  for (const f of def.fields) {
    if (f.isAnonymous && exposeAnonymous && f.type?.fields) {
      for (const sf of f.type.fields) visibleKeys.push(sf.name);
    } else if (!f.isAnonymous) {
      visibleKeys.push(f.name);
    }
  }

  return {
    get(target, prop) {
      // Meta proprietà dell'istanza (ordine: prima controlli più comuni).
      if (prop === "_buffer") return target;
      if (prop === "toObject") return () => def.toObject(target);
      if (prop === Symbol.toStringTag) return instanceTag;
      if (prop === Symbol.iterator) return undefined;
      if (typeof prop === "string" && BUFFER_META_PROPS.has(prop)) return target[prop];

      if (typeof prop === "string") {
        if (fieldReaders !== undefined) {
          const r = fieldReaders[prop];
          if (r !== undefined) return r(target);
        }
        const arrayReader = arrayReaders[prop];
        if (arrayReader !== undefined && def.get === get) return arrayReader(target);
        // Mirrored arrays, nested fields and anonymous subfields use def.get.
        if (fieldMap?.has(prop) || (exposeAnonymous && anonymousFieldNames?.[prop] === true)) {
          return def.get(target, prop);
        }
      }

      // Tutto il resto: delega al Buffer sottostante (es. .subarray, .slice).
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },

    set(target, prop, value) {
      if (typeof prop === "string") {
        if (fieldWriters !== undefined) {
          const w = fieldWriters[prop];
          if (w !== undefined) {
            w(target, value);
            return true;
          }
        }
        if (fieldMap?.has(prop) || (exposeAnonymous && anonymousFieldNames?.[prop] === true)) {
          def.set(target, prop, value);
          return true;
        }
      }
      return Reflect.set(target, prop, value, target);
    },

    has(target, prop) {
      if (prop === "_buffer" || prop === "toObject") return true;
      if (typeof prop === "string") {
        if (fieldMap?.has(prop)) return true;
        if (exposeAnonymous && anonymousFieldNames?.[prop] === true) return true;
      }
      return Reflect.has(target, prop);
    },

    // visibleKeys è precomputato — zero allocazioni per enumerazione.
    ownKeys() {
      return visibleKeys;
    },

    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string") {
        if (fieldMap?.has(prop) || prop === "_buffer" || prop === "toObject") {
          return {
            enumerable: prop !== "_buffer" && prop !== "toObject",
            configurable: true,
            writable: true,
          };
        }
        if (exposeAnonymous && anonymousFieldNames?.[prop] === true) {
          return { enumerable: true, configurable: true, writable: true };
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  };
}
