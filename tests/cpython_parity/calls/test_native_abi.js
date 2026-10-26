import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestNativeABI", function () {
  let lib;
  before(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_mixed_signature", function () {
    const fn = lib.fixture_exact_mixed;
    fn.argtypes = [c.c_int32, c.c_double, c.c_float, c.c_int32];
    fn.restype = c.c_double;
    assert.equal(fn(-7, 1.5, 2.25, 8), 10.75);
  });

  it("test_unsigned_four", function () {
    const fn = lib.fixture_exact_u64_four;
    fn.argtypes = [c.c_uint64, c.c_uint64, c.c_uint64, c.c_uint64];
    fn.restype = c.c_uint64;
    const values = [0xffffffffffffffffn, 0x123456789abcdef0n, 0x8765432101234567n, 1n];
    const expected = values.reduce((a, b) => a ^ b, 0n);
    assert.equal(fn(...values), expected);
  });

  it("test_mixed_fallback", function () {
    const fn = lib.fixture_exact_fallback;
    fn.argtypes = [c.c_int16, c.c_int32, c.c_uint64];
    fn.restype = c.c_int32;
    assert.equal(fn(-7, 8, 9n), 10);
  });

  it("test_callback_scalar_results", function () {
    const cases = [
      ["i8", c.c_int8, [-128, -1, 0, 127]],
      ["u8", c.c_uint8, [0, 1, 255]],
      ["i16", c.c_int16, [-32768, -1, 0, 32767]],
      ["u16", c.c_uint16, [0, 1, 65535]],
      ["i32", c.c_int32, [-2147483648, -1, 0, 2147483647]],
      ["u32", c.c_uint32, [0, 1, 4294967295]],
      ["i64", c.c_int64, [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]],
      ["u64", c.c_uint64, [0n, 1n, (1n << 64n) - 1n]],
      ["long", c.c_long, [-7n, 0n, 7n]],
      ["ulong", c.c_ulong, [0n, 1n, 7n]],
      ["size", c.c_size_t, [0n, 1n, 7n]],
      ["ssize", c.c_ssize_t, [-7n, 0n, 7n]],
      ["char", c.c_char, ["\0", "A", "\xff"]],
      ["wchar", c.c_wchar, ["\0", "\u4e2d"]],
      ["bool", c.c_bool, [false, true]],
      ["float", c.c_float, [-1.5, 0, 2.25]],
      ["double", c.c_double, [-1.5, 0, 2.25]],
    ];
    for (const [name, kind, values] of cases) {
      const prototype = c.CFUNCTYPE(kind, kind);
      const callback = prototype((value) => value);
      const fn = lib[`fixture_callback_${name}`];
      fn.argtypes = [prototype, kind];
      fn.restype = kind;
      try {
        for (const value of values) assert.equal(fn(callback, value), new kind(value).value);
      } finally {
        callback.release();
      }
    }
  });
});
