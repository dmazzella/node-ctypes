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
import { funcPtrFieldType, writePointerField } from "./common.js";

// Python: gli array di c_char / c_wchar (anche come campi struct) hanno un
// `.value` stringa fino al primo NUL; quelli di c_char anche `.raw` (bytes).
function charArrayValue(buf, charKind, wcharSize) {
  if (charKind === "char") {
    const end = buf.indexOf(0);
    return buf.toString("utf8", 0, end === -1 ? buf.length : end);
  }
  return decodeWide(buf, wcharSize);
}

function setCharArrayValue(buf, charKind, wcharSize, value, message) {
  const units = charKind === "char" ? (Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")) : encodeWide(String(value), wcharSize);
  if (units.length > buf.length) {
    throw new RangeError(message(units.length / (charKind === "char" ? 1 : wcharSize), buf.length / (charKind === "char" ? 1 : wcharSize)));
  }
  units.copy(buf);
  const unit = charKind === "char" ? 1 : wcharSize;
  if (units.length + unit <= buf.length) {
    buf.fill(0, units.length, units.length + unit);
  }
}

export function array(elementType, count, sizeof, alloc, readValue, writeValue, Structure, Union, ArrayType, voidPointerType) {
  // Validate elementType: accept SimpleCData classes, Structure/Union classes,
  // or native CType-like objects.
  const isSimple = typeof elementType === "function" && elementType._isSimpleCData;
  const isStruct = typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union);
  // Array di puntatori (Python: POINTER(T) * n, CFUNCTYPE * n).
  const isPointerElem = (typeof elementType === "object" && elementType !== null && elementType._pointerTo !== undefined) || (typeof elementType === "function" && elementType._isFuncPtr === true);
  const isNativeTypeObj = !isPointerElem && typeof elementType === "object" && elementType !== null && (typeof elementType.getSize === "function" || elementType.size !== undefined);
  // Array di array (Python: (c_int * 2) * 3).
  const isArrayElem = typeof elementType === "function" && elementType._isArrayType === true;
  if (!isSimple && !isStruct && !isNativeTypeObj && !isArrayElem && !isPointerElem) {
    throw new TypeError("array elementType must be a SimpleCData class or a Structure/Union class");
  }

  const elementSize = sizeof(elementType);
  // Array alignment == element alignment (C standard), NOT element size.
  // For Structure/Union: ask the class. For SimpleCData: alignment == size
  // (each primitive is self-aligned on all platforms we target).
  const elementAlignment = isStruct ? (elementType.alignment ?? elementSize) : isArrayElem ? elementType.getAlignment() : elementSize;
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
  const elemReader = isSimple ? elementType._reader : null;
  const elemWriter = isSimple ? elementType._writer : null;

  // Array di caratteri (Python: c_char * n / c_wchar * n): `.value` e `.raw`.
  const charKind = isSimple ? elementType._charKind : undefined;
  const tooLong = charKind === "char" ? () => "byte string too long" : () => "string too long";
  const getValue = charKind === undefined ? undefined : (buf) => charArrayValue(buf, charKind, elementSize);
  const setValue = charKind === undefined ? undefined : (buf, value, message = tooLong) => setCharArrayValue(buf, charKind, elementSize, value, message);
  const setRaw = (buf, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    if (bytes.length > buf.length) throw new RangeError("byte string too long");
    bytes.copy(buf);
  };

  // Elementi puntatore: NULL → null, altrimenti oggetto puntatore / funzione.
  const pointerElemType = !isPointerElem ? null : typeof elementType === "function" ? funcPtrFieldType(elementType) : elementType;
  const readPointer = (target, off) => {
    const address = elementSize === 8 ? target.readBigUInt64LE(off) : BigInt(target.readUInt32LE(off));
    return address === 0n ? null : pointerElemType.fromAddress(address);
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
          source.copy(inner, 0, 0, elementSize);
        } else if (source !== null && typeof source === "object" && typeof source.length === "number") {
          const view = elementType.wrap(inner);
          for (let i = 0; i < Math.min(source.length, elementType.length); i++) view[i] = source[i];
        }
      } else if (elemWriter !== null && off + elementSize <= target.length) {
        elemWriter(target, off, value);
      } else {
        writeValue(target, elementType, value, off);
      }
      return true;
    }
    // Index out of bounds - don't write anything but return false
    return false;
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

  // Wrap function that returns a Proxy for array-like indexing
  const wrap = function (buffer) {
    return new Proxy(buffer, {
      get(target, prop, receiver) {
        const fast = fastIndex(prop);
        if (fast === fast) {
          return readAt(target, fast);
        }

        if (charKind !== undefined) {
          if (prop === "value") return getValue(target);
          if (prop === "raw" && charKind === "char") return Buffer.from(target);
        }

        // Special case for _buffer to return the underlying buffer
        if (prop === "_buffer") {
          return target;
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
  };

  // create automatically returns the proxy
  const create = (values) => {
    const buffer = alloc(count * elementSize);
    if (Array.isArray(values)) {
      for (let i = 0; i < Math.min(values.length, count); i++) {
        writeAt(buffer, i, values[i]);
      }
    } else if (typeof values === "string") {
      for (let i = 0; i < Math.min(values.length, count); i++) {
        writeAt(buffer, i, values.charCodeAt(i));
      }
    }
    return wrap(buffer);
  };

  // Python: il tipo array si chiama con gli elementi, (c_int * 3)(1, 2, 3)
  // → array(c_int, 3)(1, 2, 3) (anche con `new`). `.create([...])` resta.
  const ArrayCType = function (...values) {
    return create(values);
  };

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

    // Array di caratteri: tipo e conversione da/verso stringa (campi struct).
    _charKind: { value: charKind },
    getValue: { value: getValue },
    setValue: { value: setValue },

    // For compatibility, expose the native array (needed for StructType.addField)
    _native: { value: nativeArray },

    // Helper to check if this is an ArrayType wrapper
    _isArrayType: { value: true },
  });

  return ArrayCType;
}
