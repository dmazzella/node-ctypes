/**
 * Test Basic Types - Cross Platform
 * Tests all basic C types supported by ctypes
 * Using Python-style SimpleCData classes only
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { platform } from "node:os";

describe("Basic Types", function () {
  describe("Character Pointer Type (Python-style)", function () {
    it("should handle char_p / c_char_p", function () {
      const val = new ctypes.c_char_p("Hello, World!");
      assert.strictEqual(val.value, "Hello, World!");

      const val2 = new ctypes.c_char_p("");
      assert.strictEqual(val2.value, "");
    });

    it("should handle null char_p", function () {
      const val = new ctypes.c_char_p(null);
      assert.strictEqual(val.value, null);
    });

    it("should allow modifying c_char_p value", function () {
      const val = new ctypes.c_char_p("Initial Value");
      assert.strictEqual(val.value, "Initial Value");
      val.value = "Modified Value";
      assert.strictEqual(val.value, "Modified Value");
    });
  });

  describe("Wide Character Pointer Type (Python-style)", function () {
    it("should handle wchar_p / c_wchar_p", function () {
      const val = new ctypes.c_wchar_p("Hello, Wide World!");
      assert.strictEqual(val.value, "Hello, Wide World!");

      const val2 = new ctypes.c_wchar_p("");
      assert.strictEqual(val2.value, "");
    });

    it("should handle null wchar_p", function () {
      const val = new ctypes.c_wchar_p(null);
      assert.strictEqual(val.value, null);
    });

    it("should allow modifying c_wchar_p value", function () {
      const val = new ctypes.c_wchar_p("Initial Wide Value");
      assert.strictEqual(val.value, "Initial Wide Value");
      val.value = "Modified Wide Value";
      assert.strictEqual(val.value, "Modified Wide Value");
    });
  });

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
      // Python: ref = byref(x); assertIsNotNone(ref)
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

    it("should work with struct instances", function () {
      // Python: ref = byref(pt); assertIsNotNone(ref)
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const pt = new Point(10, 20);
      const ref = ctypes.byref(pt);
      assert(Buffer.isBuffer(ref));
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
      assert.strictEqual(ctypes.readValue(buf, ctypes.c_uint64), 18446744073709551615n);
    });
  });

  // ─── c_ssize_t ───
  // Python: from ctypes import c_ssize_t

  describe("c_ssize_t type", function () {
    it("should store positive values", function () {
      // Python: v = c_ssize_t(42); assertEqual(v.value, 42)
      const v = new ctypes.c_ssize_t(42);
      assert.strictEqual(v.value, ctypes.POINTER_SIZE === 8 ? 42n : 42);
    });

    it("should store negative values", function () {
      // Python: v = c_ssize_t(-42); assertEqual(v.value, -42)
      const v = new ctypes.c_ssize_t(-42);
      assert.strictEqual(v.value, ctypes.POINTER_SIZE === 8 ? -42n : -42);
    });

    it("should have same size as c_size_t", function () {
      // Python: assertEqual(sizeof(c_ssize_t), sizeof(c_size_t))
      assert.strictEqual(ctypes.sizeof(ctypes.c_ssize_t), ctypes.sizeof(ctypes.c_size_t));
    });

    it("should have same size as pointer", function () {
      // Python: assertEqual(sizeof(c_ssize_t), sizeof(c_void_p))
      assert.strictEqual(ctypes.sizeof(ctypes.c_ssize_t), ctypes.sizeof(ctypes.c_void_p));
    });

    it("should handle large positive value", function () {
      const v = new ctypes.c_ssize_t(2 ** 31 - 1);
      assert.strictEqual(v.value, ctypes.POINTER_SIZE === 8 ? BigInt(2 ** 31 - 1) : 2 ** 31 - 1);
    });

    it("should handle large negative value", function () {
      const v = new ctypes.c_ssize_t(-(2 ** 31));
      assert.strictEqual(v.value, ctypes.POINTER_SIZE === 8 ? BigInt(-(2 ** 31)) : -(2 ** 31));
    });

    it("should work in struct field", function () {
      // Python: class S(Structure): _fields_ = [("len", c_ssize_t)]
      class S extends ctypes.Structure {
        static _fields_ = [["len", ctypes.c_ssize_t]];
      }
      const s = new S(-100);
      assert.strictEqual(s.len, ctypes.POINTER_SIZE === 8 ? -100n : -100);
    });
  });

  // ─── alignment() ───
  // Python: from ctypes import alignment

  describe("alignment() function", function () {
    it("should return correct alignment for primitive types", function () {
      // Python: assertEqual(alignment(c_uint8), 1)
      assert.strictEqual(ctypes.alignment(ctypes.c_uint8), 1);
      assert.strictEqual(ctypes.alignment(ctypes.c_int32), 4);
      assert.strictEqual(ctypes.alignment(ctypes.c_double), 8);
    });

    it("should return correct alignment for pointer type", function () {
      // Python: expected = 8 if struct.calcsize("P") == 8 else 4
      assert.strictEqual(ctypes.alignment(ctypes.c_void_p), ctypes.POINTER_SIZE === 8 ? 8 : 4);
    });

    it("should return correct alignment for Structure", function () {
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      assert.strictEqual(ctypes.alignment(Point), 4);
    });

    it("should return correct alignment for Structure with mixed types", function () {
      class Mixed extends ctypes.Structure {
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_double]];
      }
      assert.strictEqual(ctypes.alignment(Mixed), 8);
    });

    it("should return correct alignment for array type", function () {
      // Python: alignment(c_int32 * 4)
      const IntArray = ctypes.array(ctypes.c_int32, 4);
      assert.strictEqual(ctypes.alignment(IntArray), 4);
    });

    it("should work on SimpleCData instance", function () {
      // Python: alignment(c_int32(42)) == 4
      const v = new ctypes.c_int32(42);
      assert.strictEqual(ctypes.alignment(v), 4);
    });

    it("should work on Structure instance", function () {
      // Python: alignment(Point(1, 2)) == 4
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const p = new Point(1, 2);
      assert.strictEqual(ctypes.alignment(p), 4);
    });

    it("should throw for invalid argument", function () {
      // Python: assertRaises(TypeError)
      assert.throws(() => ctypes.alignment(42), /TypeError/);
      assert.throws(() => ctypes.alignment("string"), /TypeError/);
      assert.throws(() => ctypes.alignment(null), /TypeError/);
    });
  });

  // ─── pointer() ───
  // Python: from ctypes import pointer

  describe("pointer() function", function () {
    it("should create pointer to int", function () {
      // Python: x = c_int32(42); p = pointer(x); assertEqual(p[0], 42)
      const x = new ctypes.c_int32(42);
      const p = ctypes.pointer(x);
      assert.strictEqual(p.isNull, false);
      assert.strictEqual(p[0], 42);
      assert.strictEqual(p.contents, 42);
    });

    it("should modify through pointer changes original", function () {
      // Python: p[0] = 100; assertEqual(x.value, 100)
      const x = new ctypes.c_int32(42);
      const p = ctypes.pointer(x);
      p[0] = 100;
      assert.strictEqual(x.value, 100);
    });

    it("should write value via contents setter", function () {
      // Python: p.contents = c_int32(99)
      const x = new ctypes.c_int32(42);
      const p = ctypes.pointer(x);
      p.contents = 99;
      assert.strictEqual(p.contents, 99);
      assert.strictEqual(x.value, 99);
    });

    it("should create pointer to struct", function () {
      // Python: pt = Point(10,20); p = pointer(pt); assertEqual(p.contents.x, 10)
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const pt = new Point(10, 20);
      const p = ctypes.pointer(pt);
      assert.strictEqual(p.contents.x, 10);
      assert.strictEqual(p.contents.y, 20);
    });

    it("should create pointer to double", function () {
      // Python: x = c_double(3.14159); p = pointer(x)
      const x = new ctypes.c_double(3.14159);
      const p = ctypes.pointer(x);
      assert.ok(Math.abs(p[0] - 3.14159) < 0.00001);
    });

    it("should have deref() alias for contents", function () {
      const x = new ctypes.c_int32(42);
      const p = ctypes.pointer(x);
      assert.strictEqual(p.deref(), p.contents);
      assert.strictEqual(p.deref(), 42);
    });
  });

  // ─── addressof() ───
  // Python: from ctypes import addressof

  describe("addressof() function", function () {
    it("should return bigint address", function () {
      // Python: addr = addressof(x); assertIsInstance(addr, int)
      const x = new ctypes.c_int32(42);
      const addr = ctypes.addressof(x);
      assert.strictEqual(typeof addr, "bigint");
      assert.ok(addr > 0n);
    });

    it("should match pointer address", function () {
      // Python: assertEqual(addressof(x), addressof(p.contents))
      const x = new ctypes.c_int32(42);
      const p = ctypes.pointer(x);
      assert.strictEqual(ctypes.addressof(x), p.address);
    });

    it("should work with struct", function () {
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const pt = new Point(10, 20);
      const addr = ctypes.addressof(pt);
      assert.strictEqual(typeof addr, "bigint");
      assert.ok(addr > 0n);
    });

    it("should roundtrip via cast", function () {
      // Python: p = cast(c_void_p(addressof(x)), POINTER(c_int32)); assertEqual(p[0], 42)
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const x = new ctypes.c_int32(42);
      const addr = ctypes.addressof(x);
      const p = ctypes.cast(new ctypes.c_void_p(addr), IntPtr);
      assert.strictEqual(p[0], 42);
    });
  });

  // ─── cast() with POINTER target ───
  // Python: cast(arr, POINTER(c_int32))

  describe("cast() with POINTER target", function () {
    it("should cast array to POINTER", function () {
      // Python: arr = (c_int32 * 3)(100, 200, 300); p = cast(arr, POINTER(c_int32))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const arr = ctypes.array(ctypes.c_int32, 3).create([100, 200, 300]);
      const p = ctypes.cast(arr, IntPtr);
      assert.strictEqual(p[0], 100);
      assert.strictEqual(p[1], 200);
      assert.strictEqual(p[2], 300);
    });

    it("should cast c_void_p to POINTER", function () {
      // Python: cast(c_void_p(addressof(val)), POINTER(c_int32))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const val = new ctypes.c_int32(12345);
      const addr = ctypes.addressof(val);
      const voidP = new ctypes.c_void_p(addr);
      const p = ctypes.cast(voidP, IntPtr);
      assert.strictEqual(p[0], 12345);
    });

    it("should cast preserving type", function () {
      // Python: p2 = cast(p, POINTER(c_double))
      const DblPtr = ctypes.POINTER(ctypes.c_double);
      const val = new ctypes.c_double(3.14);
      const p = ctypes.pointer(val);
      const p2 = ctypes.cast(p, DblPtr);
      assert.ok(Math.abs(p2[0] - 3.14) < 0.01);
    });

    it("should reinterpret memory as different type", function () {
      // Python: cast(pointer(c_float(1.0)), POINTER(c_uint32))[0] == 0x3F800000
      const val = new ctypes.c_float(1.0);
      const p = ctypes.pointer(val);
      const p2 = ctypes.cast(p, ctypes.POINTER(ctypes.c_uint32));
      assert.strictEqual(p2[0], 0x3F800000);
    });

    it("should allow write-through", function () {
      // Python: arr=(c_int32*2)(0,0); p=cast(arr,POINTER(c_int32)); p[0]=111; p[1]=222
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const arr = ctypes.array(ctypes.c_int32, 2).create([0, 0]);
      const p = ctypes.cast(arr, IntPtr);
      p[0] = 111;
      p[1] = 222;
      assert.strictEqual(arr[0], 111);
      assert.strictEqual(arr[1], 222);
    });

    it("should cast PointerInstance to POINTER", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(42, 0);
      const p = IntPtr.fromBuffer(buf);
      const p2 = ctypes.cast(p, IntPtr);
      assert.strictEqual(p2[0], 42);
    });

    it("should cast number to POINTER", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = ctypes.cast(0x12345678, IntPtr);
      assert.strictEqual(p.address, 0x12345678n);
    });

    // Python: `cast(buf, POINTER(T))` punta ALLA memoria di buf, non legge
    // i suoi byte come valore pointer. Per costruire un POINTER da un
    // address numerico usa `P.fromAddress(addr)` o `cast(BigInt, P)`.
    it("should cast Buffer to POINTER (points to buffer memory)", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(0x12345678, 0);
      const p = ctypes.cast(buf, IntPtr);
      assert.strictEqual(p.contents, 0x12345678, "contents read from buf memory");
    });

    it("should cast BigInt address to POINTER (from address value)", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      // Pattern per ottenere un POINTER da un address numerico noto.
      const p = ctypes.cast(0x12345678n, IntPtr);
      assert.strictEqual(p.address, 0x12345678n);
    });
  });

  // ─── Pointer indexing / array walk ───
  // Python: p = cast(arr, POINTER(c_int32)); p[0], p[1], ...

  describe("Pointer indexing / array walk", function () {
    it("should read array elements via [index]", function () {
      // Python: arr = (c_int32*5)(10,20,30,40,50); p = cast(arr, POINTER(c_int32))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const arr = ctypes.array(ctypes.c_int32, 5).create([10, 20, 30, 40, 50]);
      const p = ctypes.cast(arr, IntPtr);
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(p[i], (i + 1) * 10);
      }
    });

    it("should write array elements via [index]", function () {
      // Python: arr=(c_int32*3)(0,0,0); p=cast(arr,POINTER(c_int32)); p[0]=11
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const arr = ctypes.array(ctypes.c_int32, 3).create([0, 0, 0]);
      const p = ctypes.cast(arr, IntPtr);
      p[0] = 11;
      p[1] = 22;
      p[2] = 33;
      assert.strictEqual(arr[0], 11);
      assert.strictEqual(arr[1], 22);
      assert.strictEqual(arr[2], 33);
    });

    it("should walk double array", function () {
      // Python: arr = (c_double*3)(1.1, 2.2, 3.3); p = cast(arr, POINTER(c_double))
      const DblPtr = ctypes.POINTER(ctypes.c_double);
      const arr = ctypes.array(ctypes.c_double, 3).create([1.1, 2.2, 3.3]);
      const p = ctypes.cast(arr, DblPtr);
      assert.ok(Math.abs(p[0] - 1.1) < 0.01);
      assert.ok(Math.abs(p[1] - 2.2) < 0.01);
      assert.ok(Math.abs(p[2] - 3.3) < 0.01);
    });

    it("should check NULL pointer", function () {
      // Python: IntPtr = POINTER(c_int32); p = IntPtr(); assertFalse(bool(p))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.create();
      assert.strictEqual(p.isNull, true);
    });

    it("should throw on NULL pointer dereference", function () {
      // Python: accessing NULL pointer contents raises ValueError
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.create();
      assert.throws(() => p.contents, /NULL pointer/);
      assert.throws(() => p[0], /NULL pointer/);
    });
  });

  // ─── POINTER.fromAddress() — node-ctypes specific ───

  describe("POINTER.fromAddress()", function () {
    it("should create pointer at given address", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.fromAddress(0xDEADBEEFn);
      assert.strictEqual(p.address, 0xDEADBEEFn);
      assert.strictEqual(p.isNull, false);
    });

    it("should create NULL pointer from 0n", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.fromAddress(0n);
      assert.strictEqual(p.isNull, true);
    });

    it("should roundtrip read array", function () {
      // Python equivalent: addr=addressof(arr); p=cast(c_void_p(addr), POINTER(c_int32))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf = Buffer.alloc(12);
      buf.writeInt32LE(100, 0);
      buf.writeInt32LE(200, 4);
      buf.writeInt32LE(300, 8);
      const addr = ctypes.addressof(buf);
      const p = IntPtr.fromAddress(addr);
      assert.strictEqual(p[0], 100);
      assert.strictEqual(p[1], 200);
      assert.strictEqual(p[2], 300);
    });

    it("should roundtrip write array", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf = Buffer.alloc(12);
      const addr = ctypes.addressof(buf);
      const p = IntPtr.fromAddress(addr);
      p[0] = 11;
      p[1] = 22;
      p[2] = 33;
      assert.strictEqual(buf.readInt32LE(0), 11);
      assert.strictEqual(buf.readInt32LE(4), 22);
      assert.strictEqual(buf.readInt32LE(8), 33);
    });

    it("should work with struct pointer", function () {
      class Point extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const PointPtr = ctypes.POINTER(Point);
      const pt = new Point({ x: 10, y: 20 });
      const addr = ctypes.addressof(pt);
      const p = PointPtr.fromAddress(addr);
      assert.strictEqual(p.contents.x, 10);
      assert.strictEqual(p.contents.y, 20);
    });
  });

  // ─── PointerInstance methods — node-ctypes extras ───

  describe("PointerInstance methods", function () {
    it("should set() to change target buffer", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf1 = Buffer.alloc(4);
      buf1.writeInt32LE(42, 0);
      const buf2 = Buffer.alloc(4);
      buf2.writeInt32LE(100, 0);
      const p = IntPtr.create();
      assert.strictEqual(p.isNull, true);
      p.set(buf1);
      assert.strictEqual(p.contents, 42);
      p.set(buf2);
      assert.strictEqual(p.contents, 100);
    });

    it("should set() to change target address", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.create();
      p.set(0x12345678n);
      assert.strictEqual(p.address, 0x12345678n);
    });

    it("should toBuffer() return address as buffer", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(42, 0);
      const p = IntPtr.fromBuffer(buf);
      const addrBuf = p.toBuffer();
      assert.ok(Buffer.isBuffer(addrBuf));
      assert.strictEqual(addrBuf.length, 8);
      assert.ok(addrBuf.readBigUInt64LE(0) > 0n);
    });

    it("should toString() show type and address", function () {
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const p = IntPtr.create();
      const str = p.toString();
      assert.ok(str.includes("pointer"));
      assert.ok(str.includes("0x0"));
    });
  });

  // ─── ptrToBuffer() — node-ctypes specific ───

  describe("ptrToBuffer() function", function () {
    it("should create buffer view at address", function () {
      const x = new ctypes.c_int32(42);
      const addr = ctypes.addressof(x);
      const view = ctypes.ptrToBuffer(addr, 4);
      assert.ok(Buffer.isBuffer(view));
      assert.strictEqual(view.length, 4);
      assert.strictEqual(view.readInt32LE(0), 42);
    });

    it("should allow modifications to view change original", function () {
      const x = new ctypes.c_int32(42);
      const addr = ctypes.addressof(x);
      const view = ctypes.ptrToBuffer(addr, 4);
      view.writeInt32LE(999, 0);
      assert.strictEqual(x.value, 999);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// SimpleCData.in_dll: bind a type to an exported global variable.
// (Python: `c_int.in_dll(libc, "_timezone")` → Structure-valued instance)
// ────────────────────────────────────────────────────────────────────

describe("in_dll", function () {
  const { c_int32 } = ctypes;

  it("SimpleCData.in_dll binds to exported global (Win only)",
     { skip: process.platform !== "win32" }, function () {
    const libc = new ctypes.CDLL(ctypes.find_library("c"));
    const tz = c_int32.in_dll(libc, "_timezone");
    assert.strictEqual(typeof tz.value, "number");
    libc.close();
  });

  it("throws on missing symbol", function () {
    const libc = new ctypes.CDLL(ctypes.find_library("c"));
    assert.throws(
      () => c_int32.in_dll(libc, "symbol_that_definitely_does_not_exist_12345"),
      /not found|Symbol/i,
    );
    libc.close();
  });

  it("Structure.in_dll is callable (inherited)",
     { skip: process.platform !== "win32" }, function () {
    class Dummy extends ctypes.Structure {
      static _fields_ = [["x", c_int32]];
    }
    assert.strictEqual(typeof Dummy.in_dll, "function");
  });
});

// ────────────────────────────────────────────────────────────────────
// `_as_parameter_` / `from_param` protocols
// (Python: any ctypes call-site unwraps obj._as_parameter_ first;
//  classmethod `from_param(cls, value)` converts before the call)
// ────────────────────────────────────────────────────────────────────

describe("_as_parameter_ / from_param", function () {
  const { CDLL, find_library, c_int32 } = ctypes;

  it("_as_parameter_ on a wrapper object unwraps to the real value", function () {
    const libc = new CDLL(find_library("c"));
    const abs = libc.func("abs", c_int32, [c_int32]);
    class Handle {
      constructor(v) { this._as_parameter_ = v; }
    }
    assert.strictEqual(abs(new Handle(-42)), 42);
    libc.close();
  });

  it("from_param classmethod transforms the incoming arg", function () {
    const libc = new CDLL(find_library("c"));
    class StrLen extends c_int32 {
      static from_param(obj) {
        return typeof obj === "string" ? obj.length : obj;
      }
    }
    const abs = libc.func("abs", c_int32, [StrLen]);
    assert.strictEqual(abs("hello"), 5);
    assert.strictEqual(abs(-7), 7);
    libc.close();
  });
});
