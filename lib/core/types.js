/**
 * @file types.js
 * @module core/types
 * @description Type normalization helpers for converting between JavaScript type representations
 * and native FFI type specifications.
 *
 * This module handles the conversion of SimpleCData classes (e.g., c_int32, c_char_p) into
 * the format expected by the native FFI layer. It bridges the gap between the user-facing
 * Python ctypes-compatible API and the underlying libffi implementation.
 *
 * @example
 * ```javascript
 * import { _toNativeType, _toNativeTypes } from './core/types.js';
 * import { c_int32, c_char_p, CType } from 'node-ctypes';
 *
 * // Convert single type - returns numeric CType value
 * const nativeType = _toNativeType(c_int32); // Returns CType.INT32 (5)
 *
 * // Convert array of types
 * const nativeTypes = _toNativeTypes([c_int32, c_char_p]);
 * // Returns [CType.INT32, CType.STRING]
 * ```
 */

/**
 * Converts a SimpleCData class or other type specification to the format required
 * by the native FFI module.
 *
 * **Type Conversion Rules**:
 * 1. **SimpleCData classes** (e.g., `c_int32`, `c_uint64`):
 *    - Returns the numeric CType value (e.g., `CType.INT32`, `CType.STRING`)
 *
 * 2. **Structure/Union classes**: Pass through unchanged for struct/union handling
 *
 * 3. **Numbers (CType values)**: Pass through unchanged (already in native format)
 *
 * 4. **Native CType objects**: Pass through unchanged (already in native format)
 *
 * **Python ctypes Compatibility**:
 * This function mimics Python's ctypes internal type normalization, ensuring that
 * type specifications work consistently whether passed as class constructors or
 * type objects.
 *
 * @param {Function|Object|number} type - Type specification to normalize
 *   - SimpleCData class (e.g., `c_int32`)
 *   - Structure or Union class
 *   - CType numeric value
 *   - Native CType object
 * @param {Object} native - Native module reference (unused but kept for API compatibility)
 * @returns {number|Object} Normalized type for native FFI:
 *   - Numeric CType value for SimpleCData types
 *   - Original value for Structure/Union/CType objects
 *
 * @example Basic type conversion
 * ```javascript
 * import { c_int32, c_float, c_char_p, CType } from 'node-ctypes';
 *
 * _toNativeType(c_int32);  // Returns CType.INT32 (5)
 * _toNativeType(c_float);  // Returns CType.FLOAT (9)
 * _toNativeType(c_char_p); // Returns CType.STRING (12)
 * ```
 *
 * @example Structure type pass-through
 * ```javascript
 * import { Structure, c_int32 } from 'node-ctypes';
 *
 * class Point extends Structure {
 *   static _fields_ = [['x', c_int32], ['y', c_int32]];
 * }
 *
 * _toNativeType(Point); // Returns Point class unchanged
 * ```
 *
 * @example Direct CType usage
 * ```javascript
 * import { CType } from 'node-ctypes';
 *
 * _toNativeType(CType.INT32); // Returns 5 (pass-through)
 * ```
 *
 * @private
 * @internal
 */
export function _toNativeType(type, native) {
  // SimpleCData classes: return the numeric CType value directly
  if (typeof type === "function" && type._isSimpleCData) {
    // _type is now a numeric CType value from native.CType
    return type._type;
  }

  // Structure/Union classes: pass through unchanged
  // These are handled specially by the FFI layer
  if (typeof type === "function" && type.prototype) {
    // Note: We can't directly check "instanceof Structure" here because it would
    // create a circular dependency. The native FFI layer handles this check.
    return type;
  }

  // Numbers (direct CType values): pass through unchanged
  if (typeof type === "number") {
    return type;
  }

  // Native CType objects: pass through unchanged (already in correct format)
  return type;
}

/**
 * Normalizes an array of type specifications by converting each element using
 * `_toNativeType()`.
 *
 * This is a convenience function for batch type normalization, commonly used when
 * defining function signatures with multiple parameters.
 *
 * **Python ctypes Compatibility**:
 * Equivalent to Python's internal type normalization for argtypes lists.
 *
 * @param {Array|*} types - Array of type specifications, or non-array value
 * @param {Object} native - Native module reference for CType lookups
 * @returns {Array|*} Array of normalized types (CType values), or original value if not an array
 *
 * @example Function signature normalization
 * ```javascript
 * import { c_int32, c_char_p, c_void_p, CType } from 'node-ctypes';
 *
 * // Normalize function argument types
 * const argTypes = [c_int32, c_char_p, c_void_p];
 * const normalized = _toNativeTypes(argTypes);
 * // Returns [CType.INT32, CType.STRING, CType.POINTER]
 * ```
 *
 * @example Non-array pass-through
 * ```javascript
 * // Non-arrays are returned unchanged
 * _toNativeTypes(null);      // Returns null
 * _toNativeTypes(undefined); // Returns undefined
 * _toNativeTypes(c_int32);   // Returns c_int32 (not normalized individually)
 * ```
 *
 * @private
 * @internal
 */
export function _toNativeTypes(types, native) {
  // Non-arrays pass through unchanged
  if (!Array.isArray(types)) return types;

  // Normalize each type in the array
  return types.map((type) => _toNativeType(type, native));
}
