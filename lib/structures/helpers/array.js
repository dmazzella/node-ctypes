/**
 * @file array.js
 * @module structures/array
 * @description Array type implementation for fixed-size arrays of C types.
 *
 * This module provides Python ctypes-compatible array types that support:
 * - Fixed-size arrays of any C type (primitives, structs, unions)
 * - Python-like indexing with bracket notation
 * - Iteration support (for...of, spread operator)
 * - String initialization for character arrays
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `type * count` array syntax or explicit array types.
 *
 * @example Basic usage
 * ```javascript
 * import { array, c_int32 } from 'node-ctypes';
 *
 * const IntArray5 = array(c_int32, 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1
 * arr[2] = 42;
 * console.log(arr[2]);  // 42
 * ```
 *
 * @example Array of structs
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const PointArray = array(Point, 3);
 * const points = PointArray.create();
 * points[0].x = 10;
 * points[0].y = 20;
 * ```
 *
 * @example Iteration
 * ```javascript
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * for (const val of arr) {
 *   console.log(val);
 * }
 * const values = [...arr]; // Spread operator
 * ```
 */

/**
 * Creates a fixed-size array type for a given element type.
 *
 * Returns an array type definition that can create instances of fixed-size
 * arrays. The created arrays support Python-like indexing, iteration, and
 * automatic memory management.
 *
 * **Python ctypes Compatibility**:
 * Similar to Python's `type * count` syntax (e.g., `c_int * 5`).
 *
 * @param {Function|Object} elementType - Element type (SimpleCData class, Structure/Union class, or type object)
 * @param {number} count - Number of elements in the array
 * @param {Function} sizeof - sizeof function reference
 * @param {Function} alloc - alloc function reference
 * @param {Function} readValue - readValue function reference
 * @param {Function} writeValue - writeValue function reference
 * @param {Function} Structure - Structure class reference
 * @param {Function} Union - Union class reference
 * @param {Function} ArrayType - Native ArrayType class reference (if available)
 * @returns {Object} Array type definition with create and wrap methods
 * @throws {TypeError} If elementType is not a valid type
 *
 * @example Create integer array
 * ```javascript
 * import { array, c_int32 } from 'node-ctypes';
 *
 * const IntArray5 = array(c_int32, 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1
 * arr[2] = 42;
 * console.log(arr[2]);  // 42
 * ```
 *
 * @example Partial initialization
 * ```javascript
 * const arr = IntArray5.create([1, 2]); // Rest are zeros
 * console.log(arr[0]); // 1
 * console.log(arr[4]); // 0
 * ```
 *
 * @example String initialization (character arrays)
 * ```javascript
 * const CharArray10 = array(c_char, 10);
 * const arr = CharArray10.create("hello");
 * // arr contains ASCII codes: [104, 101, 108, 108, 111, 0, 0, 0, 0, 0]
 * ```
 *
 * @example Array of structs
 * ```javascript
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * const PointArray = array(Point, 3);
 * const points = PointArray.create();
 * points[0].x = 10;
 * points[0].y = 20;
 * ```
 */
import { encodeWide, decodeWide } from "../../memory/buffer.js";
import { copyInstance, funcPtrFieldType, pointerOwner, scalarReader, simpleFieldWriter, writePointerField } from "./common.js";
import { buildWrapper } from "./wrap.js";
import { flush, isMirror, mirrorsActive, refresh } from "../../memory/mirror.js";

// Python: gli array di c_char / c_wchar (anche come campi struct) hanno un
// `.value` stringa fino al primo NUL; quelli di c_char anche `.raw` (bytes).
function charArrayValue(buf, charKind, wcharSize, swapped) {
  if (charKind === "char") {
    const end = buf.indexOf(0);
    return buf.toString("utf8", 0, end === -1 ? buf.length : end);
  }
  if (swapped) {
    buf = Buffer.from(buf);
    wcharSize === 2 ? buf.swap16() : buf.swap32();
  }
  return decodeWide(buf, wcharSize);
}

function setCharArrayValue(buf, charKind, wcharSize, value, message, swapped) {
  const units = charKind === "char" ? (Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")) : encodeWide(String(value), wcharSize);
  if (units.length > buf.length) {
    throw new RangeError(message(units.length / (charKind === "char" ? 1 : wcharSize), buf.length / (charKind === "char" ? 1 : wcharSize)));
  }
  if (swapped && charKind === "wchar") wcharSize === 2 ? units.swap16() : units.swap32();
  units.copy(buf);
  const unit = charKind === "char" ? 1 : wcharSize;
  if (units.length + unit <= buf.length) {
    buf.fill(0, units.length, units.length + unit);
  }
}

// Metodi di Array che sul proxy operano sugli elementi (Python: arr[1:3],
// x in arr, list(arr)), non sui byte del Buffer: le versioni generiche di
// Array.prototype usano `length` e gli indici del proxy. I metodi propri di
// Buffer/TypedArray (readInt32LE, subarray, copy, ...) restano sui byte.
const elementMethods = new Map(
  [
    "at",
    "copyWithin",
    "entries",
    "every",
    "fill",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "forEach",
    "includes",
    "indexOf",
    "join",
    "keys",
    "lastIndexOf",
    "map",
    "reduce",
    "reduceRight",
    "reverse",
    "slice",
    "some",
    "sort",
    "toLocaleString",
    "toReversed",
    "toSorted",
    "values",
    "with",
  ]
    .filter((name) => typeof Array.prototype[name] === "function")
    .map((name) => [name, Array.prototype[name]]),
);

function elementsToJSON() {
  return Array.from(this);
}

// Python: lo slice di c_char * n / c_wchar * n è bytes / str.
function charSlice(...args) {
  return Array.prototype.slice.apply(this, args).join("");
}

export function array(elementType, count, sizeof, alloc, readValue, writeValue, Structure, Union, ArrayType, voidPointerType, ptrToBuffer, swapped = false) {
  // Validate elementType: accept SimpleCData classes, Structure/Union classes,
  // or native CType-like objects.
  const isSimple = typeof elementType === "function" && elementType._isSimpleCData;
  const isStruct = typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union);
  // Array di puntatori (Python: POINTER(T) * n, CFUNCTYPE * n).
  const isPointerElem = (typeof elementType === "object" && elementType !== null && elementType._pointerTo !== undefined) || (typeof elementType === "function" && elementType._isFuncPtr === true);
  // Definizione di struct()/union(): come una classe Structure/Union.
  const isStructDef = !isPointerElem && typeof elementType === "object" && elementType !== null && elementType._isStructType === true;
  const isNativeTypeObj = !isPointerElem && !isStructDef && typeof elementType === "object" && elementType !== null && (typeof elementType.getSize === "function" || elementType.size !== undefined);
  // Array di array (Python: (c_int * 2) * 3).
  const isArrayElem = typeof elementType === "function" && elementType._isArrayType === true;
  if (!isSimple && !isStruct && !isStructDef && !isNativeTypeObj && !isArrayElem && !isPointerElem) {
    throw new TypeError("array elementType must be a SimpleCData class or a Structure/Union class");
  }
  if (swapped && isArrayElem) elementType = elementType._swappedType ?? elementType;

  const elementSize = sizeof(elementType);
  // Array alignment == element alignment (C standard), NOT element size.
  // For Structure/Union: ask the class. For SimpleCData: alignment == size
  // (each primitive is self-aligned on all platforms we target).
  const elementAlignment = isStruct ? (elementType.alignment ?? elementSize) : isStructDef ? elementType.alignment : isArrayElem ? elementType.getAlignment() : elementSize;
  let nativeArray;
  if (isPointerElem && ArrayType && voidPointerType) {
    nativeArray = new ArrayType(voidPointerType._type, count);
  } else if (isNativeTypeObj && ArrayType) {
    nativeArray = new ArrayType(elementType, count);
  } else if (isSimple && ArrayType) {
    // Array di SimpleCData: costruiamo un vero native ArrayType passando
    // il CType numerico come element. Questo abilita l'uso di array come
    // campo di struct-by-value (il native StructType.addField duck-typing
    // su `getLength` funziona con lo shim JS ma `ObjectWrap::Unwrap` no —
    // serve un'istanza reale).
    nativeArray = new ArrayType(elementType._type, count);
  } else {
    // Fallback shim (caso Structure/Union come element, o ArrayType
    // non disponibile): il native StructType.addField non può unwrappare
    // questo shim; l'utilizzo come field di struct-by-value fallirà con
    // errore chiaro da `_buildNativeStructType`.
    nativeArray = {
      getSize: () => count * elementSize,
      getLength: () => count,
      getAlignment: () => elementAlignment,
      create: (values) => {
        const size = count * elementSize;
        const buffer = alloc(size);
        buffer.fill(0);
        return buffer;
      },
    };
  }

  // Precalcolati una volta per tipo: l'handler del Proxy li ripeteva ad ogni
  // accesso indicizzato (instanceof Structure/Union + dispatch di readValue).
  const isStructElem = typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union);
  const elemReader = isSimple ? scalarReader(elementType, swapped && elementType._readerBE ? elementType._readerBE : elementType._reader, swapped) : null;
  const elemWriter = isSimple ? simpleFieldWriter(elementType, swapped && elementType._writerBE ? elementType._writerBE : elementType._writer, 0) : null;

  // Array di caratteri (Python: c_char * n / c_wchar * n): `.value` e `.raw`.
  const charKind = isSimple ? elementType._charKind : undefined;
  const tooLong = charKind === "char" ? () => "byte string too long" : () => "string too long";
  const getValue = charKind === undefined ? undefined : (buf) => charArrayValue(buf, charKind, elementSize, swapped);
  const setValue = charKind === undefined ? undefined : (buf, value, message = tooLong) => setCharArrayValue(buf, charKind, elementSize, value, message, swapped);
  const setRaw = (buf, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    if (bytes.length > buf.length) throw new RangeError("byte string too long");
    bytes.copy(buf);
  };
  const getRaw = (buf) => Buffer.from(buf);

  // Elementi puntatore: NULL → null, altrimenti oggetto puntatore / funzione.
  const pointerElemType = !isPointerElem ? null : typeof elementType === "function" ? funcPtrFieldType(elementType) : elementType;
  const readPointer = (target, off) => {
    const address = elementSize === 8 ? target.readBigUInt64LE(off) : BigInt(target.readUInt32LE(off));
    const owner = pointerOwner(target, off, address);
    return address === 0n ? null : pointerElemType.fromAddress(address, owner);
  };
  const writePointer = (target, off, value) => writePointerField(target, off, value, elementSize);

  const readAt = (target, index) => {
    if (index >= 0 && index < count) {
      const off = index * elementSize;
      if (pointerElemType !== null) {
        return readPointer(target, off);
      }
      if (isStructElem) {
        return new elementType(target.subarray(off, off + elementSize));
      }
      if (isStructDef) {
        const view = target.subarray(off, off + elementSize);
        return new Proxy(view, buildWrapper(elementType, { instanceTag: "NestedStructInstance", exposeAnonymous: true, mirrored: isMirror(view) }));
      }
      if (isArrayElem) {
        return elementType.wrap(target.subarray(off, off + elementSize));
      }
      if (elemReader !== null && off + elementSize <= target.length) {
        return elemReader(target, off);
      }
      return readValue(target, elementType, off);
    }
    // Numeric index out of bounds -> undefined (JavaScript behavior)
    return undefined;
  };

  const writeAt = (target, index, value) => {
    if (index >= 0 && index < count) {
      const off = index * elementSize;
      if (pointerElemType !== null) {
        writePointer(target, off, value);
      } else if (isArrayElem) {
        const inner = target.subarray(off, off + elementSize);
        const source = value !== null && typeof value === "object" && Buffer.isBuffer(value._buffer) ? value._buffer : value;
        if (Buffer.isBuffer(source)) {
          copyInstance(inner, 0, elementSize, value, 0, elementType);
        } else if (source !== null && typeof source === "object" && typeof source.length === "number") {
          const view = elementType.wrap(inner);
          for (let i = 0; i < Math.min(source.length, elementType.length); i++) view[i] = source[i];
        }
      } else if (elemWriter !== null && off + elementSize <= target.length) {
        elemWriter(target, value, off);
      } else {
        writeValue(target, elementType, value, off);
      }
      return true;
    }
    // Index out of bounds - don't write anything but return false
    return false;
  };

  // Array su una copia della memoria nativa (memory/mirror.js): un elemento
  // scalare o puntatore si rilegge prima di leggerlo e si ricopia dopo averlo
  // scritto (viene sovrascritto per intero). Gli elementi struct e array sono
  // istanze che si sincronizzano da sole.
  const scalarElem = !isStructElem && !isStructDef && !isArrayElem;
  const mirroredReadAt = (target, index) => {
    if (scalarElem && index >= 0 && index < count) refresh(target, index * elementSize, elementSize);
    return readAt(target, index);
  };
  const mirroredWriteAt = (target, index, value) => {
    const result = writeAt(target, index, value);
    if (result && (scalarElem || (isArrayElem && (Buffer.isBuffer(value) || Buffer.isBuffer(value?._buffer))))) {
      flush(target, index * elementSize, elementSize);
    }
    return result;
  };
  const synced =
    (fn) =>
    (buf, ...args) => {
      refresh(buf);
      const result = fn(buf, ...args);
      flush(buf);
      return result;
    };
  const mirroredGetValue =
    getValue &&
    ((buf) => {
      refresh(buf);
      return getValue(buf);
    });
  const mirroredSetValue = setValue && synced(setValue);
  const mirroredSetRaw = synced(setRaw);
  const mirroredGetRaw = (buf) => {
    refresh(buf);
    return Buffer.from(buf);
  };

  // Indice da una chiave che inizia con una cifra (il caso comune arr[i]);
  // NaN per tutto il resto, che segue il percorso generico.
  const fastIndex = (prop) => {
    if (typeof prop === "string") {
      const c = prop.charCodeAt(0);
      if (c >= 48 && c <= 57) {
        const index = Number(prop);
        if (Number.isInteger(index)) return index;
      }
    }
    return NaN;
  };

  // Proxy handler for array-like indexing: one per array type (and one for
  // copies of native memory), the buffer is the target.
  const makeHandler = (readAt, writeAt, getValue, setValue, setRaw, getRaw) => ({
    get(target, prop, receiver) {
      const fast = fastIndex(prop);
      if (fast === fast) {
        return readAt(target, fast);
      }

      if (charKind !== undefined) {
        if (prop === "value") return getValue(target);
        if (prop === "raw" && charKind === "char") return getRaw(target);
      }

      // Special case for _buffer to return the underlying buffer
      if (prop === "_buffer") {
        return target;
      }
      // Tipo dell'array (controllo degli argomenti: Python accetta solo
      // istanze dello stesso tipo array).
      if (prop === "_arrayType") {
        return ArrayCType;
      }

      // Python ctypes parity: `len(arr)` ritorna il numero di elementi,
      // non la dimensione in byte del buffer. Senza questo trap,
      // `arr.length` casca sul buffer sottostante e ritorna byte count,
      // rompendo il pattern idiomatico `for (let i = 0; i < arr.length; i++)`.
      if (prop === "length") return count;
      if (prop === "byteLength") return target.length;

      // Special case for toString to show array contents
      if (prop === "toString") {
        return function () {
          try {
            const arr = Array.from(this);
            return `[${arr.join(", ")}]`;
          } catch (e) {
            return "[error]";
          }
        }.bind(receiver);
      }

      // Intercept Symbol.iterator to iterate over elements, not bytes
      if (prop === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < count; i++) {
            yield readAt(target, i);
          }
        };
      }

      // Ignore other Symbols
      if (typeof prop === "symbol") {
        const value = Reflect.get(target, prop, target);
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      }

      // If it's a number (index) - intercept BEFORE checking target
      const index = Number(prop);
      if (Number.isInteger(index) && !isNaN(index)) {
        return readAt(target, index);
      }

      const method = elementMethods.get(prop);
      if (method !== undefined) return charKind !== undefined && prop === "slice" ? charSlice : method;
      if (prop === "toJSON") return elementsToJSON;

      // For everything else, use the normal buffer
      const value = Reflect.get(target, prop, target);
      // If it's a function, bind it to the target
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
    set(target, prop, value) {
      const fast = fastIndex(prop);
      if (fast === fast) {
        return writeAt(target, fast, value);
      }

      if (charKind !== undefined) {
        if (prop === "value") {
          setValue(target, value);
          return true;
        }
        if (prop === "raw" && charKind === "char") {
          setRaw(target, value);
          return true;
        }
      }

      // Ignore Symbols
      if (typeof prop === "symbol") {
        return Reflect.set(target, prop, value, target);
      }

      // `length`/`byteLength` sono read-only (parity Python Array).
      if (prop === "length" || prop === "byteLength") return false;

      const index = Number(prop);
      if (Number.isInteger(index) && !isNaN(index)) {
        return writeAt(target, index, value);
      }
      return Reflect.set(target, prop, value, target);
    },
  });
  const handler = makeHandler(readAt, writeAt, getValue, setValue, setRaw, getRaw);
  const mirroredHandler = mirrorsActive ? makeHandler(mirroredReadAt, mirroredWriteAt, mirroredGetValue, mirroredSetValue, mirroredSetRaw, mirroredGetRaw) : null;
  const wrap = (buffer) => new Proxy(buffer, mirroredHandler !== null && isMirror(buffer) ? mirroredHandler : handler);

  // create automatically returns the proxy
  const create = (values) => {
    const buffer = alloc(count * elementSize);
    if (Array.isArray(values)) {
      for (let i = 0; i < Math.min(values.length, count); i++) {
        writeAt(buffer, i, values[i]);
      }
    } else if (typeof values === "string" && setValue !== undefined) {
      // c_char * n / c_wchar * n: stessa codifica di `.value` (UTF-8 / wchar_t).
      setValue(buffer, values);
    } else if (typeof values === "string") {
      for (let i = 0; i < Math.min(values.length, count); i++) {
        writeAt(buffer, i, values.charCodeAt(i));
      }
    }
    return wrap(buffer);
  };

  // Python: (c_int * 3).from_buffer / from_buffer_copy / from_address.
  const byteSize = count * elementSize;
  const bytesOf = (source, name) => {
    const bytes = source !== null && typeof source === "object" && Buffer.isBuffer(source._buffer) ? source._buffer : source;
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`${name}: source must be a Buffer or a ctypes instance`);
    return bytes;
  };
  const checkRange = (bytes, offset, name) => {
    if (!Number.isInteger(offset) || offset < 0) throw new RangeError(`${name}: offset must be a non-negative integer`);
    if (bytes.byteLength - offset < byteSize) throw new RangeError(`${name}: source too small (${bytes.byteLength - offset} < ${byteSize})`);
  };
  const from_buffer = (source, offset = 0) => {
    const bytes = bytesOf(source, "from_buffer");
    checkRange(bytes, offset, "from_buffer");
    const view = Buffer.from(bytes.buffer, bytes.byteOffset + offset, byteSize);
    return wrap(view);
  };
  const from_buffer_copy = (source, offset = 0) => {
    const bytes = bytesOf(source, "from_buffer_copy");
    checkRange(bytes, offset, "from_buffer_copy");
    const copy = alloc(byteSize);
    copyInstance(copy, 0, byteSize, bytes, offset, ArrayCType);
    return wrap(copy);
  };
  const from_address = (address) => {
    if (!address) throw new TypeError("from_address: NULL address");
    if (byteSize === 0) return wrap(alloc(0));
    return wrap(ptrToBuffer(typeof address === "bigint" ? address : BigInt(address), byteSize));
  };

  // Python: il tipo array si chiama con gli elementi, (c_int * 3)(1, 2, 3)
  // → array(c_int, 3)(1, 2, 3) (anche con `new`). `.create([...])` resta.
  const ArrayCType = function (...values) {
    return create(values);
  };
  let swappedType;

  // `length` (numero di elementi) è una proprietà propria non scrivibile delle
  // funzioni: va ridefinita con defineProperties.
  Object.defineProperties(ArrayCType, {
    // Type information
    elementType: { value: elementType, enumerable: true },
    length: { value: count, enumerable: true },

    // Delegated methods
    getSize: { value: () => nativeArray.getSize(), enumerable: true },
    getLength: { value: () => nativeArray.getLength(), enumerable: true },
    getAlignment: { value: () => nativeArray.getAlignment(), enumerable: true },

    create: { value: create, enumerable: true },

    // Explicit wrap method
    wrap: { value: wrap, enumerable: true },

    // Python ctypes: instances on existing memory
    from_buffer: { value: from_buffer, enumerable: true },
    from_buffer_copy: { value: from_buffer_copy, enumerable: true },
    from_address: { value: from_address, enumerable: true },

    // Array di caratteri: tipo e conversione da/verso stringa (campi struct).
    _charKind: { value: charKind },
    getValue: { value: mirrorsActive && getValue ? (buf) => (isMirror(buf) ? mirroredGetValue : getValue)(buf) : getValue },
    setValue: { value: mirrorsActive && setValue ? (buf, ...args) => (isMirror(buf) ? mirroredSetValue : setValue)(buf, ...args) : setValue },

    // For compatibility, expose the native array (needed for StructType.addField)
    _native: { value: nativeArray },

    // Helper to check if this is an ArrayType wrapper
    _isArrayType: { value: true },
    _swapped_: { value: swapped },
    _swappedType: {
      get() {
        if (swapped) return ArrayCType;
        if (swappedType === undefined) {
          swappedType = array(elementType, count, sizeof, alloc, readValue, writeValue, Structure, Union, ArrayType, voidPointerType, ptrToBuffer, true);
          Object.defineProperty(swappedType, "_baseArrayType", { value: ArrayCType });
        }
        return swappedType;
      },
    },
  });

  return ArrayCType;
}
