import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE, LIBC } from "../_support.js";

const { ARRAY } = c;

describe("TestCallbacks", function () {
  let libc;
  beforeEach(() => {
    libc = new c.CDLL(LIBC);
  });

  it("test_qsort_callback", function () {
    const values = ARRAY(c.c_int, 5)(5, 2, 8, 1, 9);
    const compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p);
    const compare = compare_type((first, second) => c.cast(first, c.POINTER(c.c_int)).contents.value - c.cast(second, c.POINTER(c.c_int)).contents.value);
    const qsort = libc.qsort;
    qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p];
    qsort.restype = null;
    qsort(values, 5, c.sizeof(c.c_int), compare);
    assert.deepEqual([...values], [1, 2, 5, 8, 9]);
  });

  it("test_qsort_reverse_callback", function () {
    const values = ARRAY(c.c_int, 4)(3, 1, 4, 2);
    const compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p);
    const compare = compare_type((first, second) => c.cast(second, c.POINTER(c.c_int)).contents.value - c.cast(first, c.POINTER(c.c_int)).contents.value);
    const qsort = libc.qsort;
    qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p];
    qsort.restype = null;
    qsort(values, 4, c.sizeof(c.c_int), compare);
    assert.deepEqual([...values], [4, 3, 2, 1]);
  });

  it("test_qsort_float_callback", function () {
    const values = ARRAY(c.c_float, 3)(3.14, 1.41, 2.71);
    const compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p);
    const callback = compare_type((first, second) => {
      const first_value = c.cast(first, c.POINTER(c.c_float)).contents.value;
      const second_value = c.cast(second, c.POINTER(c.c_float)).contents.value;
      return Number(first_value > second_value) - Number(first_value < second_value);
    });
    const qsort = libc.qsort;
    qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p];
    qsort.restype = null;
    qsort(values, 3, c.sizeof(c.c_float), callback);
    for (const [index, expected] of [1.41, 2.71, 3.14].entries()) {
      assert.ok(Math.abs(values[index] - expected) < 0.0005);
    }
  });

  it("test_callback_properties", function () {
    const callback = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)(() => 0);
    assert.equal(typeof callback, "function");
    assert.equal(callback(null, null), 0);
    assert.ok(c.cast(callback, c.c_void_p).value);
  });

  it("test_aggregate_callback_constructs_before_copying_c_fields", function () {
    using lib = new c.CDLL(FIXTURE);
    const Words = ARRAY(c.c_int32, 2);
    for (const Base of [c.Structure, c.Union]) {
      const initialized = [];
      const received = [];
      class Record extends Base {
        static _fields_ =
          Base === c.Structure
            ? [
                ["x", c.c_int32],
                ["y", c.c_int32],
              ]
            : [
                ["scalar", c.c_int64],
                ["values", Words],
              ];
        constructor(...args) {
          super(...args);
          const view = Words.from_buffer(this);
          initialized.push([this, args.length, [...view], view]);
          view[0] = 90;
        }
      }
      const prototype = c.CFUNCTYPE(c.c_int32, Record);
      const callback = prototype((record) => {
        received.push(record);
        return Base === c.Structure ? record.x + record.y : record.values[0] + record.values[1];
      });
      try {
        let result;
        if (Base === c.Structure) {
          const invoke = lib.fixture_point_callback;
          invoke.argtypes = [prototype, c.c_int32, c.c_int32];
          invoke.restype = c.c_int32;
          result = invoke(callback, 3, 4);
        } else {
          const make = lib.fixture_return_union_make;
          make.argtypes = [c.c_int32, c.c_int32];
          make.restype = Record;
          result = callback(make(3, 4));
        }
        assert.equal(result, 7);
        assert.equal(initialized.length, 1);
        const [obj, argc, before, view] = initialized[0];
        assert.deepEqual([argc, before], [0, [0, 0]]);
        assert.equal(received[0], obj);
        assert.deepEqual([...view], [3, 4]);
        view[1] = 12;
        assert.equal(Base === c.Structure ? obj.y : obj.values[1], 12);
      } finally {
        callback.release();
      }
    }
  });

  it("test_callback_ignores_instance_call_attribute", function () {
    // The handler is invoked directly, like CPython's tp_call: own call/apply are ignored.
    const add = (first, second) => first + second;
    add.call = () => 99;
    add.apply = () => 99;
    const callback = c.CFUNCTYPE(c.c_int, c.c_int, c.c_int)(add);
    assert.equal(callback(3, 4), 7);
  });

  it("test_function_pointer_ignores_as_parameter_attribute", function () {
    const callback = c.CFUNCTYPE(c.c_int, c.c_int, c.c_int)((first, second) => first + second);
    const address = c.cast(callback, c.c_void_p).value;
    // _as_parameter_ is a read-only getter on the instance, so the override
    // lives on an object derived from it.
    const overridden = Object.create(callback, { _as_parameter_: { value: 0x1234n } });
    // memmove(dst, src, 0) copies nothing and returns dst.
    const memmove = libc.memmove;
    memmove.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t];
    memmove.restype = c.c_void_p;
    assert.equal(memmove(overridden, null, 0), address);
    assert.equal(callback(3, 4), 7);
  });

  it("test_callback_two_by_value_aggregates", function () {
    const lib = new c.CDLL(FIXTURE);
    class Bytes33 extends c.Structure {
      static _fields_ = [["values", c.ARRAY(c.c_uint8, 33)]];
    }
    const cbType = c.CFUNCTYPE(c.c_int32, Bytes33, Bytes33, c.c_void_p);
    const seen = [];
    const cb = cbType((first, second, rawPtr) => {
      first.values[0] = 99;
      seen.push([first.values[0], second.values[0], second.values[32], rawPtr !== null]);
      return first.values[0] + second.values[0] + second.values[32];
    });
    try {
      const invoke = lib.fixture_callback_large_alias;
      invoke.argtypes = [cbType, c.c_uint8];
      invoke.restype = c.c_int32;
      assert.equal(invoke(cb, 10), 99 + 10 + 42);
      assert.deepEqual(seen, [[99, 10, 42, true]]);
    } finally {
      cb.release();
    }
  });
});
