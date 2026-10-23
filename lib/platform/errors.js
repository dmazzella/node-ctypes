/**
 * @file errors.js
 * @module platform/errors
 * @description Windows error formatting helpers.
 *
 * Provides `FormatError` and `WinError` — the Python ctypes equivalents of
 * `ctypes.FormatError()` and `ctypes.WinError()`. These wrap the Win32
 * `FormatMessageW` API to turn a numeric error code into a human-readable
 * message and (for `WinError`) an `Error` object with a `winerror` property.
 *
 * **Note**: `get_errno` / `set_errno` / `GetLastError` / `SetLastError` are
 * implemented in the native addon (thread-local slots on the Addon instance)
 * and re-exported from `lib/index.js`. Python ctypes parity: these functions
 * read/write a private ctypes slot, not the system errno/GetLastError — if
 * you want to capture the system value after an FFI call, open the library
 * with `{ use_last_error: true }` / `{ use_errno: true }`.
 */

// Lazy-loaded Windows error functions
let _win_error_funcs = null;

/**
 * Initializes Windows error functions (lazy loading).
 * Only available on Windows platform.
 *
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {Object} Windows error functions object (or { error } sentinel)
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
      FormatMessageW: kernel32.func("FormatMessageW", c_uint32, [c_uint32, c_void_p, c_uint32, c_uint32, c_void_p, c_uint32, c_void_p]),
      _lib: kernel32,
    };
  } catch (e) {
    _win_error_funcs = { error: e.message };
  }

  return _win_error_funcs;
}

/**
 * Formats a Windows error code into a human-readable message.
 *
 * **Windows Only.**
 *
 * **Python ctypes Compatibility**: Direct equivalent to `ctypes.FormatError()`.
 *
 * @param {number} code - Error code (callers that want the "current" code —
 *                        i.e. the one last captured by a use_last_error FFI
 *                        call — should pass `GetLastError()` explicitly).
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Function} alloc - alloc function reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {string} Formatted error message
 * @throws {Error} If not on Windows or kernel32.dll unavailable
 */
export function FormatError(code, WinDLL, alloc, c_uint32, c_void, c_void_p) {
  const funcs = _initWinError(WinDLL, c_uint32, c_void, c_void_p);
  if (funcs.error) {
    throw new Error("FormatError not available: " + funcs.error);
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

  // Convert from UTF-16LE to string, trimming any trailing CRLF
  return buf.toString("utf16le", 0, len * 2).replace(/\r?\n$/, "");
}

/**
 * Creates an Error object from a Windows error code.
 *
 * **Windows Only.**
 *
 * **Python ctypes Compatibility**: Direct equivalent to `ctypes.WinError()`.
 *
 * @param {number} code - Error code
 * @param {Function} WinDLL - WinDLL class reference
 * @param {Function} alloc - alloc function reference
 * @param {Object} c_uint32 - c_uint32 type reference
 * @param {Object} c_void - c_void type reference
 * @param {Object} c_void_p - c_void_p type reference
 * @returns {Error} Error with `.winerror = code` and a formatted message
 */
export function WinError(code, WinDLL, alloc, c_uint32, c_void, c_void_p, descr) {
  const msg = descr ?? FormatError(code, WinDLL, alloc, c_uint32, c_void, c_void_p);
  const err = new Error(`[WinError ${code}] ${msg}`);
  // Python: OSError(None, descr, None, code) — errno derivato da winerror.
  err.winerror = code;
  err.errno = winerrorToErrno(code);
  err.strerror = msg;
  return err;
}

// errno (valori del CRT Microsoft) di un codice Windows, come
// winerror_to_errno di CPython (PC/errmap.h).
const ENOENT = 2;
const errnoGroups = [
  [ENOENT, [2, 3, 15, 18, 53, 67, 161, 206]],
  [7, [10]], // E2BIG
  [8, [11, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202]], // ENOEXEC
  [9, [6, 114, 130]], // EBADF
  [10, [128, 129]], // ECHILD
  [11, [89, 164, 215]], // EAGAIN
  [12, [7, 8, 9, 1816]], // ENOMEM
  [13, [5, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 65, 82, 83, 108, 132, 158, 167]], // EACCES
  [17, [80, 183]], // EEXIST
  [18, [17]], // EXDEV
  [20, [267]], // ENOTDIR
  [24, [4]], // EMFILE
  [28, [112]], // ENOSPC
  [32, [109, 232]], // EPIPE
  [41, [145]], // ENOTEMPTY
  [42, [1113]], // EILSEQ
  [138, [258]], // ETIMEDOUT
];
const errnoByWinerror = new Map(errnoGroups.flatMap(([errno, codes]) => codes.map((code) => [code, errno])));
const EINVAL = 22;

/**
 * errno of a Windows error code (CPython `winerror_to_errno`).
 *
 * @param {number} winerror - Windows error code (or FACILITY_WIN32 HRESULT)
 * @returns {number} errno value
 */
export function winerrorToErrno(winerror) {
  let code = winerror >>> 0;
  if ((code & 0xffff0000) >>> 0 === 0x80070000) code &= 0xffff;
  if (code >= 10000 && code < 12000) {
    // Winsock: i codici sono già errno (alcuni con offset 10000).
    return [10004, 10009, 10013, 10014, 10022, 10024].includes(code) ? code - 10000 : code;
  }
  return errnoByWinerror.get(code) ?? EINVAL;
}

/**
 * Raised when a foreign function call cannot convert one of the passed
 * arguments (Python ctypes `ctypes.ArgumentError`). Subclass of `TypeError`.
 *
 * @example
 * ```javascript
 * try {
 *   abs("12");
 * } catch (e) {
 *   if (e instanceof ArgumentError) console.log(e.message); // "argument 1: TypeError: ..."
 * }
 * ```
 */
export class ArgumentError extends TypeError {
  constructor(message, options) {
    super(message, options);
    this.name = "ArgumentError";
  }
}
