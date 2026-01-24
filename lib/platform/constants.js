/**
 * @file constants.js
 * @module platform/constants
 * @description Platform-specific constants exported from the native module.
 * These values are determined at compile-time based on the target platform and architecture.
 *
 * @example
 * import { POINTER_SIZE, WCHAR_SIZE, NULL } from './platform/constants.js';
 *
 * console.log(`Pointer size: ${POINTER_SIZE} bytes`);
 * console.log(`Wide char size: ${WCHAR_SIZE} bytes`);
 */

import { createRequire } from "node:module";
import path from "node:path";

/**
 * Get the path to the native module
 * @private
 */
function getNativeModule() {
  // This will be replaced by the actual native module loading logic from index.js
  // For now, we assume the native module is already loaded in the parent
  // In the refactored version, this should import from a shared native module loader
  throw new Error("This module should be imported through index.js");
}

/**
 * Size of a pointer in bytes on the current platform.
 *
 * - **32-bit systems**: 4 bytes
 * - **64-bit systems**: 8 bytes
 *
 * This constant is determined at compile-time based on `sizeof(void*)` in C.
 *
 * @constant {number} POINTER_SIZE
 * @example
 * import { POINTER_SIZE } from 'node-ctypes';
 *
 * console.log(`Running on ${POINTER_SIZE * 8}-bit architecture`);
 * // Output: "Running on 64-bit architecture" (on 64-bit systems)
 *
 * @example
 * // Allocate buffer for pointer
 * const ptrBuf = Buffer.alloc(POINTER_SIZE);
 */
export let POINTER_SIZE;

/**
 * Size of wchar_t in bytes on the current platform.
 *
 * - **Windows**: 2 bytes (UTF-16LE)
 * - **Unix/Linux/macOS**: 4 bytes (UTF-32LE)
 *
 * This constant is determined at compile-time based on `sizeof(wchar_t)` in C.
 * The difference affects how wide strings are encoded and decoded.
 *
 * @constant {number} WCHAR_SIZE
 * @example
 * import { WCHAR_SIZE } from 'node-ctypes';
 *
 * if (WCHAR_SIZE === 2) {
 *   console.log('Windows platform detected (UTF-16LE wide strings)');
 * } else {
 *   console.log('Unix-like platform detected (UTF-32LE wide strings)');
 * }
 *
 * @example
 * // Allocate buffer for wide string (10 characters)
 * const wcharBuf = Buffer.alloc(10 * WCHAR_SIZE);
 */
export let WCHAR_SIZE;

/**
 * Null pointer constant (JavaScript `null`).
 *
 * Represents a NULL pointer in C. This is provided for Python ctypes compatibility,
 * where `None` is used to represent NULL pointers.
 *
 * @constant {null} NULL
 * @example
 * import { NULL, c_void_p } from 'node-ctypes';
 *
 * // Create a NULL pointer
 * const nullPtr = new c_void_p(NULL);
 * console.log(nullPtr.value); // 0n (BigInt zero)
 *
 * @example
 * // Check for NULL pointer
 * function processPointer(ptr) {
 *   if (ptr === NULL) {
 *     throw new Error('NULL pointer provided');
 *   }
 *   // ... process pointer
 * }
 */
export const NULL = null;

/**
 * Initialize constants from native module.
 * This function is called internally by index.js after loading the native module.
 *
 * @param {Object} native - The native module object
 * @private
 * @internal
 */
export function _initConstants(native) {
  POINTER_SIZE = native.POINTER_SIZE;
  WCHAR_SIZE = native.WCHAR_SIZE;
}
