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
 *  - Bitfield: consecutivi nella stessa storage-cell vengono raggruppati
 *    in un singolo field del base type (layout C-ABI compatibile; i
 *    reader/writer bitfield individuali leggono/scrivono a offset).
 *  - Array: sia `array(SimpleCData, N)` sia `array(Structure/Union, N)`;
 *    per il secondo caso il native ArrayType è costruito lazy qui.
 *  - Nested Structure/Union (anche `_anonymous_`): ricorsione.
 */

/**
 * Costruisce (o recupera cached) un native `StructType` corrispondente a un
 * structDef/unionDef. Cacheato su `def._nativeStructType` per evitare
 * ricostruzioni multiple sulla stessa def.
 *
 * @param {Object} def - structDef o unionDef (output di `struct()`/`union()`
 *   o `_structDef` di una Structure class).
 * @param {Object} native - modulo native (`require('ctypes.node')`).
 * @returns {Object} istanza di `native.StructType` utilizzabile come
 *   argtype/restype dal FFIFunction.
 */
function _buildNativeStructType(def, native) {
  if (def._nativeStructType) return def._nativeStructType;
  const st = new native.StructType({ union: !!def.isUnion });

  // Gestione bitfield per layout-compatible con libffi:
  // libffi non ha `ffi_type` per bitfield. Replichiamo il layout C
  // raggruppando i bitfield consecutivi che condividono lo stesso
  // storage-cell (identificato dal `baseType` + `offset` di partenza)
  // in un singolo field del base type (c_uint32, c_uint64, ecc.).
  //
  // Esempio C:
  //   struct { int a:3; int b:5; int c:8; };   // tutti nello stesso int32
  // Layout:
  //   native StructType aggiunge 1 field di tipo c_int32 con nome sintetico
  //   (es. "__bitfield@0"). I reader/writer bitfield individuali restano
  //   sulla def JS e continuano a funzionare perché leggono/scrivono a
  //   offset corretti dentro il buffer della struct.
  //
  // Quando la struct è passata/ricevuta by-value, il layout di memoria è
  // identico a quello C; i bitfield values viaggiano dentro gli integer
  // di base e l'utente li legge/scrive normalmente via i field accessor.
  const emittedBitfieldCells = new Set();
  for (const f of def.fields) {
    if (f.isBitField) {
      const cellKey = `${f.offset}:${f.baseSize}`;
      if (emittedBitfieldCells.has(cellKey)) continue; // già emesso da un bitfield precedente nella stessa cell
      emittedBitfieldCells.add(cellKey);
      // Determina il CType del base type (es. c_uint32 → CType.UINT32).
      // f.type è la SimpleCData class del base.
      if (!f.type || typeof f.type._type !== "number") {
        throw new Error(`Bitfield '${f.name}': base type senza _type numerico`);
      }
      // Usa un nome sintetico per la cell (non accessibile via field map —
      // i bitfield individuali conservano i loro nomi e accedono al buffer
      // direttamente via fieldReaders/fieldWriters precompilati).
      const cellName = `__bitfield@${f.offset}`;
      st.addField(cellName, f.type._type);
      continue;
    }
    if (f.isArray) {
      // Caso 1: `_native` è già un native ArrayType instance (array di
      // primitives o di Structure native). Lo passiamo direttamente al
      // StructType.addField.
      const native_is_array_type =
        f.type && f.type._native &&
        typeof f.type._native.getSize === "function" &&
        f.type._native.constructor?.name === "ArrayType";
      if (native_is_array_type) {
        st.addField(f.name, f.type._native, f.isAnonymous ? { anonymous: true } : undefined);
        continue;
      }
      // Caso 2: lo shim JS ha Structure/Union come elementType. Costruiamo
      // qui (lazy) un native ArrayType col native StructType dell'element.
      // Questo abilita struct-by-value con array-of-struct fields.
      const elementType = f.type?.elementType;
      const count = f.type?.length;
      if (elementType && typeof count === "number" &&
          typeof elementType === "function" &&
          (typeof elementType._buildStruct === "function" ||
           typeof elementType._buildUnion === "function")) {
        const elemDef = elementType._structDef || elementType._unionDef ||
                        elementType._buildStruct?.() || elementType._buildUnion?.();
        const elemNative = _buildNativeStructType(elemDef, native);
        const arrNative = new native.ArrayType(elemNative, count);
        st.addField(f.name, arrNative, f.isAnonymous ? { anonymous: true } : undefined);
        // Promuovi il native sullo shim per evitare ricostruzioni future.
        f.type._native = arrNative;
        continue;
      }
      throw new Error(
        `Field '${f.name}': array-in-struct-by-value non riconosciuto. ` +
          `Tipi supportati: array(SimpleCData, N), array(Structure/Union subclass, N). ` +
          `Alternativa: passa la struct per puntatore.`,
      );
    }
    if (f.isNested) {
      // f.type è un structDef/unionDef (quando dichiarato via struct/union)
      // o una Structure/Union class (quando dichiarato con class extends).
      let nestedDef = f.type;
      if (typeof f.type === "function") {
        nestedDef = f.type._structDef || f.type._unionDef || f.type._buildStruct?.() || f.type._buildUnion?.();
      }
      if (!nestedDef || !Array.isArray(nestedDef.fields)) {
        throw new Error(`Field '${f.name}': nested type non riconosciuto`);
      }
      const nestedNative = _buildNativeStructType(nestedDef, native);
      st.addField(f.name, nestedNative, f.isAnonymous ? { anonymous: true } : undefined);
      continue;
    }
    if (f.isPointer) {
      st.addField(f.name, native.CType.POINTER);
      continue;
    }
    // SimpleCData class: usa il suo _type numerico.
    if (f.type && typeof f.type === "function" && f.type._isSimpleCData) {
      st.addField(f.name, f.type._type);
      continue;
    }
    throw new Error(`Field '${f.name}': tipo non riconosciuto durante _buildNativeStructType`);
  }

  def._nativeStructType = st;
  return st;
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
  if (type && typeof type === "object" && type._isArrayType) {
    return type._native || type;
  }

  // 6. Numero
  if (typeof type === "number") return type;

  // 7. Pass-through
  return type;
}

/**
 * Normalizza un array di tipi (batch). Non-array → pass-through.
 */
export function _toNativeTypes(types, native) {
  if (!Array.isArray(types)) return types;
  return types.map((type) => _toNativeType(type, native));
}
