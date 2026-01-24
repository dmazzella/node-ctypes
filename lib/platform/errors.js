/**
 * @file errors.js
 * @module platform/errors
 * @description Platform-specific error handling for errno and Windows errors.
 *
 * This module provides Python ctypes-compatible error handling functions for both
 * Unix-like systems (errno) and Windows (GetLastError/FormatError).
 *
 * **Python ctypes Compatibility**:
 * - `get_errno()` / `set_errno()` ≈ Python's `ctypes.get_errno()` / `set_errno()`
 * - `GetLastError()` / `SetLastError()` ≈ Python's `ctypes.GetLastError()` / `SetLastError()`
 * - `FormatError()` ≈ Python's `ctypes.FormatError()`
 * - `WinError()` ≈ Python's `ctypes.WinError()`
 *
 * @example Unix errno
 * ```javascript
 * import { get_errno, set_errno } from 'node-ctypes';
 *
 * // Call C function that might set errno
 * const result = some_c_function();
 * if (result === -1) {
 *   const err = get_errno();
 *   console.log(`errno: ${err}`);
 * }
 * ```
 *
 * @example Windows errors
 * ```javascript
 * import { GetLastError, WinError } from 'node-ctypes';
 *
 * // Call Windows API that might fail
 * const result = some_win_api();
 * if (!result) {
 *   throw WinError(); // Creates Error with formatted message
 * }
 * ```
 */

// Lazy-loaded errno and Windows error functions
let _errno_funcs = null;
let _win_error_funcs = null;

/**
 * Initializes errno functions (lazy loading).
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: Uses msvcrt.dll `_get_errno()` / `_set_errno()`
 * - **macOS**: Uses `__error()` function (returns pointer to errno)
 * - **Linux**: Uses `__errno_location()` function (returns pointer to errno)
 *
 * @param {Function} CDLL - CDLL class reference
 * @param {Object} c_int32 - c_int32 type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {Object} Errno functions object
 * @private
 */
function _initErrno(CDLL, c_int32, c_void_p) {
  if (_errno_funcs) return _errno_funcs;

  try {
    if (process.platform === "win32") {
      const msvcrt = new CDLL("msvcrt.dll");
      _errno_funcs = {
        _get: msvcrt.func("_get_errno", c_int32, [c_void_p]),
        _set: msvcrt.func("_set_errno", c_int32, [c_int32]),
        _lib: msvcrt,
      };
    } else if (process.platform === "darwin") {
      // macOS uses __error instead of __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__error", c_void_p, []),
        _lib: libc,
      };
    } else {
      // Linux and other Unix systems use __errno_location
      const libc = new CDLL(null);
      _errno_funcs = {
        _location: libc.func("__errno_location", c_void_p, []),
        _lib: libc,
      };
    }
  } catch (e) {
    _errno_funcs = { error: e.message };
  }

  return _errno_funcs;
}

/**
 * Gets the current value of errno.
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: Calls msvcrt `_get_errno()`
 * - **Unix**: Reads from errno location pointer
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.get_errno()`.
 *
 * @param {Function} CDLL - CDLL class reference
 * @param {Function} alloc - alloc function reference
 * @param {Function} readValue - readValue function reference
 * @param {Object} c_int32 - c_int32 type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {number} Current errno value
 * @throws {Error} If errno is not available on this platform
 *
 * @example Get errno after failed system call
 * ```javascript
 * import { CDLL, get_errno, c_int } from 'node-ctypes';
 *
 * const libc = new CDLL(null);
 * const open = libc.func('open', c_int, [c_char_p, c_int]);
 *
 * const fd = open('/nonexistent/file', 0);
 * if (fd === -1) {
 *   const err = get_errno();
 *   console.log(`Error code: ${err}`); // e.g., 2 (ENOENT)
 * }
 * ```
 */
export function get_errno(CDLL, alloc, readValue, c_int32, c_void_p) {
  const funcs = _initErrno(CDLL, c_int32, c_void_p);
  if (funcs.error) {
    throw new Error("errno not available: " + funcs.error);
  }

  if (process.platform === "win32") {
    const buf = alloc(4);
    funcs._get(buf);
    return readValue(buf, c_int32);
  } else {
    const ptr = funcs._location();
    return readValue(ptr, c_int32);
  }
}

/**
 * Sets the value of errno.
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: Calls msvcrt `_set_errno()`
 * - **Unix**: Writes to errno location pointer
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.set_errno()`.
 *
 * @param {number} value - New errno value
 * @param {Function} CDLL - CDLL class reference
 * @param {Function} writeValue - writeValue function reference
 * @param {Object} c_int32 - c_int32 type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @throws {Error} If errno is not available on this platform
 *
 * @example Set errno before calling function
 * ```javascript
 * import { set_errno } from 'node-ctypes';
 *
 * // Clear errno before call
 * set_errno(0);
 * const result = some_c_function();
 * ```
 */
export function set_errno(value, CDLL, writeValue, c_int32, c_void_p) {
  const funcs = _initErrno(CDLL, c_int32, c_void_p);
  if (funcs.error) {
    throw new Error("errno not available: " + funcs.error);
  }

  if (process.platform === "win32") {
    funcs._set(value);
  } else {
    const ptr = funcs._location();
    writeValue(ptr, c_int32, value);
  }
}

/**
 * Initializes Windows error functions (lazy loading).
 *
 * Loads kernel32.dll functions for Windows error handling.
 * Only available on Windows platform.
 *
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {Object} Windows error functions object
 * @private
 */
function _initWinError(WinDLL, c_uint32, c_void, c_void_p) {
  if (_win_error_funcs) return _win_error_funcs;

  if (process.platform !== "win32") {
    _win_error_funcs = { error: "Windows only" };
    return _win_error_funcs;
  }

  try {
    const kernel32 = new WinDLL("kernel32.dll");
    _win_error_funcs = {
      GetLastError: kernel32.func("GetLastError", c_uint32, []),
      SetLastError: kernel32.func("SetLastError", c_void, [c_uint32]),
      FormatMessageW: kernel32.func("FormatMessageW", c_uint32, [c_uint32, c_void_p, c_uint32, c_uint32, c_void_p, c_uint32, c_void_p]),
      _lib: kernel32,
    };
  } catch (e) {
    _win_error_funcs = { error: e.message };
  }

  return _win_error_funcs;
}

/**
 * Gets the last Windows error code (GetLastError).
 *
 * **Windows Only**: This function is only available on Windows.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.GetLastError()`.
 *
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {number} Windows error code
 * @throws {Error} If not on Windows or kernel32.dll unavailable
 *
 * @example Get Windows error after failed API call
 * ```javascript
 * import { WinDLL, GetLastError } from 'node-ctypes';
 *
 * const kernel32 = new WinDLL('kernel32.dll');
 * const CreateFileW = kernel32.func('CreateFileW', ...);
 *
 * const handle = CreateFileW(...);
 * if (handle === -1) {
 *   const err = GetLastError();
 *   console.log(`Windows error code: ${err}`);
 * }
 * ```
 */
export function GetLastError(WinDLL, c_uint32, c_void, c_void_p) {
  const funcs = _initWinError(WinDLL, c_uint32, c_void, c_void_p);
  if (funcs.error) {
    throw new Error("GetLastError not available: " + funcs.error);
  }
  return funcs.GetLastError();
}

/**
 * Sets the last Windows error code (SetLastError).
 *
 * **Windows Only**: This function is only available on Windows.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.SetLastError()`.
 *
 * @param {number} code - Error code to set
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @throws {Error} If not on Windows or kernel32.dll unavailable
 *
 * @example Clear Windows error before call
 * ```javascript
 * import { SetLastError } from 'node-ctypes';
 *
 * // Clear error before Windows API call
 * SetLastError(0);
 * const result = some_win_api();
 * ```
 */
export function SetLastError(code, WinDLL, c_uint32, c_void, c_void_p) {
  const funcs = _initWinError(WinDLL, c_uint32, c_void, c_void_p);
  if (funcs.error) {
    throw new Error("SetLastError not available: " + funcs.error);
  }
  funcs.SetLastError(code);
}

/**
 * Formats a Windows error code into a human-readable message.
 *
 * **Windows Only**: This function is only available on Windows.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.FormatError()`.
 *
 * @param {number} [code] - Error code (default: GetLastError())
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Function} alloc - alloc function reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {string} Formatted error message
 * @throws {Error} If not on Windows or kernel32.dll unavailable
 *
 * @example Format current Windows error
 * ```javascript
 * import { FormatError } from 'node-ctypes';
 *
 * const result = some_win_api();
 * if (!result) {
 *   const message = FormatError();
 *   console.log(`Error: ${message}`);
 * }
 * ```
 *
 * @example Format specific error code
 * ```javascript
 * const message = FormatError(5); // Access denied
 * console.log(message); // "Access is denied."
 * ```
 */
export function FormatError(code, WinDLL, alloc, c_uint32, c_void, c_void_p) {
  const funcs = _initWinError(WinDLL, c_uint32, c_void, c_void_p);
  if (funcs.error) {
    throw new Error("FormatError not available: " + funcs.error);
  }

  if (code === undefined) {
    code = funcs.GetLastError();
  }

  const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
  const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

  const bufSize = 512;
  const buf = alloc(bufSize * 2); // Wide chars

  const len = funcs.FormatMessageW(
    FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    null,
    code,
    0, // Default language
    buf,
    bufSize,
    null,
  );

  if (len === 0) {
    return `Unknown error ${code}`;
  }

  // Convert from UTF-16LE to string
  return buf.toString("utf16le", 0, len * 2).replace(/\r?\n$/, "");
}

/**
 * Creates an Error object from a Windows error code.
 *
 * **Windows Only**: This function is only available on Windows.
 *
 * The returned Error object has an additional `winerror` property containing
 * the numeric error code.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.WinError()`.
 *
 * @param {number} [code] - Error code (default: GetLastError())
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Function} alloc - alloc function reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {Error} Error object with formatted message and winerror property
 *
 * @example Throw WinError on failure
 * ```javascript
 * import { WinDLL, WinError } from 'node-ctypes';
 *
 * const kernel32 = new WinDLL('kernel32.dll');
 * const CreateFileW = kernel32.func('CreateFileW', ...);
 *
 * const handle = CreateFileW(...);
 * if (handle === -1) {
 *   throw WinError(); // Throws Error with formatted message
 * }
 * ```
 *
 * @example Check specific error code
 * ```javascript
 * try {
 *   const result = some_win_api();
 *   if (!result) throw WinError();
 * } catch (err) {
 *   if (err.winerror === 5) {
 *     console.log('Access denied');
 *   }
 * }
 * ```
 */
export function WinError(code, WinDLL, alloc, c_uint32, c_void, c_void_p) {
  if (code === undefined) {
    code = GetLastError(WinDLL, c_uint32, c_void, c_void_p);
  }
  const msg = FormatError(code, WinDLL, alloc, c_uint32, c_void, c_void_p);
  const err = new Error(`[WinError ${code}] ${msg}`);
  err.winerror = code;
  return err;
}
