/**
 * node-ctypes - Python ctypes-like FFI for Node.js
 *
 * A simple FFI library that allows calling C functions from JavaScript,
 * similar to Python's ctypes module.
 *
 * @module node-ctypes
 * @see {@link https://github.com/dmazzella/node-ctypes|GitHub Repository}
 * @example
 * import { CDLL, c_int, c_char_p } from 'node-ctypes';
 *
 * const libc = new CDLL(null); // Load C standard library
 * const printf = libc.func('printf', c_int, [c_char_p]);
 * printf('Hello from Node.js!\\n');
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Import refactored modules
import { LRUCache } from "./utils/cache.js";
import { _initConstants } from "./platform/constants.js";
import { _toNativeType, _toNativeTypes } from "./core/types.js";
import { callback as createCallback, threadSafeCallback as createThreadSafeCallback } from "./core/callback.js";
import { createLibraryClasses } from "./core/Library.js";
import {
  alloc as _alloc,
  cstring as _cstring,
  wstring as _wstring,
  create_string_buffer as _create_string_buffer,
  create_unicode_buffer as _create_unicode_buffer,
  string_at as _string_at,
  wstring_at as _wstring_at,
  memmove as _memmove,
  memset as _memset,
} from "./memory/buffer.js";
import {
  readValue as _readValue,
  writeValue as _writeValue,
  sizeof as _sizeof,
} from "./memory/operations.js";
import {
  addressOf as _addressOf,
  byref as _byref,
  cast as _cast,
  ptrToBuffer as _ptrToBuffer,
  POINTER as _POINTER,
} from "./memory/pointer.js";
import {
  get_errno as _get_errno,
  set_errno as _set_errno,
  GetLastError as _GetLastError,
  SetLastError as _SetLastError,
  FormatError as _FormatError,
  WinError as _WinError,
} from "./platform/errors.js";
import {
  bitfield as _bitfield,
  _isStruct,
  _isArrayType,
  _isBitField,
} from "./structures/helpers/common.js";
import { array as _array } from "./structures/helpers/array.js";
import {
  _readBitField as _readBitFieldHelper,
  _writeBitField as _writeBitFieldHelper,
  _readUintFromBuffer,
  _writeUintToBuffer,
} from "./structures/helpers/bitfield.js";
import { union as _union } from "./structures/helpers/union.js";
import { struct as _struct } from "./structures/helpers/struct.js";
import { createStructureClass } from "./structures/Structure.js";
import { createUnionClass } from "./structures/Union.js";
import { createSimpleCDataClass } from "./types/SimpleCData.js";
import { createPrimitiveTypes } from "./types/primitives.js";

/**
 * Get the path to the native module, checking multiple possible locations
 * @param {string} moduleName - The name of the npm module
 * @param {string} nativeFile - The name of the native .node file
 * @param {string} config - Build configuration (Release or Debug)
 * @returns {string} The absolute path to the native module
 */
const getNativeModulePath = (moduleName, nativeFile, config = "Release") => {
  const buildPath = (base) => path.join(base, "build", config, nativeFile);

  // Check if running in Electron
  if (process.versions?.electron) {
    const electronProcess = process;
    if (electronProcess.resourcesPath) {
      const unpackedPath = path.join(electronProcess.resourcesPath, "app.asar.unpacked", "node_modules", moduleName);
      if (existsSync(buildPath(unpackedPath))) {
        return buildPath(unpackedPath);
      }
    }
  }

  // Check in current working directory's node_modules
  const cwdPath = buildPath(path.join(process.cwd(), "node_modules", moduleName));
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  // Check local build directory in the project root (useful for local testing)
  const localBuildPath = buildPath(process.cwd());
  if (existsSync(localBuildPath)) {
    return localBuildPath;
  }

  // Try Debug build as fallback
  if (config === "Release") {
    try {
      return getNativeModulePath(moduleName, nativeFile, "Debug");
    } catch (e) {
      // Continue to error below
    }
  }

  throw new Error(`Native module "${nativeFile}" not found for "${moduleName}". ` + `Searched in Electron resources, node_modules, and local build.`);
};

// Load the native module
let nativeModulePath;
try {
  nativeModulePath = getNativeModulePath("node-ctypes", `ctypes.node`);
} catch (e) {
  try {
    const platform = process.platform;
    const arch = process.arch;
    nativeModulePath = getNativeModulePath("node-ctypes", `ctypes-${platform}-${arch}.node`);
  } catch (fallbackError) {
    throw new Error(`Failed to load native module: ${e.message}. Fallback also failed: ${fallbackError.message}`);
  }
}
const require = createRequire(path.join(process.cwd(), "index.js"));
const native = require(nativeModulePath);

// Initialize platform constants from native module
_initConstants(native);

// Re-esporta le classi native
const { Version, Library, FFIFunction, Callback, ThreadSafeCallback, CType, StructType, ArrayType } = native;

// ============================================================================
// Type Normalization Helpers
// Now imported from ./core/types.js - see that file for implementation details
// ============================================================================

/**
 * Carica una libreria dinamica
 * @param {string|null} libPath - Percorso della libreria o null per l'eseguibile corrente
 * @returns {Library} Oggetto Library
 */
function load(libPath) {
  return new Library(libPath);
}

// LRUCache is now imported from ./utils/cache.js
// See lib/utils/cache.js for implementation details

/**
 * Wrapper per funzioni con sintassi Python-like ctypes (argtypes/restype)
 */
// Create Library classes (FunctionWrapper, CDLL, WinDLL)
const { FunctionWrapper, CDLL, WinDLL } = createLibraryClasses(
  Library,
  LRUCache,
  _toNativeType,
  _toNativeTypes,
  native
);

// ============================================================================
// Callback Functions
// Now imported from ./core/callback.js - see that file for implementation details
// ============================================================================

/**
 * Crea un callback JS chiamabile da C (solo main thread)
 * @see ./core/callback.js for full documentation
 */
function callback(fn, returnType, argTypes = []) {
  return createCallback(fn, returnType, argTypes, native);
}

/**
 * Crea un callback JS chiamabile da qualsiasi thread
 * @see ./core/callback.js for full documentation
 */
function threadSafeCallback(fn, returnType, argTypes = []) {
  return createThreadSafeCallback(fn, returnType, argTypes, native);
}

// ============================================================================
// Buffer Operations
// Now imported from ./memory/buffer.js - see that file for implementation details
// ============================================================================

function alloc(size) {
  return _alloc(size);
}

function cstring(str) {
  return _cstring(str, native);
}

function wstring(str) {
  return _wstring(str, native);
}

// Internal wrappers for backward compatibility (used by SimpleCData _reader/_writer)
function readCString(ptr, maxLen) {
  return _string_at(ptr, maxLen, native);
}

function readWString(ptr, size) {
  return _wstring_at(ptr, size, native);
}

// ============================================================================
// Memory Operations
// Now imported from ./memory/operations.js - see that file for implementation details
// ============================================================================

function readValue(ptr, type, offset = 0) {
  return _readValue(ptr, type, offset, sizeof, ptrToBuffer, Structure, Union);
}

function writeValue(ptr, type, value, offset = 0) {
  return _writeValue(ptr, type, value, offset, sizeof, Structure, Union);
}

function sizeof(type) {
  return _sizeof(type, Structure, Union);
}

// ============================================================================
// Pointer Operations
// Now imported from ./memory/pointer.js - see that file for implementation details
// ============================================================================

function addressOf(ptr) {
  return _addressOf(ptr, alloc, native);
}

function byref(obj) {
  return _byref(obj);
}

function cast(ptr, targetType) {
  return _cast(ptr, targetType, readValue, sizeof, ptrToBuffer);
}

function ptrToBuffer(address, size) {
  return _ptrToBuffer(address, size, native);
}

function POINTER(baseType) {
  return _POINTER(baseType, sizeof, alloc, readValue, writeValue, c_void_p, native);
}

/**
 * Helper per definire union (tutti i campi condividono offset 0)
 * Supporta nested structs e bitfields come struct()
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 * @returns {Object} Definizione della union
 */
function union(fields) {
  return _union(fields, sizeof, alloc, readValue, writeValue, _isStruct, _isArrayType, _isBitField, Structure, Union, native);
}

/**
 * Helper to define a JS class backed by a struct definition.
 * Useful for TypeScript inference: const Point = defineStruct({ x: 'int32', y: 'int32' }, { packed: false });
 */
function defineStruct(fields, options) {
  const def = struct(fields, options);
  class AutoStruct extends Structure {}
  // cache structDef on the class so constructor picks it up
  AutoStruct._structDef = def;
  AutoStruct._fields_ = fields;
  return AutoStruct;
}

/**
 * Helper to define a JS class backed by a union definition.
 */
function defineUnion(fields) {
  const def = union(fields);
  class AutoUnion extends Union {}
  AutoUnion._structDef = def;
  AutoUnion._fields_ = fields;
  return AutoUnion;
}
// --------------------------------------------------------------------------
// Structure and Union base classes (created via factory functions)
// These classes read static properties on the subclass:
// - `_fields_`: array of [name, type] or object map { name: type }
// - `_anonymous_`: optional array of anonymous field names (for structs)
// - `_pack_`: optional packing value (true/false)
// The classes expose `create()`, `toObject()`, `get()`, `set()` and a hidden
// `_buffer` when an instance is created via `new`.
// --------------------------------------------------------------------------

// Create Structure and Union classes with injected dependencies
const Structure = createStructureClass(alloc, struct);
const Union = createUnionClass(Structure, union);


/**
 * Helper per creare array a dimensione fissa (come c_int * 5 in Python)
 * Ritorna un ArrayType wrapper con supporto per indexing arr[i]
 *
 * @param {string} elementType - Tipo degli elementi ('int32', 'float', etc.)
 * @param {number} count - Numero di elementi
 * @returns {Object} ArrayType con metodi getSize(), getLength(), create(), wrap()
 *
 * @example
 * const IntArray5 = array('int32', 5);
 * const arr = IntArray5.create([1, 2, 3, 4, 5]);
 * console.log(arr[0]);  // 1 - indexing Python-like!
 * arr[2] = 42;
 * console.log(arr[2]);  // 42
 */
function array(elementType, count) {
  return _array(elementType, count, sizeof, alloc, readValue, writeValue, Structure, Union, ArrayType);
}

// ============================================================================
// Error Handling
// ============================================================================
// ============================================================================

// ============================================================================
// Error Handling
// Now imported from ./platform/errors.js - see that file for implementation details
// ============================================================================

function get_errno() {
  return _get_errno(CDLL, alloc, readValue, c_int32, c_void_p);
}

function set_errno(value) {
  return _set_errno(value, CDLL, writeValue, c_int32, c_void_p);
}

function GetLastError() {
  return _GetLastError(WinDLL, c_uint32, c_void, c_void_p);
}

function SetLastError(code) {
  return _SetLastError(code, WinDLL, c_uint32, c_void, c_void_p);
}

function FormatError(code) {
  return _FormatError(code, WinDLL, alloc, c_uint32, c_void, c_void_p);
}

function WinError(code) {
  return _WinError(code, WinDLL, alloc, c_uint32, c_void, c_void_p);
}

/**
 * Helper per definire un bit field
 * @param {string} baseType - Tipo base (uint8, uint16, uint32, uint64)
 * @param {number} bits - Numero di bit
 * @returns {Object} Definizione del bit field
 */
function bitfield(baseType, bits) {
  return _bitfield(baseType, bits, sizeof);
}

/**
 * Helper per leggere un valore bit field da un buffer
 * @private
 */
function _readBitField(buf, offset, baseType, bitOffset, bitSize) {
  return _readBitFieldHelper(buf, offset, baseType, bitOffset, bitSize, sizeof);
}

/**
 * Helper per scrivere un valore bit field in un buffer
 * @private
 */
function _writeBitField(buf, offset, baseType, bitOffset, bitSize, newValue) {
  return _writeBitFieldHelper(buf, offset, baseType, bitOffset, bitSize, newValue, sizeof);
}

/**
 * Helper per definire struct con supporto per:
 * - Alignment corretto
 * - Nested structs
 * - Bit fields
 *
 * @param {Object} fields - Definizione dei campi { name: type, ... }
 *   - type può essere: 'int32', 'uint8', etc. (tipi base)
 *   - type può essere: un'altra struct (nested)
 *   - type può essere: bitfield('uint32', 4) (bit field)
 * @param {Object} [options] - Opzioni { packed: false }
 * @returns {Object} Definizione della struttura
 */
function struct(fields, options = {}) {
  return _struct(fields, options, sizeof, alloc, readValue, writeValue, _isStruct, _isArrayType, _isBitField, Structure, Union, native);
}

// ============================================================================
// Python-compatible Simple C Data Types (instantiable)
// Usage: const v = new c_uint64(42); v.value; byref(v);
// ============================================================================
// SimpleCData base class (created via factory function)
const SimpleCData = createSimpleCDataClass(alloc);

// Create all primitive type classes
const primitiveTypes = createPrimitiveTypes(
  SimpleCData,
  native,
  addressOf,
  cstring,
  wstring,
  readCString,
  readWString
);

// Destructure all types for easy access
const {
  c_void,
  c_int8, c_int16, c_int32, c_int64,
  c_uint8, c_uint16, c_uint32, c_uint64,
  c_float, c_double,
  c_bool,
  c_char, c_wchar,
  c_void_p, c_char_p, c_wchar_p,
  c_size_t, c_long, c_ulong,
  c_byte, c_ubyte, c_short, c_ushort,
  c_int, c_uint, c_longlong, c_ulonglong,
} = primitiveTypes;

// ============================================================================
// Alias Python-compatibili per Memory Management
// ============================================================================

// ============================================================================
// Memory Management Functions
// Now imported from ./memory/buffer.js - see that file for implementation details
// ============================================================================

function create_string_buffer(init) {
  return _create_string_buffer(init, native);
}

function create_unicode_buffer(init) {
  return _create_unicode_buffer(init, native);
}

function string_at(address, size) {
  return _string_at(address, size, native);
}

function wstring_at(address, size) {
  return _wstring_at(address, size, native);
}

// Alias lowercase per compatibilità Python (addressof invece di addressOf)
const addressof = addressOf;

function memmove(dst, src, count) {
  return _memmove(dst, src, count, native);
}

function memset(dst, value, count) {
  return _memset(dst, value, count);
}

// Export come ES module
export {
  // Classi
  Version,
  Library,
  CDLL,
  WinDLL,
  FFIFunction,
  Callback,
  ThreadSafeCallback,
  CType,

  // Funzioni base
  load,
  callback,
  threadSafeCallback,

  // Memory Management - Python-compatibili
  create_string_buffer,
  create_unicode_buffer,
  string_at,
  wstring_at,
  addressof,
  memmove,
  memset,

  // Memory - utility senza equivalente Python diretto
  readValue,
  writeValue,
  sizeof,
  ptrToBuffer,

  // Strutture
  struct,
  union,
  defineStruct,
  defineUnion,
  array,
  bitfield,
  StructType,
  ArrayType,
  Structure,
  Union,

  // Classes for Python-like subclassing: class X extends Structure { static _fields_ = [...] }
  // See Structure/Union implementation below

  // Puntatori (Python-compatible)
  byref,
  cast,
  POINTER,

  // Error handling
  get_errno,
  set_errno,
  GetLastError,
  SetLastError,
  FormatError,
  WinError,

  // SimpleCData base class
  SimpleCData,

  // Python-compatible type classes
  c_void,
  c_int,
  c_uint,
  c_int8,
  c_uint8,
  c_int16,
  c_uint16,
  c_int32,
  c_uint32,
  c_int64,
  c_uint64,
  c_float,
  c_double,
  c_char,
  c_char_p,
  c_wchar,
  c_wchar_p,
  c_void_p,
  c_bool,
  c_size_t,
  c_long,
  c_ulong,
  // Python-compatible aliases
  c_byte,
  c_ubyte,
  c_short,
  c_ushort,
  c_longlong,
  c_ulonglong,
};

// Re-export constants from platform module
export { POINTER_SIZE, WCHAR_SIZE, NULL } from "./platform/constants.js";
