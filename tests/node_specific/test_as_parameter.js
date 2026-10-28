import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

describe("Node-specific parameter adapters", function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => {
    if (lib) lib.close();
  });

  it("recursive adapters resolve ctypes and reject unbounded recursion for async calls", async function () {
    const fn = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    const pointer = lib.func("fixture_address", c.c_size_t, [c.POINTER(c.c_int32)]);
    assert.equal(await fn.callAsync({ _as_parameter_: { _as_parameter_: new c.c_int32(7) } }), 7);
    class Adapted extends c.c_int32 {
      static from_param(value) {
        return { _as_parameter_: { _as_parameter_: value } };
      }
    }
    const adapted = lib.func("fixture_scalar_i32", c.c_int32, [Adapted]);
    assert.equal(await adapted.callAsync(9), 9);
    const target = new c.c_int32(11);
    assert.equal(await pointer.callAsync({ _as_parameter_: { _as_parameter_: c.pointer(target) } }), c.addressof(target));
    const self = {};
    self._as_parameter_ = self;
    const first = {},
      second = {};
    first._as_parameter_ = second;
    second._as_parameter_ = first;
    let deep = 7;
    for (let i = 0; i < 256; i++) deep = { _as_parameter_: deep };
    assert.equal(await fn.callAsync(deep), 7);
    for (const bad of [self, first]) {
      await assert.rejects(
        async () => fn.callAsync(bad),
        (error) => error instanceof c.ArgumentError && /recurs|stack/i.test(error.message),
      );
    }
  });

  it("library and prototype async callers preserve typed pointer adapter rules", async function () {
    const prototype = c.CFUNCTYPE(c.c_size_t, c.POINTER(c.c_int32));
    const scalar = new c.c_int32(11);
    const array = c.array(c.c_int32, 2)(11, 12);
    for (const fn of [lib.func("fixture_address", c.c_size_t, [c.POINTER(c.c_int32)]), prototype(["fixture_address", lib])]) {
      for (const [source, expected, implicit] of [
        [scalar, c.addressof(scalar), true],
        [array, c.addressof(array), true],
        [null, 0n, true],
        [c.pointer(scalar), c.addressof(scalar), false],
        [c.byref(scalar), c.addressof(scalar), false],
        [c.cast(null, c.POINTER(c.c_int32)), 0n, false],
      ]) {
        for (const depth of [0, 1, 2]) {
          let value = source;
          for (let i = 0; i < depth; i++) value = { _as_parameter_: value };
          if (implicit && depth > 0) await assert.rejects(async () => fn.callAsync(value), c.ArgumentError);
          else assert.equal(await fn.callAsync(value), expected);
        }
      }
    }
  });

  it("terminal adapters preserve primitive values and getter order for async calls", async function () {
    const integer = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    const length = lib.func("fixture_string_length", c.c_size_t, [c.c_char_p]);
    const address = lib.func("fixture_address", c.c_size_t, [c.c_void_p]);
    for (const [value, expected] of [
      [-7, -7],
      [-7n, -7],
      [true, 1],
      [false, 0],
    ]) {
      const reads = [];
      const adapter = {
        get _as_parameter_() {
          reads.push("parameter");
          return value;
        },
      };
      assert.equal(await integer.callAsync(adapter), expected);
      assert.deepEqual(reads, ["parameter"]);
    }
    assert.equal(await length.callAsync({ _as_parameter_: "é" }), 2n);
    assert.equal(await address.callAsync({ _as_parameter_: null }), 0n);
    await assert.rejects(async () => integer.callAsync({ _as_parameter_: Symbol("not an integer") }), c.ArgumentError);
  });

  it("BigInt, string and Symbol adapter terminals preserve synchronous Node conversions", function () {
    const integer = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    const length = lib.func("fixture_string_length", c.c_size_t, [c.c_char_p]);
    const reads = [];
    const adapter = {
      get _as_parameter_() {
        reads.push("parameter");
        return -7n;
      },
    };
    assert.equal(integer(adapter), -7);
    assert.deepEqual(reads, ["parameter"]);
    assert.equal(length({ _as_parameter_: "é" }), 2n);
    assert.throws(() => integer({ _as_parameter_: Symbol("not an integer") }), c.ArgumentError);
  });

  it("finite adapter chains and changing getters work for async calls", async function () {
    const fn = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
    for (const count of [128, 129, 256]) {
      let value = 7;
      for (let i = 0; i < count; i++) value = { _as_parameter_: value };
      assert.equal(await fn.callAsync(value), 7);
    }
    for (const count of [2, 3, 32, 129]) {
      let reads = 0;
      const repeated = {
        get _as_parameter_() {
          return ++reads >= count ? 7 : repeated;
        },
      };
      assert.equal(await fn.callAsync(repeated), 7);
      assert.equal(reads, count);
    }
  });

  it("from_param ArgumentError retains argument context and cause for all callers", async function () {
    for (const failure of [0, 1, 3]) {
      const sentinel = new c.ArgumentError("adapter sentinel");
      class Word extends c.c_uint64 {
        static from_param(value) {
          if (value === failure) throw sentinel;
          return BigInt(value);
        }
      }
      const attribute = lib.fixture_exact_u64_four;
      attribute.argtypes = [Word, Word, Word, Word];
      attribute.restype = c.c_uint64;
      const callers = [
        attribute,
        lib.func("fixture_exact_u64_four", c.c_uint64, [Word, Word, Word, Word]),
        c.CFUNCTYPE(c.c_uint64, Word, Word, Word, Word)(["fixture_exact_u64_four", lib]),
      ];
      const check = (error) =>
        error instanceof c.ArgumentError &&
        error !== sentinel &&
        error.cause === sentinel &&
        error.message === `argument ${failure + 1}: ArgumentError: adapter sentinel`;
      for (const fn of callers) {
        assert.throws(() => fn(0, 1, 2, 3), check);
        await assert.rejects(async () => fn.callAsync(0, 1, 2, 3), check);
      }
    }
  });

  for (const async of [false, true]) {
    it(`recursive adapter getter errors preserve their cause for ${async ? "async" : "sync"} calls`, async function () {
      const fn = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
      const sentinel = new RangeError("adapter sentinel");
      let reads = 0;
      const adapter = {
        get _as_parameter_() {
          if (++reads === 3) throw sentinel;
          return adapter;
        },
      };
      const check = (error) => error instanceof c.ArgumentError && error.cause === sentinel && /adapter sentinel/.test(error.message);
      if (async) await assert.rejects(async () => fn.callAsync(adapter), check);
      else assert.throws(() => fn(adapter), check);
      assert.equal(reads, 3);
    });

    it(`undefined terminal getters keep the original object for ${async ? "async" : "sync"} calls`, async function () {
      const fn = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
      let reads = 0;
      const adapter = {
        get _as_parameter_() {
          return ++reads === 1 ? adapter : undefined;
        },
      };
      const check = (error) => error instanceof c.ArgumentError && !/cycle|maximum depth/i.test(error.message);
      if (async) await assert.rejects(async () => fn.callAsync(adapter), check);
      else assert.throws(() => fn(adapter), check);
      assert.ok(reads >= 2);
    });
  }

  it("recursive memory adapters retain parents and release recursion failures", async function () {
    const bytes = Buffer.alloc(4);
    let parentReference;
    const terminal = {
      get _as_parameter_() {
        gc();
        assert.ok(parentReference.deref(), "the parent adapter must survive nested getter collection");
        return bytes;
      },
    };
    let adapter = { _as_parameter_: terminal };
    parentReference = new WeakRef(adapter);
    await new Promise(setImmediate);
    c.memset(adapter, 0x5a, bytes.length);
    assert.deepEqual([...bytes], [0x5a, 0x5a, 0x5a, 0x5a]);
    adapter = null;
    for (let i = 0; i < 12; i++) {
      gc();
      await new Promise(setImmediate);
    }
    assert.equal(parentReference.deref(), undefined);

    function fail() {
      const cyclic = {};
      cyclic._as_parameter_ = cyclic;
      const reference = new WeakRef(cyclic);
      assert.throws(() => c.memset(cyclic, 0, 1), RangeError);
      return reference;
    }
    const failed = fail();
    for (let i = 0; i < 12; i++) {
      gc();
      await new Promise(setImmediate);
    }
    assert.equal(failed.deref(), undefined, "a failed recursive conversion must not leak its owners");
  });

  it("adapter intermediates keep otherwise opaque pointer owners alive through async callbacks", async function () {
    let weak;
    const callback = c.threadSafeCallback(
      () => {
        gc();
        return weak.deref() === undefined ? 0 : 1;
      },
      c.c_int32,
      [],
    );
    const fn = lib.func("fixture_owner_check", c.c_int32, [c.POINTER(c.c_int32), c.c_void_p]);
    try {
      const adapter = {
        get _as_parameter_() {
          const owner = new c.c_int32(7);
          weak = new WeakRef(owner);
          return {
            owner,
            _as_parameter_: c.POINTER(c.c_int32).fromAddress(c.addressof(owner)),
          };
        },
      };
      assert.equal(await fn.callAsync(adapter, callback), 1);
      for (let i = 0; i < 10; i++) {
        gc();
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(weak.deref(), undefined);
    } finally {
      callback.release();
    }
  });
});
