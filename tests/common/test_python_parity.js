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
  });

  describe("c_char / c_wchar", function () {
    it("values are 1-character strings", function () {
      assert.strictEqual(new c_char("A").value, "A");
      assert.strictEqual(new c_char(66).value, "B");
      assert.strictEqual(new c_wchar("é").value, "é");
    });

    it("rejects values that are not one character", function () {
      for (const v of ["", "ab", 256, -1]) {
        assert.throws(() => new c_char(v), { name: "TypeError", message: "one character bytes, bytearray or integer expected" });
      }
      for (const v of ["", "ab"]) {
        assert.throws(() => new c_wchar(v), { name: "TypeError", message: "one character unicode string expected" });
      }
    });

    it("c_char arguments accept one character", function () {
      const strchr = libc.strchr;
      strchr.restype = c_char_p;
      strchr.argtypes = [c_char_p, c_char];
      assert.strictEqual(strchr("abcdef", "d"), "def");
      assert.strictEqual(strchr("abcdef", Buffer.from("e")), "ef");
      assert.throws(
        () => strchr("abcdef", "de"),
        (e) => e instanceof ArgumentError && e instanceof TypeError && e.message === "argument 2: TypeError: one character bytes, bytearray or integer expected",
      );
    });
  });

  describe("Buffers and arrays", function () {
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
      assert.throws(() => Chars("ab"), { message: "one character bytes, bytearray or integer expected" });
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

  describe("Pointer arguments and results", function () {
    it("POINTER restype returns a pointer object or null", function () {
      const strchr = libc.strchr;
      strchr.restype = POINTER(c_char);
      strchr.argtypes = [c_char_p, c_int];
      const p = strchr("abc", 98);
      assert.strictEqual(p.contents.value, "b");
      assert.strictEqual(strchr("abc", 120), null);
    });

    it("rejects values that are not pointers (no implicit NULL)", function () {
      const memset = libc.memset;
      memset.restype = c_void_p;
      memset.argtypes = [c_void_p, c_int, c_size_t];
      for (const v of [() => 0, {}, Symbol("x")]) {
        assert.throws(
          () => memset(v, 0, 0),
          (e) => e instanceof ArgumentError && e.message === "argument 1: TypeError: wrong type",
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
