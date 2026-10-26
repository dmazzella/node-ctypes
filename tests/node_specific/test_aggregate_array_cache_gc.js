// V8 weak-reference cleanup, native wrapper ownership and async signature lifetimes.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";
import { _toNativeType } from "../../lib/core/types.js";
import { cacheWeakValue } from "../../lib/utils/cache.js";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

async function collectGarbage() {
  for (let i = 0; i < 10; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("weak-value cache cleanup", function () {
  it("removes collected values and their keys from a live cache", async function () {
    const cache = new Map();
    function populate() {
      for (let key = 0; key < 32; key++) cacheWeakValue(cache, key, {});
    }
    populate();
    assert.equal(cache.size, 32);
    await collectGarbage();
    assert.equal(cache.size, 0);
  });

  it("does not delete a replacement when an older value is finalized", async function () {
    const cache = new Map();
    function populate() {
      cacheWeakValue(cache, 7, {});
      return cache.get(7);
    }
    const previous = populate();
    await new Promise((resolve) => setImmediate(resolve));
    gc();
    assert.equal(previous.deref(), undefined);
    const replacement = {};
    cacheWeakValue(cache, 7, replacement);
    await collectGarbage();
    assert.equal(cache.size, 1);
    assert.equal(cache.get(7).deref(), replacement);
  });

  it("cleans a replacement even if an older value remains live", async function () {
    const cache = new Map();
    const previous = {};
    cacheWeakValue(cache, 7, previous);
    function replace() {
      cacheWeakValue(cache, 7, {});
    }
    replace();
    await collectGarbage();
    assert.equal(cache.size, 0);
    assert.deepEqual(previous, {});
  });
});

describe("array type cache lifetime", function () {
  it("reuses live types without conflating element types or lengths", async function () {
    class Int extends c.c_int32 {}
    const type = c.array(c.c_int32, 17);
    const distinctElement = c.array(Int, 17);
    const distinctLength = c.array(c.c_int32, 18);
    const empty = c.array(c.c_int32, 0);
    await collectGarbage();
    assert.equal(c.array(c.c_int32, 17), type);
    assert.equal(c.array(c.c_int, 17), type);
    assert.equal(c.array(Int, 17), distinctElement);
    assert.equal(c.array(c.c_int32, 18), distinctLength);
    assert.equal(c.array(c.c_int32, -0), empty);
    assert.notEqual(type, distinctElement);
    assert.notEqual(type, distinctLength);
  });

  it("collects unused array types and native wrappers even for a builtin element", async function () {
    function abandon() {
      return Array.from({ length: 32 }, (_, index) => {
        const type = c.array(c.c_uint8, 10000 + index);
        return { type: new WeakRef(type), native: new WeakRef(type._native) };
      });
    }
    const references = abandon();
    await collectGarbage();
    for (const reference of references) {
      assert.equal(reference.type.deref(), undefined, "the builtin must not retain an unused array type");
      assert.equal(reference.native.deref(), undefined, "the cache must not retain the native wrapper");
    }
  });

  it("recreates a collected type with the same layout and then reuses it", async function () {
    function abandon() {
      return new WeakRef(c.array(c.c_uint16, 11001));
    }
    const reference = abandon();
    await collectGarbage();
    assert.equal(reference.deref(), undefined);
    const type = c.array(c.c_uint16, 11001);
    await collectGarbage();
    assert.equal(c.array(c.c_uint16, 11001), type);
    assert.equal(type.getLength(), 11001);
    assert.equal(type.getSize(), 22002);
    assert.equal(type.getAlignment(), c.alignment(c.c_uint16));
  });

  it("does not retain an abandoned custom element through cleanup metadata", async function () {
    function abandon() {
      class Element extends c.c_int32 {}
      const type = c.array(Element, 19);
      return { element: new WeakRef(Element), type: new WeakRef(type) };
    }
    const references = abandon();
    await collectGarbage();
    assert.equal(references.type.deref(), undefined);
    assert.equal(references.element.deref(), undefined);
  });

  it("collects unused endian variants together with their original array type", async function () {
    function abandon() {
      const type = c.array(c.c_uint16, 12001);
      const swapped = type._swappedType;
      return [new WeakRef(type), new WeakRef(swapped)];
    }
    const references = abandon();
    await collectGarbage();
    for (const reference of references) assert.equal(reference.deref(), undefined);
  });

  for (const [index, method] of ["call", "create", "wrap", "from_buffer", "from_buffer_copy", "from_address"].entries()) {
    it(`an instance made with ${method} retains its type until released`, async function () {
      const count = 20 + index;
      function prepare() {
        const type = c.array(c.c_int32, count);
        const source = Buffer.alloc(type.getSize());
        source.writeInt32LE(7);
        const instance = method === "call" ? type(7) : method === "create" ? type.create([7]) : method === "from_address" ? type.from_address(c.addressof(source)) : type[method](source);
        return { instance, source, type: new WeakRef(type) };
      }
      const state = prepare();
      await collectGarbage();
      assert.ok(state.type.deref());
      assert.equal(state.instance._arrayType, state.type.deref());
      assert.equal(c.array(c.c_int32, count), state.type.deref());
      assert.equal(state.instance[0], 7);
      state.instance[1] = 9;
      assert.equal(state.instance[1], 9);
      state.instance = null;
      await collectGarbage();
      assert.equal(state.type.deref(), undefined);
    });
  }

  for (const container of ["array", "pointer", "struct", "union"]) {
    it(`a live ${container} retains its dependent array type`, async function () {
      const count = 30 + ["array", "pointer", "struct", "union"].indexOf(container);
      function prepare() {
        const type = c.array(c.c_int32, count);
        const owner = container === "array" ? c.array(type, 2) : container === "pointer" ? c.POINTER(type) : c[container]({ values: type });
        return { owner, type: new WeakRef(type) };
      }
      const state = prepare();
      await collectGarbage();
      assert.ok(state.type.deref());
      assert.equal(c.array(c.c_int32, count), state.type.deref());
      state.owner = null;
      await collectGarbage();
      assert.equal(state.type.deref(), undefined);
    });
  }

  for (const binding of ["func", "attribute", "prototype"]) {
    it(`the ${binding} signature retains its array type for sync and async calls`, { skip: !existsSync(fixture) && `${fixture} not built` }, async function () {
      function prepare() {
        const library = new c.CDLL(fixture);
        const type = c.array(c.c_int32, 4);
        let fn;
        if (binding === "func") {
          fn = library.func("fixture_sum_int4", c.c_int32, [type]);
        } else if (binding === "attribute") {
          fn = library.fixture_sum_int4;
          fn.restype = c.c_int32;
          fn.argtypes = [type];
        } else {
          fn = c.CFUNCTYPE(c.c_int32, type)(["fixture_sum_int4", library]);
        }
        return { library, fn, type: new WeakRef(type) };
      }
      const state = prepare();
      try {
        await collectGarbage();
        assert.ok(state.type.deref());
        assert.equal(c.array(c.c_int32, 4), state.type.deref());
        const values = Buffer.from(new Int32Array([1, 2, 3, 4]).buffer);
        assert.equal(state.fn(values), 10);
        assert.equal(await state.fn.callAsync(values), 10);
      } finally {
        state.library.close();
        state.fn = null;
        state.library = null;
      }
      await collectGarbage();
      assert.equal(state.type.deref(), undefined);
    });
  }

  it("collects cached byte-array wrappers without invalidating native layout owners", async function () {
    const descriptors = [];
    class TrackedArray extends c.ArrayType {
      constructor(...args) {
        super(...args);
        descriptors.push(new WeakRef(this));
      }
    }
    function prepare() {
      class Packed extends c.Structure {
        static _pack_ = 1;
        static _fields_ = [
          ["tag", c.c_uint8],
          ["values", c.array(c.c_uint32, 6001)],
        ];
      }
      return _toNativeType(Packed, { ...c, ArrayType: TrackedArray });
    }
    const nativeType = prepare();
    assert.equal(descriptors.length, 1);
    await collectGarbage();
    assert.equal(descriptors[0].deref(), undefined);
    assert.equal(nativeType.getSize(), 24005);
    assert.equal(nativeType.getAlignment(), 1);
    const instance = nativeType.create();
    assert.equal(instance._buffer.length, 24005);
    assert.equal(nativeType.read(instance._buffer)["__bytes@1"].length, 24004);
  });
});
