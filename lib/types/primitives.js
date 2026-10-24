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
 * const ch = new c_char('A'); // Python: c_char(b'A')
 * console.log(ch.value); // 'A'
 *
 * const wide = new c_wchar(0x4E2D); // Chinese character
 * console.log(wide.value); // '中'
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

import { booleanValue, keepAlive, notIntegral, registerSimpleType } from "../structures/helpers/common.js";

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

  // Python: un intero è troncato ai bit del tipo (c_uint8(256) → 0,
  // c_int64(2**64 + 7) → 7). Signed e unsigned hanno gli stessi bit, quindi i
  // writer (tranne c_int32, più veloce con writeInt32) scrivono la
  // rappresentazione senza segno. Number via ToInt32/ToUint32 (esatti per ogni
  // double), BigInt via asIntN/asUintN.
  // Il caso number è testato per primo: è il percorso caldo dei campi.
  // Un number non intero è un float, che Python rifiuta per i tipi interi.
  const integerBoolean = (val) => {
    if (typeof val === "boolean") return +val;
    throw new TypeError(`'${typeName(val)}' object cannot be interpreted as an integer`);
  };
  const u32 = (val) => (typeof val === "number" ? (Number.isInteger(val) ? val >>> 0 : notIntegral()) : typeof val === "bigint" ? Number(BigInt.asUintN(32, val)) : integerBoolean(val));
  const i32 = (val) => (typeof val === "number" ? (Number.isInteger(val) ? val | 0 : notIntegral()) : typeof val === "bigint" ? Number(BigInt.asIntN(32, val)) : integerBoolean(val));
  const u64 = (val) => BigInt.asUintN(64, typeof val === "bigint" ? val : typeof val === "number" ? (Number.isInteger(val) ? BigInt(val) : notIntegral()) : BigInt(integerBoolean(val)));
  const real = (val) => {
    if (typeof val === "number") return val;
    if (typeof val === "boolean") return +val;
    if (typeof val === "bigint") {
      if (val < -(2n ** 63n) || val >= 2n ** 64n) throw new RangeError("BigInt out of range for a floating point argument");
      return Number(val);
    }
    throw new TypeError(`must be real number, not ${typeName(val)}`);
  };
  const writeU8 = (buf, off, val) => {
    buf[off] = u32(val);
  };
  // Interi a 64 bit: un number intero sicuro (il caso comune) è scritto come
  // due metà a 32 bit, senza passare da BigInt (~10x più lento).
  const TWO_32 = 4294967296;
  const writeU64LE = (buf, off, val) => {
    if (typeof val === "number" && Number.isSafeInteger(val) && off + 8 <= buf.length) {
      buf.writeUInt32LE(val >>> 0, off);
      buf.writeUInt32LE(Math.floor(val / TWO_32) >>> 0, off + 4);
    } else {
      buf.writeBigUInt64LE(u64(val), off);
    }
  };
  const writeU64BE = (buf, off, val) => {
    if (typeof val === "number" && Number.isSafeInteger(val) && off + 8 <= buf.length) {
      buf.writeUInt32BE(Math.floor(val / TWO_32) >>> 0, off);
      buf.writeUInt32BE(val >>> 0, off + 4);
    } else {
      buf.writeBigUInt64BE(u64(val), off);
    }
  };

  // Each numeric primitive carries both a default LE _reader/_writer AND BE
  // variants (_readerBE/_writerBE). BigEndianStructure / LittleEndianStructure
  // opt-in via the struct's _swapped_ flag; native-order code is unaffected.
  // For 1-byte types, BE == LE (same Buffer op).

  class c_int8 extends SimpleCData {
    static _size = 1;
    static _type = CType.INT8;
    static _signed = true;
    static _reader = (buf, off) => buf.readInt8(off);
    static _writer = writeU8;
    static _readerBE = c_int8._reader;
    static _writerBE = c_int8._writer;
  }

  class c_int16 extends SimpleCData {
    static _size = 2;
    static _type = CType.INT16;
    static _signed = true;
    static _reader = (buf, off) => buf.readInt16LE(off);
    static _writer = (buf, off, val) => buf.writeUInt16LE(u32(val) & 0xffff, off);
    static _readerBE = (buf, off) => buf.readInt16BE(off);
    static _writerBE = (buf, off, val) => buf.writeUInt16BE(u32(val) & 0xffff, off);
  }

  class c_int32 extends SimpleCData {
    static _size = 4;
    static _type = CType.INT32;
    static _signed = true;
    static _reader = (buf, off) => buf.readInt32LE(off);
    static _writer = (buf, off, val) => buf.writeInt32LE(i32(val), off);
    static _readerBE = (buf, off) => buf.readInt32BE(off);
    static _writerBE = (buf, off, val) => buf.writeInt32BE(i32(val), off);
  }

  class c_int64 extends SimpleCData {
    static _size = 8;
    static _type = CType.INT64;
    static _signed = true;
    static _reader = (buf, off) => buf.readBigInt64LE(off);
    static _writer = writeU64LE;
    static _readerBE = (buf, off) => buf.readBigInt64BE(off);
    static _writerBE = writeU64BE;
  }

  // ============================================================================
  // Integer types - unsigned
  // ============================================================================

  class c_uint8 extends SimpleCData {
    static _size = 1;
    static _type = CType.UINT8;
    static _reader = (buf, off) => buf.readUInt8(off);
    static _writer = writeU8;
    static _readerBE = c_uint8._reader;
    static _writerBE = c_uint8._writer;
  }

  class c_uint16 extends SimpleCData {
    static _size = 2;
    static _type = CType.UINT16;
    static _reader = (buf, off) => buf.readUInt16LE(off);
    static _writer = (buf, off, val) => buf.writeUInt16LE(u32(val) & 0xffff, off);
    static _readerBE = (buf, off) => buf.readUInt16BE(off);
    static _writerBE = (buf, off, val) => buf.writeUInt16BE(u32(val) & 0xffff, off);
  }

  class c_uint32 extends SimpleCData {
    static _size = 4;
    static _type = CType.UINT32;
    static _reader = (buf, off) => buf.readUInt32LE(off);
    static _writer = (buf, off, val) => buf.writeUInt32LE(u32(val), off);
    static _readerBE = (buf, off) => buf.readUInt32BE(off);
    static _writerBE = (buf, off, val) => buf.writeUInt32BE(u32(val), off);
  }

  class c_uint64 extends SimpleCData {
    static _size = 8;
    static _type = CType.UINT64;
    static _reader = (buf, off) => buf.readBigUInt64LE(off);
    static _writer = writeU64LE;
    static _readerBE = (buf, off) => buf.readBigUInt64BE(off);
    static _writerBE = writeU64BE;
  }

  // ============================================================================
  // Floating point types
  // ============================================================================

  class c_float extends SimpleCData {
    static _size = 4;
    static _type = CType.FLOAT;
    static _reader = (buf, off) => buf.readFloatLE(off);
    static _writer = (buf, off, val) => buf.writeFloatLE(real(val), off);
    static _readerBE = (buf, off) => buf.readFloatBE(off);
    static _writerBE = (buf, off, val) => buf.writeFloatBE(real(val), off);
  }

  class c_double extends SimpleCData {
    static _size = 8;
    static _type = CType.DOUBLE;
    static _reader = (buf, off) => buf.readDoubleLE(off);
    static _writer = (buf, off, val) => buf.writeDoubleLE(real(val), off);
    static _readerBE = (buf, off) => buf.readDoubleBE(off);
    static _writerBE = (buf, off, val) => buf.writeDoubleBE(real(val), off);
  }

  // ============================================================================
  // Boolean type
  // ============================================================================

  class c_bool extends SimpleCData {
    static _size = 1;
    static _type = CType.BOOL;
    static _isBoolean = true;
    static _reader = (buf, off) => buf.readUInt8(off) !== 0;
    static _writer = (buf, off, val) => buf.writeUInt8(booleanValue(val) ? 1 : 0, off);
    static _readerBE = c_bool._reader;
    static _writerBE = c_bool._writer;
  }

  // ============================================================================
  // Character types
  // ============================================================================

  // Python c_char: il valore è un bytes di 1 byte; in JS una stringa di 1
  // carattere con codice 0-255. In scrittura accetta anche un numero o un Buffer.
  // Python ctypes accetta solo un singolo carattere (o un intero 0..255 per c_char).
  const typeName = (val) => {
    if (val === null) return "null";
    if (Buffer.isBuffer(val)) return "Buffer";
    if (typeof val === "object") return val.constructor?.name || "object";
    return typeof val;
  };

  const CHAR_EXPECTED = "one character bytes, bytearray, or an integer in range(256) expected";
  const charCode = (val) => {
    if (typeof val === "string") {
      if (val.length !== 1) throw new TypeError(`${CHAR_EXPECTED}, not a string of length ${val.length}`);
      const code = val.charCodeAt(0);
      if (code > 0xff) throw new TypeError("character not in range(256)");
      return code;
    }
    if (val instanceof Uint8Array) {
      if (val.length !== 1) throw new TypeError(`${CHAR_EXPECTED}, not ${typeName(val)} of length ${val.length}`);
      return val[0];
    }
    if (typeof val === "number" && Number.isInteger(val)) {
      if (val < 0 || val > 0xff) throw new TypeError("integer not in range(256)");
      return val;
    }
    if (typeof val === "boolean") return val ? 1 : 0;
    throw new TypeError(`${CHAR_EXPECTED}, not ${typeName(val)}`);
  };

  // Python c_wchar: un solo carattere. Dove wchar_t è a 16 bit un carattere
  // fuori dal BMP occupa due wchar_t e non è accettato.
  const WCHAR_LIMIT = native.WCHAR_SIZE === 2 ? 0x10000 : 0x110000;
  const wcharCode = (val) => {
    if (typeof val === "string") {
      const code = val.codePointAt(0);
      let length = val.length;
      if (length === 2 && code > 0xffff && code < WCHAR_LIMIT) length = 1;
      if (length !== 1) throw new TypeError(`a unicode character expected, not a string of length ${length}`);
      return code;
    }
    if (typeof val === "number") {
      if (Number.isInteger(val) && val >= 0 && val < WCHAR_LIMIT) return val;
      throw new TypeError(`wchar_t code point not in range(0x${WCHAR_LIMIT.toString(16)})`);
    }
    throw new TypeError(`a unicode character expected, not instance of ${typeName(val)}`);
  };

  const wcharString = (code) => String.fromCodePoint(code > 0x10ffff ? 0xfffd : code);

  class c_char extends SimpleCData {
    static _size = 1;
    static _type = CType.CHAR;
    static _charKind = "char";
    static _reader = (buf, off) => String.fromCharCode(buf.readUInt8(off));
    static _writer = (buf, off, val) => {
      buf.writeUInt8(charCode(val), off);
    };
    static _readerBE = c_char._reader;
    static _writerBE = c_char._writer;
  }

  class c_wchar extends SimpleCData {
    static _size = native.WCHAR_SIZE;
    static _type = CType.WCHAR;
    static _charKind = "wchar";
    static _reader = (buf, off) => {
      if (native.WCHAR_SIZE === 2) {
        return String.fromCharCode(buf.readUInt16LE(off));
      }
      return wcharString(buf.readUInt32LE(off));
    };
    static _writer = (buf, off, val) => {
      const code = wcharCode(val);
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
      return wcharString(buf.readUInt32BE(off));
    };
    static _writerBE = (buf, off, val) => {
      const code = wcharCode(val);
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
    static _isPointerValued = true;
    // Campi c_void_p: anche istanze c_char_p / c_wchar_p (il loro indirizzo).
    static _acceptsPointerValues = true;
    static _reader = (buf, off) => {
      const ptr = native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : BigInt(buf.readUInt32LE(off));
      if (!ptr) return null;
      return ptr;
    };
    static _writer = (buf, off, val) => {
      const address = voidPointerAddress(val);
      if (native.POINTER_SIZE === 8) buf.writeBigUInt64LE(address, off);
      else buf.writeUInt32LE(Number(address), off);
      // La memoria assegnata resta viva con il buffer (Python `_objects`).
      keepAlive(buf, off, val !== null && typeof val === "object" ? val : null);
    };
  }

  // Indirizzo assegnato a un c_void_p: memoria di Buffer e istanze, valore di
  // puntatori, c_void_p / c_char_p / c_wchar_p e `_as_parameter_`.
  function voidPointerAddress(val) {
    if (typeof val === "bigint") return val;
    if (val === null || val === undefined) return 0n;
    if (typeof val === "object") {
      if (val._pointerType !== undefined) return val.address;
      const T = val.constructor;
      if (T?._isSimpleCData === true && (T._type === CType.POINTER || T._type === CType.STRING || T._type === CType.WSTRING)) {
        return native.POINTER_SIZE === 8 ? val._buffer.readBigUInt64LE(0) : BigInt(val._buffer.readUInt32LE(0));
      }
      if (Buffer.isBuffer(val) || Buffer.isBuffer(val._buffer)) return BigInt(addressOf(val));
      if (val._as_parameter_ !== undefined) return voidPointerAddress(val._as_parameter_);
      throw new TypeError("c_void_p: cannot be converted to pointer");
    }
    return BigInt(val);
  }

  // ============================================================================
  // Platform-specific types
  // ============================================================================

  // Interi pointer-sized e long: stessi writer troncanti degli interi a 32/64 bit.
  const writeWord = (size) => (size === 8 ? writeU64LE : (buf, off, val) => buf.writeUInt32LE(u32(val), off));
  const writeWordBE = (size) => (size === 8 ? writeU64BE : (buf, off, val) => buf.writeUInt32BE(u32(val), off));

  class c_size_t extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.SIZE_T;
    static _reader = (buf, off) => {
      return native.POINTER_SIZE === 8 ? buf.readBigUInt64LE(off) : buf.readUInt32LE(off);
    };
    static _writer = writeWord(native.POINTER_SIZE);
    static _readerBE = (buf, off) => (native.POINTER_SIZE === 8 ? buf.readBigUInt64BE(off) : buf.readUInt32BE(off));
    static _writerBE = writeWordBE(native.POINTER_SIZE);
  }

  class c_ssize_t extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.SSIZE_T;
    static _signed = true;
    static _reader = (buf, off) => {
      return native.POINTER_SIZE === 8 ? buf.readBigInt64LE(off) : buf.readInt32LE(off);
    };
    static _writer = writeWord(native.POINTER_SIZE);
    static _readerBE = (buf, off) => (native.POINTER_SIZE === 8 ? buf.readBigInt64BE(off) : buf.readInt32BE(off));
    static _writerBE = writeWordBE(native.POINTER_SIZE);
  }

  // Get actual long size from native module (4 on Windows, 4 or 8 on Unix depending on arch)
  const _longSize = native.sizeof ? native.sizeof(CType.LONG) : 4;

  // c_long / c_ulong valgono BigInt su ogni piattaforma, anche dove `long` è a
  // 32 bit (Windows): stesso tipo JS per ritorni, campi e `.value` ovunque.
  // In scrittura accettano number e BigInt (troncato ai bit del tipo, come Python).
  class c_long extends SimpleCData {
    static _size = _longSize;
    static _type = CType.LONG;
    static _signed = true;
    static _reader = _longSize === 8 ? (buf, off) => buf.readBigInt64LE(off) : (buf, off) => BigInt(buf.readInt32LE(off));
    static _writer = writeWord(_longSize);
    static _readerBE = _longSize === 8 ? (buf, off) => buf.readBigInt64BE(off) : (buf, off) => BigInt(buf.readInt32BE(off));
    static _writerBE = writeWordBE(_longSize);
  }

  class c_ulong extends SimpleCData {
    static _size = _longSize;
    static _type = CType.ULONG;
    static _reader = _longSize === 8 ? (buf, off) => buf.readBigUInt64LE(off) : (buf, off) => BigInt(buf.readUInt32LE(off));
    static _writer = writeWord(_longSize);
    static _readerBE = _longSize === 8 ? (buf, off) => buf.readBigUInt64BE(off) : (buf, off) => BigInt(buf.readUInt32BE(off));
    static _writerBE = writeWordBE(_longSize);
  }

  // ============================================================================
  // String pointer types (special handling)
  // ============================================================================

  // Keepalive: when assigning a JS string (or an arbitrary Buffer) to a
  // c_char_p / c_wchar_p field, the converted Buffer is kept alive with the
  // memory of the structure (see keepAlive), otherwise the field would point
  // to collected memory. This mirrors Python ctypes' `_objects`.
  const _stringKeepalive = keepAlive;

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
    static _isPointerValued = true;
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
        _writePointerField(buf, off, addressOf(val));
        _stringKeepalive(buf, off, val);
      } else if (val == null) {
        _writePointerField(buf, off, 0n);
        _stringKeepalive(buf, off, null);
      } else {
        _writePointerField(buf, off, val);
        _stringKeepalive(buf, off, null);
      }
    };
  }

  class c_wchar_p extends SimpleCData {
    static _size = native.POINTER_SIZE;
    static _type = CType.WSTRING;
    static _isPointerValued = true;
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
        _writePointerField(buf, off, addressOf(val));
        _stringKeepalive(buf, off, val);
      } else if (val == null) {
        _writePointerField(buf, off, 0n);
        _stringKeepalive(buf, off, null);
      } else {
        _writePointerField(buf, off, val);
        _stringKeepalive(buf, off, null);
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
  const types = {
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
  for (const type of Object.values(types)) registerSimpleType(type);
  return types;
}
