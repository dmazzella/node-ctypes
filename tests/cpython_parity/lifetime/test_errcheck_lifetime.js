import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestErrcheckLifetime", function () {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_replacement_during_callback", function () {
    const attribute = lib.fixture_first_char_after;
    attribute.argtypes = [c.c_char_p, c.c_void_p];
    attribute.restype = c.c_int32;
    const independent = c.CFUNCTYPE(c.c_int32, c.c_char_p, c.c_void_p)(["fixture_first_char_after", lib]);
    for (const function_ of [attribute, independent]) {
      const identities = [];
      const nested = [];
      const next_check = (result, invoked) => {
        identities.push(invoked === function_);
        return 202;
      };
      const old_check = (result, invoked) => {
        identities.push(invoked === function_);
        return 101;
      };
      const callback = c.CFUNCTYPE(null)(() => {
        function_.errcheck = next_check;
        nested.push(function_("B", null));
      });
      for (const text of ["A", "A".repeat(2048)]) {
        function_.errcheck = old_check;
        assert.equal(function_(text, c.cast(callback, c.c_void_p)), 101);
        assert.equal(nested.at(-1), 202);
        assert.equal(function_("A", null), 202);
      }
      assert.deepEqual(identities, Array(6).fill(true));
    }
  });

  it("test_snapshot_precedes_from_param", function () {
    let function_;
    class Input {
      value = "A";
    }
    const next_check = () => 202;
    class Adapted extends c.c_char_p {
      static from_param(value) {
        function_.errcheck = next_check;
        return value.value;
      }
    }
    const attribute = lib.fixture_first_char_after;
    attribute.argtypes = [Adapted, c.c_void_p];
    attribute.restype = c.c_int32;
    const independent = c.CFUNCTYPE(c.c_int32, Adapted, c.c_void_p)(["fixture_first_char_after", lib]);
    for (function_ of [attribute, independent]) {
      const value = new Input();
      const received = [];
      function_.errcheck = (result, invoked, arguments_) => {
        received.push([invoked === function_, arguments_[0] === value]);
        return 101;
      };
      assert.equal(function_(value, null), 101);
      assert.equal(function_(value, null), 202);
      assert.deepEqual(received, [[true, true]]);
      function_.errcheck = null;
      assert.equal(function_(value, null), 65);
    }
  });

  it("test_invalid_hook_preserves_current", function () {
    const attribute = lib.fixture_first_char_after;
    attribute.argtypes = [c.c_char_p, c.c_void_p];
    attribute.restype = c.c_int32;
    const independent = c.CFUNCTYPE(c.c_int32, c.c_char_p, c.c_void_p)(["fixture_first_char_after", lib]);
    for (const function_ of [attribute, independent]) {
      function_.errcheck = () => 101;
      assert.throws(() => {
        function_.errcheck = {};
      }, TypeError);
      assert.equal(function_("A", null), 101);
    }
  });

  it("test_checked_variadic_arguments", function () {
    const function_ = lib.fixture_variadic_sum;
    function_.argtypes = [c.c_void_p, c.c_int32];
    function_.restype = c.c_int32;
    const values = [null, 8, 1, 2, 3, 4, 5, 6, 7, 8];
    const received = [];
    function_.errcheck = (result, invoked, arguments_) => {
      received.push([invoked === function_, [...arguments_]]);
      return result;
    };
    assert.equal(function_(...values), 36);
    assert.deepEqual(received, [[true, values]]);
  });

  it("test_paramflags_binding_independence", function () {
    const shared = lib.fixture_divmod;
    shared.argtypes = [c.c_int32, c.c_int32, c.POINTER(c.c_int32)];
    shared.restype = c.c_int32;
    shared.errcheck = () => 303;
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    const function_ = prototype(
      ["fixture_divmod", lib],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    const received = [];
    function_.errcheck = (result, invoked, arguments_) => {
      received.push([result, invoked === function_, arguments_[0], arguments_[1]]);
      return arguments_;
    };
    assert.equal(function_(17, 5), 2);
    const output = new c.c_int32();
    assert.equal(shared(17, 5, c.byref(output)), 303);
    assert.equal(output.value, 2);
    assert.deepEqual(received, [[3, true, 17, 5]]);
  });

  it("test_paramflags_output_instances", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    const function_ = prototype(
      ["fixture_divmod", lib],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    const received = [];
    function_.errcheck = (result, invoked, arguments_) => {
      received.push([result, invoked === function_, arguments_[2] instanceof c.c_int32, arguments_[2].value]);
      return arguments_;
    };
    assert.equal(function_(17, 5), 2);
    assert.deepEqual(received, [[3, true, true, 2]]);
  });

  it("test_paramflags_hook_replacement", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    const function_ = prototype(
      ["fixture_divmod", lib],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    function_.errcheck = (result, invoked, arguments_) => {
      function_.errcheck = () => 202;
      return arguments_;
    };
    assert.equal(function_(17, 5), 2);
    assert.equal(function_(17, 5), 202);
  });

  it("test_paramflags_temporary_ownership", function () {
    class Temporary extends c.c_void_p {
      static from_param() {
        return c.cast(c.create_string_buffer("A".repeat(4096)), c.POINTER(c.c_uint8));
      }
    }
    const function_ = c.CFUNCTYPE(c.c_size_t, Temporary)(["fixture_address", lib], [[1, "value"]]);
    const received = [];
    function_.errcheck = (result, invoked) => {
      received.push([invoked === function_, c.cast(result, c.POINTER(c.c_uint8))[0]]);
      return result;
    };
    assert.ok(function_(0) > 0n);
    assert.deepEqual(received, [[true, 65]]);
  });

  it("test_hresult_precedes_errcheck", { skip: process.platform !== "win32" && "OleDLL/HRESULT requires Windows" }, function () {
    const library = new c.OleDLL(FIXTURE);
    const function_ = c.WINFUNCTYPE(
      c.HRESULT,
      c.c_int32,
      c.c_int32,
      c.POINTER(c.c_int32),
    )(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    const checks = [];
    function_.errcheck = (result, invoked, arguments_) => {
      checks.push(result);
      return arguments_;
    };
    assert.throws(() => function_(-7, 2), Error);
    assert.deepEqual(checks, []);
    assert.equal(function_(17, 5), 2);
    assert.deepEqual(checks, [3]);
  });
});
