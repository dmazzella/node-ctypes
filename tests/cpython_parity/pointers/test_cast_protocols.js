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
  it("test_addressof_array_and_pointer_arrays", function () {
    const ints = ARRAY(c_int, 3)(7, 8, 9);
    const p = ctypes.cast(ctypes.addressof(ints), POINTER(c_int));
    assert.deepStrictEqual([p[0], p[2]], [7, 9]);
    class Mod extends Structure {
      static _fields_ = [
        ["op", c_int],
        ["name", ctypes.c_wchar_p],
      ];
    }
    const PMods = ARRAY(POINTER(Mod), 3);
    const mods = PMods(pointer(new Mod(1, "cn")), pointer(new Mod(2, "mail")));
    assert.strictEqual(sizeof(PMods), 3 * sizeof(c_void_p));
    assert.deepStrictEqual([mods[0].contents.name, mods[1].contents.op, mods[2]], ["cn", 2, null]);
    assert.throws(() => (mods[2] = () => 0), TypeError);
    // POINTER(POINTER(T)): elements are pointer objects (NULL → null)
    const pp = ctypes.cast(ctypes.addressof(mods), POINTER(POINTER(Mod)));
    assert.deepStrictEqual([pp[0].contents.name, pp[1].contents.op, pp[2]], ["cn", 2, null]);
    pp[2] = pointer(new Mod(3, "sn"));
    assert.strictEqual(mods[2].contents.name, "sn");
  });

  it("test_pointer_restype", function () {
    const strchr = libc.strchr;
    strchr.restype = POINTER(c_char);
    strchr.argtypes = [c_char_p, c_int];
    const p = strchr("abc", 98);
    assert.strictEqual(p.contents.value, "b");
    assert.strictEqual(strchr("abc", 120), null);
  });

  it("test_cast_char_p", function () {
    const p = ctypes.cast(new c_char_p("abc"), POINTER(c_char));
    assert.deepStrictEqual([p[0], p[1], p[2]], ["a", "b", "c"]);
    const w = ctypes.cast(new ctypes.c_wchar_p("xy"), POINTER(c_wchar));
    assert.deepStrictEqual([w[0], w[1]], ["x", "y"]);
  });

  it("test_cast_to_simple_pointers", function () {
    const buf = create_string_buffer("hello");
    const v = ctypes.cast(buf, c_void_p);
    assert.ok(v instanceof c_void_p);
    assert.strictEqual(v.value, ctypes.addressof(buf));
    assert.strictEqual(ctypes.cast(ctypes.addressof(buf), c_char_p).value, "hello");
    assert.strictEqual(ctypes.cast(new c_void_p(ctypes.addressof(buf)), c_char_p).value, "hello");
    const s = ctypes.cast(create_string_buffer("kept"), c_char_p);
    assert.strictEqual(s.value, "kept");
    assert.strictEqual(ctypes.cast(create_unicode_buffer("wz"), ctypes.c_wchar_p).value, "wz");
    const p = pointer(new c_int(7));
    assert.strictEqual(ctypes.cast(p, c_void_p).value, ctypes.addressof(p.contents));
  });

  it("test_type_identity", function () {
    assert.strictEqual(POINTER(c_int), POINTER(c_int));
    assert.strictEqual(ARRAY(c_int, 4), ARRAY(c_int, 4));
    assert.notStrictEqual(ARRAY(c_int, 4), ARRAY(c_int, 5));
    assert.strictEqual(pointer(new c_int(1))._pointerType, POINTER(c_int));
  });

  it("test_pointer_to_array", function () {
    const a = ARRAY(c_int, 3)(1, 2, 3);
    const p = pointer(a);
    assert.strictEqual(p.contents[1], 2);
    p.contents[1] = 20;
    assert.strictEqual(a[1], 20);
    assert.strictEqual(ctypes.addressof(p.contents), ctypes.addressof(a));
  });

  it("test_contents_same_size_type", function () {
    const p = POINTER(ctypes.c_uint32).create();
    p.contents = new c_int(-1);
    assert.strictEqual(p.contents.value, 4294967295);
  });

  it("test_rejects_non_pointers", function () {
    const memset = libc.memset;
    memset.restype = c_void_p;
    memset.argtypes = [c_void_p, c_int, c_size_t];
    for (const [v, name] of [
      [() => 0, "function"],
      [{}, "Object"],
      [3.5, "float"],
    ]) {
      assert.throws(
        () => memset(v, 0, 0),
        (e) => e instanceof ArgumentError && e.message === `argument 1: TypeError: '${name}' object cannot be interpreted as ctypes.c_void_p`,
      );
    }
  });
});
