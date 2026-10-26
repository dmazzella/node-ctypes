import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("Node binding, buffer and function-pointer interoperability", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  for (const async of [false, true]) {
    it(`typed pointers reject incompatible ctypes before ${async ? "async" : "sync"} C entry`, async function () {
      class Int extends c.c_int32 {}
      const P = c.POINTER(c.c_int32);
      const fn = lib.func("fixture_address", c.c_size_t, [P]);
      const invoke = (value) => (async ? fn.callAsync(value) : fn(value));
      const value = new c.c_int32(7);
      const derived = new Int(8);
      const array = c.array(c.c_int32, 2)(1, 2);
      for (const source of [value, derived, c.pointer(value), c.pointer(derived), array, c.byref(value), value._buffer, { _buffer: value._buffer }]) {
        assert.equal(await invoke(source), c.addressof(source?._pointerType ? source.contents : source));
      }
      assert.equal(await invoke(null), 0n);
      for (const wrong of [1.5, NaN, Infinity]) {
        if (async) await assert.rejects(async () => invoke(wrong), c.ArgumentError);
        else assert.throws(() => invoke(wrong), c.ArgumentError);
      }
      for (const wrong of [new c.c_double(2), c.pointer(new c.c_double(2)), c.array(c.c_double, 1)(2), c.byref(new c.c_double(2)), new c.c_void_p(c.addressof(value))]) {
        if (async) await assert.rejects(async () => invoke(wrong), c.ArgumentError);
        else assert.throws(() => invoke(wrong), c.ArgumentError);
      }
      const cast = c.cast(c.pointer(new c.c_double(2)), P);
      assert.equal(await invoke(cast), cast.address);
      assert.equal(await invoke(c.addressof(value)), c.addressof(value));
    });
  }

  it("structure pointer covariance preserves the original allocation", function () {
    class Base extends c.Structure {
      static _fields_ = [["x", c.c_int32]];
    }
    class Derived extends Base {
      static _fields_ = [["y", c.c_int32]];
    }
    const fn = lib.func("fixture_address", c.c_size_t, [c.POINTER(Base)]);
    const value = new Derived(1, 2);
    assert.equal(fn(value), c.addressof(value));
    assert.equal(fn(c.pointer(value)), c.addressof(value));
  });

  it("function pointers read from fields round-trip through fields, arrays and arguments", async function () {
    const Prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    class Record extends c.Structure {
      static _fields_ = [["function", Prototype]];
    }
    const source = Record.in_dll(lib, "fixture_global_function");
    const fn = source.function;
    const copy = new Record();
    copy.function = fn;
    assert.equal(copy.function(7), 8);
    const values = c.array(Prototype, 1)();
    values[0] = fn;
    assert.equal(values[0](7), 8);
    const invoke = lib.func("fixture_scalar_callback", c.c_int32, [Prototype, c.c_int32]);
    assert.equal(invoke(fn, 7), 8);
    assert.equal(await invoke.callAsync(fn, 7), 8);
    assert.throws(() => {
      copy.function = (value) => value;
    }, TypeError);
    assert.throws(() => invoke((value) => value, 7), c.ArgumentError);
  });

  it("library attributes and explicit bindings can be used as native function pointers", function () {
    const Prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    const invoke = lib.func("fixture_scalar_callback", c.c_int32, [Prototype, c.c_int32]);
    const direct = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    const attribute = lib.fixture_scalar_i32;
    attribute.argtypes = [c.c_int32];
    attribute.restype = c.c_int32;
    assert.equal(invoke(direct, 7), 7);
    assert.equal(invoke(attribute, 8), 8);
  });

  it("function pointer callback results unwrap FFI callables but reject bare JS functions", function () {
    const Prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    const target = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    const callback = c.callback(() => target, Prototype, []);
    try {
      const invoke = c.CFUNCTYPE(Prototype)(callback.pointer);
      assert.equal(invoke()(7), 7);
    } finally {
      callback.release();
    }
    const invalid = c.callback(() => () => 1, Prototype, []);
    try {
      assert.equal(c.CFUNCTYPE(Prototype)(invalid.pointer)(), null);
      assert.match(invalid._callback.getLastError(), /function.*cannot be interpreted/);
    } finally {
      invalid.release();
    }
  });

  it("explicit null casts and pointers to entire arrays remain valid", function () {
    const P = c.POINTER(c.c_int32);
    assert.equal(c.cast(null, P).isNull, true);
    assert.equal(c.cast(null, c.c_void_p).value, null);
    const A = c.array(c.c_int32, 2);
    const value = A(1, 2);
    const fn = lib.func("fixture_address", c.c_size_t, [c.POINTER(A)]);
    assert.equal(fn(value), c.addressof(value));
    assert.equal(fn(c.byref(value)), c.addressof(value));
  });

  it("OleDLL defaults to HRESULT without altering other loaders or explicit restypes", async function () {
    const library = new c.OleDLL(fixture);
    try {
      const fn = library.fixture_scalar_i32;
      assert.equal(fn.restype, c.HRESULT);
      fn.argtypes = [c.c_int32];
      assert.throws(() => fn(-1), /HRESULT/);
      await assert.rejects(fn.callAsync(-1), /HRESULT/);
      const defaultFn = library.func("fixture_scalar_i32");
      assert.throws(() => defaultFn(-1), /HRESULT/);
      fn.restype = c.c_int32;
      assert.equal(fn(-1), -1);
      assert.equal(lib.fixture_scalar_i32.restype, c.c_int32);
    } finally {
      library.close();
    }
  });
});
