/**
 * Test Basic Types - Cross Platform
 * Tests all basic C types supported by ctypes
 */

import assert, { strictEqual, throws } from "node:assert";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

describe("Basic Types", function () {
  describe("Integer Types", function () {
    it("should handle int8 / c_int8", function () {
      const buf = ctypes.create_string_buffer(1);
      ctypes.writeValue(buf, "int8", -128);
      assert.strictEqual(ctypes.readValue(buf, "int8"), -128);

      ctypes.writeValue(buf, "int8", 127);
      assert.strictEqual(ctypes.readValue(buf, "int8"), 127);
    });

    it("should handle uint8 / c_uint8 / c_ubyte", function () {
      const buf = ctypes.create_string_buffer(1);
      ctypes.writeValue(buf, "uint8", 0);
      assert.strictEqual(ctypes.readValue(buf, "uint8"), 0);

      ctypes.writeValue(buf, "uint8", 255);
      assert.strictEqual(ctypes.readValue(buf, "uint8"), 255);
    });

    it("should handle int16 / c_int16 / c_short", function () {
      const buf = ctypes.create_string_buffer(2);
      ctypes.writeValue(buf, "int16", -32768);
      assert.strictEqual(ctypes.readValue(buf, "int16"), -32768);

      ctypes.writeValue(buf, "int16", 32767);
      assert.strictEqual(ctypes.readValue(buf, "int16"), 32767);
    });

    it("should handle uint16 / c_uint16 / c_ushort", function () {
      const buf = ctypes.create_string_buffer(2);
      ctypes.writeValue(buf, "uint16", 0);
      assert.strictEqual(ctypes.readValue(buf, "uint16"), 0);

      ctypes.writeValue(buf, "uint16", 65535);
      assert.strictEqual(ctypes.readValue(buf, "uint16"), 65535);
    });

    it("should handle int32 / c_int32 / c_int", function () {
      const buf = ctypes.create_string_buffer(4);
      ctypes.writeValue(buf, "int32", -2147483648);
      assert.strictEqual(ctypes.readValue(buf, "int32"), -2147483648);

      ctypes.writeValue(buf, "int32", 2147483647);
      assert.strictEqual(ctypes.readValue(buf, "int32"), 2147483647);
    });

    it("should handle uint32 / c_uint32 / c_uint", function () {
      const buf = ctypes.create_string_buffer(4);
      ctypes.writeValue(buf, "uint32", 0);
      assert.strictEqual(ctypes.readValue(buf, "uint32"), 0);

      ctypes.writeValue(buf, "uint32", 4294967295);
      assert.strictEqual(ctypes.readValue(buf, "uint32"), 4294967295);
    });

    it("should handle int64 / c_int64 / c_longlong", function () {
      const buf = ctypes.create_string_buffer(8);
      ctypes.writeValue(buf, "int64", -9223372036854775808n);
      assert.strictEqual(ctypes.readValue(buf, "int64"), -9223372036854775808n);

      ctypes.writeValue(buf, "int64", 9223372036854775807n);
      assert.strictEqual(ctypes.readValue(buf, "int64"), 9223372036854775807n);
    });

    it("should handle uint64 / c_uint64 / c_ulonglong", function () {
      const buf = ctypes.create_string_buffer(8);
      ctypes.writeValue(buf, "uint64", 0n);
      assert.strictEqual(ctypes.readValue(buf, "uint64"), 0n);

      ctypes.writeValue(buf, "uint64", 18446744073709551615n);
      assert.strictEqual(
        ctypes.readValue(buf, "uint64"),
        18446744073709551615n,
      );
    });
  });

  describe("Floating Point Types", function () {
    it("should handle float / c_float", function () {
      const buf = ctypes.create_string_buffer(4);
      ctypes.writeValue(buf, "float", 3.14159);
      const val = ctypes.readValue(buf, "float");
      assert(Math.abs(val - 3.14159) < 0.00001);
    });

    it("should handle double / c_double", function () {
      const buf = ctypes.create_string_buffer(8);
      ctypes.writeValue(buf, "double", 3.141592653589793);
      const val = ctypes.readValue(buf, "double");
      assert(Math.abs(val - 3.141592653589793) < 0.000000000001);
    });
  });

  describe("Boolean Type", function () {
    it("should handle bool / c_bool", function () {
      const buf = ctypes.create_string_buffer(1);
      ctypes.writeValue(buf, "bool", true);
      assert.strictEqual(ctypes.readValue(buf, "bool"), true);

      ctypes.writeValue(buf, "bool", false);
      assert.strictEqual(ctypes.readValue(buf, "bool"), false);
    });
  });

  describe("Pointer Types", function () {
    it("should handle pointer / c_void_p", function () {
      const buf = ctypes.create_string_buffer(ctypes.POINTER_SIZE);
      const addr = 0x12345678n;
      ctypes.writeValue(buf, "pointer", addr);
      assert.strictEqual(ctypes.readValue(buf, "pointer"), addr);
    });

    it("should handle size_t / c_size_t", function () {
      const buf = ctypes.create_string_buffer(ctypes.POINTER_SIZE);
      const size = 1024n;
      ctypes.writeValue(buf, "size_t", size);
      assert.strictEqual(ctypes.readValue(buf, "size_t"), size);
    });
  });

  describe("Platform-dependent Types", function () {
    it("should handle c_long (platform-dependent)", function () {
      const size = ctypes.sizeof("long");
      assert(size === 4 || size === 8, "c_long should be 4 or 8 bytes");

      const buf = ctypes.create_string_buffer(size);
      const val = size === 4 ? 2147483647 : 9223372036854775807n;
      ctypes.writeValue(buf, "long", val);
      assert.strictEqual(ctypes.readValue(buf, "long"), val);
    });

    it("should handle c_ulong (platform-dependent)", function () {
      const size = ctypes.sizeof("ulong");
      assert(size === 4 || size === 8, "c_ulong should be 4 or 8 bytes");

      const buf = ctypes.create_string_buffer(size);
      const val = size === 4 ? 4294967295 : 18446744073709551615n;
      ctypes.writeValue(buf, "ulong", val);
      assert.strictEqual(ctypes.readValue(buf, "ulong"), val);
    });
  });

  describe("sizeof()", function () {
    it("should return correct sizes for all types", function () {
      assert.strictEqual(ctypes.sizeof("int8"), 1);
      assert.strictEqual(ctypes.sizeof("uint8"), 1);
      assert.strictEqual(ctypes.sizeof("int16"), 2);
      assert.strictEqual(ctypes.sizeof("uint16"), 2);
      assert.strictEqual(ctypes.sizeof("int32"), 4);
      assert.strictEqual(ctypes.sizeof("uint32"), 4);
      assert.strictEqual(ctypes.sizeof("int64"), 8);
      assert.strictEqual(ctypes.sizeof("uint64"), 8);
      assert.strictEqual(ctypes.sizeof("float"), 4);
      assert.strictEqual(ctypes.sizeof("double"), 8);
      assert.strictEqual(ctypes.sizeof("bool"), 1);
      assert.strictEqual(ctypes.sizeof("pointer"), ctypes.POINTER_SIZE);
      assert.strictEqual(ctypes.sizeof("size_t"), ctypes.POINTER_SIZE);
    });
  });
});
