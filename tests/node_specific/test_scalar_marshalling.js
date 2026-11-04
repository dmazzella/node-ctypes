import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";
import { activeArgumentOwners, activeOwnerStack } from "../../lib/structures/helpers/common.js";
import { FIXTURE } from "../cpython_parity/_support.js";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

describe("Scalar argument storage", function () {
  let library;
  beforeEach(() => {
    library = new c.CDLL(FIXTURE);
  });
  afterEach(() => {
    library.close();
    assert.equal(activeOwnerStack.length, 0);
    assert.equal(activeArgumentOwners.size, 0);
  });

  const types = [c.c_uint64, c.c_uint64, c.c_uint64, c.c_uint64];
  const data = () => [1n, 2n, 3n, 4n].map((value) => new c.c_uint64(value));
  const bind = () => library.func("fixture_exact_u64_four", c.c_uint64, types);

  it("ignores public value getters through func, attributes and prototypes", function () {
    for (const binding of ["func", "attribute", "prototype"]) {
      let fn;
      if (binding === "attribute") {
        fn = library.fixture_exact_u64_four;
        fn.argtypes = types;
        fn.restype = c.c_uint64;
      } else {
        fn = binding === "func" ? bind() : c.CFUNCTYPE(c.c_uint64, ...types)(["fixture_exact_u64_four", library]);
      }
      const values = data();
      Object.defineProperty(values[0], "value", {
        get() {
          throw new Error("public value getter must not run");
        },
      });
      assert.equal(fn(...values), 4n);
    }
  });

  it("preserves primitives, original errcheck arguments, adapters and async calls", async function () {
    const fn = bind();
    const values = data();
    assert.equal(fn(1n, 2n, 3n, 4n), 4n);
    assert.equal(fn(values[0], 2n, 3n, 4n), 4n);
    fn.errcheck = (result, invoked, args) => {
      assert.equal(invoked, fn);
      assert.deepEqual(args, values);
      return result;
    };
    assert.equal(fn(...values), 4n);
    assert.equal(await fn.callAsync(...values), 4n);
    fn.errcheck = null;
    assert.equal(await fn.callAsync(...values), 4n);
    assert.equal(fn(values[0], { _as_parameter_: values[1] }, values[2], values[3]), 4n);
  });

  it("copies each scalar before the next storage getter and recovers after failure", function () {
    const fn = bind();
    const values = data();
    const buffer = values[1]._buffer;
    let fail = true;
    let reads = 0;
    const sentinel = new Error("storage sentinel");
    Object.defineProperty(values[1], "_buffer", {
      get() {
        reads++;
        values[0].value = 8n;
        if (fail) throw sentinel;
        return buffer;
      },
      configurable: true,
    });
    assert.throws(
      () => fn(...values),
      (error) => error === sentinel,
    );
    assert.equal(activeOwnerStack.length, 0);
    fail = false;
    values[0].value = 1n;
    assert.equal(fn(...values), 4n);
    assert.equal(values[0].value, 8n);
    assert.equal(reads, 2);
  });

  it("keeps native errcheck values stable during reentry", function () {
    const fn = bind();
    let nested = false;
    const values = data();
    fn._ffi.setErrcheck((result, invoked, args) => {
      assert.equal(invoked, fn._ffi);
      if (nested) {
        assert.deepEqual(args, [2n, 4n, 0n, 0n]);
        return result;
      }
      assert.deepEqual(args, [1n, 2n, 3n, 4n]);
      values[0].value = 99n;
      nested = true;
      return fn(new c.c_uint64(2n), new c.c_uint64(4n), new c.c_uint64(0n), new c.c_uint64(0n)) ^ result;
    });
    assert.equal(fn(...values), 2n);
  });

  it("supports C callback reentry while collecting garbage", function () {
    const outer = library.func("fixture_u64_pair_callback", c.c_uint64, [c.c_void_p, c.c_uint64, c.c_uint64]);
    const inner = bind();
    const values = data();
    const callback = c.callback(
      (first, second) => {
        gc();
        return inner(...values) ^ first ^ second;
      },
      c.c_uint64,
      [c.c_uint64, c.c_uint64],
    );
    try {
      assert.equal(outer(callback, new c.c_uint64(1n), new c.c_uint64(8n)), 13n);
    } finally {
      callback.release();
    }
  });

  it("preserves aliases, replacement buffers and constructor-free views", function () {
    const fn = bind();
    const value = new c.c_uint64(1n);
    const bytes = value._buffer;
    bytes.writeBigUInt64LE(7n);
    assert.equal(value.value, 7n);
    value.value = 9n;
    assert.equal(bytes.readBigUInt64LE(), 9n);
    value._buffer = Buffer.alloc(8);
    value.value = 1n;
    assert.equal(fn(value, 2n, 3n, 4n), 4n);
    assert.equal(bytes.readBigUInt64LE(), 9n);
    class Derived extends c.c_uint64 {
      constructor() {
        throw new Error("constructor must not run");
      }
    }
    const view = Derived.from_buffer(value);
    assert.equal(view.value, 1n);
    view.value = 7n;
    assert.equal(value.value, 7n);
    assert.equal(fn(value, 2n, 3n, 4n), 2n);
  });

  it("preserves type reader overrides", function () {
    const fn = bind();
    const values = data();
    const reader = Object.getOwnPropertyDescriptor(c.c_uint64, "_reader");
    try {
      Object.defineProperty(c.c_uint64, "_reader", { ...reader, value: () => 99n });
      assert.equal(fn(...values), 0n);
    } finally {
      Object.defineProperty(c.c_uint64, "_reader", reader);
    }
  });

  it("preserves logical swapped-view values and refreshes mirrors", function () {
    class Value extends c.c_uint64 {}
    class Record extends c.BigEndianStructure {
      static _fields_ = [["value", Value]];
    }
    const record = new Record();
    record.value = 5n;
    const fn = c.CFUNCTYPE(c.c_uint64, Value)(["fixture_scalar_u64", library]);
    assert.equal(fn(record.value), 5n);
    const source = new c.c_uint64(7n);
    const view = c.c_uint64.from_address(c.addressof(source));
    source.value = 9n;
    assert.equal(bind()(view, new c.c_uint64(2n), new c.c_uint64(3n), new c.c_uint64(4n)), 12n);
  });
});
