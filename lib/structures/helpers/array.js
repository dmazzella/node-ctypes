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
export function array(elementType, count, sizeof, alloc, readValue, writeValue, Structure, Union, ArrayType) {
  // Validate elementType: accept SimpleCData classes, Structure/Union classes,
  // or native CType-like objects.
  const isSimple = typeof elementType === "function" && elementType._isSimpleCData;
  const isStruct = typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union);
  const isNativeTypeObj = typeof elementType === "object" && elementType !== null && (typeof elementType.getSize === "function" || elementType.size !== undefined);
  if (!isSimple && !isStruct && !isNativeTypeObj) {
    throw new TypeError("array elementType must be a SimpleCData class or a Structure/Union class");
  }

  const elementSize = sizeof(elementType);
  let nativeArray;
  if (isNativeTypeObj && ArrayType) {
    nativeArray = new ArrayType(elementType, count);
  } else {
    // Provide a small JS-side shim implementing the minimal ArrayType API
    nativeArray = {
      getSize: () => count * elementSize,
      getLength: () => count,
      getAlignment: () => elementSize,
      create: (values) => {
        // JS create is implemented below; this should not be invoked by JS code
        const size = count * elementSize;
        const buffer = alloc(size);
        buffer.fill(0);
        return buffer;
      },
    };
  }

  // Wrap function that returns a Proxy for array-like indexing
  const wrap = function (buffer) {
    return new Proxy(buffer, {
      get(target, prop, receiver) {
        // Special case for _buffer to return the underlying buffer
        if (prop === "_buffer") {
          return target;
        }

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
              const off = i * elementSize;
              // If elementType is a struct/union class, return an instance bound to the slice
              if (typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union)) {
                yield new elementType(target.subarray(off, off + elementSize));
              } else {
                yield readValue(target, elementType, off);
              }
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
          if (index >= 0 && index < count) {
            const off = index * elementSize;
            if (typeof elementType === "function" && (elementType.prototype instanceof Structure || elementType.prototype instanceof Union)) {
              return new elementType(target.subarray(off, off + elementSize));
            }
            return readValue(target, elementType, off);
          }
          // Numeric index out of bounds -> undefined (JavaScript behavior)
          return undefined;
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
        // Ignore Symbols
        if (typeof prop === "symbol") {
          return Reflect.set(target, prop, value, target);
        }

        const index = Number(prop);
        if (Number.isInteger(index) && !isNaN(index)) {
          if (index >= 0 && index < count) {
            writeValue(target, elementType, value, index * elementSize);
            return true;
          }
          // Index out of bounds - don't write anything but return false
          return false;
        }
        return Reflect.set(target, prop, value, target);
      },
    });
  };

  // Return a wrapper object that delegates to nativeArray but overrides create()
  return {
    // Type information
    elementType,
    length: count,

    // Delegated methods
    getSize: () => nativeArray.getSize(),
    getLength: () => nativeArray.getLength(),
    getAlignment: () => nativeArray.getAlignment(),

    // create automatically returns the proxy
    create: (values) => {
      const size = count * sizeof(elementType);
      const buffer = alloc(size);
      buffer.fill(0);
      if (Array.isArray(values)) {
        for (let i = 0; i < Math.min(values.length, count); i++) {
          writeValue(buffer, elementType, values[i], i * sizeof(elementType));
        }
      } else if (typeof values === "string") {
        for (let i = 0; i < Math.min(values.length, count); i++) {
          writeValue(buffer, elementType, values.charCodeAt(i), i * sizeof(elementType));
        }
      }
      return wrap(buffer);
    },

    // Explicit wrap method
    wrap: wrap,

    // For compatibility, expose the native array (needed for StructType.addField)
    _native: nativeArray,

    // Helper to check if this is an ArrayType wrapper
    _isArrayType: true,
  };
}
