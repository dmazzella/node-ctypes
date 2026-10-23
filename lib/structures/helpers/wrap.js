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

// Proprietà meta del Buffer che NON vanno mai interpretate come field name.
// Per i campi Proxy passano direttamente attraverso al target buffer.
const BUFFER_META_PROPS = new Set(["length", "byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"]);

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
        // FAST PATH: reader precompilato (scalari, POINTER, bitfield).
        // NB: questa è la differenza chiave rispetto ai 2 vecchi proxy
        // nested che non usavano fieldReaders — ora anche loro ottengono
        // il fast path gratis.
        if (fieldReaders !== undefined) {
          const r = fieldReaders[prop];
          if (r !== undefined) return r(target);
        }
        // FALLBACK: tipi complessi (nested/array) e anonymous subfields.
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
