// Node factories, iterable syntax, absent-index representation and address validation.
import assert, { throws } from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";

const IntArray3 = ctypes.array(ctypes.c_int32, 3);

describe("Node array creation, representation and functional aggregate APIs", function () {
  it("should create fixed-size arrays", function () {
    const IntArray5 = ctypes.array(ctypes.c_int32, 5);

    assert.strictEqual(IntArray5.getSize(), 20); // 5 * 4 bytes
    assert.strictEqual(IntArray5.getLength(), 5);
  });

  it("should support spread operator", function () {
    const IntArray3 = ctypes.array(ctypes.c_int32, 3);
    const arr = IntArray3.create([10, 20, 30]);

    const values = [...arr];
    assert.deepStrictEqual(values, [10, 20, 30]);
  });

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

  it("should create arrays from strings", function () {
    const CharArray = ctypes.array(ctypes.c_int8, 100);
    const arr = CharArray.create("Hello, World!");

    // Should contain ASCII values
    assert.strictEqual(arr[0], "H".charCodeAt(0));
    assert.strictEqual(arr[1], "e".charCodeAt(0));
    assert.strictEqual(arr[7], "W".charCodeAt(0));
  });

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

describe("Node array create() initialization paths", function () {
  it("should support partial initialization", function () {
    const IntArray5 = ctypes.array(ctypes.c_int32, 5);
    const arr = IntArray5.create([1, 2, 3]); // Rest filled with 0

    assert.strictEqual(arr[0], 1);
    assert.strictEqual(arr[2], 3);
    assert.strictEqual(arr[3], 0);
    assert.strictEqual(arr[4], 0);
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

  it("should handle empty array creation", function () {
    const IntArray5 = ctypes.array(ctypes.c_int32, 5);
    const arr = IntArray5.create(); // All zeros

    assert.strictEqual(arr[0], 0);
    assert.strictEqual(arr[4], 0);
  });
});
