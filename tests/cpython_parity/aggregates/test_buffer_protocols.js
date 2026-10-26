import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { LIBC, bytes } from "../_support.js";
const { CDLL, Structure, Union, POINTER, pointer, ARRAY, sizeof, alignment, CFUNCTYPE, ArgumentError, create_string_buffer, create_unicode_buffer, c_buffer, c_int, c_char, c_wchar, c_char_p, c_void_p, c_size_t } = ctypes;
const platform = process.platform;

describe("TestPythonParity", function () {
  let libc;
  before(() => {
    libc = new CDLL(LIBC);
  });
  after(() => {
    if (libc) libc.close();
  });
  it("test_rejections", function () {
    class P extends Structure {
      static _fields_ = [["x", c_int]];
    }
    assert.throws(() => new P(1, 2), { name: "TypeError", message: "too many initializers" });
    assert.strictEqual(new P(new c_int(5)).x, 5);
    const s = new P();
    assert.throws(() => {
      s.x = new ctypes.c_double(1);
    }, /incompatible types, c_double instance instead of/);
    class N extends Structure {
      static _fields_ = [["name", ARRAY(c_char, 4)]];
    }
    const n = new N();
    assert.throws(() => {
      n.name = Buffer.from("toolong");
    }, /bytes too long \(7, maximum length 4\)/);
    n.name = Buffer.from("ab");
    assert.strictEqual(n.name, "ab");
    assert.throws(() => {
      class B extends Structure {
        static _fields_ = [["f", ctypes.c_float, 3]];
      }
      sizeof(B);
    }, /bit fields not allowed for type c_float/);
    assert.strictEqual(ARRAY(c_char, 8).create("héllo").value, "héllo");
  });

  it("test_from_buffer_offset", function () {
    class P extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    const buf = Buffer.alloc(16);
    assert.throws(() => P.from_buffer(buf, -4), { name: "RangeError", message: /offset cannot be negative/ });
    assert.throws(() => P.from_buffer_copy(buf, -1), { name: "RangeError", message: /offset cannot be negative/ });
    assert.throws(() => P.from_buffer(buf, 12), { name: "RangeError", message: /Buffer size too small \(16 instead of at least 20 bytes\)/ });
    assert.strictEqual(P.from_buffer(ARRAY(c_int, 4)(1, 2, 3, 4), 4).x, 2);
  });

  it("test_array_elements", function () {
    const a = ARRAY(c_int, 3)(1, 2, 300);
    assert.deepStrictEqual(a.slice(0, 2), [1, 2]);
    assert.strictEqual(a.at(-1), 300);
    assert.ok(a.includes(300));
    assert.strictEqual(a.indexOf(2), 1);
    assert.deepStrictEqual(
      a.map((v) => v * 2),
      [2, 4, 600],
    );
    assert.strictEqual(a.join(","), "1,2,300");
    assert.strictEqual(JSON.stringify(a), "[1,2,300]");
    const visited = [];
    a.forEach((v) => visited.push(v));
    assert.deepStrictEqual(visited, [1, 2, 300]);
    a.fill(7);
    assert.deepStrictEqual([...a], [7, 7, 7]);
    const s = ARRAY(c_char, 6)();
    s.value = "abc";
    assert.strictEqual(s.slice(0, 3), "abc");
    assert.strictEqual(ARRAY(c_wchar, 4)("x", "y").slice(0, 2), "xy");
  });

  it("test_create_string_buffer", function () {
    const buf = create_string_buffer("Hello", 10);
    assert.strictEqual(sizeof(buf), 10);
    assert.strictEqual(buf.value, "Hello");
    assert.deepStrictEqual([...buf.raw], [72, 101, 108, 108, 111, 0, 0, 0, 0, 0]);
    buf.value = "Hi";
    assert.strictEqual(buf.value, "Hi");
    assert.throws(() => create_string_buffer("Hello", 3), RangeError);
    assert.strictEqual(create_unicode_buffer("ok", 5).value, "ok");
  });

  it("test_array_call", function () {
    const Int3 = ARRAY(c_int, 3);
    const a = Int3(1, 2, 3);
    assert.deepStrictEqual([a[0], a[1], a[2]], [1, 2, 3]);
    assert.strictEqual(Int3(4)[0], 4);
  });

  it("test_char_array", function () {
    const Chars = ARRAY(c_char, 4);
    const c = Chars("a", "b");
    assert.strictEqual(c.value, "ab");
    assert.deepStrictEqual([...c.raw], [97, 98, 0, 0]);
    assert.throws(() => Chars("ab"), { message: "one character bytes, bytearray, or an integer in range(256) expected, not a string of length 2" });
  });

  it("test_array_of_arrays", function () {
    const Matrix = ARRAY(ARRAY(c_int, 2), 2);
    const m = Matrix();
    m[1][0] = 5;
    assert.strictEqual(m[1][0], 5);
    assert.strictEqual(sizeof(Matrix), 4 * sizeof(c_int));
  });
});
