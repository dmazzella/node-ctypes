import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

describe("scalar buffer factories", function () {
  for (const method of ["from_buffer", "from_buffer_copy"]) {
    for (const T of [c.c_int32, c.c_uint64, c.c_double, c.c_void_p]) {
      it(`${T.name}.${method} validates before exposing memory`, function () {
        for (const offset of [-1, 0.5, NaN, Infinity, 2 ** 54]) {
          assert.throws(() => T[method](Buffer.alloc(16), offset), /offset|small|size/i);
        }
        assert.throws(() => T[method](Buffer.alloc(c.sizeof(T) - 1)), /small|size/i);
        assert.throws(() => T[method](Buffer.alloc(16), 17), /small|size/i);
      });
    }
  }

  it("accepts byte-addressed typed views and bypasses derived constructors", function () {
    class Value extends c.c_int32 {
      constructor() { throw new Error("constructor must not run"); }
      static _writer() { throw new Error("writer must not run"); }
    }
    const source = Buffer.from(new Int32Array([7, 8]).buffer);
    for (const view of [source, new Uint8Array(source.buffer, source.byteOffset, source.byteLength), new DataView(source.buffer, source.byteOffset, source.byteLength)]) {
      const borrowed = Value.from_buffer(view, 4);
      const copied = Value.from_buffer_copy(view, 4);
      assert.ok(borrowed instanceof Value);
      assert.equal(borrowed.value, 8);
      assert.equal(copied.value, 8);
      assert.notEqual(copied._buffer.buffer, source.buffer);
    }
  });
});

describe("memory API address contracts", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => { lib = new c.CDLL(fixture); });
  after(() => lib.close());

  it("byref offsets preserve the origin and signed address arithmetic", function () {
    const source = c.array(c.c_int32, 3)(1, 2, 3);
    const address = lib.func("fixture_address", c.c_size_t, [c.c_void_p]);
    for (const offset of [-4, 0, 1, 4, 8, 12, 16]) {
      assert.equal(address(c.byref(source, offset)), c.addressof(source) + BigInt(offset));
    }
    for (const offset of [0.5, NaN, Infinity, "4"]) assert.throws(() => c.byref(source, offset), /offset/i);
    assert.equal(c.cast(c.byref(source, 4), c.POINTER(c.c_int32))[0], 2);
    assert.ok(Buffer.isBuffer(c.byref(source)));
  });

  it("memmove and memset return destination addresses for views, pointers and zero counts", function () {
    const source = Buffer.from([1, 2, 3, 4]);
    const destination = Buffer.alloc(8);
    for (const value of [destination, new Uint8Array(destination.buffer, destination.byteOffset, 8), new DataView(destination.buffer, destination.byteOffset, 8), destination.buffer]) {
      const address = c.addressof(Buffer.from(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength));
      assert.equal(c.memmove(value, source, 4), address);
      assert.equal(c.memset(value, 7, 2), address);
      assert.equal(c.memmove(value, source, 0), address);
    }
    const pointer = c.cast(destination, c.POINTER(c.c_uint8));
    assert.equal(c.memmove(pointer, source, 4), c.addressof(destination));
    assert.equal(c.memset(pointer, 0, 4), c.addressof(destination));
    assert.equal(c.memmove(null, null, 0), 0n);
    assert.equal(c.memset(0n, 0, 0), 0n);
    assert.throws(() => c.memmove(null, source, 1), /NULL/);
    assert.deepEqual([...destination.subarray(0, 4)], [0, 0, 0, 0]);
    const slice = destination.subarray(2);
    assert.equal(c.memset(slice, 1, 2), c.addressof(destination) + 2n);
    for (const count of [-1, NaN, 1.5, Infinity]) assert.throws(() => c.memmove(destination, source, count), /count/);
  });

  it("byref views retain their original wrapper until the reference is discarded", async function () {
    function prepare() {
      const value = new c.c_int32(7);
      return { reference: c.byref(value, 1), weak: new WeakRef(value) };
    }
    const state = prepare();
    for (let i = 0; i < 10; i++) { gc(); await new Promise((resolve) => setImmediate(resolve)); }
    assert.ok(state.weak.deref());
    state.reference = null;
    for (let i = 0; i < 10; i++) { gc(); await new Promise((resolve) => setImmediate(resolve)); }
    assert.equal(state.weak.deref(), undefined);
  });

  it("address results never reuse cached pointers after resize or detachment", function () {
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const view = new Uint8Array(resizable);
    assert.equal(c.memset(view, 1, 0), c.addressof(view));
    resizable.resize(16);
    assert.equal(c.memset(view, 1, 0), c.addressof(view));
    const fixed = new ArrayBuffer(8);
    const bytes = new Uint8Array(fixed);
    c.memset(bytes, 0, 0);
    structuredClone(fixed, { transfer: [fixed] });
    assert.equal(c.memset(bytes, 0, 0), 0n);
  });
});
