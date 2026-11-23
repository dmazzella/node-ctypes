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

    it("specialized entries preserve adapter deferral, validation and errcheck", { skip: !fixtureAvailable && "native fixture not built" }, function () {
      const echoBool = fixture.func("fixture_scalar_bool", ctypes.c_bool, [ctypes.c_bool]);
      assert.strictEqual(echoBool(true), true);
      assert.strictEqual(echoBool(false), false);
      assert.strictEqual(echoBool(0), false);
      assert.strictEqual(echoBool("nonempty"), true);
      assert.strictEqual(echoBool(new ctypes.c_bool(false)), false);
      assert.strictEqual(echoBool({ _as_parameter_: false }), false);

      const mixed = fixture.func("fixture_exact_mixed", ctypes.c_double, [ctypes.c_int32, ctypes.c_double, ctypes.c_float, ctypes.c_int32]);
      assert.strictEqual(mixed(-7, 1.5, 2.25, 8), 10.75);
      assert.strictEqual(mixed({ _as_parameter_: -7 }, 1.5, 2.25, 8n), 10.75);
      assert.throws(() => mixed(1.5, 1.5, 2.25, 8), /argument 1: TypeError: 'float' object cannot be interpreted as an integer/);
      assert.throws(() => mixed(1, "x", 2.25, 8), /argument 2/);

      const stack10 = fixture.func("fixture_abi_i32_stack", ctypes.c_int64, Array(10).fill(ctypes.c_int32));
      const vals = Array.from({ length: 10 }, (_, i) => i + 1);
      assert.strictEqual(stack10(...vals), 385n);
      assert.strictEqual(stack10({ _as_parameter_: 1 }, ...vals.slice(1)), 385n);
      assert.throws(() => stack10(1, 2, 3.5, 4, 5, 6, 7, 8, 9, 10), /argument 3: TypeError: 'float' object cannot be interpreted as an integer/);

      const strLen = fixture.func("fixture_string_length", ctypes.c_size_t, [ctypes.c_char_p]);
      assert.strictEqual(strLen("short"), 5n);
      assert.strictEqual(strLen("x".repeat(4096)), 4096n);
      assert.strictEqual(strLen("tiny"), 4n);
      assert.strictEqual(strLen({ _as_parameter_: "abc" }), 3n);
      assert.throws(() => strLen(123), /argument 1/);
    });

    it("specialized entries handle dynamic errcheck, reentrancy, overflow and fallback transitions", { skip: !fixtureAvailable && "native fixture not built" }, async function () {
      // Dynamic errcheck + reentrancy on CoreDirectEntry and AllInt32Entry<32>
      const mixed = fixture.func("fixture_exact_mixed", ctypes.c_double, [ctypes.c_int32, ctypes.c_double, ctypes.c_float, ctypes.c_int32]);
      let nestedSeen = 0;
      mixed.errcheck = (result) => {
        if (nestedSeen++ === 0) {
          assert.strictEqual(mixed(1, 2.0, 3.0, 4), 19.0);
        }
        return result + 1;
      };
      try {
        assert.strictEqual(mixed(-7, 1.5, 2.25, 8), 11.75);
        assert.strictEqual(nestedSeen, 2);
      } finally {
        mixed.errcheck = null;
      }
      assert.strictEqual(mixed(-7, 1.5, 2.25, 8), 10.75);
      assert.throws(() => mixed(1, 2n ** 1024n, 1.0, 1), /argument 2/);
      assert.throws(() => mixed(1, 1.0), /Expected 4 arguments, got 2/);

      const stack32 = fixture.func("fixture_abi_i32_32", ctypes.c_int32, Array(32).fill(ctypes.c_int32));
      const vals32 = Array.from({ length: 32 }, (_, i) => i + 1);
      const expected32 = vals32.reduce((sum, v) => sum + v * v, 0);
      assert.strictEqual(stack32(...vals32), expected32);
      // BigInt truncation + boolean + _as_parameter_ on 32-arg AllInt32Entry<32>
      assert.strictEqual(stack32(0x100000001n, ...vals32.slice(1)), expected32);
      assert.strictEqual(stack32(true, ...vals32.slice(1)), expected32);
      assert.strictEqual(stack32({ _as_parameter_: 1 }, ...vals32.slice(1)), expected32);
      assert.throws(() => stack32(1, 2, 3, 4.5, ...vals32.slice(4)), /argument 4: TypeError: 'float' object cannot be interpreted as an integer/);
      stack32.errcheck = (r) => r + 5;
      try {
        assert.strictEqual(stack32(...vals32), expected32 + 5);
      } finally {
        stack32.errcheck = null;
      }
      assert.strictEqual(stack32(...vals32), expected32);

      // UnaryStringEntry transitions after long_string_hints_ is set
      const charPtrAddr = fixture.func("fixture_address", ctypes.c_size_t, [ctypes.c_char_p]);
      assert.ok(charPtrAddr("short") !== 0n);
      assert.ok(charPtrAddr("x".repeat(4096)) !== 0n);
      assert.strictEqual(charPtrAddr(null), 0n);
      assert.strictEqual(charPtrAddr(undefined), 0n);
      const cbuf = ctypes.create_string_buffer("buf");
      assert.strictEqual(charPtrAddr(cbuf), ctypes.addressof(cbuf));
      assert.throws(() => charPtrAddr(42), /argument 1/);
      assert.ok(charPtrAddr("short-again") !== 0n);

      // UnaryPointerCall across view types, scalars, errors and errcheck
      const sum4 = fixture.func("fixture_sum_int4", ctypes.c_int32, [ctypes.c_void_p]);
      const raw = new Int32Array([10, 20, 30, 40]);
      const buf = Buffer.from(raw.buffer);
      const dv = new DataView(raw.buffer);
      assert.strictEqual(sum4(buf), 100);
      assert.strictEqual(sum4(raw), 100);
      assert.strictEqual(sum4(dv), 100);
      assert.strictEqual(sum4(ctypes.addressof(buf)), 100);
      assert.throws(() => sum4(1.5), /cannot be interpreted as ctypes.c_void_p/);
      sum4.errcheck = (r) => r * 2;
      try {
        assert.strictEqual(sum4(buf), 200);
      } finally {
        sum4.errcheck = null;
      }
      assert.strictEqual(sum4(buf), 100);

      // DirectPointerCall (2-4 args with pointers + ints): memset & qsort edge cases
      const libc = new ctypes.CDLL(process.platform === "win32" ? "msvcrt.dll" : null);
      try {
        const memsetFn = libc.func("memset", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_size_t]);
        const target = Buffer.alloc(32);
        assert.strictEqual(memsetFn(target, 0x5a, 32), ctypes.addressof(target));
        assert.strictEqual(target[0], 0x5a);
        assert.strictEqual(target[31], 0x5a);
        const sub = new Uint8Array(target.buffer, target.byteOffset + 8, 8);
        assert.strictEqual(memsetFn(sub, 0x22, 8), ctypes.addressof(target) + 8n);
        assert.strictEqual(target[7], 0x5a);
        assert.strictEqual(target[8], 0x22);
        assert.strictEqual(target[15], 0x22);
        assert.strictEqual(target[16], 0x5a);
        assert.strictEqual(memsetFn(ctypes.addressof(target), 0x11, 4n), ctypes.addressof(target));
        assert.strictEqual(target[0], 0x11);
        assert.strictEqual(target[4], 0x5a);
        // Boolean, zero-length buffer, pre-detached view, and negative/large BigInt fallbacks on DirectPointerCall
        assert.strictEqual(memsetFn(target, true, 2), ctypes.addressof(target));
        assert.strictEqual(target[0], 1);
        assert.strictEqual(target[1], 1);
        assert.strictEqual(memsetFn(target, false, 1n), ctypes.addressof(target));
        assert.strictEqual(target[0], 0);
        const emptyBuf = Buffer.alloc(0);
        const emptyRet = memsetFn(emptyBuf, 0x44, 0);
        assert.ok(emptyRet === null || typeof emptyRet === "bigint");
        const preDetachedAb = new ArrayBuffer(8);
        const preDetachedView = new Uint8Array(preDetachedAb);
        preDetachedAb.transfer();
        assert.strictEqual(memsetFn(preDetachedView, 0, 0), null);
        assert.throws(() => memsetFn(target, 1.5, 4), /argument 2/);
        assert.throws(() => memsetFn(target, 1, 4.5), /argument 3/);
        assert.throws(() => memsetFn(1.5, 1, 4), /cannot be interpreted as ctypes.c_void_p/);
        memsetFn.errcheck = (r) => r + 1n;
        try {
          assert.strictEqual(memsetFn(target, 0x33, 4), ctypes.addressof(target) + 1n);
        } finally {
          memsetFn.errcheck = null;
        }

        // Detached ArrayBuffer during a DirectPointerCall callback (qsort)
        const qsortFn = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
        const ab = new ArrayBuffer(16);
        const arr = new Int32Array(ab);
        arr.set([4, 1, 3, 2]);
        let detachedOnce = false;
        const detachCb = ctypes.callback(
          (a, b) => {
            if (!detachedOnce) {
              detachedOnce = true;
              ab.transfer();
            }
            return a < b ? -1 : a > b ? 1 : 0;
          },
          ctypes.c_int32,
          [ctypes.c_void_p, ctypes.c_void_p],
        );
        try {
          assert.throws(() => qsortFn(arr, 4, 4, detachCb.pointer), /argument 1:.*detached/);
        } finally {
          detachCb.release();
        }
      } finally {
        libc.close();
      }

      // specializeCall case 2 variadic path: primitive fast-path vs object extra args,
      // plus >32 extra variadic arguments (overflow path in AcquireExtraCall / MarshalArguments)
      const vsum = fixture.func("fixture_variadic_sum", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_int32]);
      assert.strictEqual(vsum(null, 3, 7, 8, 9), 24);
      assert.strictEqual(vsum(null, 3, 7, new ctypes.c_int32(8), { _as_parameter_: 9 }), 24);
      const many35 = Array.from({ length: 35 }, (_, i) => i + 1);
      assert.strictEqual(vsum(null, 35, ...many35), 630);
      assert.strictEqual(await vsum.callAsync(null, 35, ...many35), 630);
      let cbHits = 0;
      const hook = ctypes.callback(
        () => {
          cbHits++;
        },
        ctypes.c_void,
        [],
      );
      try {
        assert.strictEqual(vsum(hook, 3, 7, 8, 9), 24);
        assert.strictEqual(cbHits, 1);
      } finally {
        hook.release();
      }

      // PreparedCall inline SBO boundaries (argc 0, 4, 10, 32; return <=64B and 65B)
      const zero = fixture.func("fixture_benchmark_zero", ctypes.c_int32, []);
      const stack10 = fixture.func("fixture_abi_i32_stack", ctypes.c_int64, Array(10).fill(ctypes.c_int32));
      const Bytes33 = ctypes.struct({ values: ctypes.array(ctypes.c_uint8, 33) });
      const Bytes65 = ctypes.struct({ values: ctypes.array(ctypes.c_uint8, 65) });
      const echo33 = fixture.func("fixture_bytes_33_echo", Bytes33, [Bytes33]);
      const echo65 = fixture.func("fixture_bytes_65_echo", Bytes65, [Bytes65]);
      const in33 = { values: Array.from({ length: 33 }, (_, i) => i + 1) };
      const in65 = { values: Array.from({ length: 65 }, (_, i) => (i * 3) & 0xff) };
      const executor = new ctypes.Executor();
      try {
        assert.strictEqual(await zero.callAsync(), 7);
        assert.strictEqual(await zero.callOn(executor), 7);
        assert.strictEqual(await mixed.callAsync(-7, 1.5, 2.25, 8), 10.75);
        assert.strictEqual(await stack10.callAsync(...Array.from({ length: 10 }, (_, i) => i + 1)), 385n);
        assert.strictEqual(await stack32.callAsync(...vals32), expected32);
        assert.strictEqual(await stack32.callOn(executor, ...vals32), expected32);
        assert.deepStrictEqual([...(await echo33.callAsync(in33)).values], in33.values);
        assert.deepStrictEqual([...(await echo65.callAsync(in65)).values], in65.values);
        assert.deepStrictEqual([...(await echo65.callOn(executor, in65)).values], in65.values);

        // PreparedCall inline large-struct SBO edge cases:
        // 1) struct 32B + errcheck (KeepArguments), 2) two 32B structs in one callAsync (1st inline, 2nd heap),
        // 3) 32B struct + c_char_p string (FixupPointers interaction), 4) 5 args with 32B struct (>4 args fallback)
        const HFA = ctypes.struct({ a: ctypes.c_double, b: ctypes.c_double, c: ctypes.c_double, d: ctypes.c_double });
        const sumHFA = fixture.func("fixture_hfa_f64_4_sum", ctypes.c_double, [HFA]);
        const hfaVal = { a: 0.25, b: 1.25, c: 2.25, d: 3.25 };
        const seenErrcheckArgs = [];
        sumHFA.errcheck = (res, _fn, args) => {
          seenErrcheckArgs.push(args[0]);
          return res + 1;
        };
        try {
          assert.strictEqual(await sumHFA.callAsync(hfaVal), 23.5);
          assert.strictEqual(seenErrcheckArgs[0], hfaVal);
        } finally {
          sumHFA.errcheck = null;
        }

        const tsTwoHfa = ctypes.threadSafeCallback((x, y) => x.a + x.d + y.b + y.c, ctypes.c_double, [HFA, HFA]);
        const tsHfaStr = ctypes.threadSafeCallback((x, s) => x.a + x.d + s.length, ctypes.c_double, [HFA, ctypes.c_char_p]);
        const tsFiveArgs = ctypes.threadSafeCallback((a, b, c, d, x) => a + b + c + d + x.a + x.d, ctypes.c_double, [ctypes.c_int32, ctypes.c_int32, ctypes.c_int32, ctypes.c_int32, HFA]);
        try {
          const callTwoHfa = ctypes.CFUNCTYPE(ctypes.c_double, HFA, HFA)(tsTwoHfa.pointer);
          const callHfaStr = ctypes.CFUNCTYPE(ctypes.c_double, HFA, ctypes.c_char_p)(tsHfaStr.pointer);
          const callFiveArgs = ctypes.CFUNCTYPE(ctypes.c_double, ctypes.c_int32, ctypes.c_int32, ctypes.c_int32, ctypes.c_int32, HFA)(tsFiveArgs.pointer);
          assert.strictEqual(await callTwoHfa.callAsync(hfaVal, { a: 10, b: 20, c: 30, d: 40 }), 0.25 + 3.25 + 20 + 30);
          assert.strictEqual(await callHfaStr.callAsync(hfaVal, "hello world"), 0.25 + 3.25 + 11);
          assert.strictEqual(await callFiveArgs.callAsync(1, 2, 3, 4, hfaVal), 10 + 0.25 + 3.25);
        } finally {
          tsTwoHfa.release();
          tsHfaStr.release();
          tsFiveArgs.release();
        }
      } finally {
        await executor.close();
      }
    });
  });
});
