import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { LIBC } from "../_support.js";

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
});
