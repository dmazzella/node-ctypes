/**
 * @file buffer.js
 * @module memory/buffer
 * @description Buffer creation and string handling functions for C interoperability.
 *
 * This module provides Python ctypes-compatible functions for creating and managing
 * buffers, C strings, and wide strings. It handles platform-specific differences in
 * character encoding (UTF-16LE on Windows, UTF-32LE on Unix).
 *
 * **Python ctypes Compatibility**:
 * - `create_string_buffer()` ≈ Python's `ctypes.create_string_buffer()`
 * - `create_unicode_buffer()` ≈ Python's `ctypes.create_unicode_buffer()`
 * - `string_at()` ≈ Python's `ctypes.string_at()`
 * - `wstring_at()` ≈ Python's `ctypes.wstring_at()`
 *
 * @example Basic buffer operations
 * ```javascript
 * import { create_string_buffer, create_unicode_buffer } from 'node-ctypes';
 *
 * // Create C string buffer
 * const buf1 = create_string_buffer(64);        // 64-byte buffer
 * const buf2 = create_string_buffer("Hello");   // Buffer with string
 *
 * // Create wide string buffer
 * const wbuf1 = create_unicode_buffer(32);      // 32 wchar_t buffer
 * const wbuf2 = create_unicode_buffer("Hello"); // Wide string buffer
 * ```
 */

/**
 * Allocates a zero-initialized buffer of the specified size.
 *
 * This is a simple wrapper around `Buffer.alloc()` for consistency with
 * the ctypes API. All bytes are initialized to zero.
 *
 * @param {number} size - Size in bytes to allocate
 * @returns {Buffer} Zero-initialized buffer
 *
 * @example
 * ```javascript
 * import { alloc } from 'node-ctypes';
 *
 * const buf = alloc(256); // 256-byte zero-filled buffer
 * console.log(buf[0]); // 0
 * ```
 */
export function alloc(size) {
  return Buffer.alloc(size);
}

/**
 * Creates a buffer containing a null-terminated C string.
 *
 * The resulting buffer is compatible with C `char*` strings and includes
 * the null terminator.
 *
 * **Platform Notes**:
 * - Uses the native module's cstring implementation
 * - Automatically adds null terminator
 * - Encoding is UTF-8 (standard for C strings)
 *
 * @param {string} str - JavaScript string to convert
 * @param {Object} native - Native module reference
 * @returns {Buffer} Buffer containing null-terminated C string
 *
 * @example
 * ```javascript
 * import { cstring } from 'node-ctypes';
 *
 * const buf = cstring("Hello, World!");
 * // Buffer: [72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 33, 0]
 * //          H   e    l    l    o    ,  ' '  W   o    r    l    d    !   \0
 * ```
 */
export function cstring(str, native) {
  return native.cstring(str);
}

/**
 * Creates a buffer containing a null-terminated wide string (wchar_t*).
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: 2 bytes per character (UTF-16LE)
 * - **Unix/Linux/macOS**: 4 bytes per character (UTF-32LE)
 *
 * The function automatically detects the platform and encodes accordingly.
 *
 * **Python ctypes Compatibility**:
 * Equivalent to creating a wide string in Python ctypes, handling the
 * platform's native wchar_t representation.
 *
 * @param {string} str - JavaScript string to convert
 * @param {Object} native - Native module reference (provides WCHAR_SIZE)
 * @returns {Buffer} Buffer containing null-terminated wide string
 *
 * @example Windows (UTF-16LE)
 * ```javascript
 * import { wstring } from 'node-ctypes';
 *
 * // On Windows (WCHAR_SIZE = 2):
 * const buf = wstring("Hi");
 * // Buffer: [72, 0, 105, 0, 0, 0]
 * //          H      i      \0
 * ```
 *
 * @example Unix (UTF-32LE)
 * ```javascript
 * // On Unix (WCHAR_SIZE = 4):
 * const buf = wstring("Hi");
 * // Buffer: [72, 0, 0, 0, 105, 0, 0, 0, 0, 0, 0, 0]
 * //          H           i           \0
 * ```
 */
export function wstring(str, native) {
  const wcharSize = native.WCHAR_SIZE;

  // Windows: UTF-16LE (2 bytes per character)
  if (wcharSize === 2) {
    return Buffer.from(str + "\0", "utf16le");
  }

  // Unix: UTF-32LE (4 bytes per character)
  // Manually construct UTF-32LE buffer from code points
  const codePoints = [];
  for (const ch of str) {
    codePoints.push(ch.codePointAt(0));
  }

  const buf = Buffer.alloc((codePoints.length + 1) * 4);
  for (let i = 0; i < codePoints.length; i++) {
    buf.writeUInt32LE(codePoints[i], i * 4);
  }
  // Null terminator already initialized (Buffer.alloc zeros memory)

  return buf;
}

/**
 * Creates a C string buffer (Python ctypes compatible).
 *
 * **Overloaded Function**:
 * - `create_string_buffer(size)` - Allocates empty buffer of size bytes
 * - `create_string_buffer(string)` - Creates buffer from string (with null terminator)
 * - `create_string_buffer(bytes)` - Copies buffer and adds null terminator
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.create_string_buffer()`.
 *
 * @param {number|string|Buffer} init - Size, string, or buffer to copy
 * @param {Object} native - Native module reference
 * @returns {Buffer} Created buffer
 * @throws {TypeError} If init is not number, string, or Buffer
 *
 * @example Empty buffer
 * ```javascript
 * import { create_string_buffer } from 'node-ctypes';
 *
 * const buf = create_string_buffer(256);
 * // 256-byte zero-filled buffer
 * ```
 *
 * @example From string
 * ```javascript
 * const buf = create_string_buffer("Hello");
 * // Buffer: "Hello\0" (6 bytes including null terminator)
 * ```
 *
 * @example From buffer
 * ```javascript
 * const src = Buffer.from([72, 101, 108, 108, 111]);
 * const buf = create_string_buffer(src);
 * // Buffer: [72, 101, 108, 108, 111, 0] (adds null terminator)
 * ```
 */
export function create_string_buffer(init, native) {
  if (typeof init === "number") {
    // create_string_buffer(size) - allocate empty buffer
    return alloc(init);
  } else if (typeof init === "string") {
    // create_string_buffer("string") - create buffer with string
    return cstring(init, native);
  } else if (Buffer.isBuffer(init)) {
    // create_string_buffer(bytes) - copy bytes and add null terminator
    const buf = alloc(init.length + 1);
    init.copy(buf);
    buf[init.length] = 0; // null terminator
    return buf;
  }

  throw new TypeError("create_string_buffer requires number, string, or Buffer");
}

/**
 * Creates a Unicode (wide string) buffer (Python ctypes compatible).
 *
 * **Overloaded Function**:
 * - `create_unicode_buffer(size)` - Allocates buffer for size characters
 * - `create_unicode_buffer(string)` - Creates wide string buffer from string
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: size * 2 bytes (UTF-16LE)
 * - **Unix**: size * 4 bytes (UTF-32LE)
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.create_unicode_buffer()`.
 *
 * @param {number|string} init - Size in characters or string
 * @param {Object} native - Native module reference (provides WCHAR_SIZE)
 * @returns {Buffer} Created wide string buffer
 * @throws {TypeError} If init is not number or string
 *
 * @example Empty wide buffer
 * ```javascript
 * import { create_unicode_buffer } from 'node-ctypes';
 *
 * // On Windows (2 bytes per wchar_t):
 * const buf = create_unicode_buffer(64);
 * // 128-byte buffer (64 characters * 2 bytes)
 *
 * // On Unix (4 bytes per wchar_t):
 * const buf = create_unicode_buffer(64);
 * // 256-byte buffer (64 characters * 4 bytes)
 * ```
 *
 * @example From string
 * ```javascript
 * const buf = create_unicode_buffer("Hello");
 * // Wide string buffer with "Hello\0"
 * ```
 */
export function create_unicode_buffer(init, native) {
  const wcharSize = native.WCHAR_SIZE;

  if (typeof init === "number") {
    // create_unicode_buffer(size) - allocate empty buffer for N characters
    return alloc(init * wcharSize);
  } else if (typeof init === "string") {
    // create_unicode_buffer("string") - create buffer with wide string
    return wstring(init, native);
  }

  throw new TypeError("create_unicode_buffer requires number or string");
}

/**
 * Reads a C string from a memory address (Python ctypes compatible).
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.string_at()`.
 *
 * @param {Buffer|bigint|number} address - Memory address or buffer
 * @param {number} [size] - Number of bytes to read (default: until null terminator)
 * @param {Object} native - Native module reference
 * @returns {string|null} String read from memory
 *
 * @example Read until null terminator
 * ```javascript
 * import { string_at, cstring } from 'node-ctypes';
 *
 * const buf = cstring("Hello");
 * const str = string_at(buf);
 * console.log(str); // "Hello"
 * ```
 *
 * @example Read fixed size
 * ```javascript
 * const buf = Buffer.from("Hello, World!\0");
 * const str = string_at(buf, 5);
 * console.log(str); // "Hello"
 * ```
 */
export function string_at(address, size, native) {
  return native.readCString(address, size);
}

/**
 * Reads a wide string from a memory address (Python ctypes compatible).
 *
 * **Platform-Specific Behavior**:
 * - **Windows**: Reads UTF-16LE (2 bytes per character)
 * - **Unix**: Reads UTF-32LE (4 bytes per character)
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.wstring_at()`.
 *
 * @param {Buffer|bigint|number} address - Memory address or buffer
 * @param {number} [size] - Number of wide characters to read (not bytes)
 * @param {Object} native - Native module reference
 * @returns {string|null} Wide string read from memory
 *
 * @example Read wide string
 * ```javascript
 * import { wstring_at, wstring } from 'node-ctypes';
 *
 * const buf = wstring("Hello");
 * const str = wstring_at(buf);
 * console.log(str); // "Hello"
 * ```
 */
export function wstring_at(address, size, native) {
  if (address === null || address === undefined) {
    return null;
  }

  const wcharSize = native.WCHAR_SIZE;
  let buf;

  if (Buffer.isBuffer(address)) {
    buf = address;
  } else {
    // Convert BigInt/number to buffer
    const maxBytes = size ? size * wcharSize : 1024;
    buf = native.ptrToBuffer(address, maxBytes);
  }

  // Windows: UTF-16LE
  if (wcharSize === 2) {
    if (size !== undefined) {
      return buf.toString("utf16le", 0, size * 2);
    }
    // Read until null terminator
    let end = 0;
    while (end < buf.length - 1 && (buf[end] !== 0 || buf[end + 1] !== 0)) {
      end += 2;
    }
    return buf.toString("utf16le", 0, end);
  }

  // Unix: UTF-32LE
  const chars = [];
  const limit = size !== undefined ? size : Math.floor(buf.length / 4);

  for (let i = 0; i < limit; i++) {
    const codePoint = buf.readUInt32LE(i * 4);
    if (codePoint === 0) break;
    chars.push(String.fromCodePoint(codePoint));
  }

  return chars.join("");
}

/**
 * Copies memory from source to destination (like C's memmove).
 *
 * **Python ctypes Compatibility**:
 * Equivalent to Python's `ctypes.memmove()`.
 *
 * @param {Buffer} dst - Destination buffer
 * @param {Buffer|bigint} src - Source buffer or address
 * @param {number} count - Number of bytes to copy
 * @param {Object} native - Native module reference
 * @throws {TypeError} If dst is not a Buffer
 *
 * @example
 * ```javascript
 * import { memmove } from 'node-ctypes';
 *
 * const dst = Buffer.alloc(10);
 * const src = Buffer.from("Hello");
 * memmove(dst, src, 5);
 * console.log(dst.toString('utf8', 0, 5)); // "Hello"
 * ```
 */
export function memmove(dst, src, count, native) {
  if (!Buffer.isBuffer(dst)) {
    throw new TypeError("dst must be a Buffer");
  }

  let srcBuf;
  if (Buffer.isBuffer(src)) {
    srcBuf = src;
  } else {
    srcBuf = native.ptrToBuffer(src, count);
  }

  srcBuf.copy(dst, 0, 0, count);
}

/**
 * Fills memory with a byte value (like C's memset).
 *
 * **Python ctypes Compatibility**:
 * Equivalent to Python's `ctypes.memset()`.
 *
 * @param {Buffer} dst - Destination buffer
 * @param {number} value - Byte value to fill (0-255)
 * @param {number} count - Number of bytes to fill
 * @throws {TypeError} If dst is not a Buffer
 *
 * @example
 * ```javascript
 * import { memset } from 'node-ctypes';
 *
 * const buf = Buffer.alloc(10);
 * memset(buf, 0xFF, 5);
 * console.log([...buf]); // [255, 255, 255, 255, 255, 0, 0, 0, 0, 0]
 * ```
 */
export function memset(dst, value, count) {
  if (!Buffer.isBuffer(dst)) {
    throw new TypeError("dst must be a Buffer");
  }
  dst.fill(value, 0, count);
}
