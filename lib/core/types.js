/**
 * @file types.js
 * @module core/types
 * @description Type normalization helpers tra il formato JS-facing della lib
 * e quello richiesto dal binding nativo (`FFIFunction` / `Callback` / ecc.).
 *
 * Le classi `Structure`/`Union` JS (e `struct()`/`union()` plain helpers)
 * producono `structDef` — oggetti JS con `fields`/`fieldMap`/ecc. — **non**
 * sono il native `StructType` che il C++ si aspetta come argtype/restype.
 *
 * `_buildNativeStructType` costruisce (o recupera cached) il wrapper
 * `new native.StructType()` popolato con `addField(name, type)` per ogni
 * campo del def. Supporta tutti i tipi di field:
 *
 *  - SimpleCData primitives (c_int32, ecc.)
 *  - POINTER
 *  - Bitfield: i byte che contengono bitfield diventano campi uint8 agli
 *    offset del layout JS (con gcc-sysv un bitfield può condividere byte con
 *    altri campi, e un unico tipo per "cella" non riprodurrebbe gli offset).
 *  - Campi disallineati (`_pack_`): byte uint8 agli offset del layout JS.
 *  - Array: sia `array(SimpleCData, N)` sia `array(Structure/Union, N)`;
 *    per il secondo caso il native ArrayType è costruito lazy qui.
 *  - Nested Structure/Union (anche `_anonymous_`): ricorsione.
 *  - Classe base (Python: sottoclasse con _fields_): primo campo, come in C.
 *
 * Dimensione e allineamento sono quelli del layout JS (layout.js, `_align_`).
 */

import { cacheWeakValue } from "../utils/cache.js";

// ArrayType nativi costruiti per gli array di Structure/Union (gli array JS
// espongono `_native` in sola lettura).
const nativeArrayTypes = new WeakMap();

// ArrayType nativi uint8[n] per i byte emessi come tali (vedi sotto).
const byteArrayTypes = new Map();

function byteRun(st, native, offset, length) {
  if (length <= 0) return;
  if (length === 1) {
    st.addField(`__byte@${offset}`, native.CType.UINT8);
    return;
  }
  let arrayType = byteArrayTypes.get(length)?.deref();
  if (arrayType === undefined) {
    arrayType = new native.ArrayType(native.CType.UINT8, length);
    cacheWeakValue(byteArrayTypes, length, arrayType);
  }
  st.addField(`__bytes@${offset}`, arrayType);
}

const roundUp = (n, a) => Math.ceil(n / a) * a;

// Byte toccati da un bitfield (dentro la sua unità di `baseSize` byte).
function bitFieldBytes(f) {
  const first = Math.floor(f.bitOffset / 8);
  const last = Math.floor((f.bitOffset + f.bitSize - 1) / 8);
  const bytes = [];
  for (let b = first; b <= last; b++) {
    bytes.push(f.offset + (f.swapped ? f.baseSize - 1 - b : b));
  }
  return bytes;
}

const nestedDefOf = (f) => {
  if (f.isNested) return typeof f.type === "function" ? f.type._structDef || f.type._buildStruct?.() : f.type;
  const element = f.isArray ? f.type?.elementType : undefined;
  if (typeof element === "function" && typeof element._buildStruct === "function") return element._structDef || element._buildStruct();
  return undefined;
};

// Campi (anche di struct annidate) a un offset non multiplo del loro
// allineamento C, come con `_pack_`: l'ABI x86-64 System V passa queste struct
// in memoria (vedi StructInfo::SetMemoryClass).
const unalignedDefs = new WeakMap();
function hasUnalignedFields(def) {
  let result = unalignedDefs.get(def);
  if (result === undefined) {
    result = def.fields.some((f) => {
      if (f.isBitField) return false;
      if (!def.isUnion && f.offset % (f.naturalAlignment ?? f.alignment) !== 0) return true;
      const nested = nestedDefOf(f);
      return nested !== undefined && hasUnalignedFields(nested);
    });
    unalignedDefs.set(def, result);
  }
  return result;
}

/**
 * Costruisce (o recupera cached) un native `StructType` corrispondente a un
 * structDef/unionDef. Cacheato su `def._nativeStructType` per evitare
 * ricostruzioni multiple sulla stessa def.
 *
 * La struct nativa ha gli offset, la dimensione e l'allineamento del layout
 * JS (layout.js, `_pack_`, `_align_`, bitfield). Un campo resta del suo tipo
 * (che conta per la classificazione dell'ABI: float/double vanno nei registri
 * SSE) quando nella struct nativa cade allo stesso offset: offset allineato al
 * suo allineamento C, non superiore a quello della struct. Altrimenti (campi
 * disallineati da `_pack_`, byte dei bitfield) i suoi byte diventano uint8. Il
 * padding non è emesso, se non prima di byte da collocare all'offset giusto.
 *
 * @param {Object} def - structDef o unionDef (output di `struct()`/`union()`
 *   o `_structDef` di una Structure class).
 * @param {Object} native - modulo native (`require('ctypes.node')`).
 * @returns {Object} istanza di `native.StructType` utilizzabile come
 *   argtype/restype dal FFIFunction.
 */
function _buildNativeStructType(def, native) {
  if (def._nativeStructType) return def._nativeStructType;
  if (!Number.isInteger(Math.log2(def.alignment))) {
    throw new TypeError("Native by-value ABI requires power-of-two alignment; use this layout only for memory serialization");
  }
  const st = new native.StructType({ union: !!def.isUnion, alignment: def.alignment, memoryClass: hasUnalignedFields(def) });
  const fits = (alignment, offset) => alignment <= def.alignment && offset % alignment === 0;

  // La classe base è il primo membro della struct (i suoi campi sono i primi
  // di def.fields, agli stessi offset).
  let fields = def.fields;
  let position = 0;
  if (def.base) {
    if (fits(def.base.alignment, 0)) st.addField("__base__", _buildNativeStructType(def.base, native));
    else byteRun(st, native, 0, def.base.size);
    fields = def.fields.slice(def.base.fields.length);
    position = def.isUnion ? 0 : def.base.size;
  }

  if (def.isUnion) {
    for (const f of fields) {
      const size = f.isBitField ? f.baseSize : f.size;
      const alignment = f.naturalAlignment ?? f.alignment;
      if (!fits(alignment, 0)) byteRun(st, native, 0, size);
      // Un bitfield occupa il proprio tipo base all'offset 0.
      else if (f.isBitField) st.addField(`__bitfield_${f.name}`, bitFieldBaseType(f));
      else addNativeField(st, f, native);
    }
  } else {
    // Campi e byte dei bitfield in ordine di offset.
    const items = [];
    const bitBytes = new Set();
    for (const f of fields) {
      if (f.isBitField) bitFieldBytes(f).forEach((b) => bitBytes.add(b));
      else if (f.size > 0) items.push({ offset: f.offset, size: f.size, field: f });
    }
    for (const b of bitBytes) items.push({ offset: b, size: 1, field: null });
    items.sort((a, b) => a.offset - b.offset);

    let bytesFrom = -1; // inizio della sequenza di byte in corso
    const flushBytes = () => {
      if (bytesFrom >= 0) byteRun(st, native, bytesFrom, position - bytesFrom);
      bytesFrom = -1;
    };
    const addBytes = (offset, size) => {
      if (bytesFrom < 0) bytesFrom = position;
      position = offset + size;
    };

    for (const { offset, size, field } of items) {
      if (offset < position) continue; // byte già coperto
      const alignment = field ? (field.naturalAlignment ?? field.alignment) : 1;
      if (field && fits(alignment, offset)) {
        // Il padding naturale prima del campo resta padding; un vuoto più
        // grande (es. `_align_` di una struct annidata) diventa byte.
        if (roundUp(position, alignment) !== offset) addBytes(offset, 0);
        flushBytes();
        addNativeField(st, field, native);
        position = offset + size;
      } else {
        addBytes(offset, size);
      }
    }
    flushBytes();
    // Coda oltre l'arrotondamento all'allineamento (non accade con i layout
    // di layout.js, ma la dimensione deve comunque coincidere).
    if (roundUp(position, def.alignment) < def.size) byteRun(st, native, position, def.size - position);
  }

  const size = st.getSize();
  if (size !== def.size || st.getAlignment() !== def.alignment) {
    throw new Error(`Native layout of the structure (size ${size}, alignment ${st.getAlignment()}) differs from its definition (size ${def.size}, alignment ${def.alignment})`);
  }
  def._nativeStructType = st;
  return st;
}

function bitFieldBaseType(f) {
  if (!f.type || typeof f.type._type !== "number") {
    throw new Error(`Bitfield '${f.name}': base type senza _type numerico`);
  }
  return f.type._type;
}

function addNativeField(st, f, native) {
  const options = f.isAnonymous ? { anonymous: true } : undefined;
  if (f.isArray) {
    // Array di primitive (o di struct native): `_native` è già un ArrayType.
    const own = f.type?._native;
    if (own && typeof own.getSize === "function" && own.constructor?.name === "ArrayType") {
      st.addField(f.name, own, options);
      return;
    }
    // Array di Structure/Union: ArrayType nativo costruito qui (una volta per tipo).
    const elementType = f.type?.elementType;
    const count = f.type?.length;
    const elemDef = typeof elementType === "function" && typeof elementType._buildStruct === "function" ? elementType._structDef || elementType._buildStruct() : elementType?._isStructType === true ? elementType : undefined;
    if (elemDef !== undefined && typeof count === "number") {
      let arrNative = nativeArrayTypes.get(f.type);
      if (arrNative === undefined) {
        arrNative = new native.ArrayType(_buildNativeStructType(elemDef, native), count);
        nativeArrayTypes.set(f.type, arrNative);
      }
      st.addField(f.name, arrNative, options);
      return;
    }
    throw new Error(`Field '${f.name}': array-in-struct-by-value non riconosciuto. ` + `Tipi supportati: array(SimpleCData, N), array(Structure/Union subclass o struct()/union(), N). ` + `Alternativa: passa la struct per puntatore.`);
  }
  if (f.isNested) {
    // f.type è un structDef/unionDef (quando dichiarato via struct/union)
    // o una Structure/Union class (quando dichiarato con class extends).
    let nestedDef = f.type;
    if (typeof f.type === "function") {
      nestedDef = f.type._structDef || f.type._buildStruct?.();
    }
    if (!nestedDef || !Array.isArray(nestedDef.fields)) {
      throw new Error(`Field '${f.name}': nested type non riconosciuto`);
    }
    st.addField(f.name, _buildNativeStructType(nestedDef, native), options);
    return;
  }
  if (f.isPointer) {
    st.addField(f.name, native.CType.POINTER);
    return;
  }
  // SimpleCData class: usa il suo _type numerico.
  if (f.type && typeof f.type === "function" && f.type._isSimpleCData) {
    st.addField(f.name, f.type._type);
    return;
  }
  throw new Error(`Field '${f.name}': tipo non riconosciuto durante _buildNativeStructType`);
}

/**
 * Normalizza un tipo singolo nel formato atteso dal native FFIFunction.
 *
 * Regole di conversione:
 *  1. SimpleCData class (c_int32, c_char_p, ecc.): ritorna `_type` numerico.
 *  2. POINTER(T) wrapper (ha `_pointerTo`): ritorna `CType.POINTER`.
 *  3. Structure / Union class: costruisce (o cachea) un native StructType.
 *  4. Plain structDef / unionDef (ha `_isStructType`): idem.
 *  5. ArrayType wrapper (ha `_isArrayType`): ritorna il `_native` se
 *     disponibile, altrimenti l'object.
 *  6. Numero: pass-through (già un CType).
 *  7. Altro: pass-through (es. native CType object, HRESULT, ecc.).
 */
export function _toNativeType(type, native) {
  // 1. SimpleCData
  if (typeof type === "function" && type._isSimpleCData) {
    return type._type;
  }

  // 2. POINTER wrapper
  if (type && typeof type === "object" && type._pointerTo !== undefined) {
    return native.CType.POINTER;
  }

  // 2b. Tipo funzione CFUNCTYPE / WINFUNCTYPE (Python: argtypes = [..., CMPFUNC])
  if (typeof type === "function" && type._isFuncPtr === true) {
    return native.CType.POINTER;
  }

  // 3. Structure / Union subclass → native StructType.
  if (typeof type === "function" && typeof type._buildStruct === "function") {
    const def = type._structDef || type._buildStruct();
    return _buildNativeStructType(def, native);
  }
  if (typeof type === "function" && typeof type._buildUnion === "function") {
    const def = type._unionDef || type._buildUnion();
    return _buildNativeStructType(def, native);
  }

  // 4. Plain structDef / unionDef.
  if (type && typeof type === "object" && type._isStructType && Array.isArray(type.fields)) {
    return _buildNativeStructType(type, native);
  }

  // 5. Array wrapper
  if (type && (typeof type === "object" || typeof type === "function") && type._isArrayType) {
    return type._native || type;
  }

  // 6. Numero
  if (typeof type === "number") return type;

  // 7. Pass-through
  return type;
}

/**
 * Come _toNativeType, per i tipi di ritorno: `null` vale `void`
 * (Python ctypes: `restype = None`, `CFUNCTYPE(None, ...)`).
 */
export function _toNativeReturnType(type, native) {
  if (type === null) return native.CType.VOID;
  return _toNativeType(type, native);
}

/**
 * Normalizza un array di tipi di argomento (batch). Non-array → pass-through.
 * Un tipo array come argomento è un puntatore, come in C e Python
 * (`argtypes = [c_int * 4]` passa l'indirizzo dell'array).
 */
export function _toNativeTypes(types, native) {
  if (!Array.isArray(types)) return types;
  return types.map((type) => (type && (typeof type === "object" || typeof type === "function") && type._isArrayType === true ? native.CType.POINTER : _toNativeType(type, native)));
}
