import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestApiCompatibility", function () {
  let lib;
  before(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_typed_pointer_compatibility", function () {
    class Derived extends c.c_int32 {}
    const value = new c.c_int32(7),
      derived = new Derived(7);
    const array = c.ARRAY(c.c_int32, 2)();
    const fn = lib.fixture_address;
    fn.argtypes = [c.POINTER(c.c_int32)];
    fn.restype = c.c_size_t;
    for (const [source, expected] of [
      [null, 0n],
      [value, c.addressof(value)],
      [derived, c.addressof(derived)],
      [c.pointer(value), c.addressof(value)],
      [array, c.addressof(array)],
      [c.byref(value), c.addressof(value)],
    ])
      assert.equal(fn(source), expected);
    for (const incompatible of [new c.c_double(2), c.pointer(new c.c_double(2)), c.byref(new c.c_double(2)), new c.c_void_p()]) {
      assert.throws(() => fn(incompatible), c.ArgumentError);
    }
  });

  it("test_scalar_buffer_bounds", function () {
    for (const kind of [c.c_int32, c.c_uint64, c.c_double, c.c_void_p]) {
      for (const method of ["from_buffer", "from_buffer_copy"]) {
        assert.throws(() => kind[method](Buffer.alloc(c.sizeof(kind) - 1)), RangeError);
        assert.throws(() => kind[method](Buffer.alloc(16), -1), RangeError);
        assert.throws(() => kind[method](Buffer.alloc(16), 17), RangeError);
      }
    }
  });

  it("test_signed_byref_offset", function () {
    const value = new c.c_int32();
    const base = c.addressof(value);
    for (const offset of [-4, 0, 1, 4, 8]) {
      assert.equal(c.cast(c.byref(value, offset), c.c_void_p).value, base + BigInt(offset));
    }
  });

  it("test_memory_returns", function () {
    const destination = c.create_string_buffer(8),
      source = c.create_string_buffer("abc");
    assert.equal(c.memmove(destination, source, 4), c.addressof(destination));
    assert.equal(c.memset(destination, 0, 4), c.addressof(destination));
  });

  it("test_structure_pointer_covariance", function () {
    class Base extends c.Structure {
      static _fields_ = [["x", c.c_int32]];
    }
    class Derived extends Base {
      static _fields_ = [["y", c.c_int32]];
    }
    const fn = lib.fixture_address;
    fn.argtypes = [c.POINTER(Base)];
    fn.restype = c.c_size_t;
    const value = new Derived(1, 2);
    assert.equal(fn(value), c.addressof(value));
    assert.equal(fn(c.pointer(value)), c.addressof(value));
  });
});
