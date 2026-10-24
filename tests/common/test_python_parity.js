/**
 * Test Python ctypes parity (2.0) - names, characters, buffers, arrays,
 * pointers and argument validation behave as in Python ctypes.
 * Python twin: test_python_parity.py
 */

import assert from "node:assert";
import os from "node:os";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const { CDLL, Structure, Union, POINTER, pointer, array, ARRAY, sizeof, alignment, CFUNCTYPE, ArgumentError, create_string_buffer, create_unicode_buffer, c_buffer, c_int, c_char, c_wchar, c_char_p, c_void_p, c_size_t } = ctypes;

const platform = os.platform();

describe("Python ctypes parity", function () {
  let libc;

  before(function () {
    if (platform === "win32") {
      libc = new CDLL("msvcrt.dll");
    } else {
      libc = new CDLL(platform === "darwin" ? "libc.dylib" : "libc.so.6");
    }
  });

  after(function () {
    if (libc) libc.close();
  });

  describe("Names", function () {
    it("exports the Python aliases and constants", function () {
      assert.strictEqual(ctypes.c_voidp, c_void_p);
      assert.strictEqual(sizeof(ctypes.c_time_t), 8);
      assert.strictEqual(ctypes.SIZEOF_TIME_T, 8);
      assert.strictEqual(typeof ctypes.RTLD_GLOBAL, "number");
      assert.strictEqual(typeof ctypes.RTLD_LOCAL, "number");
      assert.strictEqual(ctypes.DEFAULT_MODE, ctypes.RTLD_LOCAL);
      assert.strictEqual(sizeof(ARRAY(c_int, 3)), 3 * sizeof(c_int));
      assert.strictEqual(c_buffer("ab").value, "ab");
    });

    it("set_last_error returns the previous value", function () {
      const old = ctypes.set_last_error(5);
      assert.strictEqual(ctypes.set_last_error(old), 5);
      assert.strictEqual(ctypes.get_last_error(), old);
    });

    it("cdll.LoadLibrary always creates a new instance", function () {
      const name = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
      const a = ctypes.cdll.LoadLibrary(name);
      const b = new ctypes.LibraryLoader(CDLL).LoadLibrary(name);
      assert.notStrictEqual(a, b);
      assert.strictEqual(a.abs(-3), 3);
    });

    it("functions without restype return c_int", function () {
      assert.strictEqual(libc.abs(-5), 5);
    });

    it("null restype returns undefined, as Python restype=None returns None", function () {
      assert.strictEqual(libc.func("srand", null, [ctypes.c_uint32])(1), undefined);
      const srand = libc.srand;
      srand.argtypes = [ctypes.c_uint32];
      srand.restype = null;
      assert.strictEqual(srand(2), undefined);
      const Srand = CFUNCTYPE(null, ctypes.c_uint32);
      assert.strictEqual(Srand(["srand", libc])(3), undefined);
    });

    it("CFUNCTYPE callers honor the _as_parameter_ protocol", function () {
      const Abs = CFUNCTYPE(c_int, c_int);
      const abs = Abs(["abs", libc]);
      assert.strictEqual(abs({ _as_parameter_: -9 }), 9);
    });
  });

  describe("c_char / c_wchar", function () {
    it("values are 1-character strings", function () {
      assert.strictEqual(new c_char("A").value, "A");
      assert.strictEqual(new c_char(66).value, "B");
      assert.strictEqual(new c_wchar("é").value, "é");
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

    it("c_char arguments accept one character", function () {
      const strchr = libc.strchr;
      strchr.restype = c_char_p;
      strchr.argtypes = [c_char_p, c_char];
      assert.strictEqual(strchr("abcdef", "d"), "def");
      assert.strictEqual(strchr("abcdef", Buffer.from("e")), "ef");
      assert.throws(
        () => strchr("abcdef", Buffer.from("de")),
        (e) => e instanceof ArgumentError && e instanceof TypeError && e.message === "argument 2: TypeError: one character bytes, bytearray, or an integer in range(256) expected, not Buffer of length 2",
      );
    });
  });

  describe("Wide characters", function () {
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

    it("c_wchar arguments accept exactly one character", function () {
      const wcschr = libc.func("wcschr", ctypes.c_wchar_p, [ctypes.c_wchar_p, c_wchar]);
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

  describe("Buffers and arrays", function () {
    it("Structure.from_buffer validates the offset and accepts ctypes arrays", function () {
      class P extends Structure {
        static _fields_ = [
          ["x", c_int],
          ["y", c_int],
        ];
      }
      const buf = Buffer.alloc(16);
      assert.throws(() => P.from_buffer(buf, -4), { name: "RangeError", message: /offset cannot be negative/ });
      assert.throws(() => P.from_buffer_copy(buf, -1), { name: "RangeError", message: /offset cannot be negative/ });
      assert.throws(() => P.from_buffer(buf, 12), { name: "RangeError", message: /Buffer size too small \(16 instead of at least 20 bytes\)/ });
      assert.strictEqual(P.from_buffer(array(c_int, 4)(1, 2, 3, 4), 4).x, 2);
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

    it("string_at / wstring_at read the memory of instances, arrays and pointers", function () {
      const buf = create_string_buffer("hello");
      const addr = ctypes.addressof(buf);
      assert.strictEqual(ctypes.string_at(buf), "hello");
      assert.strictEqual(ctypes.string_at(new c_char_p("world")), "world");
      assert.strictEqual(ctypes.string_at(new c_void_p(addr)), "hello");
      assert.strictEqual(ctypes.string_at(POINTER(c_char).fromAddress(addr)), "hello");
      assert.strictEqual(ctypes.string_at(array(c_char, 8).from_buffer(Buffer.from("arr\0xxxx"))), "arr");
      assert.strictEqual(ctypes.string_at({ _as_parameter_: addr }, 3), "hel");
      assert.strictEqual(ctypes.wstring_at(create_unicode_buffer("wide")), "wide");
      assert.strictEqual(ctypes.wstring_at(new ctypes.c_wchar_p("wz")), "wz");
      assert.throws(() => ctypes.string_at({}), TypeError);
    });

    it("string_at and c_char_p read strings longer than 1 MiB", function () {
      const big = create_string_buffer(2 * 1024 * 1024);
      big.fill(0x41, 0, big.length - 1);
      assert.strictEqual(ctypes.string_at(ctypes.addressof(big)).length, big.length - 1);
      assert.strictEqual(new c_char_p(big).value.length, big.length - 1);
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

    it("create_string_buffer(init, size)", function () {
      const buf = create_string_buffer("Hello", 10);
      assert.strictEqual(sizeof(buf), 10);
      assert.strictEqual(buf.value, "Hello");
      assert.deepStrictEqual([...buf.raw], [72, 101, 108, 108, 111, 0, 0, 0, 0, 0]);
      buf.value = "Hi";
      assert.strictEqual(buf.value, "Hi");
      assert.throws(() => create_string_buffer("Hello", 3), RangeError);
      assert.strictEqual(create_unicode_buffer("ok", 5).value, "ok");
    });

    it("string_at / wstring_at read exactly `size` units, else up to NUL", function () {
      const b = create_string_buffer("A\0BC", 6);
      assert.strictEqual(ctypes.string_at(b, 4), "A\0BC");
      assert.strictEqual(ctypes.string_at(ctypes.addressof(b)), "A");
      const w = create_unicode_buffer("ab\0cd", 6);
      assert.strictEqual(ctypes.wstring_at(w, 5), "ab\0cd");
      assert.strictEqual(ctypes.wstring_at(ctypes.addressof(w)), "ab");
      class S extends Structure {
        static _fields_ = [["s", ctypes.c_wchar_p]];
      }
      const long = "x".repeat(5000) + "é😀";
      const st = new S();
      st.s = long;
      assert.strictEqual(st.s, long);
    });

    it("array types are callable like (c_int * 3)(1, 2, 3)", function () {
      const Int3 = array(c_int, 3);
      const a = Int3(1, 2, 3);
      assert.deepStrictEqual([a[0], a[1], a[2]], [1, 2, 3]);
      assert.strictEqual(new Int3(4)[0], 4);
    });

    it("char arrays expose value/raw and validate elements", function () {
      const Chars = array(c_char, 4);
      const c = Chars("a", "b");
      assert.strictEqual(c.value, "ab");
      assert.deepStrictEqual([...c.raw], [97, 98, 0, 0]);
      assert.throws(() => Chars("ab"), { message: "one character bytes, bytearray, or an integer in range(256) expected, not a string of length 2" });
    });

    it("addressof(array) and arrays of pointers", function () {
      const ints = array(c_int, 3)(7, 8, 9);
      const p = ctypes.cast(ctypes.addressof(ints), POINTER(c_int));
      assert.deepStrictEqual([p[0], p[2]], [7, 9]);

      class Mod extends Structure {
        static _fields_ = [
          ["op", c_int],
          ["name", ctypes.c_wchar_p],
        ];
      }
      const PMods = array(POINTER(Mod), 3);
      const mods = PMods(pointer(new Mod(1, "cn")), pointer(new Mod(2, "mail")));
      assert.strictEqual(sizeof(PMods), 3 * sizeof(c_void_p));
      assert.deepStrictEqual([mods[0].contents.name, mods[1].contents.op, mods[2]], ["cn", 2, null]);
      assert.throws(() => (mods[2] = () => 0), TypeError);

      // POINTER(POINTER(T)): elements are pointer objects (NULL → null)
      const pp = ctypes.cast(ctypes.addressof(mods), POINTER(POINTER(Mod)));
      assert.deepStrictEqual([pp[0].contents.name, pp[1].contents.op, pp[2]], ["cn", 2, null]);
      pp[2] = pointer(new Mod(3, "sn"));
      assert.strictEqual(mods[2].contents.name, "sn");
    });

    it("arrays of arrays", function () {
      const Matrix = array(array(c_int, 2), 2);
      const m = Matrix();
      m[1][0] = 5;
      assert.strictEqual(m[1][0], 5);
      assert.strictEqual(sizeof(Matrix), 4 * sizeof(c_int));
    });
  });

  describe("Structures", function () {
    it("rejects what Python rejects: initializers, incompatible instances, long bytes, float bitfields", function () {
      class P extends Structure {
        static _fields_ = [["x", c_int]];
      }
      assert.throws(() => new P(1, 2), { name: "TypeError", message: "too many initializers" });
      assert.strictEqual(new P(new c_int(5)).x, 5);
      const s = new P();
      assert.throws(() => {
        s.x = new ctypes.c_double(1);
      }, /incompatible types, c_double instance instead of/);
      class N extends Structure {
        static _fields_ = [["name", array(c_char, 4)]];
      }
      const n = new N();
      assert.throws(() => {
        n.name = Buffer.from("toolong");
      }, /bytes too long \(7, maximum length 4\)/);
      n.name = Buffer.from("ab");
      assert.strictEqual(n.name, "ab");
      assert.throws(() => {
        class B extends Structure {
          static _fields_ = [["f", ctypes.c_float, 3]];
        }
        sizeof(B);
      }, /bit fields not allowed for type c_float/);
      assert.strictEqual(array(c_char, 8).create("héllo").value, "héllo");
    });

    it("fields keep the declared order, also with integer-like names", function () {
      class S extends Structure {
        static _fields_ = [
          ["a", ctypes.c_int8],
          ["1", c_int],
        ];
      }
      const s = new S();
      s.a = 1;
      s["1"] = 2;
      assert.strictEqual(sizeof(S), 8);
      assert.deepStrictEqual([...s._buffer], [1, 0, 0, 0, 2, 0, 0, 0]);
    });

    it("anonymous members of a Union are promoted, also through nested anonymous fields", function () {
      class P extends Structure {
        static _fields_ = [["x", c_int]];
      }
      class Q extends Structure {
        static _fields_ = [
          ["p", P],
          ["z", c_int],
        ];
        static _anonymous_ = ["p"];
      }
      class U extends Union {
        static _fields_ = [
          ["q", Q],
          ["i", c_int],
        ];
        static _anonymous_ = ["q"];
      }
      const u = new U();
      u.x = 7;
      assert.deepStrictEqual([u.i, u.x, u.z, u.q.p.x], [7, 7, 0, 7]);
    });

    it("malformed _fields_ entries are rejected", function () {
      class M extends Structure {
        static _fields_ = [["x"]];
      }
      assert.throws(() => sizeof(M), { name: "TypeError", message: /_fields_ must be a sequence of \(name, C type\) pairs/ });
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

    class POINT extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }

    it("accepts a struct instance as positional initializer", function () {
      class RECT extends Structure {
        static _fields_ = [
          ["a", POINT],
          ["b", POINT],
        ];
      }
      const r = new RECT(new POINT(1, 2), new POINT(3, 4));
      assert.deepStrictEqual([r.a.x, r.b.y], [1, 4]);
    });

    it("a nested structure field is an instance of its class on the same memory", function () {
      class POINT extends Structure {
        static _fields_ = [
          ["x", c_int],
          ["y", c_int],
        ];
      }
      class RECT extends Structure {
        static _fields_ = [
          ["a", POINT],
          ["b", POINT],
        ];
      }
      class Value extends Union {
        static _fields_ = [
          ["p", POINT],
          ["n", ctypes.c_int64],
        ];
      }
      const r = new RECT(new POINT(1, 2), new POINT(3, 4));
      const a = r.a;
      assert.ok(a instanceof POINT);
      a.x = 10;
      assert.strictEqual(r.a.x, 10);
      r.a = new POINT(5, 6);
      assert.deepStrictEqual([a.x, a.y], [5, 6]);
      assert.strictEqual(ctypes.addressof(r.b), ctypes.addressof(r) + BigInt(sizeof(POINT)));
      const v = new Value();
      v.p.y = 7;
      assert.ok(v.p instanceof POINT);
      assert.strictEqual(v.n, 7n << 32n);
    });

    it("nested struct/union instances are copied bytewise (no inactive member reads)", function () {
      class Data extends Union {
        static _fields_ = [
          ["s", ctypes.c_wchar_p],
          ["Integer", ctypes.c_ulong],
        ];
      }
      class Value extends Structure {
        static _fields_ = [
          ["dwType", ctypes.c_ulong],
          ["Value", Data],
        ];
      }
      const v = new Value(7, new Data({ Integer: 1000 }));
      assert.deepStrictEqual([v.dwType, v.Value.Integer], [7n, 1000n]);
      const prefs = array(Value, 2)(v, new Value(6, new Data({ s: "text" })));
      assert.deepStrictEqual([prefs[0].Value.Integer, prefs[1].Value.s], [1000n, "text"]);
    });

    it("char array fields read and write as strings", function () {
      class Named extends Structure {
        static _fields_ = [["name", array(c_char, 8)]];
      }
      const n = new Named();
      n.name = "abc";
      assert.strictEqual(n.name, "abc");
    });

    it("NULL pointer fields are null", function () {
      class Node extends Structure {
        static _fields_ = [["next", POINTER(c_int)]];
      }
      assert.strictEqual(new Node().next, null);
    });

    it("pointer(instance).contents is an instance of the class", function () {
      const p = new POINT(3, 4);
      const pp = pointer(p);
      assert.ok(pp.contents instanceof POINT);
      pp.contents.x = 7;
      assert.strictEqual(p.x, 7);
    });

    it("CFUNCTYPE fields hold callable functions", function () {
      const FT = CFUNCTYPE(c_int, c_int);
      class Ops extends Structure {
        static _fields_ = [
          ["n", c_int],
          ["f", FT],
        ];
      }
      class OpsU extends Union {
        static _fields_ = [
          ["f", FT],
          ["i", c_int],
        ];
      }
      const cb = FT((x) => x * 3);
      try {
        const o = new Ops(1, cb);
        assert.strictEqual(o.f(14), 42);
        assert.strictEqual(new Ops().f, null);
        const u = new OpsU();
        u.f = cb;
        assert.strictEqual(u.f(5), 15);
        assert.throws(() => (o.f = (x) => x), TypeError);
        assert.strictEqual(sizeof(Ops), 2 * sizeof(c_void_p));
        assert.strictEqual(sizeof(FT), sizeof(c_void_p));
        assert.strictEqual(alignment(FT), alignment(c_void_p));
      } finally {
        cb.release();
      }
    });
  });

  describe("Keepalive of assigned objects (Python _objects)", function () {
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
  });

  describe("Variadic arguments", function () {
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
  });

  describe("Numeric arguments", function () {
    it("non-integral numbers are rejected for integer types (Python: float)", function () {
      const libc = new CDLL(ctypes.find_library("c"));
      const abs = libc.func("abs", c_int, [c_int]);
      for (const value of [3.7, NaN, Infinity]) {
        assert.throws(() => abs(value), { name: "ArgumentError", message: "argument 1: TypeError: 'float' object cannot be interpreted as an integer" });
      }
      assert.strictEqual(abs(-3.0), 3);
      assert.throws(() => new ctypes.c_int32(3.7), { name: "TypeError", message: "'float' object cannot be interpreted as an integer" });
      class S extends Structure {
        static _fields_ = [["i", c_int]];
      }
      const s = new S();
      assert.throws(() => {
        s.i = 3.5;
      }, /'float' object cannot be interpreted as an integer/);
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
      // node-ctypes extensions: BigInt wraps like a Python int, true is 1 and
      // null is 0 for 64-bit integers.
      assert.strictEqual(llabs(2n ** 64n - 3n), 3n);
      assert.strictEqual(llabs(true), 1n);
      assert.strictEqual(llabs(null), 0n);
    });

    it("integer values wrap to the bits of the type, as in Python", function () {
      const cases = [
        [ctypes.c_uint8, 256, 0],
        [ctypes.c_int8, 200, -56],
        [ctypes.c_uint16, -1, 65535],
        [ctypes.c_int16, 40000, -25536],
        [ctypes.c_int32, 2 ** 40 + 5, 5],
        [ctypes.c_int32, 2n ** 64n + 7n, 7],
        [ctypes.c_uint32, -1, 4294967295],
        [ctypes.c_uint64, -1, 2n ** 64n - 1n],
        [ctypes.c_int64, 2n ** 64n + 7n, 7n],
        [ctypes.c_long, 2n ** 64n + 9n, 9n],
      ];
      for (const [T, value, expected] of cases) {
        assert.strictEqual(new T(value).value, expected, `${T.name}(${value})`);
      }
      assert.strictEqual(new c_size_t(-1).value, ctypes.sizeof(c_size_t) === 8 ? 2n ** 64n - 1n : 4294967295);
      class S extends Structure {
        static _fields_ = [
          ["a", ctypes.c_uint8],
          ["b", ctypes.c_int16],
          ["c", ctypes.c_uint64],
        ];
      }
      const s = new S();
      s.a = 300;
      s.b = 40000;
      s.c = -2;
      assert.deepStrictEqual([s.a, s.b, s.c], [44, -25536, 2n ** 64n - 2n]);
      const bytes = array(ctypes.c_uint8, 2)(300, -1);
      assert.deepStrictEqual([...bytes], [44, 255]);
    });

    it("floating point arguments reject non-numeric values, as in Python", function () {
      // glibc has fabs in libm only.
      const libm = platform === "linux" ? new CDLL(ctypes.find_library("m")) : libc;
      try {
        const fabs = libm.func("fabs", ctypes.c_double, [ctypes.c_double]);
        assert.strictEqual(fabs(-1.5), 1.5);
        assert.throws(
          () => fabs("1"),
          (e) => e instanceof ArgumentError && e.message === "argument 1: TypeError: must be real number, not string",
        );
      } finally {
        if (libm !== libc) libm.close();
      }
    });
  });

  describe("Pointer arguments and results", function () {
    it("POINTER restype returns a pointer object or null", function () {
      const strchr = libc.strchr;
      strchr.restype = POINTER(c_char);
      strchr.argtypes = [c_char_p, c_int];
      const p = strchr("abc", 98);
      assert.strictEqual(p.contents.value, "b");
      assert.strictEqual(strchr("abc", 120), null);
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

    it("POINTER(T) and array types are cached (identity)", function () {
      assert.strictEqual(POINTER(c_int), POINTER(c_int));
      assert.strictEqual(array(c_int, 4), array(c_int, 4));
      assert.notStrictEqual(array(c_int, 4), array(c_int, 5));
      assert.strictEqual(pointer(new c_int(1))._pointerType, POINTER(c_int));
    });

    it("pointer(array) points to the array", function () {
      const a = array(c_int, 3)(1, 2, 3);
      const p = pointer(a);
      assert.strictEqual(p.contents[1], 2);
      p.contents[1] = 20;
      assert.strictEqual(a[1], 20);
      assert.strictEqual(ctypes.addressof(p.contents), ctypes.addressof(a));
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

    it("errcheck receives the function itself for every restype; None resets argtypes and errcheck", function () {
      const libc = new CDLL(ctypes.find_library("c"));
      const abs = libc.abs;
      abs.argtypes = [c_int];
      let seen = null;
      abs.errcheck = (result, func, args) => {
        seen = func;
        return result;
      };
      assert.strictEqual(abs(-3), 3);
      assert.strictEqual(seen, abs);
      const malloc = libc.malloc;
      malloc.argtypes = [c_size_t];
      malloc.restype = POINTER(c_int);
      malloc.errcheck = (result, func) => {
        seen = func;
        return result;
      };
      libc.free(malloc(8));
      assert.strictEqual(seen, malloc);
      abs.errcheck = undefined;
      abs.argtypes = null;
      assert.deepStrictEqual(abs.argtypes, []);
      assert.strictEqual(abs(-5), 5);
    });

    it("callbacks receive structures by value; a structure restype is rejected", function () {
      class P extends Structure {
        static _fields_ = [
          ["x", c_int],
          ["y", c_int],
        ];
      }
      const T = CFUNCTYPE(c_int, P, c_int);
      const cb = T((p, k) => p.x * k + p.y);
      assert.strictEqual(T(cb._as_parameter_)(new P(3, 4), 10), 34);
      cb.release();
      assert.throws(() => CFUNCTYPE(P, c_int)(() => new P(1, 2)), { name: "TypeError", message: "invalid result type for callback function" });
    });

    it("a callback with restype c_char_p / c_wchar_p can return a string", function () {
      const T = CFUNCTYPE(c_char_p);
      const cb = T(() => "abc");
      assert.strictEqual(T(cb._as_parameter_)(), "abc");
      const W = CFUNCTYPE(ctypes.c_wchar_p);
      const wcb = W(() => "xy");
      assert.strictEqual(W(wcb._as_parameter_)(), "xy");
      cb.release();
      wcb.release();
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

    it("prototype([name, library]) and paramflags tuples", function () {
      const strlen = CFUNCTYPE(c_size_t, c_char_p)(["strlen", libc]);
      assert.strictEqual(strlen("hello"), 5n);
      const modf = CFUNCTYPE(
        ctypes.c_double,
        ctypes.c_double,
        POINTER(ctypes.c_double),
      )(
        ["modf", libc],
        [
          [1, "x"],
          [2, "iptr"],
        ],
      );
      assert.strictEqual(modf(3.75), 3);
      assert.strictEqual(modf({ x: -2.5 }), -2);
    });

    it("a JS function is not a CFUNCTYPE argument", function () {
      const CMP = CFUNCTYPE(c_int, c_void_p, c_void_p);
      const qsort = libc.qsort;
      qsort.restype = null;
      qsort.argtypes = [c_void_p, c_size_t, c_size_t, CMP];
      assert.throws(
        () => qsort(Buffer.alloc(8), 2, 4, () => 0),
        (e) => e instanceof ArgumentError && e.message.startsWith("argument 4: TypeError"),
      );
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
});
