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
  it("test_load_library_new_instance", function () {
    const a = ctypes.cdll.LoadLibrary(LIBC);
    const b = new ctypes.LibraryLoader(CDLL).LoadLibrary(LIBC);
    assert.notStrictEqual(a, b);
    assert.strictEqual(a.abs(-3), 3);
  });

  it("test_default_restype_c_int", function () {
    assert.strictEqual(libc.abs(-5), 5);
  });

  it("test_none_restype_returns_none", function () {
    const srand = libc.srand;
    srand.argtypes = [ctypes.c_uint32];
    srand.restype = null;
    assert.strictEqual(srand(1), undefined);
    const Srand = CFUNCTYPE(null, ctypes.c_uint32);
    assert.strictEqual(Srand(["srand", libc])(2), undefined);
  });

  it("test_prototype_as_parameter", function () {
    const Abs = CFUNCTYPE(c_int, c_int);
    const abs = Abs(["abs", libc]);
    assert.strictEqual(abs({ _as_parameter_: -9 }), 9);
  });

  it("test_variadic_instances_keep_type", { skip: platform === "win32" && process.arch === "arm64" && "CPython Windows ARM64 does not prepare the variadic CIF correctly" }, function () {
    const sprintf = libc.sprintf;
    sprintf.restype = c_int;
    sprintf.argtypes = [c_char_p, c_char_p];
    const buf = create_string_buffer(128);
    sprintf(buf, "%.1f %d %lld|", new ctypes.c_double(2.0), new c_int(-3), new ctypes.c_longlong(1n << 40n));
    assert.strictEqual(buf.value, "2.0 -3 1099511627776|");
  });

  it("test_errcheck_func", function () {
    const libc = new CDLL(ctypes.find_library("c"));
    const abs = libc.abs;
    abs.argtypes = [c_int];
    let seen = null;
    abs.errcheck = (result, func, args) => {
      seen = func;
      return result;
    };
    assert.strictEqual(abs(-3), 3);
    assert.strictEqual(seen, abs);
    const malloc = libc.malloc;
    malloc.argtypes = [c_size_t];
    malloc.restype = POINTER(c_int);
    malloc.errcheck = (result, func) => {
      seen = func;
      return result;
    };
    const free = libc.free;
    free.argtypes = [c_void_p];
    free.restype = null;
    free(malloc(8));
    assert.strictEqual(seen, malloc);
    abs.errcheck = null;
    abs.argtypes = null;
    assert.deepStrictEqual(abs.argtypes, []);
    assert.strictEqual(abs(-5), 5);
  });

  it("test_callback_struct_by_value", function () {
    class P extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    const T = CFUNCTYPE(c_int, P, c_int);
    const cb = T((p, k) => p.x * k + p.y);
    assert.strictEqual(T(ctypes.cast(cb, c_void_p).value)(new P(3, 4), 10), 34);
    cb.release();
    assert.throws(() => CFUNCTYPE(P, c_int)(() => new P(1, 2)), { name: "TypeError", message: "invalid result type for callback function" });
  });

  it("test_callback_returns_string", function () {
    const T = CFUNCTYPE(c_char_p);
    const cb = T(() => "abc");
    assert.strictEqual(T(ctypes.cast(cb, c_void_p).value)(), "abc");
    const W = CFUNCTYPE(ctypes.c_wchar_p);
    const wcb = W(() => "xy");
    assert.strictEqual(W(ctypes.cast(wcb, c_void_p).value)(), "xy");
    cb.release();
    wcb.release();
  });

  it("test_prototype_name_library_paramflags", function () {
    const strlen = CFUNCTYPE(c_size_t, c_char_p)(["strlen", libc]);
    assert.strictEqual(strlen("hello"), 5n);
    const modf = CFUNCTYPE(
      ctypes.c_double,
      ctypes.c_double,
      POINTER(ctypes.c_double),
    )(
      ["modf", libc],
      [
        [1, "x"],
        [2, "iptr"],
      ],
    );
    assert.strictEqual(modf(3.75), 3);
    assert.strictEqual(modf({ x: -2.5 }), -2);
  });

  it("test_function_not_cfunctype_argument", function () {
    const CMP = CFUNCTYPE(c_int, c_void_p, c_void_p);
    const qsort = libc.qsort;
    qsort.restype = null;
    qsort.argtypes = [c_void_p, c_size_t, c_size_t, CMP];
    assert.throws(
      () => qsort(create_string_buffer(8), 2, 4, () => 0),
      (e) => e instanceof ArgumentError && e.message.startsWith("argument 4: TypeError"),
    );
  });
});
