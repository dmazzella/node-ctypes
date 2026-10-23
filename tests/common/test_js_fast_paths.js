/**
 * Test the JS-layer fast paths:
 * - Python-style function attributes (argtypes/restype) without Proxy
 * - array / pointer indexing
 * - readValue at a raw address
 * - Structure instances sharing one Proxy handler per type
 * - pointers created from an address passed as function arguments
 */

import assert from "node:assert";
import util from "node:util";
import os from "node:os";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const platform = os.platform();
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";

describe("JS fast paths", function () {
  let libc;

  before(function () {
    libc = new ctypes.CDLL(LIBC);
  });

  after(function () {
    if (libc) libc.close();
  });

  describe("Python-style function attributes", function () {
    it("argtypes/restype, reassignment and custom properties", function () {
      const abs = libc.abs;
      assert.strictEqual(libc.abs, abs, "the wrapper is cached per name");
      // Python ctypes: restype predefinito c_int.
      assert.strictEqual(abs.restype, ctypes.c_int);
      assert.strictEqual(abs(-1), 1);
      abs.argtypes = [ctypes.c_int32];
      abs.restype = ctypes.c_int32;
      assert.deepStrictEqual(abs.argtypes, [ctypes.c_int32]);
      assert.strictEqual(abs.restype, ctypes.c_int32);
      assert.strictEqual(abs(-7), 7);

      abs.restype = ctypes.c_int8;
      assert.strictEqual(abs(-200), -56, "a new restype rebuilds the function");

      abs.custom = 42;
      assert.strictEqual(abs.custom, 42);
    });

    it("errcheck is null until set", function () {
      const strlen = libc.strlen;
      assert.strictEqual(strlen.errcheck, null);
      strlen.argtypes = [ctypes.c_char_p];
      strlen.restype = ctypes.c_size_t;
      strlen.errcheck = (result) => result * 2n;
      assert.strictEqual(strlen("abc"), 6n);
      assert.strictEqual(libc.func("abs", ctypes.c_int32, [ctypes.c_int32]).errcheck, null);
    });

    it("callAsync", async function () {
      const atoi = libc.atoi;
      atoi.argtypes = [ctypes.c_char_p];
      atoi.restype = ctypes.c_int32;
      assert.strictEqual(await atoi.callAsync("42"), 42);
    });
  });

  describe("array indexing", function () {
    it("reads, writes, bounds and iteration", function () {
      const arr = ctypes.array(ctypes.c_int32, 3).create([10, 20, 30]);
      assert.strictEqual(arr[1], 20);
      arr[2] = -5;
      assert.strictEqual(arr[2], -5);
      assert.strictEqual(arr[3], undefined);
      assert.strictEqual(arr[-1], undefined);
      assert.strictEqual(arr.length, 3);
      assert.deepStrictEqual([...arr], [10, 20, -5]);
    });

    it("non-canonical numeric keys keep their previous meaning", function () {
      const arr = ctypes.array(ctypes.c_int32, 3).create([10, 20, 30]);
      assert.strictEqual(arr["1.0"], 20);
      assert.strictEqual(arr[""], 10);
    });

    it("struct elements return views on the array memory", function () {
      class Point extends ctypes.Structure {
        static _fields_ = [
          ["x", ctypes.c_int32],
          ["y", ctypes.c_int32],
        ];
      }
      const points = ctypes.array(Point, 2).create([{ x: 1, y: 2 }]);
      points[1].x = 9;
      assert.strictEqual(points[0].y, 2);
      assert.strictEqual(points[1].x, 9);
    });

    it("string initializer writes char codes", function () {
      const chars = ctypes.array(ctypes.c_uint8, 4).create("AB");
      assert.deepStrictEqual([...chars], [65, 66, 0, 0]);
    });
  });

  describe("readValue at a raw address", function () {
    const cases = [
      ["c_int8", -5],
      ["c_uint8", 250],
      ["c_int16", -300],
      ["c_uint16", 65000],
      ["c_int32", -123456],
      ["c_uint32", 4000000000],
      ["c_int64", -(2n ** 40n)],
      ["c_uint64", 2n ** 63n],
      ["c_float", 1.5],
      ["c_double", -2.25],
      ["c_bool", true],
      ["c_char", 65],
    ];
    for (const [name, value] of cases) {
      it(name, function () {
        const type = ctypes[name];
        const buf = Buffer.alloc(16);
        ctypes.writeValue(buf, type, value, 4);
        const addr = ctypes.addressof(buf);
        assert.strictEqual(ctypes.readValue(addr, type, 4), ctypes.readValue(buf, type, 4));
        assert.strictEqual(ctypes.readValue(Number(addr), type, 4), ctypes.readValue(buf, type, 4));
      });
    }

    it("NULL address still throws", function () {
      assert.throws(() => ctypes.readValue(0n, ctypes.c_int32), TypeError);
    });
  });

  describe("pointers", function () {
    it("index and contents on buffer and address pointers", function () {
      const buf = Buffer.alloc(12);
      [7, 8, 9].forEach((v, i) => buf.writeInt32LE(v, i * 4));
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      for (const p of [IntPtr.fromBuffer(buf), IntPtr.fromAddress(ctypes.addressof(buf))]) {
        assert.strictEqual(p.contents.value, 7);
        assert.strictEqual(p[2], 9);
        p[1] = 80;
        assert.strictEqual(buf.readInt32LE(4), 80);
        buf.writeInt32LE(8, 4);
      }
    });

    it("pointers created from an address are passed as that address", function () {
      const src = Buffer.from([1, 2, 3, 4]);
      const p = ctypes.POINTER(ctypes.c_uint8).fromAddress(ctypes.addressof(src));
      const memcpy = libc.func("memcpy", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]);
      const dst = Buffer.alloc(4);
      memcpy(dst, p, 4);
      assert.deepStrictEqual([...dst], [1, 2, 3, 4]);

      const MEMCPY = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t);
      const fp = MEMCPY(libc.symbol("memcpy"));
      const dst2 = Buffer.alloc(4);
      fp(dst2, p, 4);
      assert.deepStrictEqual([...dst2], [1, 2, 3, 4]);
    });
  });

  describe("Python ctypes parity", function () {
    const sortWith = (makeCmp) => {
      const qsort = libc.func("qsort", null, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
      const arr = ctypes.array(ctypes.c_int32, 4).create([4, 1, 3, 2]);
      const cmp = makeCmp((a, b) => ctypes.readValue(a, ctypes.c_int32) - ctypes.readValue(b, ctypes.c_int32));
      qsort(arr, 4, 4, cmp);
      cmp.release();
      return [...arr];
    };

    it("callbacks can be passed directly as arguments", function () {
      assert.deepStrictEqual(
        sortWith((fn) => ctypes.callback(fn, ctypes.c_int32, [ctypes.c_void_p, ctypes.c_void_p])),
        [1, 2, 3, 4],
      );
      const CompareFn = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_void_p, ctypes.c_void_p);
      assert.deepStrictEqual(
        sortWith((fn) => new CompareFn(fn)),
        [1, 2, 3, 4],
      );
      assert.deepStrictEqual(
        sortWith((fn) => libc.callback(fn, ctypes.c_int32, [ctypes.c_void_p, ctypes.c_void_p])),
        [1, 2, 3, 4],
      );
    });

    it("the callback pointer is not enumerable", function () {
      const cb = ctypes.callback(() => 0, ctypes.c_int32, []);
      assert.deepStrictEqual(Object.keys(cb), ["pointer", "release", "_callback"]);
      assert.strictEqual(cb._as_parameter_, cb.pointer);
      cb.release();
    });

    it("null restype means void (Python: restype = None)", function () {
      assert.strictEqual(libc.func("srand", null, [ctypes.c_uint32])(1), undefined);
      const srand = libc.srand;
      srand.argtypes = [ctypes.c_uint32];
      srand.restype = null;
      assert.strictEqual(srand(2), undefined);
      const SRAND = ctypes.CFUNCTYPE(null, ctypes.c_uint32);
      assert.strictEqual(SRAND(libc.symbol("srand"))(3), undefined);
      const cb = ctypes.callback(() => {}, null, [ctypes.c_int32]);
      cb.release();
    });

    it("_as_parameter_ is honored by CFUNCTYPE callers", function () {
      const ABS = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_int32);
      const abs = ABS(libc.symbol("abs"));
      assert.strictEqual(abs({ _as_parameter_: -9 }), 9);
    });

    it("assigning callAsync on a Python-style function is ignored", function () {
      const atoi = libc.atoi;
      atoi.argtypes = [ctypes.c_char_p];
      atoi.restype = ctypes.c_int32;
      const original = atoi.callAsync;
      atoi.callAsync = () => "replaced";
      assert.strictEqual(atoi.callAsync, original);
    });
  });

  describe("Structure instances", function () {
    class Vec extends ctypes.Structure {
      static _fields_ = [
        ["x", ctypes.c_int32],
        ["y", ctypes.c_int32],
      ];
      sum() {
        return this.x + this.y;
      }
    }

    it("instances of the same type stay independent", function () {
      const a = new Vec(1, 2);
      const b = new Vec({ x: 10, y: 20 });
      a.x = 5;
      assert.strictEqual(b.x, 10);
      assert.strictEqual(a.sum(), 7);
      assert.strictEqual(b.sum(), 30);
    });

    it("reflection and special properties", function () {
      const v = new Vec(3, 4);
      // As in Python (fields are descriptors of the class), the fields are
      // accessors of the prototype, not own properties of the instance.
      assert.deepStrictEqual(Object.keys(v), []);
      assert.ok("x" in v);
      assert.deepStrictEqual(v.toObject(), { x: 3, y: 4 });
      assert.strictEqual(JSON.stringify(v), '{"x":3,"y":4}');
      assert.strictEqual(util.inspect(v), "Vec { x: 3, y: 4 }");
      assert.strictEqual(Object.prototype.toString.call(v), "[object Vec]");
      assert.strictEqual(v._buffer, v.__buffer);
      assert.strictEqual(v._buffer.readInt32LE(4), 4);
    });

    it("wrapping a buffer and reassigning __buffer", function () {
      const buf = Buffer.alloc(8);
      const v = new Vec(buf);
      v.y = 11;
      assert.strictEqual(buf.readInt32LE(4), 11);
      v.__buffer = Buffer.alloc(8);
      assert.strictEqual(v.y, 11, "fields keep using the original buffer");
      assert.throws(() => new Vec(Buffer.alloc(4)), RangeError);
    });
  });
});
