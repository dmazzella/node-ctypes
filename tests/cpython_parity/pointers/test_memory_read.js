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
  it("test_memmove_memset", function () {
    const words = ARRAY(ctypes.c_uint16, 4)(1, 2, 3, 4);
    const data = ARRAY(ctypes.c_uint8, 8)();
    ctypes.memmove(data, words, 8);
    assert.deepStrictEqual([...ARRAY(ctypes.c_uint16, 4).from_buffer(data)], [1, 2, 3, 4]);
    const raw = ARRAY(ctypes.c_uint8, 4)();
    ctypes.memset(raw, 0x7f, 2);
    assert.deepStrictEqual([...raw], [0x7f, 0x7f, 0, 0]);
    const ints = ARRAY(c_int, 4)(1, 2, 3, 4);
    ctypes.memmove(ctypes.addressof(ints) + BigInt(sizeof(c_int)), ints, 3 * sizeof(c_int));
    assert.deepStrictEqual([...ints], [1, 1, 2, 3]);
  });

  it("test_string_at_sources", function () {
    const buf = create_string_buffer("hello");
    const addr = ctypes.addressof(buf);
    assert.strictEqual(ctypes.string_at(buf), "hello");
    assert.strictEqual(ctypes.string_at(new c_char_p("world")), "world");
    assert.strictEqual(ctypes.string_at(new c_void_p(addr)), "hello");
    assert.strictEqual(ctypes.string_at(ctypes.cast(addr, POINTER(c_char))), "hello");
    assert.strictEqual(ctypes.string_at(ARRAY(c_char, 8).from_buffer(Buffer.from("arr\0xxxx"))), "arr");
    assert.strictEqual(ctypes.string_at({ _as_parameter_: addr }, 3), "hel");
    assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("wide")), "wide");
    assert.strictEqual(ctypes.wstring_at(new ctypes.c_wchar_p("wz")), "wz");
    assert.throws(() => ctypes.string_at({}), ctypes.ArgumentError);
  });

  it("test_long_strings", function () {
    const big = create_string_buffer(2 * 1024 * 1024);
    ctypes.memset(big, 0x41, big.length - 1);
    assert.strictEqual(ctypes.string_at(ctypes.addressof(big)).length, big.length - 1);
    assert.strictEqual(new c_char_p(ctypes.addressof(big)).value.length, big.length - 1);
  });

  it("test_string_at_exact_size", function () {
    const b = create_string_buffer("A\0BC", 6);
    assert.strictEqual(ctypes.string_at(b, 4), "A\0BC");
    assert.strictEqual(ctypes.string_at(ctypes.addressof(b)), "A");
    const w = create_unicode_buffer("ab\0cd", 6);
    assert.strictEqual(ctypes.wstring_at(w, 5), "ab\0cd");
    assert.strictEqual(ctypes.wstring_at(ctypes.addressof(w)), "ab");
    class S extends Structure {
      static _fields_ = [["s", ctypes.c_wchar_p]];
    }
    const long = "x".repeat(5000) + "é😀";
    const st = new S();
    st.s = long;
    assert.strictEqual(st.s, long);
  });

  it("test_void_p_accepts_bytes", function () {
    const memcpy = libc.memcpy;
    memcpy.restype = c_void_p;
    memcpy.argtypes = [c_void_p, c_void_p, c_size_t];
    const dst = create_string_buffer(3);
    memcpy(dst, "abc", 3);
    assert.strictEqual(dst.raw.toString("latin1"), "abc");
  });
});
