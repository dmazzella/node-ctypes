/**
 * @file conversions.js
 * @module core/conversions
 * @description Argument and result conversions shared by CDLL functions and
 * CFUNCTYPE callers, following Python ctypes (`from_param` and restype
 * conversion).
 */

/**
 * Base conversion of an object argument:
 * - struct/union/array instance or Buffer view → its Buffer (by reference)
 * - pointer created from an address → the address
 * - object with `_as_parameter_` (callbacks, adapters) → that value
 * - anything else unchanged
 */
export function coerceObject(a) {
  if (a === null || typeof a !== "object") return a;
  const b = a._buffer;
  if (b !== undefined) {
    // Puntatore creato da indirizzo (fromAddress): senza Buffer va passato
    // l'indirizzo, altrimenti al C arriverebbe NULL.
    if (b === null && a._pointerType !== undefined) return a.address;
    return b;
  }
  if (a._as_parameter_ !== undefined) return a._as_parameter_;
  return a;
}

/**
 * Python default conversion (no argtypes, variadic arguments): a SimpleCData
 * instance is passed by value (`abs(c_int(-5))`), other objects as
 * {@link coerceObject}.
 */
export function coerceValue(a) {
  if (a === null || typeof a !== "object") return a;
  if (a._isSimpleCDataInstance === true) return a.value;
  return coerceObject(a);
}

/**
 * Argument converters for `argtypes`, one per position. A SimpleCData instance
 * passed to a simple-type parameter is its value; to a pointer-like parameter
 * (c_void_p, c_char_p, c_wchar_p) only when it is of that type, otherwise its
 * address is passed.
 *
 * @param {Array} argTypes - Declared argument types
 * @param {Object} native - Native module (for CType)
 * @returns {Function[]} One converter per declared argument
 */
export function argumentConverters(argTypes, native) {
  const pointerKinds = new Set([native.CType.POINTER, native.CType.STRING, native.CType.WSTRING]);
  return argTypes.map((t) => {
    if (typeof t !== "function" || t._isSimpleCData !== true) return coerceObject;
    if (!pointerKinds.has(t._type)) return coerceValue;
    return (a) => {
      if (a === null || typeof a !== "object") return a;
      if (a._isSimpleCDataInstance === true && a instanceof t) return a.value;
      return coerceObject(a);
    };
  });
}

/**
 * Convert all call arguments: declared ones with their converter, the rest
 * (variadic or without argtypes) with the Python default conversion.
 */
export function convertArguments(args, converters) {
  const n = args.length;
  const declared = converters.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = i < declared ? converters[i](args[i]) : coerceValue(args[i]);
  }
  return out;
}

/**
 * Python restype conversion done in JS: `POINTER(T)` returns a pointer object
 * (`null` for NULL), a CFUNCTYPE type returns a callable. Undefined when the
 * native result is already final.
 *
 * @param {*} restype - Declared return type
 * @returns {Function|undefined} Converter from the native result
 */
export function resultConverter(restype) {
  if (restype !== null && typeof restype === "object" && restype._pointerTo !== undefined) {
    return (r) => (r === null || r === 0n ? null : restype.fromAddress(r));
  }
  if (typeof restype === "function" && restype._isFuncPtr === true) {
    return (r) => (r === null || r === 0n ? null : restype(r));
  }
  return undefined;
}

/**
 * Adapt a JS function used as a C callback to Python semantics: arguments
 * declared `POINTER(T)` are passed as pointer objects (`null` for NULL), and an
 * object returned by the function (pointer, SimpleCData instance, ...) is
 * converted like an argument.
 *
 * @param {Function} fn - JS callback
 * @param {Array} argTypes - Declared argument types
 * @returns {Function} Function to register with the native callback
 */
export function adaptCallbackFunction(fn, argTypes) {
  const pointerTypes = argTypes.map((t) => (t !== null && typeof t === "object" && t._pointerTo !== undefined ? t : null));
  const hasPointers = pointerTypes.some((t) => t !== null);
  return function (...args) {
    if (hasPointers) {
      for (let i = 0; i < pointerTypes.length; i++) {
        const T = pointerTypes[i];
        if (T !== null && args[i] !== null) {
          args[i] = T.fromAddress(args[i]);
        }
      }
    }
    const result = fn.apply(this, args);
    return result !== null && typeof result === "object" ? coerceValue(result) : result;
  };
}
