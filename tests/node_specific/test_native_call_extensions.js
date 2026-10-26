/**
 * Calls into tests/fixtures/ctypes_test_fixture.c (built into build/fixture/
 * by `npm run build:test-fixture`, run automatically by `npm test`):
 * - array parameters are passed by address, as in C and Python;
 * - structures by value with bit fields, a base class, `_align_` and arrays
 *   of structures, both as arguments and results;
 * - errcheck of a function with paramflags;
 * - reentrant calls (also variadic) from a callback;
 * - use_errno swaps the private errno copy with the system errno.
 *
 * Retained from common/test_native_fixture.js for CDLL.func(), Buffer/POJO
 * conversions, overridable functional helpers and worker-thread regressions.
 * Shared public contracts live in cpython_parity/calls/test_native_calls.
 */

import assert from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";
import { before, after, describe, it } from "node:test";
import * as ctypes from "node-ctypes";

const { CDLL, CFUNCTYPE, Structure, ArgumentError, POINTER, addressof, array, callback, sizeof, alignment, c_int8, c_uint8, c_int32, c_uint32, c_size_t, c_void_p, c_char_p } = ctypes;

const FIXTURE = path.join(import.meta.dirname, "..", "..", "build", "fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("native fixture", { skip: !existsSync(FIXTURE) && `${FIXTURE} not built (npm run build:test-fixture)` }, function () {
  let lib;
  before(() => {
    lib = new CDLL(FIXTURE);
  });
  after(() => lib.close());

  describe("array parameters", function () {
    const Int4 = array(c_int32, 4);

    it("an array is passed by address", function () {
      const values = Int4(1, 2, 3, 4);
      assert.strictEqual(lib.func("fixture_sum_int4", c_int32, [Int4])(values), 10);
      assert.strictEqual(lib.func("fixture_address", c_size_t, [Int4])(values), addressof(values));
      lib.func("fixture_fill_int4", null, [Int4, c_int32])(values, 7);
      assert.deepStrictEqual([...values], [7, 8, 9, 10]);
    });

    it("an array of the same element type and length from another array() call is accepted", function () {
      const sum = lib.func("fixture_sum_int4", c_int32, [Int4]);
      assert.strictEqual(sum(array(c_int32, 4)(5, 5, 5, 5)), 20);
      assert.strictEqual(sum(Buffer.from(new Int32Array([1, 1, 1, 1]).buffer)), 4);
    });

    it("other values raise ArgumentError, as in Python", function () {
      const sum = lib.func("fixture_sum_int4", c_int32, [Int4]);
      for (const [value, kind] of [
        [[1, 2, 3, 4], "Array"],
        [null, "null"],
        [array(c_int32, 3)(1, 2, 3), "c_int32 * 3"],
        [7, "number"],
      ]) {
        assert.throws(
          () => sum(value),
          (e) => e instanceof ArgumentError && e.message === `argument 1: TypeError: expected c_int32 * 4 instance instead of ${kind}`,
        );
      }
    });
  });

  describe("structures by value", function () {
    class Bits extends Structure {
      static _fields_ = [
        ["a", c_uint8, 3],
        ["b", c_uint32, 5],
        ["tail", c_uint8],
      ];
    }
    class Base extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int8],
      ];
    }
    class Derived extends Base {
      static _fields_ = [["z", c_int8]];
    }
    class Aligned extends Structure {
      static _align_ = 16;
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
      ];
    }
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Polyline extends Structure {
      static _fields_ = [
        ["count", c_int32],
        ["points", array(Point, 2)],
      ];
    }

    it("bit fields have the layout of the C compiler", function () {
      assert.strictEqual(BigInt(sizeof(Bits)), lib.func("fixture_bits_size", c_size_t, [])());
      assert.strictEqual(lib.func("fixture_bits_sum", c_uint32, [Bits])(new Bits(5, 17, 66)), 51766);
      const made = lib.func("fixture_bits_make", Bits, [c_uint8, c_uint32, c_uint8])(5, 17, 66);
      assert.ok(made instanceof Bits);
      assert.deepStrictEqual([made.a, made.b, made.tail], [5, 17, 66]);
    });

    it("a subclass is passed and returned with its base", function () {
      assert.strictEqual(lib.func("fixture_derived_sum", c_int32, [Derived])(new Derived(3, 4, 5)), 30405);
      const made = lib.func("fixture_derived_make", Derived, [c_int32, c_int8, c_int8])(3, 4, 5);
      assert.ok(made instanceof Derived);
      assert.deepStrictEqual([made.x, made.y, made.z], [3, 4, 5]);
    });

    it("_align_ structures", function () {
      assert.deepStrictEqual([sizeof(Aligned), alignment(Aligned)], [16, 16]);
      assert.strictEqual(lib.func("fixture_aligned_sum", c_uint32, [Aligned])(new Aligned(7, 42)), 7042);
      const made = lib.func("fixture_aligned_make", Aligned, [c_uint8, c_uint32])(7, 42);
      assert.deepStrictEqual([made.a, made.b], [7, 42]);
    });

    it("arrays of structures inside a structure", function () {
      const polyline = new Polyline();
      polyline.count = 2;
      polyline.points[1].y = 99;
      assert.strictEqual(lib.func("fixture_polyline_last_y", c_int32, [Polyline])(polyline), 99);
    });
  });

  describe("plain-object structure arguments", function () {
    for (const [name, bind] of [
      ["CDLL.func", (Point) => lib.func("fixture_point_sum", c_int32, [Point])],
      [
        "library attribute",
        (Point) => {
          const sum = lib.fixture_point_sum;
          sum.argtypes = [Point];
          sum.restype = c_int32;
          return sum;
        },
      ],
      ["CFUNCTYPE address", (Point) => CFUNCTYPE(c_int32, Point)(lib.symbol("fixture_point_sum"))],
      ["CFUNCTYPE library", (Point) => CFUNCTYPE(c_int32, Point)(["fixture_point_sum", lib])],
    ]) {
      it(`${name} preserves values, zero defaults and concurrent async arguments`, async function () {
        const Point = ctypes.struct({ x: c_int32, y: c_int32 });
        const sum = bind(Point);
        assert.strictEqual(sum({ x: 3, y: 4 }), 7);
        assert.strictEqual(sum({ x: new c_int32(-3), y: 4 }), 1);
        assert.strictEqual(sum({ y: 4 }), 4);
        assert.strictEqual(sum({}), 0);
        assert.deepStrictEqual(await Promise.all([{ x: 3, y: 4 }, { x: -10, y: 7 }, { x: 2 }, {}].map((value) => sum.callAsync(value))), [7, -3, 2, 0]);
        assert.throws(() => sum([3, 4]), ArgumentError);
      });
    }

    it("preserves scalar validation before native entry", async function () {
      const Point = ctypes.struct({ x: c_int32, y: c_int32 });
      const sum = lib.func("fixture_point_sum", c_int32, [Point]);
      for (const value of ["3", null, {}, new ctypes.c_double(3)]) {
        assert.throws(() => sum({ x: value, y: 4 }), TypeError);
        await assert.rejects(async () => sum.callAsync({ x: value, y: 4 }), TypeError);
      }
      assert.strictEqual(sum({ x: 3, y: 4 }), 7);
    });

    it("preserves field access order, custom setters and reentrant initialization", function () {
      const Point = ctypes.struct({ x: c_int32, y: c_int32 });
      const sum = lib.func("fixture_point_sum", c_int32, [Point]);
      const events = [];
      const set = Point.set;
      Point.set = function (buffer, name, value) {
        events.push(`set ${name}`);
        return set.call(this, buffer, name, value);
      };
      let entered = false;
      const values = {
        get x() {
          events.push("get x");
          if (!entered) {
            entered = true;
            assert.strictEqual(sum({ x: 10, y: 20 }), 30);
          }
          return 3;
        },
        get y() {
          events.push("get y");
          return 4;
        },
      };
      assert.strictEqual(sum(values), 7);
      assert.deepStrictEqual(events, ["get x", "set x", "set y", "get x", "set x", "get y", "get y", "set y"]);
    });

    it("honors a create override installed after binding without extra getter reads", function () {
      const Point = ctypes.struct({ x: c_int32, y: c_int32 });
      const sum = lib.func("fixture_point_sum", c_int32, [Point]);
      const create = Point.create;
      let reads = 0;
      let calls = 0;
      Object.defineProperty(Point, "create", {
        get() {
          reads++;
          return function (values) {
            assert.strictEqual(this, Point);
            calls++;
            return create.call(this, { x: values.x + 10, y: values.y });
          };
        },
      });
      assert.strictEqual(sum({ x: 3, y: 4 }), 17);
      assert.deepStrictEqual([reads, calls], [1, 1]);
    });

    it("captures from_param adapters per binding and preserves original errcheck arguments", async function () {
      const Point = ctypes.struct({ x: c_int32, y: c_int32 });
      Point.from_param = function (value) {
        assert.strictEqual(this, Point);
        return { _as_parameter_: value };
      };
      const sum = lib.func("fixture_point_sum", c_int32, [Point]);
      const values = { x: 3, y: 4 };
      sum.errcheck = (result, fn, args) => {
        assert.strictEqual(fn, sum);
        assert.strictEqual(args[0], values);
        return result;
      };
      assert.strictEqual(sum(values), 7);
      assert.strictEqual(await sum.callAsync(values), 7);
      Point.from_param = (value) => ({ x: value.x + 1, y: value.y });
      assert.strictEqual(sum(values), 7);
      assert.strictEqual(await sum.callAsync(values), 7);
      const rebound = lib.func("fixture_point_sum", c_int32, [Point], { abi: "default" });
      assert.strictEqual(rebound(values), 8);
      assert.strictEqual(await rebound.callAsync(values), 8);
    });

    it("keeps Structure subclass constructors in the conversion path", function () {
      let calls = 0;
      class Point extends Structure {
        static _fields_ = [
          ["x", c_int32],
          ["y", c_int32],
        ];
        constructor(values) {
          super(values);
          calls++;
          this.x += 10;
        }
      }
      assert.strictEqual(lib.func("fixture_point_sum", c_int32, [Point])({ x: 3, y: 4 }), 17);
      assert.strictEqual(calls, 1);
    });
  });

  describe("structures by value with _pack_ and padding", function () {
    class Packed extends Structure {
      static _pack_ = 1;
      static _layout_ = "ms";
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
        ["c", ctypes.c_double],
        ["d", ctypes.c_uint16],
      ];
    }
    class BitsFloat extends Structure {
      static _fields_ = [
        ["bits", ctypes.c_uint64, 60],
        ["f", ctypes.c_float],
      ];
    }

    it("unions by value use the class of all their members (x86-64 System V)", function () {
      class Num extends ctypes.Union {
        static _fields_ = [
          ["d", ctypes.c_double],
          ["i", ctypes.c_int64],
        ];
      }
      class Floats extends ctypes.Union {
        static _fields_ = [
          ["f", ctypes.array(ctypes.c_float, 2)],
          ["d", ctypes.c_double],
        ];
      }
      class Inner extends ctypes.Union {
        static _fields_ = [
          ["f", ctypes.c_float],
          ["i", ctypes.c_int32],
        ];
      }
      class Tagged extends Structure {
        static _fields_ = [
          ["tag", ctypes.c_int32],
          ["value", Inner],
        ];
      }
      const n = new Num();
      n.i = 0x123456789n;
      assert.strictEqual(lib.func("fixture_number_bits", ctypes.c_int64, [Num])(n), 0x123456789n);
      assert.strictEqual(lib.func("fixture_number_from_bits", Num, [ctypes.c_int64])(42n).i, 42n);
      const fl = new Floats();
      fl.f[0] = 1.5;
      fl.f[1] = 2;
      assert.strictEqual(lib.func("fixture_floats_sum", ctypes.c_double, [Floats])(fl), 3.5);
      const tagged = new Tagged();
      tagged.tag = 1;
      tagged.value.f = 2.5;
      assert.strictEqual(lib.func("fixture_tagged_int", ctypes.c_int32, [Tagged, ctypes.c_double])(tagged, 4), 10);
      assert.strictEqual(lib.func("fixture_tagged_make", Tagged, [ctypes.c_int32, ctypes.c_int32])(0, 7).value.i, 7);
    });

    it("a packed structure with misaligned fields keeps its layout", function () {
      assert.strictEqual(sizeof(Packed), Number(lib.func("fixture_packed_size", c_size_t, [])()));
      assert.strictEqual(lib.func("fixture_packed_sum", ctypes.c_double, [Packed])(new Packed(1, 2, 3.5, 4)), 10.5);
      const made = lib.func("fixture_packed_make", Packed, [c_uint8, c_uint32, ctypes.c_double, ctypes.c_uint16])(1, 2, 3.5, 4);
      assert.deepStrictEqual([made.a, made.b, made.c, made.d], [1, 2, 3.5, 4]);
    });

    it("a plain object for a structure argument gets bit fields and packed fields", function () {
      class Bits extends Structure {
        static _fields_ = [
          ["a", c_uint8, 3],
          ["b", c_uint32, 5],
          ["tail", c_uint8],
        ];
      }
      assert.strictEqual(lib.func("fixture_bits_sum", c_uint32, [Bits])({ a: 5, b: 17, tail: 66 }), 51766);
      assert.strictEqual(lib.func("fixture_packed_sum", ctypes.c_double, [Packed])({ a: 1, b: 2, c: 3.5, d: 4 }), 10.5);
      // As in Python (a tuple), an array is not a structure.
      assert.throws(() => lib.func("fixture_bits_sum", c_uint32, [Bits])([5, 17, 66]), ArgumentError);
    });

    it("padding is not passed as bytes (a float after a bit field stays a float)", function () {
      assert.strictEqual(sizeof(BitsFloat), Number(lib.func("fixture_bits_float_size", c_size_t, [])()));
      assert.strictEqual(lib.func("fixture_bits_float_get", ctypes.c_float, [BitsFloat])(new BitsFloat(2, 1.5)), 3.5);
      const made = lib.func("fixture_bits_float_make", BitsFloat, [ctypes.c_uint64, ctypes.c_float])(3n, 2.5);
      // Bit fields wider than 53 bits read as BigInt.
      assert.deepStrictEqual([made.bits, made.f], [3n, 2.5]);
    });
  });

  describe("paramflags", function () {
    const prototype = CFUNCTYPE(c_int32, c_int32, c_int32, POINTER(c_int32));
    const flags = [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ];

    it("output parameters are the result", function () {
      assert.strictEqual(prototype(["fixture_divmod", lib], flags)(17, 5), 2);
    });

    it("errcheck receives the result and the arguments, with the output instances", function () {
      const divmod = prototype(["fixture_divmod", lib], flags);
      divmod.errcheck = (result, func, args) => [result, func === divmod, args[0], args[1], args[2].value];
      assert.deepStrictEqual(divmod(17, 5), [3, true, 17, 5, 2]);
      divmod.errcheck = (result, func, args) => args;
      assert.strictEqual(divmod(17, 5), 2);
      divmod.errcheck = () => {
        throw new Error("checked");
      };
      assert.throws(() => divmod(17, 5), /checked/);
    });
  });

  describe("reentrant calls", function () {
    it("a nested call with longer heap strings does not overwrite the outer string", function () {
      const first = lib.func("fixture_first_char_after", c_int32, [c_char_p, c_void_p]);
      const inner = callback(
        () => {
          assert.strictEqual(first("inner" + "x".repeat(90000), null), "i".charCodeAt(0));
        },
        null,
        [],
      );
      try {
        assert.strictEqual(first("outer" + "x".repeat(9000), inner), "o".charCodeAt(0));
        assert.strictEqual(first("again" + "x".repeat(700), inner), "a".charCodeAt(0));
      } finally {
        inner.release();
      }
    });

    it("a call from a callback does not overwrite the string arguments of the outer call", function () {
      const first = lib.func("fixture_first_char_after", c_int32, [c_char_p, c_void_p]);
      const inner = callback(
        () => {
          first("inner", null);
        },
        null,
        [],
      );
      try {
        assert.strictEqual(first("outer", inner), "o".charCodeAt(0));
      } finally {
        inner.release();
      }
    });

    it("variadic calls from a callback do not replace the interface of the outer call", function () {
      const sum = lib.func("fixture_variadic_sum", c_int32, [c_void_p, c_int32]);
      const inner = [];
      // More variadic signatures than the interfaces kept in cache (16).
      const nested = callback(
        () => {
          for (let n = 1; n <= 20; n++) {
            inner.push(sum(null, n, ...Array.from({ length: n }, (_, i) => i + 1)));
          }
        },
        null,
        [],
      );
      try {
        assert.strictEqual(sum(nested, 3, 10, 20, 30), 60);
        assert.deepStrictEqual(
          inner,
          Array.from({ length: 20 }, (_, i) => ((i + 1) * (i + 2)) / 2),
        );
        assert.strictEqual(sum(null, 3, 1, 2, 3), 6);
      } finally {
        nested.release();
      }
    });
  });

  describe("pointers", function () {
    it("byref(pointer) passes the memory of the pointer (T**), so C can re-point it", function () {
      const p = POINTER(c_int32).create();
      lib.func("fixture_point_to_static", null, [c_void_p])(ctypes.byref(p));
      assert.strictEqual(p.contents.value, 42);
      assert.notStrictEqual(addressof(p), p.address);
      const q = ctypes.pointer(new ctypes.c_int32(7));
      assert.notStrictEqual(addressof(q), addressof(q.contents));
    });
  });

  describe("callbacks and threads", function () {
    it("a callback called from another thread does not run JavaScript", async function () {
      const first = lib.func("fixture_first_char_after", c_int32, [c_char_p, c_void_p]);
      let called = false;
      const cb = callback(
        () => {
          called = true;
        },
        null,
        [],
      );
      try {
        // callAsync runs the C function on a worker thread, which calls cb there.
        assert.strictEqual(await first.callAsync("xyz", cb), "x".charCodeAt(0));
        assert.strictEqual(called, false);
        assert.match(cb._callback.getLastError(), /thread other than the one that created it/);
        assert.strictEqual(first("abc", cb), "a".charCodeAt(0));
        assert.strictEqual(called, true);
      } finally {
        cb.release();
      }
    });
  });

  describe("use_errno", { skip: process.platform === "win32" && "errno belongs to each C runtime on Windows" }, function () {
    it("the call sees set_errno() and get_errno() returns the errno it left, as in Python", async function () {
      const plain = new CDLL(FIXTURE);
      const withErrno = new CDLL(FIXTURE, { use_errno: true });
      try {
        plain.func("fixture_errno_set", null, [c_int32])(5);
        const get = withErrno.func("fixture_errno_get", c_int32, []);
        ctypes.set_errno(77);
        assert.strictEqual(get(), 77);
        withErrno.func("fixture_errno_set", null, [c_int32])(123);
        assert.strictEqual(ctypes.get_errno(), 123);
        // The system errno is restored after each call.
        assert.strictEqual(plain.func("fixture_errno_get", c_int32, [])(), 5);
        ctypes.set_errno(88);
        assert.strictEqual(await get.callAsync(), 88);
        assert.strictEqual(ctypes.get_errno(), 88);
      } finally {
        withErrno.close();
        plain.close();
      }
    });
  });
});
