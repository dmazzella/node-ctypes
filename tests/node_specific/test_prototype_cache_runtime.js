// Retained common/test_prototype_cache.js weak interning, JS callable metadata,
// WINFUNCTYPE's non-Windows extension and asynchronous entry-point regressions.
// Shared type identity and converter capture live in cpython_parity/calls.
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
      return Array.from({ length: 32 }, (_, length) => new WeakRef(c.CFUNCTYPE(c.c_int32, ...Array(length).fill(c.c_uint16))));
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

  it("cast function owners retain callable callback thunks until the owner is collected", async function () {
    function escape() {
      const callback = c.CFUNCTYPE(c.c_int32, c.c_int32)((value) => value + 1);
      return {
        owner: c.cast(c.cast(callback, c.c_void_p), c.CFUNCTYPE(c.c_int32, c.c_int32)),
        references: [new WeakRef(callback), new WeakRef(callback._callback), new WeakRef(callback._objects)],
      };
    }
    const state = escape();
    await collect();
    for (const reference of state.references) assert.ok(reference.deref());
    assert.equal(state.owner(7), 8);
    state.owner = null;
    await collect();
    for (const reference of state.references) assert.equal(reference.deref(), undefined);
  });
});

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
describe("interned prototype bindings", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  it("a prototype cast retains its source native function and library through async uses", async function () {
    function escape() {
      const library = new c.CDLL(fixture);
      const source = library.fixture_scalar_i32;
      source.argtypes = [c.c_int32];
      source.restype = c.c_int32;
      return {
        caller: c.cast(source, c.CFUNCTYPE(c.c_int32, c.c_int32)),
        references: [new WeakRef(source), new WeakRef(library._lib)],
      };
    }
    const state = escape();
    await collect();
    for (const reference of state.references) assert.ok(reference.deref());
    assert.equal(state.caller(-7), -7);
    assert.equal(await state.caller.callAsync(-7), -7);
    state.caller = null;
    await collect();
    for (const reference of state.references) assert.equal(reference.deref(), undefined);
  });

  for (const [name, make] of [
    ["CFUNCTYPE", c.CFUNCTYPE],
    ["WINFUNCTYPE", c.WINFUNCTYPE],
  ]) {
    it(`${name} callers preserve zero through seven argument signatures and callable metadata`, function () {
      for (let count = 0; count <= 7; count++) {
        const type = make(c.c_int32, ...Array(count).fill(c.c_int32));
        const callback = type((...values) => values.reduce((sum, value) => sum + value, 0));
        const fn = type(callback.pointer);
        const values = Array.from({ length: count }, (_, index) => index + 1);
        try {
          assert.equal(
            fn(...values),
            values.reduce((sum, value) => sum + value, 0),
          );
          assert.equal(fn.name, "callMethod");
          assert.equal(fn.length, 0);
          assert.equal(fn.address, callback.pointer);
          assert.equal(fn._as_parameter_, fn.address);
          assert.deepEqual(Object.keys(fn), []);
          assert.deepEqual(Object.getOwnPropertyDescriptor(fn, "length"), { value: 0, writable: false, enumerable: false, configurable: true });
          const descriptor = Object.getOwnPropertyDescriptor(fn, "callAsync");
          assert.equal(typeof descriptor.value, "function");
          assert.equal(descriptor.writable, false);
          assert.equal(descriptor.enumerable, false);
          assert.equal(descriptor.configurable, false);
        } finally {
          callback.release();
        }
      }
    });
  }

  for (const binding of ["address", "library"]) {
    it(`${binding} callers preserve original hook arguments and asynchronous results`, async function () {
      const type = c.CFUNCTYPE(c.c_int32, c.c_int32);
      const fn = type(binding === "address" ? lib.symbol("fixture_scalar_i32") : ["fixture_scalar_i32", lib]);
      assert.equal(fn(-7), -7);
      assert.equal(await fn.callAsync(-7), -7);
      assert.throws(() => fn(), /Expected 1 arguments, got 0/);
      const value = new c.c_int32(-7);
      fn.errcheck = (result, invoked, args) => {
        assert.equal(invoked, fn);
        assert.ok(Array.isArray(args));
        assert.equal(args.length, 1);
        assert.equal(args[0], value);
        return result + 1;
      };
      assert.equal(fn(value), -6);
      assert.equal(await fn.callAsync(value), -6);
      fn.errcheck = null;
      assert.equal(fn(-7), -7);
    });
  }

  it("async bindings retain the retval hook captured by the cached prototype", async function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const type = c.CFUNCTYPE(Result, c.c_int32);
    const first = type(["fixture_scalar_i32", lib]);
    Result._check_retval_ = (value) => value.value + 2;
    assert.equal(c.CFUNCTYPE(Result, c.c_int32), type);
    const second = type(["fixture_scalar_i32", lib]);
    assert.equal(first(7), 8);
    assert.equal(second(7), 8);
    assert.equal(await first.callAsync(7), 8);
    assert.equal(await second.callAsync(7), 8);
    Result._check_retval_ = 7;
    assert.equal(await type(["fixture_scalar_i32", lib]).callAsync(7), 8);
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
    } finally {
      callback.release();
    }
  });

  for (const kind of ["caller", "callback", "paramflags"]) {
    it(`a live ${kind} retains its prototype but an abandoned binding does not`, async function () {
      function prepare() {
        class Value extends c.c_int32 {}
        const type = kind === "paramflags" ? c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Value)) : c.CFUNCTYPE(c.c_int32, Value);
        const binding =
          kind === "callback"
            ? type((value) => value.value)
            : kind === "paramflags"
              ? type.bind(lib, "fixture_divmod", [
                  [1, "a"],
                  [1, "b"],
                  [2, "remainder"],
                ])
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
