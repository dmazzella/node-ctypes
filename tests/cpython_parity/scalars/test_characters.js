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
  it("test_char_values", function () {
    assert.strictEqual(new c_char(Buffer.from("A")).value, "A");
    assert.strictEqual(new c_char(66).value, "B");
    assert.strictEqual(new c_wchar("é").value, "é");
  });

  it("test_char_rejects", function () {
    for (const [v, message] of [
      [Buffer.alloc(0), "one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 0"],
      [Buffer.from("ab"), "one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 2"],
      [Buffer.from("ab"), "one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 2"],
      [null, "one character bytes, bytearray, or an integer in range(256) expected, not null"],
      [256, "integer not in range(256)"],
      [-1, "integer not in range(256)"],
    ]) {
      assert.throws(() => new c_char(v), { name: "TypeError", message });
    }
    for (const [v, message] of [
      ["", "a unicode character expected, not a string of length 0"],
      ["ab", "a unicode character expected, not a string of length 2"],
      [null, "a unicode character expected, not instance of null"],
    ]) {
      assert.throws(() => new c_wchar(v), { name: "TypeError", message });
    }
  });

  it("test_char_argument", function () {
    const strchr = libc.strchr;
    strchr.restype = c_char_p;
    strchr.argtypes = [c_char_p, c_char];
    assert.strictEqual(strchr("abcdef", Buffer.from("d")), "def");
    assert.strictEqual(strchr("abcdef", Buffer.from("e")), "ef");
    assert.throws(
      () => strchr("abcdef", Buffer.from("de")),
      (e) => e instanceof ArgumentError && e instanceof TypeError && e.message === "argument 2: TypeError: one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 2",
    );
  });

  it("test_wide_strings_outside_bmp", function () {
    const wcslen = libc.wcslen;
    wcslen.restype = c_size_t;
    wcslen.argtypes = [ctypes.c_wchar_p];
    const wcschr = libc.wcschr;
    wcschr.restype = ctypes.c_wchar_p;
    wcschr.argtypes = [ctypes.c_wchar_p, c_wchar];
    const units = ctypes.WCHAR_SIZE === 2 ? 4 : 3;
    assert.strictEqual(wcslen("a😀b"), BigInt(units));
    assert.strictEqual(wcschr("x😀ab", "a"), "ab");
    assert.strictEqual(wcschr("a\ud800b", "b"), "b");
    assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("a\ud800b")), "a\ud800b");
    assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("a😀b")), "a😀b");
    if (ctypes.WCHAR_SIZE === 4) {
      assert.strictEqual(wcschr("a😀b", "😀"), "😀b");
      assert.strictEqual(new c_wchar("😀").value, "😀");
    }
  });

  it("test_wchar_argument", function () {
    const wcschr = libc.wcschr;
    wcschr.restype = ctypes.c_wchar_p;
    wcschr.argtypes = [ctypes.c_wchar_p, c_wchar];
    for (const [value, message] of [
      ["ab", "a unicode character expected, not a string of length 2"],
      ["", "a unicode character expected, not a string of length 0"],
      [null, "a unicode character expected, not instance of null"],
      [Buffer.from("a"), "a unicode character expected, not instance of Buffer"],
    ]) {
      assert.throws(
        () => wcschr("abc", value),
        (e) => e instanceof ArgumentError && e.message === `argument 2: TypeError: ${message}`,
      );
    }
  });
});
