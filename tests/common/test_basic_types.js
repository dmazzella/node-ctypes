/**
 * Test Basic Types - Cross Platform
 * Tests all basic C types supported by ctypes
 * Using Python-style SimpleCData classes only
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";

describe("Basic Types", function () {
  describe("Integer Types (Python-style)", function () {
    it("should handle int8 / c_int8", function () {
      const val = new ctypes.c_int8(-128);
      assert.strictEqual(val.value, -128);

      val.value = 127;
      assert.strictEqual(val.value, 127);
    });

    it("should handle uint8 / c_uint8 / c_ubyte", function () {
      const val = new ctypes.c_uint8(0);
      assert.strictEqual(val.value, 0);

      const val2 = new ctypes.c_uint8(255);
      assert.strictEqual(val2.value, 255);
    });

    it("should handle int16 / c_int16 / c_short", function () {
      const val = new ctypes.c_int16(-32768);
      assert.strictEqual(val.value, -32768);

      val.value = 32767;
      assert.strictEqual(val.value, 32767);
    });

    it("should handle uint16 / c_uint16 / c_ushort", function () {
      const val = new ctypes.c_uint16(0);
      assert.strictEqual(val.value, 0);

      const val2 = new ctypes.c_uint16(65535);
      assert.strictEqual(val2.value, 65535);
    });

    it("should handle int32 / c_int32 / c_int", function () {
      const val = new ctypes.c_int32(-2147483648);
      assert.strictEqual(val.value, -2147483648);

      val.value = 2147483647;
      assert.strictEqual(val.value, 2147483647);
    });

    it("should handle uint32 / c_uint32 / c_uint", function () {
      const val = new ctypes.c_uint32(0);
      assert.strictEqual(val.value, 0);

      const val2 = new ctypes.c_uint32(4294967295);
      assert.strictEqual(val2.value, 4294967295);
    });

    it("should handle int64 / c_int64 / c_longlong", function () {
      const val = new ctypes.c_int64(-9223372036854775808n);
      assert.strictEqual(val.value, -9223372036854775808n);

      val.value = 9223372036854775807n;
      assert.strictEqual(val.value, 9223372036854775807n);
    });

    it("should handle uint64 / c_uint64 / c_ulonglong", function () {
      const val = new ctypes.c_uint64(0n);
      assert.strictEqual(val.value, 0n);

      const val2 = new ctypes.c_uint64(18446744073709551615n);
      assert.strictEqual(val2.value, 18446744073709551615n);
    });
  });

  describe("Floating Point Types (Python-style)", function () {
    it("should handle float / c_float", function () {
      const val = new ctypes.c_float(3.14159);
      assert(Math.abs(val.value - 3.14159) < 0.00001);
    });

    it("should handle double / c_double", function () {
      const val = new ctypes.c_double(3.141592653589793);
      assert(Math.abs(val.value - 3.141592653589793) < 0.000000000001);
    });
  });

  describe("Boolean Type (Python-style)", function () {
    it("should handle bool / c_bool", function () {
      const val = new ctypes.c_bool(true);
      assert.strictEqual(val.value, true);

      val.value = false;
      assert.strictEqual(val.value, false);
    });
  });

  describe("Pointer Types (Python-style)", function () {
    it("should handle pointer / c_void_p", function () {
      const val = new ctypes.c_void_p(0x12345678n);
      assert.strictEqual(val.value, 0x12345678n);
    });

    it("should handle size_t / c_size_t", function () {
      const val = new ctypes.c_size_t(1024n);
      assert.strictEqual(val.value, 1024n);
    });
  });

  describe("Platform-dependent Types (Python-style)", function () {
    it("should handle c_long (platform-dependent)", function () {
      const size = ctypes.sizeof(ctypes.c_long);
      assert(size === 4 || size === 8, "c_long should be 4 or 8 bytes");

      if (size === 4) {
        const val = new ctypes.c_long(2147483647);
        assert.strictEqual(val.value, 2147483647);
      } else {
        const val = new ctypes.c_long(9223372036854775807n);
        assert.strictEqual(val.value, 9223372036854775807n);
      }
    });

    it("should handle c_ulong (platform-dependent)", function () {
      const size = ctypes.sizeof(ctypes.c_ulong);
      assert(size === 4 || size === 8, "c_ulong should be 4 or 8 bytes");

      if (size === 4) {
        const val = new ctypes.c_ulong(4294967295);
        assert.strictEqual(val.value, 4294967295);
      } else {
        const val = new ctypes.c_ulong(18446744073709551615n);
        assert.strictEqual(val.value, 18446744073709551615n);
      }
    });
  });

  describe("sizeof() on classes", function () {
    it("should return correct sizes for all type classes", function () {
      assert.strictEqual(ctypes.sizeof(ctypes.c_int8), 1);
      assert.strictEqual(ctypes.sizeof(ctypes.c_uint8), 1);
      assert.strictEqual(ctypes.sizeof(ctypes.c_int16), 2);
      assert.strictEqual(ctypes.sizeof(ctypes.c_uint16), 2);
      assert.strictEqual(ctypes.sizeof(ctypes.c_int32), 4);
      assert.strictEqual(ctypes.sizeof(ctypes.c_uint32), 4);
      assert.strictEqual(ctypes.sizeof(ctypes.c_int64), 8);
      assert.strictEqual(ctypes.sizeof(ctypes.c_uint64), 8);
      assert.strictEqual(ctypes.sizeof(ctypes.c_float), 4);
      assert.strictEqual(ctypes.sizeof(ctypes.c_double), 8);
      assert.strictEqual(ctypes.sizeof(ctypes.c_bool), 1);
      assert.strictEqual(ctypes.sizeof(ctypes.c_void_p), ctypes.POINTER_SIZE);
      assert.strictEqual(ctypes.sizeof(ctypes.c_size_t), ctypes.POINTER_SIZE);
    });

    it("should return correct sizes for instances", function () {
      const val = new ctypes.c_uint64(42n);
      assert.strictEqual(ctypes.sizeof(val), 8);
      assert.strictEqual(val.size, 8);
    });

    it("should support static .size property on classes", function () {
      assert.strictEqual(ctypes.c_uint64.size, 8);
      assert.strictEqual(ctypes.c_int32.size, 4);
      assert.strictEqual(ctypes.c_bool.size, 1);
    });
  });

  describe("byref() with SimpleCData", function () {
    it("should work with SimpleCData instances", function () {
      const val = new ctypes.c_uint32(42);
      const ref = ctypes.byref(val);
      assert(Buffer.isBuffer(ref), "byref should return a Buffer");
      assert.strictEqual(ref.length, 4);
    });

    it("should allow memmove with byref", function () {
      const val = new ctypes.c_int8(-128);
      const buf = ctypes.create_string_buffer(1);
      ctypes.memmove(buf, ctypes.byref(val), 1);
      const result = ctypes.c_int8.from_buffer(buf);
      assert.strictEqual(result.value, -128);
    });
  });

  describe("from_buffer()", function () {
    it("should create instance from buffer (view)", function () {
      const buf = ctypes.create_string_buffer(4);
      ctypes.writeValue(buf, ctypes.c_uint32, 0xdeadbeef);

      const val = ctypes.c_uint32.from_buffer(buf);
      assert.strictEqual(val.value, 0xdeadbeef);

      // Modifying the instance should modify the original buffer
      val.value = 0x12345678;
      assert.strictEqual(ctypes.readValue(buf, ctypes.c_uint32), 0x12345678);
    });

    it("should support offset parameter", function () {
      const buf = ctypes.create_string_buffer(8);
      ctypes.writeValue(buf, ctypes.c_uint32, 0xaabbccdd, 0);
      ctypes.writeValue(buf, ctypes.c_uint32, 0x11223344, 4);

      const val1 = ctypes.c_uint32.from_buffer(buf, 0);
      const val2 = ctypes.c_uint32.from_buffer(buf, 4);

      assert.strictEqual(val1.value, 0xaabbccdd);
      assert.strictEqual(val2.value, 0x11223344);
    });
  });

  describe("from_buffer_copy()", function () {
    it("should create instance from buffer (copy)", function () {
      const buf = ctypes.create_string_buffer(4);
      ctypes.writeValue(buf, ctypes.c_uint32, 0xdeadbeef);

      const val = ctypes.c_uint32.from_buffer_copy(buf);
      assert.strictEqual(val.value, 0xdeadbeef);

      // Modifying the instance should NOT modify the original buffer
      val.value = 0x12345678;
      assert.strictEqual(ctypes.readValue(buf, ctypes.c_uint32), 0xdeadbeef);
    });
  });

  describe("Python-compatible aliases", function () {
    it("should have c_byte = c_int8", function () {
      const val = new ctypes.c_byte(-128);
      assert.strictEqual(val.value, -128);
      assert.strictEqual(ctypes.sizeof(ctypes.c_byte), 1);
    });

    it("should have c_ubyte = c_uint8", function () {
      const val = new ctypes.c_ubyte(255);
      assert.strictEqual(val.value, 255);
    });

    it("should have c_short = c_int16", function () {
      const val = new ctypes.c_short(-32768);
      assert.strictEqual(val.value, -32768);
    });

    it("should have c_ushort = c_uint16", function () {
      const val = new ctypes.c_ushort(65535);
      assert.strictEqual(val.value, 65535);
    });

    it("should have c_longlong = c_int64", function () {
      const val = new ctypes.c_longlong(9223372036854775807n);
      assert.strictEqual(val.value, 9223372036854775807n);
    });

    it("should have c_ulonglong = c_uint64", function () {
      const val = new ctypes.c_ulonglong(18446744073709551615n);
      assert.strictEqual(val.value, 18446744073709551615n);
    });
  });

  describe("Default value", function () {
    it("should initialize to 0 when no value provided", function () {
      const val = new ctypes.c_uint64();
      assert.strictEqual(val.value, 0n);

      const val2 = new ctypes.c_int32();
      assert.strictEqual(val2.value, 0);

      const val3 = new ctypes.c_double();
      assert.strictEqual(val3.value, 0);

      const val4 = new ctypes.c_bool();
      assert.strictEqual(val4.value, false);
    });
  });

  describe("toString() and valueOf()", function () {
    it("should have meaningful toString()", function () {
      const val = new ctypes.c_uint32(42);
      assert.strictEqual(val.toString(), "c_uint32(42)");
    });

    it("should support valueOf() for implicit conversion", function () {
      const val = new ctypes.c_int32(42);
      assert.strictEqual(val + 0, 42);
    });
  });

  describe("readValue and writeValue with SimpleCData", function () {
    it("should work with SimpleCData types", function () {
      const buf = ctypes.create_string_buffer(8);
      ctypes.writeValue(buf, ctypes.c_uint64, 18446744073709551615n);
      assert.strictEqual(
        ctypes.readValue(buf, ctypes.c_uint64),
        18446744073709551615n,
      );
    });
  });
});
