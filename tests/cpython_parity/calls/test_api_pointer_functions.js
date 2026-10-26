import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestApiConversions", function () {
  let lib;
  before(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_function_pointer_fields_roundtrip", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    class Record extends c.Structure {
      static _fields_ = [["function", prototype]];
    }
    const source = Record.in_dll(lib, "fixture_global_function");
    const fn = source.function;
    const copy = new Record();
    copy.function = fn;
    assert.equal(copy.function(7), 8);
    const values = c.ARRAY(prototype, 1)();
    values[0] = fn;
    assert.equal(values[0](7), 8);
    const invoke = lib.fixture_scalar_callback;
    invoke.argtypes = [prototype, c.c_int32];
    invoke.restype = c.c_int32;
    assert.equal(invoke(fn, 7), 8);
    assert.throws(() => {
      copy.function = (value) => value;
    }, TypeError);
    assert.throws(() => invoke((value) => value, 7), c.ArgumentError);
  });

  it("test_explicit_function_pointer_casts", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    const invoke = lib.fixture_scalar_callback;
    invoke.argtypes = [prototype, c.c_int32];
    invoke.restype = c.c_int32;
    const direct = prototype(["fixture_scalar_i32", lib]);
    const attribute = lib.fixture_scalar_i32;
    attribute.argtypes = [c.c_int32];
    attribute.restype = c.c_int32;
    assert.equal(invoke(direct, 7), 7);
    assert.equal(invoke(c.cast(attribute, prototype), 8), 8);
  });
});
