import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRAY, Structure, Union, addressof, alignment, c_char, c_double, c_float, c_int8, c_int32, c_uint8, sizeof } from "node-ctypes";

describe("TestArrays", function () {
  it("test_array_creation", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    assert.equal(sizeof(IntArray5), 20);
  });

  it("test_array_initialization", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(1, 2, 3, 4, 5);
    assert.equal(arr[0], 1);
    assert.equal(arr[4], 5);
  });

  it("test_partial_initialization", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(1, 2, 3);
    assert.equal(arr[0], 1);
    assert.equal(arr[2], 3);
    assert.equal(arr[3], 0);
    assert.equal(arr[4], 0);
  });

  it("test_array_indexing_read", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(10, 20, 30, 40, 50);
    assert.equal(arr[0], 10);
    assert.equal(arr[1], 20);
    assert.equal(arr[2], 30);
    assert.equal(arr[3], 40);
    assert.equal(arr[4], 50);
  });

  it("test_array_indexing_write", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(1, 2, 3, 4, 5);
    arr[0] = 100;
    arr[4] = 500;
    assert.equal(arr[0], 100);
    assert.equal(arr[4], 500);
  });

  it("test_float_arrays", function () {
    const FloatArray3 = ARRAY(c_float, 3);
    const arr = FloatArray3(1.5, 2.5, 3.5);
    assert.ok(Math.abs(arr[0] - 1.5) < 0.0001);
    assert.ok(Math.abs(arr[1] - 2.5) < 0.0001);
    assert.ok(Math.abs(arr[2] - 3.5) < 0.0001);
    arr[1] = 99.9;
    assert.ok(Math.abs(arr[1] - 99.9) < 0.0001);
  });

  it("test_array_iteration", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(1, 2, 3, 4, 5);
    const values = Array.from(arr);
    assert.deepEqual(values, [1, 2, 3, 4, 5]);
  });

  it("test_arrays_in_structs", function () {
    class Data extends Structure {
      static _fields_ = [
        ["count", c_int32],
        ["values", ARRAY(c_int32, 10)],
      ];
    }
    const data = new Data();
    data.count = 5;
    for (let i = 0; i < 10; i++) data.values[i] = i + 1;
    assert.equal(data.count, 5);
    assert.equal(data.values[0], 1);
    assert.equal(data.values[9], 10);
  });

  it("test_modify_array_in_struct", function () {
    class Data extends Structure {
      static _fields_ = [["values", ARRAY(c_int32, 5)]];
    }
    const data = new Data();
    data.values[0] = 1;
    data.values[1] = 2;
    data.values[2] = 3;
    data.values[3] = 4;
    data.values[4] = 5;
    data.values[2] = 999;
    assert.equal(data.values[2], 999);
  });

  it("test_uint8_arrays", function () {
    const ByteArray = ARRAY(c_uint8, 4);
    const arr = ByteArray(0xff, 0xab, 0xcd, 0xef);
    assert.equal(arr[0], 0xff);
    assert.equal(arr[1], 0xab);
    assert.equal(arr[2], 0xcd);
    assert.equal(arr[3], 0xef);
  });

  it("test_double_arrays", function () {
    const DoubleArray = ARRAY(c_double, 3);
    const arr = DoubleArray(3.14159, 2.71828, 1.61803);
    assert.ok(Math.abs(arr[0] - 3.14159) < 0.00001);
    assert.ok(Math.abs(arr[1] - 2.71828) < 0.00001);
    assert.ok(Math.abs(arr[2] - 1.61803) < 0.00001);
  });

  it("test_empty_array_creation", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5();
    assert.equal(arr[0], 0);
    assert.equal(arr[4], 0);
  });

  it("test_from_buffer_shares_memory", function () {
    const IntArray3 = ARRAY(c_int32, 3);
    const buf = Buffer.alloc(16);
    const arr = IntArray3.from_buffer(buf, 4);
    arr[1] = 7;
    assert.equal(buf.readInt32LE(8), 7);
    buf.writeInt32LE(-3, 4);
    assert.equal(arr[0], -3);
    assert.equal(addressof(arr), addressof(c_uint8.from_buffer(buf)) + 4n);
    assert.throws(() => IntArray3.from_buffer(buf, 8), RangeError);
  });

  it("test_from_buffer_copy", function () {
    const IntArray3 = ARRAY(c_int32, 3);
    const source = IntArray3(1, 2, 3);
    const arr = IntArray3.from_buffer_copy(source);
    arr[0] = 100;
    assert.deepEqual(Array.from(arr), [100, 2, 3]);
    assert.equal(source[0], 1);
    assert.throws(() => IntArray3.from_buffer_copy(Buffer.alloc(8)), RangeError);
  });

  it("test_from_address", function () {
    const IntArray3 = ARRAY(c_int32, 3);
    const source = IntArray3(1, 2, 3);
    const arr = IntArray3.from_address(addressof(source));
    assert.deepEqual(Array.from(arr), [1, 2, 3]);
    arr[2] = 30;
    assert.equal(source[2], 30);
    source[0] = 10;
    assert.equal(arr[0], 10);
  });

  it("test_string_as_byte_array", function () {
    const CharArray = ARRAY(c_char, 100);
    const arr = CharArray();
    const s = Buffer.from("Hello, World!");
    for (const [i, char] of s.entries()) arr[i] = char;
    assert.equal(arr[0], "H");
    assert.equal(arr[1], "e");
    assert.equal(arr[7], "W");
  });

  it("test_array_length", function () {
    const IntArray5 = ARRAY(c_int32, 5);
    const arr = IntArray5(10, 20, 30, 40, 50);
    assert.equal(arr.length, 5);
    assert.equal(sizeof(arr), 20);
    let total = 0;
    for (let i = 0; i < arr.length; i++) total += arr[i];
    assert.equal(total, 150);
  });

  it("test_arrays_of_aggregates", function () {
    class P extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int8],
      ];
    }
    const A = ARRAY(P, 3);
    assert.equal(sizeof(A), 24);
    assert.equal(alignment(A), 4);
    const a = A();
    a[1].x = 5;
    a[2] = new P(7, 1);
    assert.deepEqual([a[1].x, a[2].x, a[2].y], [5, 7, 1]);
    class S extends Structure {
      static _fields_ = [
        ["n", c_int32],
        ["pts", A],
      ];
    }
    const s = new S();
    s.pts[2].y = 9;
    assert.equal(s.pts[2].y, 9);
    assert.equal(sizeof(S), 28);
    class U extends Union {
      static _fields_ = [
        ["i", c_int32],
        ["f", c_float],
      ];
    }
    const b = ARRAY(U, 2)();
    b[1].i = 3;
    assert.equal(b[1].i, 3);
  });
});
