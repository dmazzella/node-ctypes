/**
 * @file primitives.js
 * @module types/primitives
 * @description Primitive C type definitions (integers, floats, chars, pointers).
 *
 * This module provides all primitive C types that extend SimpleCData. Each type
 * defines its size, CType value, and read/write functions for buffer operations.
 *
 * **Type System**:
 * All types use numeric CType values from the native module as their `_type`
 * property. This enables efficient type passing to the native FFI layer without
 * string lookups.
 *
 * **Python ctypes Compatibility**:
 * All types are compatible with Python's ctypes module equivalents.
 *
 * @example Using integer types
 * ```javascript
 * import { c_int32, c_uint64 } from 'node-ctypes';
 *
 * const x = new c_int32(42);
 * console.log(x.value); // 42
 * x.value = -100;
 *
 * const big = new c_uint64(9007199254740991n);
 * console.log(big.value); // 9007199254740991n
 * ```
 *
 * @example Using float types
 * ```javascript
 * import { c_float, c_double } from 'node-ctypes';
 *
 * const pi = new c_float(3.14159);
 * console.log(pi.value); // ~3.1415898799896240 (float precision)
 *
 * const precise = new c_double(3.141592653589793);
 * console.log(precise.value); // 3.141592653589793
 * ```
 *
 * @example Using character types
 * ```javascript
 * import { c_char, c_wchar } from 'node-ctypes';
 *
 * const ch = new c_char('A'.charCodeAt(0));
 * console.log(ch.value); // 65
 *
 * const wide = new c_wchar(0x4E2D); // Chinese character
 * console.log(wide.value); // 20013
 * ```
 *
 * @example Using pointer types
 * ```javascript
 * import { c_void_p, c_char_p } from 'node-ctypes';
 *
 * const ptr = new c_void_p(0x1234n);
 * console.log(ptr.value); // 4660n
 *
 * const str = new c_char_p("Hello");
 * console.log(str.value); // "Hello"
 * ```
 */

/**
 * Creates all primitive type classes with required dependencies injected.
 *
 * Each type class has:
 * - `_size`: Size in bytes
 * - `_type`: CType numeric value (from native.CType)
 * - `_reader`: Function to read value from buffer
 * - `_writer`: Function to write value to buffer
 *
 * @param {Class} SimpleCData - SimpleCData base class
 * @param {Object} native - Native module with POINTER_SIZE and CType
 * @param {Function} addressOf - addressOf function for pointers
 * @param {Function} cstring - cstring function for c_char_p
 * @param {Function} wstring - wstring function for c_wchar_p
 * @param {Function} readCString - readCString function for c_char_p
 * @param {Function} readWString - readWString function for c_wchar_p
 * @returns {Object} Object containing all primitive type classes
 * @private
 */
export function createPrimitiveTypes(SimpleCData, native, addressOf, cstring, wstring, readCString, readWString) {
  // Get CType from native module - single source of truth
  const CType = native.CType;

  // ============================================================================
  // Void type
  // ============================================================================

  class c_void extends SimpleCData {
    static _size = 0;
    static _type = CType.VOID;
    static _reader = (buf, off) => undefined;
    static _writer = (buf, off, val) => {};
  }

  // ============================================================================
  // Integer types - signed
  // ============================================================================

  // Each numeric primitive carries both a default LE _reader/_writer AND BE
  // variants (_readerBE/_writerBE). BigEndianStructure / LittleEndianStructure
  // opt-in via the struct's _swapped_ flag; native-order code is unaffected.
  // For 1-byte types, BE == LE (same Buffer op).

  class c_int8 extends SimpleCData {
    static _size = 1;
    static _type = CType.INT8;
    static _reader = (buf, off) => buf.readInt8(off);
    static _writer = (buf, off, val) => buf.writeInt8(val, off);
    static _readerBE = c_int8._reader;
    static _writerBE = c_int8._writer;
  }

  class c_int16 extends SimpleCData {
    static _size = 2;
    static _type = CType.INT16;
    static _reader = (buf, off) => buf.readInt16LE(off);
    static _writer = (buf, off, val) => buf.writeInt16LE(val, off);
    static _readerBE = (buf, off) => buf.readInt16BE(off);
    static _writerBE = (buf, off, val) => buf.writeInt16BE(val, off);
  }

  class c_int32 extends SimpleCData {
    static _size = 4;
    static _type = CType.INT32;
    static _reader = (buf, off) => buf.readInt32LE(off);
    static _writer = (buf, off, val) => {
      const v = Number(val) | 0; // coerce to signed 32-bit
      return buf.writeInt32LE(v, off);
    };
    static _readerBE = (buf, off) => buf.readInt32BE(off);
    static _writerBE = (buf, off, val) => buf.writeInt32BE(Number(val) | 0, off);
  }

  class c_int64 extends SimpleCData {
    static _size = 8;
    static _type = CType.INT64;
    static _reader = (buf, off) => buf.readBigInt64LE(off);
    static _writer = (buf, off, val) => buf.writeBigInt64LE(BigInt(val), off);
    static _readerBE = (buf, off) => buf.readBigInt64BE(off);
    static _writerBE = (buf, off, val) => buf.writeBigInt64BE(BigInt(val), off);
  }

  // ============================================================================
  // Integer types - unsigned
  // ============================================================================

  class c_uint8 extends SimpleCData {
    static _size = 1;
    static _type = CType.UINT8;
    static _reader = (buf, off) => buf.readUInt8(off);
    static _writer = (buf, off, val) => buf.writeUInt8(val, off);
    static _readerBE = c_uint8._reader;
    static _writerBE = c_uint8._writer;
  }

  class c_uint16 extends SimpleCData {
    static _size = 2;
    static _type = CType.UINT16;
    static _reader = (buf, off) => buf.readUInt16LE(off);
    static _writer = (buf, off, val) => buf.writeUInt16LE(val, off);
    static _readerBE = (buf, off) => buf.readUInt16BE(off);
    static _writerBE = (buf, off, val) => buf.writeUInt16BE(val, off);
  }

  class c_uint32 extends SimpleCData {
    static _size = 4;
    static _type = CType.UINT32;
    static _reader = (buf, off) => buf.readUInt32LE(off);
    static _writer = (buf, off, val) => {
      const v = Number(val) >>> 0; // coerce to unsigned 32-bit
      return buf.writeUInt32LE(v, off);
    };
    static _readerBE = (buf, off) => buf.readUInt32BE(off);
    static _writerBE = (buf, off, val) => buf.writeUInt32BE(Number(val) >>> 0, off);
  }

  class c_uint64 extends SimpleCData {
    static _size = 8;
    static _type = CType.UINT64;
    static _reader = (buf, off) => buf.readBigUInt64LE(off);
    static _writer = (buf, off, val) => buf.writeBigUInt64LE(BigInt(val), off);
    static _readerBE = (buf, off) => buf.readBigUInt64BE(off);
    static _writerBE = (buf, off, val) => buf.writeBigUInt64BE(BigInt(val), off);
  }

  // ============================================================================
  // Floating point types
  // ============================================================================

  class c_float extends SimpleCData {
    static _size = 4;
    static _type = CType.FLOAT;
    static _reader = (buf, off) => buf.readFloatLE(off);
    static _writer = (buf, off, val) => buf.writeFloatLE(val, off);
    static _readerBE = (buf, off) => buf.readFloatBE(off);
    static _writerBE = (buf, off, val) => buf.writeFloatBE(val, off);
  }

  class c_double extends SimpleCData {
    static _size = 8;
    static _type = CType.DOUBLE;
    static _reader = (buf, off) => buf.readDoubleLE(off);
    static _writer = (buf, off, val) => buf.writeDoubleLE(val, off);
    static _readerBE = (buf, off) => buf.readDoubleBE(off);
    static _writerBE = (buf, off, val) => buf.writeDoubleBE(val, off);
  }

  // ============================================================================
  // Boolean type
  // ============================================================================

  class c_bool extends SimpleCData {
    static _size = 1;
    static _type = CType.BOOL;
    static _reader = (buf, off) => buf.readUInt8(off) !== 0;
    static _writer = (buf, off, val) => buf.writeUInt8(val ? 1 : 0, off);
    static _readerBE = c_bool._reader;
    static _writerBE = c_bool._writer;
  }

  // ============================================================================
  // Character types
  // ============================================================================

  class c_char extends SimpleCData {
    static _size = 1;
    static _type = CType.INT8; // char is int8 in C
    static _reader = (buf, off) => buf.readInt8(off);
    static _writer = (buf, off, val) => {
      if (typeof val === "string") val = val.charCodeAt(0);
      buf.writeInt8(val, off);
    };
    static _readerBE = c_char._reader;
    static _writerBE = c_char._writer;
  }

  class c_wchar extends SimpleCData {
    static _size = native.WCHAR_SIZE;
    static _type = CType.WCHAR;
    static _reader = (buf, off) => {
      if (native.WCHAR_SIZE === 2) {
        return String.fromCharCode(buf.readUInt16LE(off));
      }
      return String.fromCodePoint(buf.readUInt32LE(off));
    };
    static _writer = (buf, off, val) => {
      const code = typeof val === "string" ? val.codePointAt(0) : val;
      if (native.WCHAR_SIZE === 2) {
        buf.writeUInt16LE(code, off);
      } else {
        buf.writeUInt32LE(code, off);
      }
    };
    static _readerBE = (buf, off) => {
      if (native.WCHAR_SIZE === 2) {
        return String.fromCharCode(buf.readUInt16BE(off));
      }
      return String.fromCodePoint(buf.readUInt32BE(off));
    };
    static _writerBE = (buf, off, val) => {
      const code = typeof val === "string" ? val.codePointAt(0) : val;
      if (native.WCHAR_SIZE === 2) {
        buf.writeUInt16BE(code, off);
      } else {
        buf.writeUInt32BE(code, off);
      }
    };
  }

  // ============================================================================
  // Pointer types
  // ============================================================================

  class c_void_p extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.POINTER;
    static _reader = (buf, off) => {
      const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
      if (!ptr) return null;
      return ptr;
    };
    static _writer = (buf, off, val) => {
      // Accept Buffers (pointer to memory) and struct proxies with _buffer
      if (Buffer.isBuffer(val)) {
        const addr = addressOf(val);
        const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
        if (native.POINTER_SIZE === 8) buf.writeBigUInt64LE(v, off);
        else buf.writeUInt32LE(Number(v), off);
        return;
      }
      if (val && typeof val === "object" && val._buffer && Buffer.isBuffer(val._buffer)) {
        const addr = addressOf(val._buffer);
        const v = typeof addr === "bigint" ? addr : BigInt(addr || 0);
        if (native.POINTER_SIZE === 8) buf.writeBigUInt64LE(v, off);
        else buf.writeUInt32LE(Number(v), off);
        return;
      }

      // Fallback: accept BigInt or number
      const v = typeof val === "bigint" ? val : BigInt(val || 0);
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(v, off);
      } else {
        buf.writeUInt32LE(Number(v), off);
      }
    };
  }

  // ============================================================================
  // Platform-specific types
  // ============================================================================

  class c_size_t extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.SIZE_T;
    static _reader = (buf, off) => {
      return native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : buf.readUInt32LE(off);
    };
    static _writer = (buf, off, val) => {
      if (native.POINTER_SIZE === 8) {
        buf.writeBigUInt64LE(BigInt(val), off);
      } else {
        buf.writeUInt32LE(Number(val), off);
      }
    };
    static _readerBE = (buf, off) => (native.POINTER_SIZE === 8 ? buf.readBigUInt64BE(off) : buf.readUInt32BE(off));
    static _writerBE = (buf, off, val) => {
      if (native.POINTER_SIZE === 8) buf.writeBigUInt64BE(BigInt(val), off);
      else buf.writeUInt32BE(Number(val), off);
    };
  }

  class c_ssize_t extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.SSIZE_T;
    static _reader = (buf, off) => {
      return native.POINTER_SIZE === 8 ? buf.readBigInt64LE(off) : buf.readInt32LE(off);
    };
    static _writer = (buf, off, val) => {
      if (native.POINTER_SIZE === 8) {
        buf.writeBigInt64LE(BigInt(val), off);
      } else {
        buf.writeInt32LE(Number(val), off);
      }
    };
    static _readerBE = (buf, off) => (native.POINTER_SIZE === 8 ? buf.readBigInt64BE(off) : buf.readInt32BE(off));
    static _writerBE = (buf, off, val) => {
      if (native.POINTER_SIZE === 8) buf.writeBigInt64BE(BigInt(val), off);
      else buf.writeInt32BE(Number(val), off);
    };
  }

  // Get actual long size from native module (4 on Windows, 4 or 8 on Unix depending on arch)
  const _longSize = native.sizeof ? native.sizeof(CType.LONG) : 4;

  class c_long extends SimpleCData {
    static _size = _longSize;
    static _type = CType.LONG;
    static _reader = _longSize === 8 ? (buf, off) => buf.readBigInt64LE(off) : (buf, off) => buf.readInt32LE(off);
    static _writer = _longSize === 8 ? (buf, off, val) => buf.writeBigInt64LE(BigInt(val), off) : (buf, off, val) => buf.writeInt32LE(val, off);
    static _readerBE = _longSize === 8 ? (buf, off) => buf.readBigInt64BE(off) : (buf, off) => buf.readInt32BE(off);
    static _writerBE = _longSize === 8 ? (buf, off, val) => buf.writeBigInt64BE(BigInt(val), off) : (buf, off, val) => buf.writeInt32BE(val, off);
  }

  class c_ulong extends SimpleCData {
    static _size = _longSize;
    static _type = CType.ULONG;
    static _reader = _longSize === 8 ? (buf, off) => buf.readBigUInt64LE(off) : (buf, off) => buf.readUInt32LE(off);
    static _writer = _longSize === 8 ? (buf, off, val) => buf.writeBigUInt64LE(BigInt(val), off) : (buf, off, val) => buf.writeUInt32LE(val, off);
    static _readerBE = _longSize === 8 ? (buf, off) => buf.readBigUInt64BE(off) : (buf, off) => buf.readUInt32BE(off);
    static _writerBE = _longSize === 8 ? (buf, off, val) => buf.writeBigUInt64BE(BigInt(val), off) : (buf, off, val) => buf.writeUInt32BE(val, off);
  }

  // ============================================================================
  // String pointer types (special handling)
  // ============================================================================

  // Keepalive helper: when assigning a JS string (or an arbitrary Buffer) to a
  // c_char_p / c_wchar_p field of a Structure, we convert/reference the backing
  // Buffer and attach it to the struct's underlying Buffer so it outlives the
  // write. Without this the converted Buffer would be GC-eligible immediately
  // after _writer returns, leaving a dangling pointer in the field.
  // This mirrors Python ctypes' `_objects` keepalive mechanism.
  const _stringKeepalive = (targetBuf, off, val) => {
    let keep = targetBuf.__ctypesKeepalive;
    if (!keep) {
      keep = Object.create(null);
      Object.defineProperty(targetBuf, "__ctypesKeepalive", {
        value: keep,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
    keep[off] = val;
  };

  const _writePointerField = (buf, off, val) => {
    const addr = typeof val === "bigint" ? val : BigInt(val || 0);
    if (native.POINTER_SIZE === 8) {
      buf.writeBigUInt64LE(addr, off);
    } else {
      buf.writeUInt32LE(Number(addr), off);
    }
  };

  class c_char_p extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.STRING;
    static _reader = (buf, off) => {
      const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
      if (!ptr) return null;
      return readCString(ptr);
    };
    static _writer = (buf, off, val) => {
      if (typeof val === "string") {
        val = cstring(val);
      }
      if (Buffer.isBuffer(val)) {
        _stringKeepalive(buf, off, val);
        _writePointerField(buf, off, addressOf(val));
      } else if (val == null) {
        _stringKeepalive(buf, off, null);
        _writePointerField(buf, off, 0n);
      } else {
        _stringKeepalive(buf, off, null);
        _writePointerField(buf, off, val);
      }
    };
  }

  class c_wchar_p extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.WSTRING;
    static _reader = (buf, off) => {
      const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
      if (!ptr) return null;
      return readWString(ptr);
    };
    static _writer = (buf, off, val) => {
      if (typeof val === "string") {
        val = wstring(val);
      }
      if (Buffer.isBuffer(val)) {
        _stringKeepalive(buf, off, val);
        _writePointerField(buf, off, addressOf(val));
      } else if (val == null) {
        _stringKeepalive(buf, off, null);
        _writePointerField(buf, off, 0n);
      } else {
        _stringKeepalive(buf, off, null);
        _writePointerField(buf, off, val);
      }
    };
  }

  // ============================================================================
  // Python-compatible aliases
  // ============================================================================

  const c_byte = c_int8;
  const c_ubyte = c_uint8;
  const c_short = c_int16;
  const c_ushort = c_uint16;
  const c_int = c_int32;
  const c_uint = c_uint32;
  const c_longlong = c_int64;
  const c_ulonglong = c_uint64;

  // Return all types
  return {
    // Void
    c_void,
    // Signed integers
    c_int8,
    c_int16,
    c_int32,
    c_int64,
    // Unsigned integers
    c_uint8,
    c_uint16,
    c_uint32,
    c_uint64,
    // Floating point
    c_float,
    c_double,
    // Boolean
    c_bool,
    // Characters
    c_char,
    c_wchar,
    // Pointers
    c_void_p,
    c_char_p,
    c_wchar_p,
    // Platform-specific
    c_size_t,
    c_ssize_t,
    c_long,
    c_ulong,
    // Python-compatible aliases
    c_byte,
    c_ubyte,
    c_short,
    c_ushort,
    c_int,
    c_uint,
    c_longlong,
    c_ulonglong,
  };
}
