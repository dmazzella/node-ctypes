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
  it("test_integer_arguments_reject_non_numbers", function () {
    const functions = [];
    for (const [name, type] of [
      [platform === "win32" ? "_abs64" : "llabs", ctypes.c_longlong],
      ["labs", ctypes.c_long],
      ["abs", c_int],
    ]) {
      const f = libc[name];
      f.restype = type;
      f.argtypes = [type];
      functions.push(f);
    }
    for (const [value, name] of [
      ["1", "string"],
      [{}, "Object"],
      [null, "null"],
      [1.5, "float"],
    ]) {
      for (const f of functions) {
        assert.throws(
          () => f(value),
          (e) => e instanceof ArgumentError && e.message === `argument 1: TypeError: '${name}' object cannot be interpreted as an integer`,
        );
      }
    }
    assert.strictEqual(functions[0](2n ** 64n - 3n), 3n);
    assert.strictEqual(functions[0](true), 1n);
  });

  it("test_integer_values_wrap", function () {
    const cases = [
      [ctypes.c_uint8, 256, 0],
      [ctypes.c_int8, 200, -56],
      [ctypes.c_uint16, -1, 65535],
      [ctypes.c_int16, 40000, -25536],
      [ctypes.c_int32, 2 ** 40 + 5, 5],
      [ctypes.c_int32, 2n ** 64n + 7n, 7],
      [ctypes.c_uint32, -1, 4294967295],
      [ctypes.c_uint64, -1, 2n ** 64n - 1n],
      [ctypes.c_int64, 2n ** 64n + 7n, 7n],
      [ctypes.c_long, 2n ** 64n + 9n, 9n],
    ];
    for (const [T, value, expected] of cases) {
      assert.strictEqual(new T(value).value, expected, `${T.name}(${value})`);
    }
    assert.strictEqual(new c_size_t(-1).value, ctypes.sizeof(c_size_t) === 8 ? 2n ** 64n - 1n : 4294967295);
    class S extends Structure {
      static _fields_ = [
        ["a", ctypes.c_uint8],
        ["b", ctypes.c_int16],
        ["c", ctypes.c_uint64],
      ];
    }
    const s = new S();
    s.a = 300;
    s.b = 40000;
    s.c = -2;
    assert.deepStrictEqual([s.a, s.b, s.c], [44, -25536, 2n ** 64n - 2n]);
    const bytes = ARRAY(ctypes.c_uint8, 2)(300, -1);
    assert.deepStrictEqual([...bytes], [44, 255]);
  });

  it("test_float_arguments_reject_non_numbers", function () {
    // glibc has fabs in libm only.
    const libm = platform === "linux" ? new CDLL(ctypes.find_library("m")) : libc;
    try {
      const fabs = libm.fabs;
      fabs.restype = ctypes.c_double;
      fabs.argtypes = [ctypes.c_double];
      assert.strictEqual(fabs(-1.5), 1.5);
      assert.throws(
        () => fabs("1"),
        (e) => e instanceof ArgumentError && e.message === "argument 1: TypeError: must be real number, not string",
      );
    } finally {
      if (libm !== libc) libm.close();
    }
  });

  it("test_float_for_integer_types", function () {
    const libc = new CDLL(ctypes.find_library("c"));
    const abs = libc.abs;
    abs.argtypes = [c_int];
    for (const value of [3.7, NaN, Infinity]) {
      assert.throws(() => abs(value), { name: "ArgumentError", message: "argument 1: TypeError: 'float' object cannot be interpreted as an integer" });
    }
    assert.strictEqual(abs(-3.0), 3);
    assert.throws(() => new ctypes.c_int32(3.7), { name: "TypeError", message: "'float' object cannot be interpreted as an integer" });
    class S extends Structure {
      static _fields_ = [["i", c_int]];
    }
    const s = new S();
    assert.throws(() => {
      s.i = 3.5;
    }, /'float' object cannot be interpreted as an integer/);
  });
});
