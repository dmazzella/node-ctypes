/** Resolve aggregate field declarations before compiling their accessors or ABI descriptors. */
import { fieldEntries, funcPtrFieldType } from "./common.js";
import { computeLayout, isGccLayout } from "./layout.js";

function nestedField(name, type, cls, anonymous, isStruct) {
  const field = { name, type };
  if (anonymous || cls !== undefined) field.cls = cls;
  // `fields` is public: unions enumerate the kind flags before size/alignment.
  if (!isStruct) {
    field.isNested = true;
    if (anonymous) field.isAnonymous = true;
  }
  field.size = type.size;
  field.alignment = type.alignment;
  if (isStruct) {
    field.isNested = true;
    if (anonymous) field.isAnonymous = true;
  }
  return field;
}

function bitField(name, declaration, native, isStruct) {
  if (isStruct) {
    const { baseType, bits, baseSize } = declaration;
    return { name, type: baseType, size: 0, alignment: Math.min(baseSize, native.POINTER_SIZE), isBitField: true, bitSize: bits, baseSize };
  }
  const size = declaration.baseSize;
  const alignment = Math.min(size, native.POINTER_SIZE);
  const bitSize = declaration.bits;
  const baseSize = declaration.baseSize;
  return { name, type: declaration.baseType, isBitField: true, bitSize, baseSize, size, alignment };
}

function arrayField(name, declaration, { isStruct, swapped, sizeof, native }) {
  const type = swapped ? (declaration._swappedType ?? declaration) : declaration;
  if (isStruct) {
    const elementSize = sizeof(type.elementType);
    const alignment = typeof type.getAlignment === "function" ? type.getAlignment() : Math.min(elementSize, native.POINTER_SIZE);
    return { name, type, size: type.getSize(), alignment, isArray: true };
  }
  // Union views use the swapped type, but their layout comes from the declaration.
  const size = declaration.getSize();
  const alignment = typeof declaration.getAlignment === "function" ? declaration.getAlignment() : Math.min(sizeof(declaration.elementType), native.POINTER_SIZE);
  return { name, type, isArray: true, size, alignment };
}

function pointerType(type) {
  return typeof type === "function" ? funcPtrFieldType(type) : type;
}

function describeField(name, type, context) {
  const { isStruct, Structure, native, _isStruct, _isArrayType, _isBitField } = context;
  if (typeof type === "object" && type !== null && type.anonymous === true && type.type) {
    let { type: def, cls } = type;
    if (typeof def === "function" && typeof def._buildStruct === "function") {
      cls = def;
      def = def._finalizeFields();
    }
    if (def === null || typeof def !== "object" || !Array.isArray(def.fields)) throw new TypeError(`anonymous field "${name}" must be a structure or union`);
    return nestedField(name, def, cls, true, isStruct);
  }
  // Structs recognize bitfields before nested/array protocols, unions after them.
  if (isStruct && _isBitField(type)) return bitField(name, type, native, true);
  const isClass = typeof type === "function" && type.prototype instanceof Structure;
  if (isClass || _isStruct(type)) {
    const finalize = isStruct ? isClass : typeof type === "function" && typeof type._buildStruct === "function";
    return nestedField(name, finalize ? type._finalizeFields() : type, finalize ? type : undefined, false, isStruct);
  }
  if (_isArrayType(type)) return arrayField(name, type, context);
  if (!isStruct && _isBitField(type)) return bitField(name, type, native, false);
  if ((typeof type === "object" && type !== null && type._pointerTo !== undefined) || (typeof type === "function" && type._isFuncPtr === true)) {
    if (isStruct) return { name, type: pointerType(type), size: native.POINTER_SIZE, alignment: native.POINTER_SIZE, isPointer: true };
    const size = native.POINTER_SIZE;
    const alignment = native.POINTER_SIZE;
    return { name, type: pointerType(type), isPointer: true, size, alignment };
  }
  if (!(typeof type === "function" && type._isSimpleCData)) throw new TypeError(`${isStruct ? "struct" : "union"} field "${name}": type must be a SimpleCData class, struct, union, or array`);
  const size = type._size;
  return { name, type, size, alignment: Math.min(isStruct ? type._size : size, native.POINTER_SIZE) };
}

export function declareFields(fields, options, context) {
  const { isStruct, pack, swapped } = context;
  const gccLayout = isGccLayout(options.layout, pack, options.pack != null || options.packed === true);
  const base = options.base ?? null;
  const fieldDefs = base ? base.fields.map((f) => ({ ...f })) : [];
  const names = new Set(fieldDefs.map((f) => f.name));
  const own = [];
  for (const [name, type] of fieldEntries(fields)) {
    if (isStruct && (typeof name !== "string" || (!Array.isArray(fields) && !(fields instanceof Map) && name.trim().length === 0))) throw new TypeError("Field name must be a non-empty string");
    if (names.has(name)) throw new TypeError(`Duplicate field name: ${name}`);
    names.add(name);
    own.push(describeField(name, type, context));
  }

  const layout = computeLayout(
    own.map((f) => (f.isBitField ? { name: f.name, size: f.baseSize, align: f.alignment, bitSize: f.bitSize } : { name: f.name, size: f.size, align: f.alignment })),
    { isStruct, gccLayout, pack, align: options.align ?? 1, base, bigEndian: swapped },
  );
  own.forEach((f, i) => {
    f.offset = layout.offsets[i].offset;
    if (f.isBitField) f.bitOffset = layout.offsets[i].bitOffset;
    f.naturalAlignment = f.alignment;
    if (pack) f.alignment = Math.min(f.alignment, pack);
    f.swapped = swapped;
    fieldDefs.push(f);
  });
  const fieldMap = new Map();
  for (const field of fieldDefs) fieldMap.set(field.name, field);
  return { base, fieldDefs, fieldMap, size: layout.size, alignment: layout.alignment };
}
