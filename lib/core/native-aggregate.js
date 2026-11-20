/** Build native by-value ABI descriptors from computed structure and union layouts. */
import { cacheWeakValue } from "../utils/cache.js";

const nativeArrayTypes = new WeakMap();
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

// Bytes occupied by a bitfield within its storage unit.
function bitFieldBytes(f) {
  const first = Math.floor(f.bitOffset / 8);
  const last = Math.floor((f.bitOffset + f.bitSize - 1) / 8);
  const bytes = [];
  for (let b = first; b <= last; b++) {
    bytes.push(f.offset + (f.swapped ? f.baseSize - 1 - b : b));
  }
  return bytes;
}

function aggregateDef(type) {
  if (typeof type === "function") return type._structDef || type._buildStruct?.();
  return type?._isStructType === true ? type : undefined;
}

function arrayLeafDef(array) {
  const element = array.elementType;
  return element?._isArrayType ? arrayLeafDef(element) : aggregateDef(element);
}

// Packed fields inside a nested type can also force memory classification on SysV.
const unalignedDefs = new WeakMap();
function hasUnalignedFields(def) {
  let result = unalignedDefs.get(def);
  if (result === undefined) {
    result = def.fields.some((f) => {
      if (f.isBitField || (f.isArray && f.size === 0)) return false;
      if (!def.isUnion && f.offset % (f.naturalAlignment ?? f.alignment) !== 0) return true;
      const nested = f.isArray ? arrayLeafDef(f.type) : f.isNested ? aggregateDef(f.type) : undefined;
      return nested !== undefined && hasUnalignedFields(nested);
    });
    unalignedDefs.set(def, result);
  }
  return result;
}

function _buildNativeStructType(def, native) {
  if (def._nativeStructType) return def._nativeStructType;
  if (!Number.isInteger(Math.log2(def.alignment))) {
    throw new TypeError("Native by-value ABI requires power-of-two alignment; use this layout only for memory serialization");
  }
  const st = new native.StructType({
    union: !!def.isUnion,
    alignment: def.alignment,
    memoryClass: hasUnalignedFields(def),
  });
  const fits = (alignment, offset) => alignment <= def.alignment && offset % alignment === 0;

  // The base layout is the first member; def.fields already includes its fields.
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
      // A union bitfield occupies its base type at offset zero.
      else if (f.isBitField) st.addField(`__bitfield_${f.name}`, bitFieldBaseType(f));
      else addNativeField(st, f, native);
    }
  } else {
    // Capture offsets before resolving types. Field types can run user code.
    const items = [];
    const bitBytes = new Set();
    for (const f of fields) {
      if (f.isBitField) bitFieldBytes(f).forEach((b) => bitBytes.add(b));
      else if (f.size > 0) items.push({ offset: f.offset, size: f.size, field: f });
    }
    for (const b of bitBytes) items.push({ offset: b, size: 1, field: null });
    items.sort((a, b) => a.offset - b.offset);

    let bytesFrom = -1;
    const flushBytes = () => {
      if (bytesFrom >= 0) byteRun(st, native, bytesFrom, position - bytesFrom);
      bytesFrom = -1;
    };
    const addBytes = (offset, size) => {
      if (bytesFrom < 0) bytesFrom = position;
      position = offset + size;
    };

    for (const { offset, size, field } of items) {
      if (offset < position) continue;
      const alignment = field ? (field.naturalAlignment ?? field.alignment) : 1;
      if (field && fits(alignment, offset)) {
        // Native padding is implicit; larger gaps need explicit bytes.
        if (roundUp(position, alignment) !== offset) addBytes(offset, 0);
        flushBytes();
        addNativeField(st, field, native);
        position = offset + size;
      } else {
        addBytes(offset, size);
      }
    }
    flushBytes();
    // Preserve tail bytes beyond the padding implied by the alignment.
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

function inlineArrayType(array, native, fieldName) {
  const own = array._native;
  if (own instanceof native.ArrayType) return own;
  const cached = nativeArrayTypes.get(array);
  if (cached !== undefined) return cached;

  const element = array.elementType;
  let item;
  if (element?._isArrayType) {
    // Native arrays accept a scalar or struct, not another array. A one-field
    // struct has the row's layout and keeps its ABI types (including floats).
    item = new native.StructType().addField("__row__", inlineArrayType(element, native, fieldName));
  } else {
    const def = aggregateDef(element);
    if (!def) throw new TypeError(`Field '${fieldName}': unsupported inline array element type`);
    item = _buildNativeStructType(def, native);
  }
  const descriptor = new native.ArrayType(item, array.length);
  nativeArrayTypes.set(array, descriptor);
  return descriptor;
}

function addNativeField(st, f, native) {
  const options = f.isAnonymous ? { anonymous: true } : undefined;
  if (f.isArray) {
    st.addField(f.name, inlineArrayType(f.type, native, f.name), options);
    return;
  }
  if (f.isNested) {
    // A nested member can be a plain definition or a Structure/Union class.
    const nestedDef = aggregateDef(f.type);
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
  if (f.type && typeof f.type === "function" && f.type._isSimpleCData) {
    st.addField(f.name, f.type._type);
    return;
  }
  throw new Error(`Field '${f.name}': tipo non riconosciuto durante _buildNativeStructType`);
}

export { _buildNativeStructType as buildNativeAggregate };
