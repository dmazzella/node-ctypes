/**
 * Test Arrays - Cross Platform
 * Tests array creation, indexing, iteration, in structs, in functions
 */

import assert, { strictEqual, throws } from "node:assert";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

describe("Arrays", function () {
  describe("Array Creation", function () {
    it("should create fixed-size arrays", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);

      assert.strictEqual(IntArray5.getSize(), 20); // 5 * 4 bytes
      assert.strictEqual(IntArray5.getLength(), 5);
    });

    it("should initialize arrays with values", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([1, 2, 3, 4, 5]);

      assert.strictEqual(arr[0], 1);
      assert.strictEqual(arr[4], 5);
    });

    it("should support partial initialization", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([1, 2, 3]); // Rest filled with 0

      assert.strictEqual(arr[0], 1);
      assert.strictEqual(arr[2], 3);
      assert.strictEqual(arr[3], 0);
      assert.strictEqual(arr[4], 0);
    });
  });

  describe("Array Indexing", function () {
    it("should support Python-like indexing for reading", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([10, 20, 30, 40, 50]);

      assert.strictEqual(arr[0], 10);
      assert.strictEqual(arr[1], 20);
      assert.strictEqual(arr[2], 30);
      assert.strictEqual(arr[3], 40);
      assert.strictEqual(arr[4], 50);
    });

    it("should support Python-like indexing for writing", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([1, 2, 3, 4, 5]);

      arr[0] = 100;
      arr[4] = 500;

      assert.strictEqual(arr[0], 100);
      assert.strictEqual(arr[4], 500);
    });

    it("should handle float arrays", function () {
      const FloatArray3 = ctypes.array(ctypes.c_float, 3);
      const arr = FloatArray3.create([1.5, 2.5, 3.5]);

      assert(Math.abs(arr[0] - 1.5) < 0.0001);
      assert(Math.abs(arr[1] - 2.5) < 0.0001);
      assert(Math.abs(arr[2] - 3.5) < 0.0001);

      arr[1] = 99.9;
      assert(Math.abs(arr[1] - 99.9) < 0.0001);
    });
  });

  describe("Array Iteration", function () {
    it("should support for...of iteration", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([1, 2, 3, 4, 5]);

      const values = [];
      for (let v of arr) {
        values.push(v);
      }

      assert.deepStrictEqual(values, [1, 2, 3, 4, 5]);
    });

    it("should support spread operator", function () {
      const IntArray3 = ctypes.array(ctypes.c_int32, 3);
      const arr = IntArray3.create([10, 20, 30]);

      const values = [...arr];
      assert.deepStrictEqual(values, [10, 20, 30]);
    });

    // Python ctypes parity: `len(arr)` ritorna il numero di elementi.
    // Prima del fix, `arr.length` cadeva sul buffer sottostante e
    // tornava il byte count (20 per c_int32 × 5).
    it("should expose element count via .length (Python parity)", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create([10, 20, 30, 40, 50]);
      assert.strictEqual(arr.length, 5, ".length must be element count");
      assert.strictEqual(arr.byteLength, 20, ".byteLength = element count × size");

      // Pattern idiomatico: for-loop indicizzato
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      assert.strictEqual(sum, 150);
    });

    it("should treat .length and .byteLength as read-only", function () {
      const A = ctypes.array(ctypes.c_uint8, 4);
      const a = A.create([1, 2, 3, 4]);
      // Proxy set trap ritorna false per tentare assegnazione; in strict
      // mode JS lancia, in sloppy mode viene silentemente ignorata.
      assert.throws(() => {
        "use strict";
        a.length = 10;
      });
      assert.strictEqual(a.length, 4);
    });
  });

  describe("Arrays in Structs", function () {
    it("should support array fields in structs", function () {
      const IntArray10 = ctypes.array(ctypes.c_int32, 10);

      const Data = ctypes.struct({
        count: ctypes.c_int32,
        values: IntArray10,
      });

      const data = Data.create({
        count: 5,
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      });

      assert.strictEqual(Data.get(data, "count"), 5);

      const values = Data.get(data, "values");
      assert.strictEqual(values[0], 1);
      assert.strictEqual(values[9], 10);
    });

    it("should allow modifying array elements in structs", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);

      const Data = ctypes.struct({
        values: IntArray5,
      });

      const data = Data.create({
        values: [1, 2, 3, 4, 5],
      });

      const arr = Data.get(data, "values");
      arr[2] = 999;

      const updated = Data.get(data, "values");
      assert.strictEqual(updated[2], 999);
    });
  });

  describe("Different Array Types", function () {
    it("should support uint8 arrays", function () {
      const ByteArray = ctypes.array(ctypes.c_uint8, 4);
      const arr = ByteArray.create([0xff, 0xab, 0xcd, 0xef]);

      assert.strictEqual(arr[0], 0xff);
      assert.strictEqual(arr[1], 0xab);
      assert.strictEqual(arr[2], 0xcd);
      assert.strictEqual(arr[3], 0xef);
    });

    it("should support double arrays", function () {
      const DoubleArray = ctypes.array(ctypes.c_double, 3);
      const arr = DoubleArray.create([3.14159, 2.71828, 1.61803]);

      assert(Math.abs(arr[0] - 3.14159) < 0.00001);
      assert(Math.abs(arr[1] - 2.71828) < 0.00001);
      assert(Math.abs(arr[2] - 1.61803) < 0.00001);
    });
  });

  describe("Array Edge Cases", function () {
    it("should handle empty array creation", function () {
      const IntArray5 = ctypes.array(ctypes.c_int32, 5);
      const arr = IntArray5.create(); // All zeros

      assert.strictEqual(arr[0], 0);
      assert.strictEqual(arr[4], 0);
    });

    it("should handle bounds correctly", function () {
      const IntArray3 = ctypes.array(ctypes.c_int32, 3);
      const arr = IntArray3.create([1, 2, 3]);

      // Valid indices
      assert.strictEqual(arr[0], 1);
      assert.strictEqual(arr[2], 3);

      // Invalid index should return undefined (JavaScript behavior)
      assert.strictEqual(arr[3], undefined);
      assert.strictEqual(arr[-1], undefined);
    });
  });

  // Python: (c_int32 * 3).from_buffer / from_buffer_copy / from_address.
  describe("Arrays on existing memory", function () {
    const IntArray3 = ctypes.array(ctypes.c_int32, 3);

    it("from_buffer shares the memory", function () {
      const buf = Buffer.alloc(16);
      const arr = IntArray3.from_buffer(buf, 4);
      arr[1] = 7;
      assert.strictEqual(buf.readInt32LE(8), 7);
      buf.writeInt32LE(-3, 4);
      assert.strictEqual(arr[0], -3);
      assert.strictEqual(ctypes.addressof(arr), ctypes.addressof(buf) + 4n);
      throws(() => IntArray3.from_buffer(buf, 8), RangeError);
    });

    it("from_buffer_copy copies the bytes", function () {
      const source = IntArray3(1, 2, 3);
      const arr = IntArray3.from_buffer_copy(source);
      arr[0] = 100;
      assert.deepStrictEqual([...arr], [100, 2, 3]);
      assert.strictEqual(source[0], 1);
      throws(() => IntArray3.from_buffer_copy(Buffer.alloc(8)), RangeError);
    });

    it("from_address is the memory at the address", function () {
      const source = IntArray3(1, 2, 3);
      const arr = IntArray3.from_address(ctypes.addressof(source));
      assert.deepStrictEqual([...arr], [1, 2, 3]);
      arr[2] = 30;
      assert.strictEqual(source[2], 30);
      source[0] = 10;
      assert.strictEqual(arr[0], 10);
      throws(() => IntArray3.from_address(0), TypeError);
    });
  });

  describe("String as Byte Arrays", function () {
    it("should create arrays from strings", function () {
      const CharArray = ctypes.array(ctypes.c_int8, 100);
      const arr = CharArray.create("Hello, World!");

      // Should contain ASCII values
      assert.strictEqual(arr[0], "H".charCodeAt(0));
      assert.strictEqual(arr[1], "e".charCodeAt(0));
      assert.strictEqual(arr[7], "W".charCodeAt(0));
    });
  });

  describe("Arrays of struct() / union() definitions", function () {
    it("index elements as views and work as by-value struct fields", function () {
      const P = ctypes.struct({ x: ctypes.c_int32, y: ctypes.c_int8 });
      const A = ctypes.array(P, 3);
      assert.strictEqual(ctypes.sizeof(A), 24);
      assert.strictEqual(A.getAlignment(), 4);
      const a = A();
      a[1].x = 5;
      a[2] = { x: 7, y: 1 };
      assert.deepStrictEqual([a[1].x, a[2].x, a[2].y], [5, 7, 1]);
      class S extends ctypes.Structure {
        static _fields_ = [
          ["n", ctypes.c_int32],
          ["pts", A],
        ];
      }
      const s = new S();
      s.pts[2].y = 9;
      assert.strictEqual(s.pts[2].y, 9);
      assert.strictEqual(ctypes.sizeof(S), 28);
      const U = ctypes.union({ i: ctypes.c_int32, f: ctypes.c_float });
      const b = ctypes.array(U, 2)();
      b[1].i = 3;
      assert.strictEqual(b[1].i, 3);
      assert.throws(() => ctypes.array(ctypes.c_int32._type, 3), TypeError);
    });
  });
});
