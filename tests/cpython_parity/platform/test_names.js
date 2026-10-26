import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { LIBC, bytes } from "../_support.js";
const { CDLL, Structure, Union, POINTER, pointer, ARRAY, sizeof, alignment, CFUNCTYPE, ArgumentError, create_string_buffer, create_unicode_buffer, c_buffer, c_int, c_char, c_wchar, c_char_p, c_void_p, c_size_t } = ctypes;
const platform = process.platform;

describe("TestPythonParity", function () {
  let libc;
  before(() => {
    libc = new CDLL(LIBC);
  });
  after(() => {
    if (libc) libc.close();
  });
  it("test_names", function () {
    assert.strictEqual(ctypes.c_voidp, c_void_p);
    assert.strictEqual(sizeof(ctypes.c_time_t), 8);
    assert.strictEqual(ctypes.SIZEOF_TIME_T, 8);
    assert.strictEqual(typeof ctypes.RTLD_GLOBAL, "number");
    assert.strictEqual(typeof ctypes.RTLD_LOCAL, "number");
    assert.strictEqual(ctypes.DEFAULT_MODE, ctypes.RTLD_LOCAL);
    assert.strictEqual(sizeof(ARRAY(c_int, 3)), 3 * sizeof(c_int));
    assert.strictEqual(c_buffer("ab").value, "ab");
  });

  it("test_set_last_error_returns_previous", { skip: platform !== "win32" && "CPython exposes get/set_last_error only on Windows" }, function () {
    const old = ctypes.set_last_error(5);
    assert.strictEqual(ctypes.set_last_error(old), 5);
    assert.strictEqual(ctypes.get_last_error(), old);
  });
});
