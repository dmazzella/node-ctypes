import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";
import { createTypeKey } from "../../lib/utils/cache.js";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");
async function collect() {
  for (let i = 0; i < 12; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("prototype signature interning", function () {
  it("reuses live signatures including aliases, without conflating type identity or ABI", function () {
    const type = c.CFUNCTYPE(c.c_int32, c.c_int32);
    assert.equal(c.CFUNCTYPE(c.c_int, c.c_int), type);
    assert.notEqual(c.CFUNCTYPE(c.c_uint32, c.c_int32), type);
    assert.notEqual(c.CFUNCTYPE(c.c_int32), type);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.c_uint32), type);
    assert.notEqual(c.WINFUNCTYPE(c.c_int32, c.c_int32), type);
    assert.equal(c.WINFUNCTYPE(c.c_int32, c.c_int32), c.WINFUNCTYPE(c.c_int32, c.c_int32));
    class Int extends c.c_int32 {}
    assert.notEqual(c.CFUNCTYPE(Int, c.c_int32), type);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, Int), type);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_int32)), c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_uint32)));
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_uint32), c.CFUNCTYPE(c.c_int32, c.c_uint32, c.c_int32));
    const first = c.struct({ value: c.c_int32 });
    const second = c.struct({ value: c.c_int32 });
    assert.notEqual(c.CFUNCTYPE(first, first), c.CFUNCTYPE(second, second));
    assert.notEqual(c.CFUNCTYPE("int32", "int32"), type);
  });

  it("does not use mutable public metadata as the cache key or native signature", function () {
    class Int extends c.c_int32 {}
    const type = c.CFUNCTYPE(Int, Int);
    type.restype = c.c_uint32;
    type.argtypes[0] = c.c_uint32;
    assert.equal(c.CFUNCTYPE(Int, Int), type);
    assert.notEqual(c.CFUNCTYPE(c.c_uint32, c.c_uint32), type);
    assert.notEqual(c.CFUNCTYPE(c.c_uint32, Int), type);
    const callback = type((value) => {
      assert.ok(value instanceof Int);
      return value.value;
    });
    callback.release();
  });

  it("uses weak identity keys that distinguish primitive representations", async function () {
    const key = createTypeKey();
    assert.notEqual(key(5), key("5"));
    assert.notEqual(key(null), key("null"));
    assert.notEqual(key(undefined), key("undefined"));
    const stable = {};
    assert.equal(key(stable), key(stable));
    assert.notEqual(key(stable), key({}));
    function abandon() {
      const value = {};
      key(value);
      return new WeakRef(value);
    }
    const reference = abandon();
    await collect();
    assert.equal(reference.deref(), undefined);
  });

  it("collects unused builtin signatures and recreates a valid canonical type", async function () {
    function abandon() {
      return Array.from({ length: 32 }, (_, length) =>
        new WeakRef(c.CFUNCTYPE(c.c_int32, ...Array(length).fill(c.c_uint16))));
    }
    const references = abandon();
    await collect();
    for (const reference of references) assert.equal(reference.deref(), undefined);
    const replacement = c.CFUNCTYPE(c.c_int32, c.c_uint16);
    assert.equal(c.CFUNCTYPE(c.c_int32, c.c_uint16), replacement);
  });

  it("does not retain custom types through signature keys or finalizer metadata", async function () {
    function abandon() {
      class Value extends c.c_int32 {}
      const prototype = c.CFUNCTYPE(Value, Value);
      return [new WeakRef(Value), new WeakRef(prototype)];
    }
    const references = abandon();
    await collect();
    for (const reference of references) assert.equal(reference.deref(), undefined);
  });
});

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
describe("interned prototype bindings", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => { lib = new c.CDLL(fixture); });
  after(() => lib.close());

  it("captures retval hooks for each binding, not once for the cached type", async function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) { return value.value + 1; }
    }
    const type = c.CFUNCTYPE(Result, c.c_int32);
    const first = type(["fixture_scalar_i32", lib]);
    Result._check_retval_ = (value) => value.value + 2;
    assert.equal(c.CFUNCTYPE(Result, c.c_int32), type);
    const second = type(["fixture_scalar_i32", lib]);
    assert.equal(first(7), 8);
    assert.equal(second(7), 9);
    assert.equal(await first.callAsync(7), 8);
    assert.equal(await second.callAsync(7), 9);
    Result._check_retval_ = 7;
    assert.throws(() => type(["fixture_scalar_i32", lib]), /_check_retval_ must be callable/);
  });

  it("rebuilds argument adapters for new bindings and keeps errcheck independent", function () {
    class Value extends c.c_int32 {}
    const type = c.CFUNCTYPE(c.c_int32, Value);
    const first = type(["fixture_scalar_i32", lib]);
    Value.from_param = (value) => new Value(value + 1);
    const second = type(["fixture_scalar_i32", lib]);
    first.errcheck = (value) => value + 10;
    assert.equal(first(7), 17);
    assert.equal(second(7), 8);
    Value.from_param = (value) => new Value(value + 2);
    assert.equal(first(7), 17);
    assert.equal(second(7), 9);
    first.errcheck = null;
  });

  it("public metadata edits do not alter caller or callback ABI/conversion", function () {
    class Value extends c.c_int32 {}
    const type = c.CFUNCTYPE(c.c_int32, Value);
    type.restype = c.c_uint32;
    type.argtypes[0] = c.c_uint32;
    const fn = type(["fixture_scalar_i32", lib]);
    assert.equal(fn(-7), -7);
    const callback = type((value) => {
      assert.ok(value instanceof Value);
      return value.value;
    });
    try {
      const invoke = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
      assert.equal(invoke(callback, -7), -7);
    } finally { callback.release(); }
  });

  for (const kind of ["caller", "callback", "paramflags"]) {
    it(`a live ${kind} retains its prototype but an abandoned binding does not`, async function () {
      function prepare() {
        class Value extends c.c_int32 {}
        const type = kind === "paramflags"
          ? c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Value))
          : c.CFUNCTYPE(c.c_int32, Value);
        const binding = kind === "callback" ? type((value) => value.value)
          : kind === "paramflags" ? type.bind(lib, "fixture_divmod", [[1, "a"], [1, "b"], [2, "remainder"]])
          : type(["fixture_scalar_i32", lib]);
        return { binding, type: new WeakRef(type), value: new WeakRef(Value) };
      }
      const state = prepare();
      await collect();
      assert.ok(state.type.deref());
      assert.ok(state.value.deref());
      if (kind === "callback") state.binding.release();
      else assert.equal(kind === "paramflags" ? state.binding(17, 5).value : state.binding(7), kind === "paramflags" ? 2 : 7);
      state.binding = null;
      await collect();
      assert.equal(state.type.deref(), undefined);
      assert.equal(state.value.deref(), undefined);
    });
  }
});
