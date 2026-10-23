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

import { mirrorAddress } from "./mirror.js";

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
// ----------------------------------------------------------------------------
// Buffer di caratteri restituiti da create_string_buffer / create_unicode_buffer:
// restano Buffer di Node, con le proprietà `.value` e `.raw` degli array di
// c_char / c_wchar di Python. Prototipi condivisi derivati da Buffer.prototype.
// ----------------------------------------------------------------------------

// Stringa senza terminatore in wchar_t (UTF-16LE o UTF-32LE).
export function encodeWide(str, wcharSize) {
  if (wcharSize === 2) {
    return Buffer.from(str, "utf16le");
  }
  const codePoints = Array.from(str, (ch) => ch.codePointAt(0));
  const buf = Buffer.alloc(codePoints.length * 4);
  codePoints.forEach((cp, i) => buf.writeUInt32LE(cp, i * 4));
  return buf;
}

export function decodeWide(buf, wcharSize) {
  if (wcharSize === 2) {
    let end = 0;
    while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
    return buf.toString("utf16le", 0, end);
  }
  let out = "";
  for (let off = 0; off + 3 < buf.length; off += 4) {
    const cp = buf.readUInt32LE(off);
    if (cp === 0) break;
    out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
  }
  return out;
}

// Python: assegnare .value copia i byte e aggiunge il terminatore se c'è spazio;
// assegnare .raw copia i byte senza terminatore. Più lungo del buffer → errore.
function assignChars(buf, bytes, terminate, message) {
  if (bytes.length > buf.length) {
    throw new RangeError(message);
  }
  bytes.copy(buf);
  if (terminate && bytes.length < buf.length) {
    buf[bytes.length] = 0;
  }
}

const toBytes = (value) => (Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));

// Sottoclassi di Uint8Array con prototipo agganciato a Buffer.prototype, come
// il FastBuffer interno di Node: instanceof Buffer / Buffer.isBuffer restano
// veri e l'allocazione non passa da Object.setPrototypeOf. Le classi sono
// dichiarate con il loro nome: ridefinire `name` dopo rallenta `new` in V8.
function makeBufferClass(BufferClass, properties) {
  Object.setPrototypeOf(BufferClass.prototype, Buffer.prototype);
  Object.defineProperties(BufferClass.prototype, properties);
  return BufferClass;
}

const CharBuffer = makeBufferClass(class CharBuffer extends Uint8Array {}, {
  value: {
    get() {
      const end = this.indexOf(0);
      return this.toString("utf8", 0, end === -1 ? this.length : end);
    },
    set(value) {
      assignChars(this, toBytes(value), true, "byte string too long");
    },
  },
  raw: {
    get() {
      return Buffer.from(this);
    },
    set(value) {
      assignChars(this, toBytes(value), false, "byte string too long");
    },
  },
});

function makeWideBufferClass(wcharSize) {
  return makeBufferClass(class WideBuffer extends Uint8Array {}, {
    value: {
      get() {
        return decodeWide(this, wcharSize);
      },
      set(value) {
        const units = encodeWide(String(value), wcharSize);
        assignChars(this, units, false, "string too long");
        if (units.length + wcharSize <= this.length) {
          this.fill(0, units.length, units.length + wcharSize);
        }
      },
    },
  });
}

const WideBuffer2 = makeWideBufferClass(2);
const WideBuffer4 = makeWideBufferClass(4);

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
 * - `create_string_buffer(init, size)` - Buffer of `size` bytes initialized with `init`
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.create_string_buffer()`. The result is a
 * Node Buffer with Python's `.value` (string up to the first NUL) and `.raw`
 * (copy of all bytes) properties, both assignable.
 *
 * @param {number|string|Buffer} init - Size, string, or buffer to copy
 * @param {number} [size] - Buffer size in bytes (default: length of `init` + 1)
 * @returns {Buffer} Created buffer
 * @throws {TypeError} If init is not number, string, or Buffer
 * @throws {RangeError} If `init` is longer than `size`
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
export function create_string_buffer(init, size) {
  let bytes = null;
  if (typeof init === "number") {
    size = init;
  } else if (typeof init === "string") {
    bytes = Buffer.from(init, "utf8");
  } else if (Buffer.isBuffer(init)) {
    bytes = init;
  } else {
    throw new TypeError("create_string_buffer requires number, string, or Buffer");
  }
  if (bytes !== null) {
    if (size === undefined) {
      size = bytes.length + 1;
    } else if (bytes.length > size) {
      throw new RangeError("byte string too long");
    }
  }
  const buf = new CharBuffer(size);
  if (bytes !== null) {
    bytes.copy(buf);
  }
  return buf;
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
 * @param {number} [size] - Buffer size in characters (default: length of `init` + 1)
 * @param {Object} native - Native module reference (provides WCHAR_SIZE)
 * @returns {Buffer} Created wide string buffer, with Python's `.value` property
 * @throws {TypeError} If init is not number or string
 * @throws {RangeError} If `init` is longer than `size`
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
export function create_unicode_buffer(init, size, native) {
  const wcharSize = native.WCHAR_SIZE;
  let units = null;
  if (typeof init === "number") {
    size = init;
  } else if (typeof init === "string") {
    units = encodeWide(init, wcharSize);
  } else {
    throw new TypeError("create_unicode_buffer requires number or string");
  }
  if (units !== null) {
    const count = units.length / wcharSize;
    if (size === undefined) {
      size = count + 1;
    } else if (count > size) {
      throw new RangeError("string too long");
    }
  }
  const buf = wcharSize === 2 ? new WideBuffer2(size * 2) : new WideBuffer4(size * 4);
  if (units !== null) {
    units.copy(buf);
  }
  return buf;
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
  return native.readCString(stringSource(address, native), size);
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
  return native.readWString(stringSource(address, native), size);
}

/**
 * Source of string_at / wstring_at, as Python's c_void_p.from_param: the
 * memory of instances and arrays, the value of pointers, c_void_p, c_char_p
 * and c_wchar_p, `_as_parameter_`. Buffer or address; NULL gives null.
 */
function stringSource(value, native) {
  if (value === null || value === undefined || typeof value === "bigint" || typeof value === "number") return value;
  // Array proxies pass Buffer.isBuffer but are resolved through _buffer.
  if (Buffer.isBuffer(value) && value._buffer === undefined) return mirrorAddress(value) ?? value;
  const memory = memoryOf(value, native, "address", true);
  return memory instanceof Uint8Array && !Buffer.isBuffer(memory) ? Buffer.from(memory.buffer, memory.byteOffset, memory.byteLength) : memory;
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
  const to = memoryOf(dst, native, "dst");
  const from = memoryOf(src, native, "src");
  // Come Buffer.copy, la copia si ferma alla fine dei Buffer coinvolti.
  let n = count;
  if (typeof to !== "bigint") n = Math.min(n, to.length);
  if (typeof from !== "bigint") n = Math.min(n, from.length);
  if (n <= 0) return;
  // TypedArray.set gestisce anche la sovrapposizione (stesso ArrayBuffer).
  if (typeof to !== "bigint" && typeof from !== "bigint") to.set(n === from.length ? from : from.subarray(0, n));
  else native.memmove(to, from, n);
}

// Memoria di un argomento di memmove/memset, come Python: Buffer, ogni
// TypedArray/DataView/ArrayBuffer (come vista a byte), istanze ctypes (struct,
// array, c_*), puntatori o un indirizzo (BigInt/number).
// Gli indirizzi (anche quello originale di una copia, memory/mirror.js) sono
// letti e scritti dal nativo, senza creare un Buffer esterno.
function memoryOf(value, native, name, allowNull = false) {
  if (value !== null && typeof value === "object") {
    // c_void_p / c_char_p / c_wchar_p: the memory they point to, as in Python.
    const T = value.constructor;
    if (T?._isSimpleCData === true && (T._type === native.CType.POINTER || T._type === native.CType.STRING || T._type === native.CType.WSTRING)) {
      const slot = value._buffer;
      return addressOrNull(native.POINTER_SIZE === 8 ? slot.readBigUInt64LE(0) : BigInt(slot.readUInt32LE(0)), name, allowNull);
    }
    if (Buffer.isBuffer(value._buffer)) return mirrorAddress(value._buffer) ?? value._buffer;
    if (value._pointerType !== undefined) return addressOrNull(value.address, name, allowNull);
    if (ArrayBuffer.isView(value)) {
      return mirrorAddress(value) ?? (value instanceof Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer === "function" && value instanceof SharedArrayBuffer)) {
      return new Uint8Array(value);
    }
    if (value._as_parameter_ !== undefined) return memoryOf(value._as_parameter_, native, name, allowNull);
  }
  if (typeof value === "bigint" || typeof value === "number") return addressOrNull(value, name, allowNull);
  if (allowNull && value === null) return null;
  throw new TypeError(`${name} must be a Buffer, a ctypes instance, a pointer or an address`);
}

function addressOrNull(value, name, allowNull = false) {
  if (!value) {
    if (allowNull) return null;
    throw new TypeError(`${name} is a NULL pointer`);
  }
  return BigInt(value);
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
export function memset(dst, value, count, native) {
  const to = memoryOf(dst, native, "dst");
  if (typeof to !== "bigint") {
    // Come memmove, si ferma alla fine della memoria JS.
    to.fill(value, 0, Math.max(0, Math.min(count, to.length)));
  } else if (count > 0) {
    native.memmove(to, Buffer.alloc(count, value), count);
  }
}
