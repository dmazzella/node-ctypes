import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestPrototypeCache", function () {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_signature_identity", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    assert.equal(c.CFUNCTYPE(c.c_int, c.c_int), prototype);
    assert.notEqual(c.CFUNCTYPE(c.c_uint32, c.c_int32), prototype);
    assert.notEqual(c.CFUNCTYPE(c.c_int32), prototype);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.c_uint32), prototype);
    class Int extends c.c_int32 {}
    class First extends c.Structure {
      static _fields_ = [["value", c.c_int32]];
    }
    class Second extends c.Structure {
      static _fields_ = [["value", c.c_int32]];
    }
    assert.notEqual(c.CFUNCTYPE(Int, c.c_int32), prototype);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, Int), prototype);
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_int32)), c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_uint32)));
    assert.notEqual(c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_uint32), c.CFUNCTYPE(c.c_int32, c.c_uint32, c.c_int32));
    assert.notEqual(c.CFUNCTYPE(First, First), c.CFUNCTYPE(Second, Second));
  });

  it("test_stdcall_identity", { skip: process.platform !== "win32" && "WINFUNCTYPE requires Windows" }, function () {
    assert.notEqual(c.WINFUNCTYPE(c.c_int32, c.c_int32), c.CFUNCTYPE(c.c_int32, c.c_int32));
    assert.equal(c.WINFUNCTYPE(c.c_int32, c.c_int32), c.WINFUNCTYPE(c.c_int32, c.c_int32));
  });

  it("test_zero_to_seven_argument_signatures", function () {
    for (let count = 0; count <= 7; count++) {
      const prototype = c.CFUNCTYPE(c.c_int32, ...Array(count).fill(c.c_int32));
      const callback = prototype((...values) => values.reduce((sum, value) => sum + value, 0));
      const function_ = prototype(c.cast(callback, c.c_void_p).value);
      const values = Array.from({ length: count }, (_, index) => index + 1);
      assert.equal(
        function_(...values),
        values.reduce((sum, value) => sum + value, 0),
      );
    }
  });

  it("test_library_binding_arguments", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    const function_ = prototype(["fixture_scalar_i32", lib]);
    assert.equal(function_(-7), -7);
    assert.throws(() => function_(), TypeError);
    const value = new c.c_int32(-7);
    const received = [];
    function_.errcheck = (result, invoked, arguments_) => {
      received.push([invoked === function_, arguments_[0] === value, arguments_.length]);
      return result + 1;
    };
    assert.equal(function_(value), -6);
    assert.deepEqual(received, [[true, true, 1]]);
    function_.errcheck = null;
    assert.equal(function_(-7), -7);
  });

  it("test_address_binding_arguments", function () {
    const address = c.cast(lib.fixture_scalar_i32, c.c_void_p).value;
    const function_ = c.CFUNCTYPE(c.c_int32, c.c_int32)(address);
    assert.equal(function_(-7), -7);
    assert.throws(() => function_(), TypeError);
    const value = new c.c_int32(-7);
    const received = [];
    function_.errcheck = (result, invoked, arguments_) => {
      received.push([invoked === function_, arguments_[0] === value, arguments_.length]);
      return result + 1;
    };
    assert.equal(function_(value), -6);
    assert.deepEqual(received, [[true, true, 1]]);
    function_.errcheck = null;
    assert.equal(function_(-7), -7);
  });

  it("test_variadic_prototype", function () {
    const function_ = c.CFUNCTYPE(c.c_int32, c.c_void_p, c.c_int32)(["fixture_variadic_sum", lib]);
    assert.equal(function_(null, 0), 0);
    assert.equal(function_(null, 3, 7, 8, 9), 24);
    assert.equal(function_(null, 1, -7), -7);
    assert.throws(() => function_(null), TypeError);
  });

  it("test_retval_hook_capture", function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32);
    const first = prototype(["fixture_scalar_i32", lib]);
    Result._check_retval_ = (value) => value.value + 2;
    assert.equal(c.CFUNCTYPE(Result, c.c_int32), prototype);
    const second = prototype(["fixture_scalar_i32", lib]);
    assert.equal(first(7), 8);
    assert.equal(second(7), 8);
  });

  it("test_replaced_retval_not_revalidated", function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32);
    Result._check_retval_ = 7;
    const function_ = prototype(["fixture_scalar_i32", lib]);
    assert.equal(function_(7), 8);
  });

  it("test_argument_converter_capture", function () {
    class Value extends c.c_int32 {}
    const prototype = c.CFUNCTYPE(c.c_int32, Value);
    const first = prototype(["fixture_scalar_i32", lib]);
    Value.from_param = (value) => new Value(value + 1);
    const second = prototype(["fixture_scalar_i32", lib]);
    first.errcheck = (result) => result + 10;
    assert.equal(first(7), 17);
    assert.equal(second(7), 7);
    Value.from_param = (value) => new Value(value + 2);
    assert.equal(first(7), 17);
    assert.equal(second(7), 7);
  });

  it("test_independent_errcheck", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    const first = prototype(["fixture_scalar_i32", lib]);
    const second = prototype(["fixture_scalar_i32", lib]);
    assert.notEqual(first, second);
    first.errcheck = (result) => result + 10;
    assert.equal(first(7), 17);
    assert.equal(second(7), 7);
  });

  it("test_existing_converter_callable_capture", function () {
    class Value extends c.c_int32 {
      static from_param(value) {
        return new Value(value + 1);
      }
    }
    const prototype = c.CFUNCTYPE(c.c_int32, Value);
    const function_ = prototype(["fixture_scalar_i32", lib]);
    assert.equal(function_(7), 8);
    Value.from_param = (value) => new Value(value + 2);
    assert.equal(function_(7), 8);
    assert.equal(prototype(["fixture_scalar_i32", lib])(7), 8);
  });

  it("test_paramflags_converter_capture", function () {
    class Value extends c.c_int32 {
      static from_param(value) {
        return new Value(value + 1);
      }
    }
    const prototype = c.CFUNCTYPE(c.c_int32, Value, c.c_int32, c.POINTER(c.c_int32));
    const flags = [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ];
    Value.from_param = (value) => new Value(value + 2);
    const divide = prototype(["fixture_divmod", lib], flags);
    assert.equal(divide(17, 5), 3);
    Value.from_param = (value) => new Value(value + 3);
    assert.equal(divide(17, 5), 3);
    assert.equal(prototype(["fixture_divmod", lib], flags)(17, 5), 3);
  });

  it("test_paramflags_retval_hook_capture", function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    Result._check_retval_ = (value) => value.value + 2;
    for (let index = 0; index < 2; index++) {
      const divide = prototype(
        ["fixture_divmod", lib],
        [
          [1, "a"],
          [1, "b"],
          [2, "remainder"],
        ],
      );
      divide.errcheck = (result, function_, arguments_) => [result, function_ === divide, arguments_[2].value];
      assert.deepEqual(divide(17, 5), [4, true, 2]);
    }
  });

  it("test_attribute_converter_capture", function () {
    class Value extends c.c_int32 {
      static from_param(value) {
        return new Value(value + 1);
      }
    }
    const function_ = lib.fixture_scalar_i32;
    function_.argtypes = [Value];
    function_.restype = c.c_int32;
    Value.from_param = (value) => new Value(value + 2);
    assert.equal(function_(7), 8);
    function_.argtypes = [Value];
    assert.equal(function_(7), 9);
  });

  it("test_attribute_retval_hook_capture", function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const function_ = lib.fixture_scalar_i32;
    function_.argtypes = [c.c_int32];
    function_.restype = Result;
    Result._check_retval_ = (value) => value.value + 2;
    assert.equal(function_(7), 8);
    function_.restype = Result;
    assert.equal(function_(7), 9);
  });

  it("test_initial_invalid_retval_deferred", function () {
    class Result extends c.c_int32 {
      static _check_retval_ = 7;
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32);
    const function_ = prototype(["fixture_scalar_i32", lib]);
    assert.throws(() => function_(7), TypeError);
  });

  it("test_initial_invalid_converter_deferred", function () {
    class Value extends c.c_int32 {
      static from_param = 7;
    }
    const prototype = c.CFUNCTYPE(c.c_int32, Value);
    const function_ = prototype(["fixture_scalar_i32", lib]);
    assert.throws(() => function_(7), c.ArgumentError);
  });

  it("test_custom_string_converter_pointer_result", function () {
    const owner = c.create_string_buffer("Hello");
    class Value extends c.c_char_p {
      static from_param() {
        return new c.c_void_p(c.addressof(owner));
      }
    }
    const prototype = c.CFUNCTYPE(c.c_size_t, Value);
    const function_ = prototype(["fixture_string_length", lib]);
    assert.equal(function_(0), 5n);
    Value.from_param = () => new c.c_void_p(c.addressof(owner) + 1n);
    assert.equal(function_(0), 5n);
    assert.equal(prototype(["fixture_string_length", lib])(0), 5n);
  });

  it("test_callback_retval_hook_capture", function () {
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 1;
      }
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32);
    Result._check_retval_ = (value) => value.value + 2;
    const callback = prototype((value) => value);
    assert.equal(callback(7), 8);
  });

  it("test_callback_converter_capture", function () {
    class Value extends c.c_int32 {
      static from_param(value) {
        return new Value(value + 1);
      }
    }
    const prototype = c.CFUNCTYPE(c.c_int32, Value);
    Value.from_param = (value) => new Value(value + 2);
    const callback = prototype((value) => value.value);
    assert.equal(callback(7), 8);
  });

  it("test_binding_keeps_argument_type", function () {
    function make() {
      class Value extends c.c_int32 {}
      return c.CFUNCTYPE(c.c_int32, Value)(["fixture_scalar_i32", lib]);
    }
    const function_ = make();
    assert.equal(function_(7), 7);
  });

  it("test_callback_keeps_argument_type", function () {
    function make() {
      class Value extends c.c_int32 {}
      const prototype = c.CFUNCTYPE(c.c_int32, Value);
      return prototype((value) => value.value);
    }
    const callback = make();
    const function_ = c.CFUNCTYPE(c.c_int32, c.c_int32)(c.cast(callback, c.c_void_p).value);
    assert.equal(function_(7), 7);
  });

  it("test_paramflags_keeps_argument_type", function () {
    function make() {
      class Value extends c.c_int32 {}
      const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Value));
      return prototype(
        ["fixture_divmod", lib],
        [
          [1, "a"],
          [1, "b"],
          [2, "remainder"],
        ],
      );
    }
    const function_ = make();
    assert.equal(function_(17, 5).value, 2);
  });
});
