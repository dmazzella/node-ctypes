import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE, LIBC } from "../_support.js";

describe("TestCallFastPaths", function () {
  let libc, libm, fixture;
  beforeEach(() => {
    libc = new c.CDLL(LIBC);
    libm = new c.CDLL(process.platform === "linux" ? "libm.so.6" : LIBC);
    fixture = new c.CDLL(FIXTURE);
  });

  it("test_signed_narrow_arguments", function () {
    const promote8 = fixture.fixture_promote_i8;
    promote8.argtypes = [c.c_int8];
    promote8.restype = c.c_int32;
    for (const [value, expected] of [
      [-5, -5],
      [-128, -128],
      [true, 1],
    ])
      assert.equal(promote8(value), expected);
    const promote16 = fixture.fixture_promote_i16;
    promote16.argtypes = [c.c_int16];
    promote16.restype = c.c_int32;
    for (const value of [-300, -32768]) assert.equal(promote16(value), value);
  });

  it("test_unsigned_narrow_arguments", function () {
    const promote8 = fixture.fixture_promote_u8;
    promote8.argtypes = [c.c_uint8];
    promote8.restype = c.c_int32;
    const promote16 = fixture.fixture_promote_u16;
    promote16.argtypes = [c.c_uint16];
    promote16.restype = c.c_int32;
    assert.equal(promote8(250), 250);
    assert.equal(promote16(65535), 65535);
  });

  it("test_bool_argument", function () {
    const promote = fixture.fixture_promote_bool;
    promote.argtypes = [c.c_bool];
    promote.restype = c.c_int32;
    assert.equal(promote(true), 1);
    assert.equal(promote(false), 0);
  });

  it("test_eight_bit_returns", function () {
    const signed = fixture.fixture_narrow_i8;
    signed.argtypes = [c.c_int32];
    signed.restype = c.c_int8;
    const unsigned = fixture.fixture_narrow_u8;
    unsigned.argtypes = [c.c_int32];
    unsigned.restype = c.c_uint8;
    assert.equal(signed(200), -56);
    assert.equal(unsigned(200), 200);
  });

  it("test_sixteen_bit_returns", function () {
    const signed = fixture.fixture_narrow_i16;
    signed.argtypes = [c.c_int32];
    signed.restype = c.c_int16;
    const unsigned = fixture.fixture_narrow_u16;
    unsigned.argtypes = [c.c_int32];
    unsigned.restype = c.c_uint16;
    assert.equal(signed(40000), -25536);
    assert.equal(unsigned(40000), 40000);
  });

  it("test_bool_return", function () {
    const narrow = fixture.fixture_narrow_bool;
    narrow.argtypes = [c.c_int32];
    narrow.restype = c.c_bool;
    assert.equal(narrow(-2), true);
    assert.equal(narrow(0), false);
  });

  it("test_double_and_int_arguments", function () {
    const ldexp = libm.ldexp;
    ldexp.argtypes = [c.c_double, c.c_int32];
    ldexp.restype = c.c_double;
    assert.equal(ldexp(1.5, 3), 12);
    assert.equal(ldexp(-0.75, -2), -0.1875);
  });

  it("test_pointer_int_size_arguments", function () {
    const memchr = libc.memchr;
    memchr.argtypes = [c.c_void_p, c.c_int32, c.c_size_t];
    memchr.restype = c.c_void_p;
    const buffer = c.create_string_buffer("abcdefgh", 8);
    const base = c.addressof(buffer);
    assert.equal(memchr(buffer, "e".charCodeAt(0), 8) - base, 4n);
    assert.equal(memchr(base, "h".charCodeAt(0), 8n) - base, 7n);
    assert.equal(memchr(buffer, "z".charCodeAt(0), 8), null);
  });

  it("test_four_arguments", function () {
    const memccpy = libc[process.platform === "win32" ? "_memccpy" : "memccpy"];
    memccpy.argtypes = [c.c_void_p, c.c_void_p, c.c_int32, c.c_size_t];
    memccpy.restype = c.c_void_p;
    const destination = c.create_string_buffer(16);
    const source = c.create_string_buffer("hello,world");
    const end = memccpy(destination, source, ",".charCodeAt(0), 11);
    assert.deepEqual(destination.raw.subarray(0, 6), Buffer.from("hello,"));
    assert.equal(end - c.addressof(destination), 6n);
  });

  it("test_single_long_string", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    assert.equal(strlen("x".repeat(5000)), 5000n);
  });

  it("test_inline_boundary_lengths", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    for (let length = 505; length <= 515; length++) assert.equal(strlen("x".repeat(length)), BigInt(length));
  });

  it("test_multibyte_boundary_lengths", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    for (let length = 250; length <= 260; length++) {
      assert.equal(strlen("é".repeat(length)), BigInt(2 * length));
      assert.equal(strlen("a" + "€".repeat(length)), BigInt(1 + 3 * length));
    }
  });

  it("test_inline_and_heap_strings", function () {
    const compare = libc.strcmp;
    compare.argtypes = [c.c_char_p, c.c_char_p];
    compare.restype = c.c_int32;
    assert.equal(compare("k".repeat(400), "k".repeat(400)), 0);
    assert.ok(compare("k".repeat(400), "k".repeat(399) + "l") < 0);
    assert.ok(compare("é".repeat(200), "é".repeat(199)) > 0);
  });

  it("test_several_long_strings", function () {
    const compare = libc.strcmp;
    compare.argtypes = [c.c_char_p, c.c_char_p];
    compare.restype = c.c_int32;
    const text = "a".repeat(3000);
    assert.equal(compare(text, "a".repeat(3000)), 0);
    assert.ok(compare(text + "b", text + "c") < 0);
    assert.ok(compare("z".repeat(700), "y".repeat(90000)) > 0);
  });

  it("test_growing_utf8_and_embedded_nuls", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    const compare = libc.strcmp;
    compare.argtypes = [c.c_char_p, c.c_char_p];
    compare.restype = c.c_int32;
    for (const length of [1020, 4096, 90000, 700, 8192, 513]) {
      const text = "🙂".repeat(length) + "\ufffd";
      assert.equal(strlen(text), BigInt(Buffer.byteLength(text)));
      assert.equal(strlen(text + "\0ignored"), BigInt(Buffer.byteLength(text)));
      assert.equal(compare(text, text), 0);
      assert.ok(compare(text + "a", text + "b") < 0);
    }
  });

  it("test_reuse_after_argument_failure", function () {
    const compare = libc.strcmp;
    compare.argtypes = [c.c_char_p, c.c_char_p];
    compare.restype = c.c_int32;
    assert.equal(compare("x".repeat(3000), "x".repeat(3000)), 0);
    assert.throws(() => compare("q".repeat(90000), {}), c.ArgumentError);
    assert.equal(compare("é".repeat(700), "é".repeat(700)), 0);
    assert.ok(compare("a".repeat(8192), "b".repeat(8192)) < 0);
  });

  it("test_multimegabyte_strings", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    for (const length of [9 * 1024 * 1024, 9 * 1024 * 1024 - 1, 11 * 1024 * 1024, 700, 9 * 1024 * 1024]) {
      assert.equal(strlen("x".repeat(length)), BigInt(length));
    }
  });

  it("test_mixed_string_alignment", function () {
    const lengths = fixture.fixture_mixed_string_lengths;
    lengths.argtypes = [c.c_char_p, c.c_wchar_p, c.c_char_p];
    lengths.restype = c.c_size_t;
    for (const count of [1000, 9000, 700]) {
      const first = "é".repeat(count) + "a";
      const middle = "中".repeat(700);
      const last = "🙂".repeat(count);
      assert.equal(lengths(first, middle, last), BigInt(Buffer.byteLength(first) + middle.length + Buffer.byteLength(last)));
    }
  });

  it("test_call_after_failed_marshalling", function () {
    const compare = libc.strcmp;
    compare.argtypes = [c.c_char_p, c.c_char_p];
    compare.restype = c.c_int32;
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    assert.throws(() => compare("q".repeat(1000), {}), c.ArgumentError);
    assert.equal(absolute(-3), 3);
  });

  it("test_invalid_numeric_arguments", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    const sqrt = libm.sqrt;
    sqrt.argtypes = [c.c_double];
    sqrt.restype = c.c_double;
    for (const value of ["12", null, {}]) assert.throws(() => absolute(value), c.ArgumentError);
    for (const value of ["4", null]) assert.throws(() => sqrt(value), c.ArgumentError);
    assert.equal(absolute(-12), 12);
    assert.equal(sqrt(4), 2);
  });

  it("test_booleans_are_numeric", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    const sqrt = libm.sqrt;
    sqrt.argtypes = [c.c_double];
    sqrt.restype = c.c_double;
    assert.equal(absolute(true), 1);
    assert.equal(absolute(false), 0);
    assert.equal(sqrt(true), 1);
  });

  it("test_big_integer_arguments", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    const sqrt = libm.sqrt;
    sqrt.argtypes = [c.c_double];
    sqrt.restype = c.c_double;
    assert.equal(absolute(-5n), 5);
    assert.equal(absolute(2n ** 40n + 3n), 3);
    assert.equal(sqrt(16n), 4);
  });
});
