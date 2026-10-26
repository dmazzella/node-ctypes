import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { LIBC } from "../cpython_parity/_support.js";
const { CDLL, Structure, Union, POINTER, pointer, ARRAY, sizeof, alignment, CFUNCTYPE, ArgumentError, create_string_buffer, create_unicode_buffer, c_buffer, c_int, c_char, c_wchar, c_char_p, c_void_p, c_size_t } = ctypes;
const platform = process.platform;

const { array } = ctypes;
describe("JavaScript extensions to the Python-shaped API", function () {
  let libc;
  before(() => {
    libc = new CDLL(LIBC);
  });
  after(() => {
    if (libc) libc.close();
  });
  it("set_last_error returns the previous value", function () {
    const old = ctypes.set_last_error(5);
    assert.strictEqual(ctypes.set_last_error(old), 5);
    assert.strictEqual(ctypes.get_last_error(), old);
  });

  it("rejects values that are not one character", function () {
    for (const [v, message] of [
      ["", "one character bytes, bytearray, or an integer in range(256) expected, not a string of length 0"],
      ["ab", "one character bytes, bytearray, or an integer in range(256) expected, not a string of length 2"],
      [Buffer.from("ab"), "one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 2"],
      [{}, "one character bytes, bytearray, or an integer in range(256) expected, not Object"],
      [256, "integer not in range(256)"],
      [-1, "integer not in range(256)"],
    ]) {
      assert.throws(() => new c_char(v), { name: "TypeError", message });
    }
    for (const [v, message] of [
      ["", "a unicode character expected, not a string of length 0"],
      ["ab", "a unicode character expected, not a string of length 2"],
      [{}, "a unicode character expected, not instance of Object"],
    ]) {
      assert.throws(() => new c_wchar(v), { name: "TypeError", message });
    }
  });

  it("wide strings keep characters outside the BMP and lone surrogates", async function () {
    const wcslen = libc.func("wcslen", c_size_t, [ctypes.c_wchar_p]);
    const wcschr = libc.func("wcschr", ctypes.c_wchar_p, [ctypes.c_wchar_p, c_wchar]);
    const units = ctypes.WCHAR_SIZE === 2 ? 4 : 3;
    assert.strictEqual(Number(wcslen("a😀b")), units);
    assert.strictEqual(Number(await wcslen.callAsync("a😀b")), units);
    assert.strictEqual(wcschr("x😀ab", "a"), "ab");
    assert.strictEqual(wcschr("a\ud800b", "b"), "b");
    assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("a\ud800b")), "a\ud800b");
    assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("a😀b")), "a😀b");
    if (ctypes.WCHAR_SIZE === 4) {
      assert.strictEqual(wcschr("a😀b", "😀"), "😀b");
      assert.strictEqual(new c_wchar("😀").value, "😀");
    }
  });

  it("array methods work on elements, not bytes", function () {
    const a = array(c_int, 3)(1, 2, 300);
    assert.deepStrictEqual(a.slice(0, 2), [1, 2]);
    assert.strictEqual(a.at(-1), 300);
    assert.ok(a.includes(300));
    assert.strictEqual(a.indexOf(2), 1);
    assert.deepStrictEqual(
      a.map((v) => v * 2),
      [2, 4, 600],
    );
    assert.strictEqual(a.join(","), "1,2,300");
    assert.strictEqual(JSON.stringify(a), "[1,2,300]");
    const visited = [];
    a.forEach((v) => visited.push(v));
    assert.deepStrictEqual(visited, [1, 2, 300]);
    a.fill(7);
    assert.deepStrictEqual([...a], [7, 7, 7]);
    const s = array(c_char, 6)();
    s.value = "abc";
    assert.strictEqual(s.slice(0, 3), "abc");
    assert.strictEqual(array(c_wchar, 4)("x", "y").slice(0, 2), "xy");
  });

  it("memmove / memset work on bytes of any typed array, DataView or ArrayBuffer", function () {
    const words = new Uint16Array([1, 2, 3, 4]);
    const bytes = new Uint8Array(8);
    ctypes.memmove(bytes, words, 8);
    assert.deepStrictEqual([...new Uint16Array(bytes.buffer)], [1, 2, 3, 4]);
    const doubles = new Float64Array(1);
    ctypes.memmove(new DataView(doubles.buffer), Buffer.from(new Float64Array([1.5]).buffer), 8);
    assert.strictEqual(doubles[0], 1.5);
    const raw = new ArrayBuffer(4);
    ctypes.memset(raw, 0x7f, 2);
    assert.deepStrictEqual([...new Uint8Array(raw)], [0x7f, 0x7f, 0, 0]);
    // Overlapping copy, as C memmove; the count stops at the end of JS memory.
    const ints = array(c_int, 4)(1, 2, 3, 4);
    ctypes.memmove(ints._buffer.subarray(sizeof(c_int)), ints, 3 * sizeof(c_int));
    assert.deepStrictEqual([...ints], [1, 1, 2, 3]);
    const small = new Uint32Array(1);
    ctypes.memset(small, 0xff, 16);
    assert.strictEqual(small[0], 0xffffffff);
  });

  it("array types are callable like (c_int * 3)(1, 2, 3)", function () {
    const Int3 = array(c_int, 3);
    const a = Int3(1, 2, 3);
    assert.deepStrictEqual([a[0], a[1], a[2]], [1, 2, 3]);
    assert.strictEqual(new Int3(4)[0], 4);
  });

  it("struct() accepts a Structure class as anonymous field", function () {
    class P extends Structure {
      static _fields_ = [["x", c_int]];
    }
    const D = ctypes.struct({ id: ctypes.c_uint32, pos: { type: P, anonymous: true } });
    const d = D.create({ id: 1 });
    d.x = 4;
    assert.strictEqual(d.pos.x, 4);
  });

  it("pointer and CFUNCTYPE fields keep their objects alive", { skip: typeof globalThis.gc !== "function" }, function () {
    const FT = CFUNCTYPE(c_int, c_int);
    class S extends Structure {
      static _fields_ = [
        ["f", FT],
        ["p", POINTER(c_int)],
      ];
    }
    const s = new S();
    s.f = FT((x) => x * 2);
    s.p = pointer(new c_int(77));
    for (let i = 0; i < 3; i++) {
      globalThis.gc();
      for (let j = 0; j < 1000; j++) Buffer.alloc(4096, 1);
    }
    assert.strictEqual(s.f(21), 42);
    assert.strictEqual(s.p.contents.value, 77);
  });

  it("SimpleCData instances keep their type beyond argtypes", async function () {
    const sprintf = libc.func("sprintf", c_int, [c_char_p, c_char_p]);
    const buf = Buffer.alloc(128);
    sprintf(buf, "%.1f %d %lld|", new ctypes.c_double(2.0), new c_int(-3), new ctypes.c_longlong(1n << 40n));
    assert.strictEqual(buf.toString("latin1", 0, buf.indexOf(0)), "2.0 -3 1099511627776|");
    // node-ctypes also applies the C variadic promotions (Python: ffi_prep_cif_var fails).
    buf.fill(0);
    sprintf(buf, "%.1f %d %c|", new ctypes.c_float(1.5), new ctypes.c_int8(-3), new c_char("Z"));
    assert.strictEqual(buf.toString("latin1", 0, buf.indexOf(0)), "1.5 -3 Z|");
    buf.fill(0);
    await sprintf.callAsync(buf, "%.1f", new ctypes.c_double(3.0));
    assert.strictEqual(buf.toString("latin1", 0, buf.indexOf(0)), "3.0");
  });

  it("integer arguments reject non-numeric values, as in Python", function () {
    const llabs = libc.func(platform === "win32" ? "_abs64" : "llabs", ctypes.c_longlong, [ctypes.c_longlong]);
    const labs = libc.func("labs", ctypes.c_long, [ctypes.c_long]);
    const abs = libc.func("abs", c_int, [c_int]);
    for (const [value, name] of [
      ["1", "string"],
      [{}, "Object"],
      [Symbol("x"), "symbol"],
      [() => 1, "function"],
    ]) {
      for (const f of [llabs, labs, abs]) {
        assert.throws(
          () => f(value),
          (e) => e instanceof ArgumentError && e.message === `argument 1: TypeError: '${name}' object cannot be interpreted as an integer`,
        );
      }
    }
    // BigInt wraps like a Python int; null is not an integer argument.
    assert.strictEqual(llabs(2n ** 64n - 3n), 3n);
    assert.strictEqual(llabs(true), 1n);
    assert.throws(() => llabs(null), ArgumentError);
  });

  it("cast of c_char_p reads the stored address and keeps the source alive", function () {
    const p = ctypes.cast(new c_char_p("abc"), POINTER(c_char));
    for (let i = 0; i < 3; i++) globalThis.gc?.();
    assert.deepStrictEqual([p[0], p[1], p[2]], ["a", "b", "c"]);
    const w = ctypes.cast(new ctypes.c_wchar_p("xy"), POINTER(c_wchar));
    assert.deepStrictEqual([w[0], w[1]], ["x", "y"]);
  });

  it("cast to c_void_p / c_char_p / c_wchar_p points to the source and keeps it alive", function () {
    const buf = create_string_buffer("hello");
    const v = ctypes.cast(buf, c_void_p);
    assert.ok(v instanceof c_void_p);
    assert.strictEqual(v.value, ctypes.addressof(buf));
    assert.strictEqual(ctypes.cast(ctypes.addressof(buf), c_char_p).value, "hello");
    assert.strictEqual(ctypes.cast(new c_void_p(ctypes.addressof(buf)), c_char_p).value, "hello");
    const s = ctypes.cast(create_string_buffer("kept"), c_char_p);
    for (let i = 0; i < 3; i++) globalThis.gc?.();
    assert.strictEqual(s.value, "kept");
    assert.strictEqual(ctypes.cast(create_unicode_buffer("wz"), ctypes.c_wchar_p).value, "wz");
    const p = pointer(new c_int(7));
    assert.strictEqual(ctypes.cast(p, c_void_p).value, p.address);
  });

  it("contents accepts instances of other types of the same size, not smaller ones", function () {
    const p = POINTER(ctypes.c_uint32).create();
    p.contents = new c_int(-1);
    assert.strictEqual(p.contents.value, 4294967295);
    // Python reads 8 bytes from the 4 of the c_int here.
    assert.throws(() => {
      POINTER(ctypes.c_double).create().contents = new c_int(5);
    }, TypeError);
  });

  it("rejects values that are not pointers (no implicit NULL)", function () {
    const memset = libc.memset;
    memset.restype = c_void_p;
    memset.argtypes = [c_void_p, c_int, c_size_t];
    for (const [v, name] of [
      [() => 0, "function"],
      [{}, "Object"],
      [Symbol("x"), "symbol"],
    ]) {
      assert.throws(
        () => memset(v, 0, 0),
        (e) => e instanceof ArgumentError && e.message === `argument 1: TypeError: '${name}' object cannot be interpreted as ctypes.c_void_p`,
      );
    }
  });

  it("c_void_p accepts strings (as bytes) and typed arrays", function () {
    const memcpy = libc.memcpy;
    memcpy.restype = c_void_p;
    memcpy.argtypes = [c_void_p, c_void_p, c_size_t];
    const dst = Buffer.alloc(3);
    memcpy(dst, "abc", 3);
    assert.strictEqual(dst.toString(), "abc");
    const floats = new Float32Array(2);
    memcpy(floats, new Float32Array([1.5, 2.5]), 8);
    assert.deepStrictEqual([...floats], [1.5, 2.5]);
  });
});
