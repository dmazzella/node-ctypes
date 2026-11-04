import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../cpython_parity/_support.js";

describe("Library attribute lookup", function () {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(FIXTURE);
  });
  afterEach(() => {
    lib.close();
  });

  it("preserves cached identity, signature changes and errcheck", function () {
    const fn = lib.fixture_scalar_i32;
    fn.argtypes = [c.c_int32];
    fn.restype = c.c_int32;
    const received = [];
    fn.errcheck = (result, invoked, args) => {
      received.push([invoked === fn, args]);
      return result + 1;
    };
    assert.equal(lib.fixture_scalar_i32, fn);
    assert.equal(lib.fixture_scalar_i32(-7), -6);

    class Shifted extends c.c_int32 {
      static from_param(value) {
        return new Shifted(value + 1);
      }
    }
    fn.argtypes = [Shifted];
    fn.restype = c.c_int32;
    assert.equal(lib.fixture_scalar_i32, fn);
    assert.equal(lib.fixture_scalar_i32(-8), -6);
    assert.deepEqual(received, [
      [true, [-7]],
      [true, [-8]],
    ]);
    fn.errcheck = null;
    assert.equal(lib.fixture_scalar_i32(-9), -8);
  });

  it("keeps different symbol wrappers independent", function () {
    const signed = lib.fixture_scalar_i32;
    const unsigned = lib.fixture_scalar_u32;
    signed.argtypes = [c.c_int32];
    signed.restype = c.c_int32;
    signed.errcheck = (value) => value + 1;
    unsigned.argtypes = [c.c_uint32];
    unsigned.restype = c.c_uint32;
    assert.notEqual(signed, unsigned);
    assert.equal(lib.fixture_scalar_i32, signed);
    assert.equal(lib.fixture_scalar_u32, unsigned);
    assert.equal(lib.fixture_scalar_i32(-7), -6);
    assert.equal(lib.fixture_scalar_u32(0xffffffff), 0xffffffff);
  });

  it("preserves existing properties, symbols and accessor receivers", function () {
    const fn = lib.fixture_scalar_i32;
    const marker = Symbol("metadata");
    lib.zero = 0;
    lib.empty = null;
    lib[marker] = fn;
    Object.defineProperty(lib, "receiver", {
      get() {
        return this;
      },
    });
    assert.equal(lib.zero, 0);
    assert.equal(lib.empty, null);
    assert.equal(lib[marker], fn);
    assert.equal(lib[Symbol("missing")], undefined);
    assert.equal(lib.receiver, lib);
    assert.equal(lib.constructor, c.CDLL);
    Object.defineProperty(lib, "fixture_scalar_i32", { value: null });
    assert.equal(lib.fixture_scalar_i32, null);
  });

  it("keeps missing symbols lazy and their wrappers cached after failure", function () {
    const missing = lib.__node_ctypes_missing_lookup_symbol__;
    assert.equal(typeof missing, "function");
    assert.equal(lib.__node_ctypes_missing_lookup_symbol__, missing);
    assert.throws(() => missing(), /not found/i);
    assert.equal(lib.__node_ctypes_missing_lookup_symbol__, missing);
  });
});
