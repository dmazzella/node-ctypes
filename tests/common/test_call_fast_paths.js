/**
 * Test the synchronous call fast paths:
 * - per-instance `call` function (no ObjectWrap unwrap per call)
 * - direct call without libffi for simple signatures (<= 4 int/pointer/float/double args)
 * - heap string buffer pointer fixups
 */

import assert from "node:assert";
import os from "node:os";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const platform = os.platform();
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
// On Linux the math functions (sqrt, ...) are in libm, elsewhere in the C library.
const LIBM = platform === "linux" ? "libm.so.6" : LIBC;

describe("Call conversions (Python ctypes parity)", function () {
  let libc;
  let libm;

  before(function () {
    libc = new ctypes.CDLL(LIBC);
    libm = new ctypes.CDLL(LIBM);
  });

  after(function () {
    if (libc) libc.close();
    if (libm) libm.close();
  });

  describe("narrow integer arguments are sign/zero-extended", function () {
    it("signed 8/16-bit arguments", function () {
      assert.strictEqual(libc.func("abs", ctypes.c_int32, [ctypes.c_int8])(-5), 5);
      assert.strictEqual(libc.func("abs", ctypes.c_int32, [ctypes.c_int16])(-300), 300);
    });

    it("unsigned 8/16-bit arguments", function () {
      // A sign-extended 250 would be -6 and abs() would return 6.
      assert.strictEqual(libc.func("abs", ctypes.c_int32, [ctypes.c_uint8])(250), 250);
      assert.strictEqual(libc.func("abs", ctypes.c_int32, [ctypes.c_uint16])(65535), 65535);
    });

    it("bool argument", function () {
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_bool]);
      assert.strictEqual(abs(true), 1);
      assert.strictEqual(abs(false), 0);
    });
  });

  describe("narrow integer returns are truncated to the declared type", function () {
    it("8-bit returns", function () {
      assert.strictEqual(libc.func("abs", ctypes.c_int8, [ctypes.c_int32])(-200), -56);
      assert.strictEqual(libc.func("abs", ctypes.c_uint8, [ctypes.c_int32])(-200), 200);
    });

    it("16-bit returns", function () {
      assert.strictEqual(libc.func("abs", ctypes.c_int16, [ctypes.c_int32])(-40000), -25536);
      assert.strictEqual(libc.func("abs", ctypes.c_uint16, [ctypes.c_int32])(-40000), 40000);
    });

    it("bool return", function () {
      const abs = libc.func("abs", ctypes.c_bool, [ctypes.c_int32]);
      assert.strictEqual(abs(-2), true);
      assert.strictEqual(abs(0), false);
    });
  });

  describe("mixed register classes", function () {
    it("double + int arguments", function () {
      const ldexp = libc.func("ldexp", ctypes.c_double, [ctypes.c_double, ctypes.c_int32]);
      assert.strictEqual(ldexp(1.5, 3), 12);
      assert.strictEqual(ldexp(-0.75, -2), -0.1875);
    });

    it("pointer + int + size_t arguments with pointer return", function () {
      const memchr = libc.func("memchr", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_size_t]);
      const buf = Buffer.from("abcdefgh");
      const base = ctypes.addressof(buf);
      assert.strictEqual(memchr(buf, "e".charCodeAt(0), buf.length) - base, 4n);
      assert.strictEqual(memchr(base, "h".charCodeAt(0), BigInt(buf.length)) - base, 7n);
      assert.strictEqual(memchr(buf, "z".charCodeAt(0), buf.length), null);
    });

    it("four arguments", function () {
      const memccpy = libc.func(platform === "win32" ? "_memccpy" : "memccpy", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int32, ctypes.c_size_t]);
      const dst = Buffer.alloc(16);
      const src = Buffer.from("hello,world");
      const end = memccpy(dst, src, ",".charCodeAt(0), src.length);
      assert.strictEqual(dst.toString("latin1", 0, 6), "hello,");
      assert.strictEqual(end - ctypes.addressof(dst), 6n);
    });
  });

  describe("strings that overflow the inline buffer", function () {
    it("single long string", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      assert.strictEqual(strlen("x".repeat(5000)), 5000n);
    });

    it("lengths around the inline buffer capacity", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      for (let n = 505; n <= 515; n++) {
        assert.strictEqual(strlen("x".repeat(n)), BigInt(n), `length ${n}`);
      }
    });

    it("multi-byte characters across the inline buffer boundary", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      for (let n = 250; n <= 260; n++) {
        // "é" is 2 bytes and "€" is 3 bytes in UTF-8
        assert.strictEqual(strlen("é".repeat(n)), BigInt(2 * n), `é x ${n}`);
        assert.strictEqual(strlen("a" + "€".repeat(n)), BigInt(1 + 3 * n), `€ x ${n}`);
      }
    });

    it("strings split between the inline and heap buffers in one call", function () {
      const strcmp = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, ctypes.c_char_p]);
      const a = "k".repeat(400);
      assert.strictEqual(strcmp(a, "k".repeat(400)), 0);
      assert.ok(strcmp(a, "k".repeat(399) + "l") < 0);
      assert.ok(strcmp("é".repeat(200), "é".repeat(199)) > 0);
    });

    it("several long strings in one call keep valid pointers", function () {
      const strcmp = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, ctypes.c_char_p]);
      const a = "a".repeat(3000);
      assert.strictEqual(strcmp(a, "a".repeat(3000)), 0);
      assert.ok(strcmp(a + "b", a + "c") < 0);
      assert.ok(strcmp("z".repeat(700), "y".repeat(90000)) > 0);
    });

    it("call without strings after a call that failed mid-marshalling", function () {
      const Pair = ctypes.struct({ a: ctypes.c_int32, b: ctypes.c_int32 });
      const bad = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, Pair]);
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
      assert.throws(() => bad("q".repeat(1000), 42));
      assert.strictEqual(abs(-3), 3);
    });
  });

  describe("argument validation (Python ctypes parity)", function () {
    it("strings, null and objects for number arguments throw TypeError", function () {
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
      const sqrt = libm.func("sqrt", ctypes.c_double, [ctypes.c_double]);
      assert.throws(() => abs("12"), TypeError);
      assert.throws(() => abs(null), TypeError);
      assert.throws(() => abs({}), TypeError);
      assert.throws(() => sqrt("4"), TypeError);
      assert.throws(() => sqrt(undefined), TypeError);
      assert.strictEqual(abs(-12), 12);
      assert.strictEqual(sqrt(4), 2);
    });

    it("booleans count as 0/1", function () {
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
      const sqrt = libm.func("sqrt", ctypes.c_double, [ctypes.c_double]);
      const abs8 = libc.func("abs", ctypes.c_int32, [ctypes.c_int8]);
      assert.strictEqual(abs(true), 1);
      assert.strictEqual(abs(false), 0);
      assert.strictEqual(sqrt(true), 1);
      assert.strictEqual(abs8(true), 1);
    });

    it("BigInt values are truncated to the argument size", function () {
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
      const sqrt = libm.func("sqrt", ctypes.c_double, [ctypes.c_double]);
      assert.strictEqual(abs(-5n), 5);
      assert.strictEqual(abs(2n ** 40n + 3n), 3);
      assert.strictEqual(sqrt(16n), 4);
    });
  });

});
