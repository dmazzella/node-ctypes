import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestScalarMarshalling", function () {
  let library;
  before(() => {
    library = new c.CDLL(FIXTURE);
  });
  after(() => library.close());

  it("test_scalar_argument_ignores_value_getter", function () {
    for (const [name, Type, stored] of [
      ["i32", c.c_int32, 7],
      ["u64", c.c_uint64, 5n],
      ["double", c.c_double, 1.5],
      ["char", c.c_char, "A"],
      ["wchar", c.c_wchar, "\u03a9"],
      ["bool", c.c_bool, false],
    ]) {
      let reads = 0;
      class Value extends Type {
        get value() {
          reads++;
          throw new Error("public value getter must not run");
        }
        set value(value) {
          super.value = value;
        }
      }
      const producer = c.CFUNCTYPE(Value, Type)([`fixture_scalar_${name}`, library]);
      for (const binding of ["attribute", "prototype"]) {
        const fn = binding === "attribute" ? library[`fixture_scalar_${name}`] : c.CFUNCTYPE(Type, Type)([`fixture_scalar_${name}`, library]);
        if (binding === "attribute") {
          fn.argtypes = [Type];
          fn.restype = Type;
        }
        for (const argument of [new Value(stored), Value.from_buffer(new Type(stored)), producer(stored)]) {
          assert.equal(fn(argument), stored);
          assert.equal(reads, 0);
        }
      }
    }
  });

  it("test_scalar_arguments_snapshot_before_later_conversion", function () {
    for (const binding of ["attribute", "prototype"]) {
      const first = new c.c_uint64(1n);
      class Later extends c.c_uint64 {
        static from_param(value) {
          first.value = 8n;
          return new Later(value);
        }
      }
      const types = [c.c_uint64, Later, c.c_uint64, c.c_uint64];
      const fn = binding === "attribute" ? library.fixture_exact_u64_four : c.CFUNCTYPE(c.c_uint64, ...types)(["fixture_exact_u64_four", library]);
      if (binding === "attribute") {
        fn.argtypes = types;
        fn.restype = c.c_uint64;
      }
      assert.equal(fn(first, 2n, 4n, 0n), 7n);
      assert.equal(first.value, 8n);
    }
  });

  it("test_untyped_scalar_argument_ignores_value_getter", function () {
    let reads = 0;
    class Value extends c.c_uint64 {
      get value() {
        reads++;
        throw new Error("public value getter must not run");
      }
      set value(value) {
        super.value = value;
      }
    }
    const fn = c.CFUNCTYPE(c.c_uint64)(["fixture_exact_u64_four", library]);
    assert.equal(fn(new Value(5n), new c.c_uint64(0n), new c.c_uint64(0n), new c.c_uint64(0n)), 5n);
    assert.equal(reads, 0);
  });

  it("test_untyped_scalar_snapshot_before_later_adapter", function () {
    const first = new c.c_uint64(1n);
    const later = {
      get _as_parameter_() {
        first.value = 8n;
        return new c.c_uint64(2n);
      },
    };
    const fn = c.CFUNCTYPE(c.c_uint64)(["fixture_exact_u64_four", library]);
    assert.equal(fn(first, later, new c.c_uint64(4n), new c.c_uint64(0n)), 7n);
    assert.equal(first.value, 8n);
  });

  it("test_from_param_accepts_same_storage_type", function () {
    class Adapted extends c.c_uint64 {
      static from_param(value) {
        return new c.c_uint64(value + 1n);
      }
    }
    const fn = c.CFUNCTYPE(c.c_uint64, Adapted, c.c_uint64, c.c_uint64, c.c_uint64)(["fixture_exact_u64_four", library]);
    assert.equal(fn(1n, 2n, 4n, 0n), 4n);
  });
});
