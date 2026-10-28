import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestAsParameter", function () {
  let lib, integer, typedPointer, voidPointer, length;
  before(() => {
    lib = new c.CDLL(FIXTURE);
    integer = lib.fixture_scalar_i32;
    integer.argtypes = [c.c_int32];
    integer.restype = c.c_int32;
    typedPointer = lib.fixture_address;
    typedPointer.argtypes = [c.POINTER(c.c_int32)];
    typedPointer.restype = c.c_size_t;
    voidPointer = c.CFUNCTYPE(c.c_size_t, c.c_void_p)(["fixture_address", lib]);
    length = lib.fixture_string_length;
    length.argtypes = [c.c_char_p];
    length.restype = c.c_size_t;
  });
  after(() => {
    if (lib) lib.close();
  });

  it("test_nested_scalar_adapter", function () {
    assert.equal(integer({ _as_parameter_: { _as_parameter_: new c.c_int32(7) } }), 7);
  });

  it("test_from_param_returns_nested_adapter", function () {
    class Adapted extends c.c_int32 {
      static from_param(value) {
        return { _as_parameter_: { _as_parameter_: value } };
      }
    }
    const adapted = c.CFUNCTYPE(c.c_int32, Adapted)(["fixture_scalar_i32", lib]);
    assert.equal(adapted(9), 9);
  });

  it("test_nested_typed_pointer_adapter", function () {
    const value = new c.c_int32(11);
    assert.equal(typedPointer({ _as_parameter_: { _as_parameter_: c.pointer(value) } }), c.addressof(value));
  });

  it("test_nested_byref_adapter", function () {
    const value = new c.c_int32(11);
    assert.equal(typedPointer({ _as_parameter_: { _as_parameter_: c.byref(value) } }), c.addressof(value));
  });

  it("test_typed_null_pointer_adapter", function () {
    const value = c.cast(null, c.POINTER(c.c_int32));
    assert.equal(typedPointer({ _as_parameter_: { _as_parameter_: value } }), 0n);
  });

  it("test_typed_pointer_direct_conversions", function () {
    for (const value of [new c.c_int32(11), c.ARRAY(c.c_int32, 2)(11, 12), null]) {
      assert.equal(typedPointer(value), value === null ? 0n : c.addressof(value));
    }
  });

  it("test_typed_pointer_adapter_rejections", function () {
    for (const source of [new c.c_int32(11), c.ARRAY(c.c_int32, 2)(11, 12), null]) {
      for (const depth of [1, 2]) {
        let value = source;
        for (let i = 0; i < depth; i++) value = { _as_parameter_: value };
        assert.throws(() => typedPointer(value), c.ArgumentError);
      }
    }
  });

  it("test_prototype_typed_pointer_conversions", function () {
    const prototype = c.CFUNCTYPE(c.c_size_t, c.POINTER(c.c_int32));
    const fn = prototype(["fixture_address", lib]);
    const scalar = new c.c_int32(11);
    const array = c.ARRAY(c.c_int32, 2)(11, 12);
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
        if (implicit && depth > 0) assert.throws(() => fn(value), c.ArgumentError);
        else assert.equal(fn(value), expected);
      }
    }
  });

  it("test_aggregate_pointer_adapters", function () {
    for (const Base of [c.Structure, c.Union]) {
      class Record extends Base {
        static _fields_ = [["value", c.c_int32]];
      }
      const fn = c.CFUNCTYPE(c.c_size_t, c.POINTER(Record))(["fixture_address", lib]);
      const value = new Record(11);
      const array = c.ARRAY(Record, 2)();
      for (const [source, expected, implicit] of [
        [value, c.addressof(value), true],
        [array, c.addressof(array), true],
        [null, 0n, true],
        [c.pointer(value), c.addressof(value), false],
        [c.byref(value), c.addressof(value), false],
      ]) {
        for (const depth of [0, 1, 2]) {
          let argument = source;
          for (let i = 0; i < depth; i++) argument = { _as_parameter_: argument };
          if (implicit && depth > 0) assert.throws(() => fn(argument), c.ArgumentError);
          else assert.equal(fn(argument), expected);
        }
      }
    }
  });

  it("test_integer_terminal_read_once", function () {
    let reads = 0;
    const adapter = {
      get _as_parameter_() {
        reads++;
        return -7;
      },
    };
    assert.equal(integer(adapter), -7);
    assert.equal(reads, 1);
  });

  it("test_boolean_terminal_read_once", function () {
    for (const [value, expected] of [
      [true, 1],
      [false, 0],
    ]) {
      let reads = 0;
      const adapter = {
        get _as_parameter_() {
          reads++;
          return value;
        },
      };
      assert.equal(integer(adapter), expected);
      assert.equal(reads, 1);
    }
  });

  it("test_null_pointer_terminal", function () {
    assert.equal(voidPointer({ _as_parameter_: null }), 0n);
  });

  it("test_utf8_bytes_terminal", function () {
    const bytes = Buffer.from([0xc3, 0xa9, 0]);
    assert.equal(length({ _as_parameter_: bytes }), 2n);
  });

  it("test_invalid_integer_terminal", function () {
    for (const value of [1.5, NaN, Infinity, null]) {
      assert.throws(() => integer({ _as_parameter_: value }), c.ArgumentError);
    }
  });

  it("test_finite_adapter_chains", function () {
    for (const count of [128, 129, 256]) {
      let value = 7;
      for (let i = 0; i < count; i++) value = { _as_parameter_: value };
      assert.equal(integer(value), 7);
    }
  });

  it("test_stateful_self_revisits", function () {
    for (const count of [2, 3, 32, 129]) {
      let reads = 0;
      const adapter = {
        get _as_parameter_() {
          return ++reads >= count ? 7 : adapter;
        },
      };
      assert.equal(integer(adapter), 7);
      assert.equal(reads, count);
    }
  });

  it("test_nested_getter_order", function () {
    const reads = [];
    const inner = {
      get _as_parameter_() {
        reads.push("inner");
        return 7;
      },
    };
    const outer = {
      get _as_parameter_() {
        reads.push("outer");
        return inner;
      },
    };
    assert.equal(integer(outer), 7);
    assert.deepEqual(reads, ["outer", "inner"]);
  });

  it("test_self_recursion_error", function () {
    const adapter = {};
    adapter._as_parameter_ = adapter;
    assert.throws(
      () => integer(adapter),
      (error) => error instanceof c.ArgumentError && /recurs|stack/i.test(error.message),
    );
  });

  it("test_mutual_recursion_error", function () {
    const first = {},
      second = {};
    first._as_parameter_ = second;
    second._as_parameter_ = first;
    assert.throws(
      () => integer(first),
      (error) => error instanceof c.ArgumentError && /recurs|stack/i.test(error.message),
    );
  });

  it("test_getter_exception", function () {
    let reads = 0;
    const adapter = {
      get _as_parameter_() {
        if (++reads === 3) throw new RangeError("adapter sentinel");
        return adapter;
      },
    };
    assert.throws(
      () => integer(adapter),
      (error) => error instanceof c.ArgumentError && /adapter sentinel/.test(error.message),
    );
    assert.equal(reads, 3);
  });

  it("test_from_param_returns_stateful_adapter", function (t) {
    const library = new c.CDLL(FIXTURE);
    t.after(() => library.close());
    for (const binding of ["attribute", "prototype"]) {
      for (const count of [2, 3, 32, 129]) {
        const events = [];
        const argument = { _as_parameter_: 123 };
        class Changing {
          reads = 0;
          get _as_parameter_() {
            events.push("parameter");
            return ++this.reads >= count ? 7 : this;
          }
        }
        class Adapted extends c.c_int32 {
          static from_param(value) {
            assert.equal(value, argument);
            events.push("from_param");
            return new Changing();
          }
        }
        let fn;
        if (binding === "attribute") {
          fn = library.fixture_scalar_i32;
          fn.argtypes = [Adapted];
          fn.restype = c.c_int32;
        } else {
          fn = c.CFUNCTYPE(c.c_int32, Adapted)(["fixture_scalar_i32", library]);
        }
        assert.equal(fn(argument), 7);
        assert.deepEqual(events, ["from_param", ...Array(count).fill("parameter")]);
      }
    }
  });

  it("test_argument_conversion_order_and_failure", function () {
    const expected = [
      "from_param 0", "parameter 0",
      "from_param 1", "parameter 1",
      "from_param 2", "parameter 2",
      "from_param 3", "parameter 3",
    ];
    for (const stage of [null, "from_param", "parameter"]) {
      for (let failure = 0; failure < (stage === null ? 1 : 4); failure++) {
        const events = [];
        class Parameter {
          constructor(value) {
            this.value = value;
          }
          get _as_parameter_() {
            events.push(`parameter ${this.value}`);
            if (stage === "parameter" && this.value === failure) throw new Error("adapter sentinel");
            return 1n << BigInt(this.value);
          }
        }
        class Word extends c.c_uint64 {
          static from_param(value) {
            events.push(`from_param ${value}`);
            if (stage === "from_param" && value === failure) throw new Error("adapter sentinel");
            return new Parameter(value);
          }
        }
        const fn = c.CFUNCTYPE(c.c_uint64, Word, Word, Word, Word)(["fixture_exact_u64_four", lib]);
        fn.errcheck = (result, invoked, args) => {
          events.push("errcheck");
          assert.equal(invoked, fn);
          assert.deepEqual(args, [0, 1, 2, 3]);
          return result;
        };
        if (stage === null) {
          assert.equal(fn(0, 1, 2, 3), 15n);
          assert.deepEqual(events, [...expected, "errcheck"]);
        } else {
          assert.throws(
            () => fn(0, 1, 2, 3),
            (error) => error instanceof c.ArgumentError && new RegExp(`argument ${failure + 1}: .*adapter sentinel`).test(error.message),
          );
          const length = 2 * failure + (stage === "from_param" ? 1 : 2);
          assert.deepEqual(events, expected.slice(0, length));
        }
      }
    }
  });

  it("test_conversion_failure_prevents_native_write", function () {
    for (const stage of ["from_param", "parameter"]) {
      class Raising {
        get _as_parameter_() {
          throw new Error("adapter sentinel");
        }
      }
      class Value extends c.c_int32 {
        static from_param(value) {
          if (value === 7) return value;
          if (stage === "from_param") throw new Error("adapter sentinel");
          return new Raising();
        }
      }
      const fn = c.CFUNCTYPE(null, c.POINTER(c.c_int32), Value)(["fixture_fill_int4", lib]);
      const values = c.ARRAY(c.c_int32, 4)(-99, -99, -99, -99);
      assert.equal(fn(values, 7), undefined);
      assert.deepEqual([...values], [7, 8, 9, 10]);
      for (let index = 0; index < 4; index++) values[index] = -99;
      assert.throws(
        () => fn(values, 9),
        (error) => error instanceof c.ArgumentError && /argument 2: .*adapter sentinel/.test(error.message),
      );
      assert.deepEqual([...values], [-99, -99, -99, -99]);
    }
  });

  it("test_from_param_argument_error_wrapping", function (t) {
    const library = new c.CDLL(FIXTURE);
    t.after(() => library.close());
    for (const binding of ["attribute", "prototype"]) {
      for (const failure of [0, 1, 3]) {
        const sentinel = new c.ArgumentError("adapter sentinel");
        const calls = [];
        class Word extends c.c_uint64 {
          static from_param(value) {
            calls.push(value);
            if (value === failure) throw sentinel;
            return BigInt(value);
          }
        }
        let fn;
        if (binding === "attribute") {
          fn = library.fixture_exact_u64_four;
          fn.argtypes = [Word, Word, Word, Word];
          fn.restype = c.c_uint64;
        } else {
          fn = c.CFUNCTYPE(c.c_uint64, Word, Word, Word, Word)(["fixture_exact_u64_four", library]);
        }
        assert.throws(
          () => fn(0, 1, 2, 3),
          (error) => error instanceof c.ArgumentError && error !== sentinel && error.message === `argument ${failure + 1}: ArgumentError: adapter sentinel`,
        );
        assert.deepEqual(calls, Array.from({ length: failure + 1 }, (_, index) => index));
      }
    }
  });
});
