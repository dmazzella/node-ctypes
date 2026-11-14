// Retained common/test_call_fast_paths.js CDLL.func() regression entry points.
// Public attribute-call vectors are mirrored in cpython_parity/calls.
import assert from "node:assert";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const platform = os.platform();
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
// On Linux the math functions (sqrt, ...) are in libm, elsewhere in the C library.
const LIBM = platform === "linux" ? "libm.so.6" : LIBC;
const fixturePath = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${platform === "win32" ? ".dll" : platform === "darwin" ? ".dylib" : ".so"}`);
const fixtureAvailable = existsSync(fixturePath);

describe("CDLL.func conversion entry-point regressions", function () {
  let libc;
  let libm;
  let fixture;

  before(function () {
    libc = new ctypes.CDLL(LIBC);
    libm = new ctypes.CDLL(LIBM);
    if (fixtureAvailable) fixture = new ctypes.CDLL(fixturePath);
  });

  after(function () {
    if (libc) libc.close();
    if (libm) libm.close();
    if (fixture) fixture.close();
  });

  // abs() is int(int); narrow arguments and results need matching C signatures.
  describe("narrow integer arguments preserve their native signedness", { skip: !fixtureAvailable && "native fixture not built" }, function () {
    it("signed 8/16-bit arguments", function () {
      const promote8 = fixture.func("fixture_promote_i8", ctypes.c_int32, [ctypes.c_int8]);
      assert.strictEqual(promote8(-5), -5);
      assert.strictEqual(promote8(-128), -128);
      assert.strictEqual(promote8(true), 1);
      const promote16 = fixture.func("fixture_promote_i16", ctypes.c_int32, [ctypes.c_int16]);
      assert.strictEqual(promote16(-300), -300);
      assert.strictEqual(promote16(-32768), -32768);
    });

    it("unsigned 8/16-bit arguments", function () {
      assert.strictEqual(fixture.func("fixture_promote_u8", ctypes.c_int32, [ctypes.c_uint8])(250), 250);
      assert.strictEqual(fixture.func("fixture_promote_u16", ctypes.c_int32, [ctypes.c_uint16])(65535), 65535);
    });

    it("bool argument", function () {
      const promote = fixture.func("fixture_promote_bool", ctypes.c_int32, [ctypes.c_bool]);
      assert.strictEqual(promote(true), 1);
      assert.strictEqual(promote(false), 0);
    });
  });

  describe("narrow integer returns preserve their native representation", { skip: !fixtureAvailable && "native fixture not built" }, function () {
    it("8-bit returns", function () {
      assert.strictEqual(fixture.func("fixture_narrow_i8", ctypes.c_int8, [ctypes.c_int32])(200), -56);
      assert.strictEqual(fixture.func("fixture_narrow_u8", ctypes.c_uint8, [ctypes.c_int32])(200), 200);
    });

    it("16-bit returns", function () {
      assert.strictEqual(fixture.func("fixture_narrow_i16", ctypes.c_int16, [ctypes.c_int32])(40000), -25536);
      assert.strictEqual(fixture.func("fixture_narrow_u16", ctypes.c_uint16, [ctypes.c_int32])(40000), 40000);
    });

    it("bool return", function () {
      const narrow = fixture.func("fixture_narrow_bool", ctypes.c_bool, [ctypes.c_int32]);
      assert.strictEqual(narrow(-2), true);
      assert.strictEqual(narrow(0), false);
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

  // Scalar signatures may skip libffi, but on x64 a variadic callee declared with
  // fixed argtypes still needs the variadic register setup for its double arguments
  // (Win64 mirrors them in GPRs, SysV sets AL). Elsewhere this declaration is not
  // ABI-compatible: Apple ARM64 reads variadic arguments from the stack and Windows
  // ARM64 from integer registers, so CPython ctypes fails there as well.
  describe("variadic callee declared with fixed double argtypes", { skip: (!fixtureAvailable && "native fixture not built") || (process.arch !== "x64" && "fixed argtypes match the variadic ABI only on x64") }, function () {
    it("CDLL.func with one to three doubles", function () {
      const sum1 = fixture.func("fixture_variadic_double_sum", ctypes.c_double, [ctypes.c_int32, ctypes.c_double]);
      assert.strictEqual(sum1(1, 2.5), 2.5);
      const sum2 = fixture.func("fixture_variadic_double_sum", ctypes.c_double, [ctypes.c_int32, ctypes.c_double, ctypes.c_double]);
      assert.strictEqual(sum2(2, 1.5, 2.5), 4);
      const sum3 = fixture.func("fixture_variadic_double_sum", ctypes.c_double, [ctypes.c_int32, ctypes.c_double, ctypes.c_double, ctypes.c_double]);
      assert.strictEqual(sum3(3, 0.25, -1.5, 8), 6.75);
    });

    it("attribute call with argtypes and restype", function () {
      const sum = fixture.fixture_variadic_double_sum;
      sum.argtypes = [ctypes.c_int32, ctypes.c_double, ctypes.c_double];
      sum.restype = ctypes.c_double;
      for (let i = 0; i < 3; i++) assert.strictEqual(sum(2, 1.25, i), 1.25 + i);
    });
  });

  // The native call reads first the kind of value last seen at each pointer
  // position; any other kind must still convert as the first time.
  describe("pointer arguments whose kind of value changes between calls", { skip: !fixtureAvailable && "native fixture not built" }, function () {
    it("c_void_p: Buffer, BigInt, Number, null, undefined, string, boolean", function () {
      const address = fixture.func("fixture_address", ctypes.c_size_t, [ctypes.c_void_p]);
      const buffer = Buffer.alloc(8);
      const at = BigInt(ctypes.addressof(buffer));
      const sequence = [
        [buffer, at],
        [buffer, at],
        [0x1234n, 0x1234n],
        [0x1234n, 0x1234n],
        [4096, 4096n],
        [4096, 4096n],
        [null, 0n],
        [null, 0n],
        [undefined, 0n],
        [buffer, at],
        [0x5678n, 0x5678n],
        [null, 0n],
        [8192, 8192n],
        [true, 1n],
        [buffer, at],
      ];
      for (let round = 0; round < 2; round++) {
        for (const [value, expected] of sequence) assert.strictEqual(address(value), expected, String(value));
        const text = address("abc");
        assert.ok(text !== 0n);
      }
      assert.throws(() => address(1.5), /cannot be interpreted as ctypes.c_void_p/);
      assert.strictEqual(address(4096), 4096n);
      assert.throws(() => address({}), /argument 1/);
      assert.strictEqual(address(0x9abcn), 0x9abcn);
    });

    it("c_char_p: string, null, Buffer", function () {
      const address = fixture.func("fixture_address", ctypes.c_size_t, [ctypes.c_char_p]);
      const buffer = ctypes.create_string_buffer("xyz");
      for (let round = 0; round < 3; round++) {
        assert.ok(address("text") !== 0n);
        assert.strictEqual(address(null), 0n);
        assert.strictEqual(address(null), 0n);
        assert.ok(address("text") !== 0n);
        assert.strictEqual(address(buffer), BigInt(ctypes.addressof(buffer)));
        assert.strictEqual(address(undefined), 0n);
      }
      assert.throws(() => address(5), /argument 1/);
      assert.strictEqual(address(null), 0n);
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

    it("repeatedly grows and reuses storage for UTF-8 strings and embedded NULs", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      const strcmp = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, ctypes.c_char_p]);
      for (const length of [1020, 4096, 90000, 700, 8192, 513]) {
        const text = "\u{1f642}".repeat(length) + "\ud800";
        assert.strictEqual(strlen(text), BigInt(Buffer.byteLength(text)));
        assert.strictEqual(strlen(`${text}\0ignored`), BigInt(Buffer.byteLength(text)));
        assert.strictEqual(strcmp(text, text), 0);
        assert.ok(strcmp(`${text}a`, `${text}b`) < 0);
      }
    });

    it("reuses the same function after argument conversion fails", function () {
      const strcmp = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, ctypes.c_char_p]);
      assert.strictEqual(strcmp("x".repeat(3000), "x".repeat(3000)), 0);
      assert.throws(() => strcmp("q".repeat(90000), {}));
      assert.strictEqual(strcmp("é".repeat(700), "é".repeat(700)), 0);
      assert.ok(strcmp("a".repeat(8192), "b".repeat(8192)) < 0);
    });

    it("handles repeated multi-megabyte strings followed by shorter values", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      for (const length of [9 * 1024 * 1024, 9 * 1024 * 1024 - 1, 11 * 1024 * 1024, 700, 9 * 1024 * 1024]) {
        assert.strictEqual(strlen("x".repeat(length)), BigInt(length));
      }
    });

    // The string storage beyond the retention limit (10 MB) is released only
    // before its next use: a result that points into an argument string is
    // converted (and passed to errcheck) while that storage is still alive.
    it("keeps string arguments alive for a result that points into them", function () {
      const strchr = libc.func("strchr", ctypes.c_char_p, [ctypes.c_char_p, ctypes.c_int32]);
      const y = "y".charCodeAt(0);
      for (const size of [1024 * 1024, 11 * 1024 * 1024, 12 * 1024 * 1024, 700, 11 * 1024 * 1024]) {
        const text = "a".repeat(size) + "yz";
        assert.strictEqual(strchr(text, y), "yz", `${size} bytes`);
      }
      const checked = libc.func("strchr", ctypes.c_char_p, [ctypes.c_char_p, ctypes.c_int32]);
      const seen = [];
      checked.errcheck = (result) => {
        seen.push(result);
        return result;
      };
      for (const size of [11 * 1024 * 1024, 12 * 1024 * 1024]) {
        assert.strictEqual(checked("b".repeat(size) + "yq", y), "yq");
      }
      assert.deepStrictEqual(seen, ["yq", "yq"]);

      // errcheck calling the same function again with another long string.
      let nested = 0;
      checked.errcheck = (result) => {
        if (nested++ === 0) assert.strictEqual(checked("c".repeat(12 * 1024 * 1024) + "yn", y), "yn");
        return result;
      };
      assert.strictEqual(checked("d".repeat(11 * 1024 * 1024) + "yo", y), "yo");
      assert.strictEqual(nested, 2);
      checked.errcheck = null;

      // An argument error after the long string was stored, then valid calls.
      assert.throws(() => strchr("e".repeat(12 * 1024 * 1024), "y"), /argument 2/);
      assert.strictEqual(strchr("ayb", y), "yb");
      assert.strictEqual(strchr("f".repeat(11 * 1024 * 1024) + "yr", y), "yr");
    });

    it("preserves wide-string alignment between heap-encoded UTF-8 arguments", { skip: !fixtureAvailable && "native fixture not built" }, async function () {
      const lengths = fixture.func("fixture_mixed_string_lengths", ctypes.c_size_t, [ctypes.c_char_p, ctypes.c_wchar_p, ctypes.c_char_p]);
      for (const count of [1000, 9000, 700]) {
        const first = "é".repeat(count) + "a";
        const middle = "中".repeat(700);
        const last = "\u{1f642}".repeat(count);
        const expected = BigInt(Buffer.byteLength(first) + middle.length + Buffer.byteLength(last));
        assert.strictEqual(lengths(first, middle, last), expected);
        assert.strictEqual(await lengths.callAsync(first, middle, last), expected);
      }
    });

    it("call without strings after a call that failed mid-marshalling", function () {
      const strcmp = libc.func("strcmp", ctypes.c_int32, [ctypes.c_char_p, ctypes.c_char_p]);
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
      assert.throws(() => strcmp("q".repeat(1000), {}));
      assert.strictEqual(abs(-3), 3);
    });

    // 507 bytes leave the last 4 of the inline buffer: too few to read the next
    // argument there, which may then be any value accepted by c_char_p.
    it("converts any c_char_p value after a string that fills the inline buffer", { skip: !fixtureAvailable && "native fixture not built" }, async function () {
      const lengths = fixture.func("fixture_string_lengths_nullable", ctypes.c_size_t, [ctypes.c_char_p, ctypes.c_char_p]);
      const first = "f".repeat(507);
      const buffer = ctypes.create_string_buffer("xyz");
      for (let round = 0; round < 2; round++) {
        assert.strictEqual(lengths(first, null), 507n);
        assert.strictEqual(lengths(first, undefined), 507n);
        assert.strictEqual(lengths(first, "ab"), 510n);
        assert.strictEqual(lengths(first, "s".repeat(3000)), 3508n);
        assert.strictEqual(lengths(first, buffer), 511n);
        assert.strictEqual(lengths("t".repeat(5000), null), 5000n);
        assert.strictEqual(lengths("t".repeat(5000), "u".repeat(700)), 5701n);
        assert.strictEqual(await lengths.callAsync(first, null), 507n);
        assert.strictEqual(await lengths.callAsync(first, "s".repeat(3000)), 3508n);
      }
      assert.throws(() => lengths(first, 5), /argument 2/);
      assert.strictEqual(lengths("ab", null), 2n);
    });
  });

  describe("CDLL.func argument validation", function () {
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
      assert.strictEqual(abs(true), 1);
      assert.strictEqual(abs(false), 0);
      assert.strictEqual(sqrt(true), 1);
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
