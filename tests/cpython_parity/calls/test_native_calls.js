import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

const { ARRAY } = c;
const oldLibffi = process.platform === "linux" && process.arch === "x64" && "CPython with libffi 3.1 (manylinux_2_28 x86-64) aborts on these structures by value";
const sysvUnions = process.arch === "x64" && process.platform !== "win32" && "CPython passes unions to libffi as structures (libffi#33): wrong registers on x86-64 System V";
const sysvPacked = process.arch === "x64" && process.platform !== "win32" && "CPython passes structures with misaligned fields in registers on x86-64 System V (GCC and clang use memory)";

class Bits extends c.Structure {
  static _fields_ = [
    ["a", c.c_uint8, 3],
    ["b", c.c_uint32, 5],
    ["tail", c.c_uint8],
  ];
}
class Point extends c.Structure {
  static _fields_ = [
    ["x", c.c_int32],
    ["y", c.c_int32],
  ];
}
class Polyline extends c.Structure {
  static _fields_ = [
    ["count", c.c_int32],
    ["points", ARRAY(Point, 2)],
  ];
}
class Base extends c.Structure {
  static _fields_ = [
    ["x", c.c_int32],
    ["y", c.c_int8],
  ];
}
class Derived extends Base {
  static _fields_ = [["z", c.c_int8]];
}
class Aligned extends c.Structure {
  static _align_ = 16;
  static _fields_ = [
    ["a", c.c_uint8],
    ["b", c.c_uint32],
  ];
}
class Packed extends c.Structure {
  static _pack_ = 1;
  static _layout_ = "ms";
  static _fields_ = [
    ["a", c.c_uint8],
    ["b", c.c_uint32],
    ["c", c.c_double],
    ["d", c.c_uint16],
  ];
}
class BitsFloat extends c.Structure {
  static _fields_ = [
    ["bits", c.c_uint64, 60],
    ["f", c.c_float],
  ];
}

describe("TestNativeFixture", function () {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_array_parameters", function () {
    const Int4 = ARRAY(c.c_int32, 4);
    const values = Int4(1, 2, 3, 4);
    const total = lib.fixture_sum_int4;
    total.argtypes = [Int4];
    total.restype = c.c_int32;
    const address = lib.fixture_address;
    address.argtypes = [Int4];
    address.restype = c.c_size_t;
    const fill = lib.fixture_fill_int4;
    fill.argtypes = [Int4, c.c_int32];
    fill.restype = null;
    assert.equal(total(values), 10);
    assert.equal(address(values), c.addressof(values));
    fill(values, 7);
    assert.deepEqual([...values], [7, 8, 9, 10]);
    assert.equal(total(ARRAY(c.c_int32, 4)(5, 5, 5, 5)), 20);
    for (const value of [[1, 2, 3, 4], null, ARRAY(c.c_int32, 3)(1, 2, 3), 7]) {
      assert.throws(() => total(value), c.ArgumentError);
    }
  });

  it("test_structures_by_value", function () {
    const size = lib.fixture_bits_size;
    size.argtypes = [];
    size.restype = c.c_size_t;
    const total = lib.fixture_bits_sum;
    total.argtypes = [Bits];
    total.restype = c.c_uint32;
    const make = lib.fixture_bits_make;
    make.argtypes = [c.c_uint8, c.c_uint32, c.c_uint8];
    make.restype = Bits;
    assert.equal(BigInt(c.sizeof(Bits)), size());
    assert.equal(total(new Bits(5, 17, 66)), 51766);
    const made = make(5, 17, 66);
    assert.ok(made instanceof Bits);
    assert.deepEqual([made.a, made.b, made.tail], [5, 17, 66]);
    const last_y = lib.fixture_polyline_last_y;
    last_y.argtypes = [Polyline];
    last_y.restype = c.c_int32;
    const polyline = new Polyline();
    polyline.count = 2;
    polyline.points[1].y = 99;
    assert.equal(last_y(polyline), 99);
  });

  it("test_derived_by_value", { skip: oldLibffi }, function () {
    const total = lib.fixture_derived_sum;
    total.argtypes = [Derived];
    total.restype = c.c_int32;
    const make = lib.fixture_derived_make;
    make.argtypes = [c.c_int32, c.c_int8, c.c_int8];
    make.restype = Derived;
    assert.equal(total(new Derived(3, 4, 5)), 30405);
    const made = make(3, 4, 5);
    assert.ok(made instanceof Derived);
    assert.deepEqual([made.x, made.y, made.z], [3, 4, 5]);
  });

  it("test_aligned_by_value", { skip: oldLibffi }, function () {
    const total = lib.fixture_aligned_sum;
    total.argtypes = [Aligned];
    total.restype = c.c_uint32;
    const make = lib.fixture_aligned_make;
    make.argtypes = [c.c_uint8, c.c_uint32];
    make.restype = Aligned;
    assert.deepEqual([c.sizeof(Aligned), c.alignment(Aligned)], [16, 16]);
    assert.equal(total(new Aligned(7, 42)), 7042);
    const made = make(7, 42);
    assert.deepEqual([made.a, made.b], [7, 42]);
  });

  it("test_paramflags_errcheck", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    const flags = [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ];
    assert.equal(prototype(["fixture_divmod", lib], flags)(17, 5), 2);
    const divide = prototype(["fixture_divmod", lib], flags);
    divide.errcheck = (result, function_, arguments_) => [result, function_ === divide, arguments_[0], arguments_[1], arguments_[2].value];
    assert.deepEqual(divide(17, 5), [3, true, 17, 5, 2]);
    divide.errcheck = (result, function_, arguments_) => arguments_;
    assert.equal(divide(17, 5), 2);
    divide.errcheck = () => {
      throw new Error("checked");
    };
    assert.throws(() => divide(17, 5), /checked/);
  });

  it("test_unions_by_value", { skip: sysvUnions }, function () {
    class Num extends c.Union {
      static _fields_ = [
        ["d", c.c_double],
        ["i", c.c_int64],
      ];
    }
    class Floats extends c.Union {
      static _fields_ = [
        ["f", ARRAY(c.c_float, 2)],
        ["d", c.c_double],
      ];
    }
    class Inner extends c.Union {
      static _fields_ = [
        ["f", c.c_float],
        ["i", c.c_int32],
      ];
    }
    class Tagged extends c.Structure {
      static _fields_ = [
        ["tag", c.c_int32],
        ["value", Inner],
      ];
    }
    const bits = lib.fixture_number_bits;
    bits.argtypes = [Num];
    bits.restype = c.c_int64;
    const from_bits = lib.fixture_number_from_bits;
    from_bits.argtypes = [c.c_int64];
    from_bits.restype = Num;
    const total = lib.fixture_floats_sum;
    total.argtypes = [Floats];
    total.restype = c.c_double;
    const tagged_int = lib.fixture_tagged_int;
    tagged_int.argtypes = [Tagged, c.c_double];
    tagged_int.restype = c.c_int32;
    const tagged_make = lib.fixture_tagged_make;
    tagged_make.argtypes = [c.c_int32, c.c_int32];
    tagged_make.restype = Tagged;
    const number = new Num();
    number.i = 0x123456789n;
    assert.equal(bits(number), 0x123456789n);
    assert.equal(from_bits(42n).i, 42n);
    const floats = new Floats();
    floats.f[0] = 1.5;
    floats.f[1] = 2;
    assert.equal(total(floats), 3.5);
    const tagged = new Tagged();
    tagged.tag = 1;
    tagged.value.f = 2.5;
    assert.equal(tagged_int(tagged, 4), 10);
    assert.equal(tagged_make(0, 7).value.i, 7);
  });

  it("test_packed_structure_by_value", { skip: sysvPacked }, function () {
    const size = lib.fixture_packed_size;
    size.argtypes = [];
    size.restype = c.c_size_t;
    const total = lib.fixture_packed_sum;
    total.argtypes = [Packed];
    total.restype = c.c_double;
    const make = lib.fixture_packed_make;
    make.argtypes = [c.c_uint8, c.c_uint32, c.c_double, c.c_uint16];
    make.restype = Packed;
    assert.equal(BigInt(c.sizeof(Packed)), size());
    assert.equal(total(new Packed(1, 2, 3.5, 4)), 10.5);
    const made = make(1, 2, 3.5, 4);
    assert.deepEqual([made.a, made.b, made.c, made.d], [1, 2, 3.5, 4]);
  });

  it("test_structure_argument_rejects_tuple", function () {
    const total = lib.fixture_bits_sum;
    total.argtypes = [Bits];
    total.restype = c.c_uint32;
    assert.throws(() => total([5, 17, 66]), c.ArgumentError);
  });

  it("test_bit_field_and_float_by_value", function () {
    const size = lib.fixture_bits_float_size;
    size.argtypes = [];
    size.restype = c.c_size_t;
    const get = lib.fixture_bits_float_get;
    get.argtypes = [BitsFloat];
    get.restype = c.c_float;
    const make = lib.fixture_bits_float_make;
    make.argtypes = [c.c_uint64, c.c_float];
    make.restype = BitsFloat;
    assert.equal(BigInt(c.sizeof(BitsFloat)), size());
    assert.equal(get(new BitsFloat(2n, 1.5)), 3.5);
    const made = make(3n, 2.5);
    assert.deepEqual([made.bits, made.f], [3n, 2.5]);
  });

  it("test_byref_pointer", function () {
    const point_to_static = lib.fixture_point_to_static;
    point_to_static.argtypes = [c.c_void_p];
    point_to_static.restype = null;
    const pointer = c.cast(null, c.POINTER(c.c_int32));
    point_to_static(c.byref(pointer));
    assert.equal(pointer.contents.value, 42);
    assert.notEqual(c.addressof(pointer), c.cast(pointer, c.c_void_p).value);
    const other = c.pointer(new c.c_int32(7));
    assert.notEqual(c.addressof(other), c.addressof(other.contents));
  });

  it("test_reentrant_calls", function () {
    const first = lib.fixture_first_char_after;
    first.argtypes = [c.c_char_p, c.c_void_p];
    first.restype = c.c_int32;
    const inner_results = [];
    const inner = c.CFUNCTYPE(null)(() => {
      inner_results.push(first("inner", null));
    });
    assert.equal(first("outer", c.cast(inner, c.c_void_p)), "o".charCodeAt(0));
    assert.deepEqual(inner_results, ["i".charCodeAt(0)]);
    const total = lib.fixture_variadic_sum;
    total.argtypes = [c.c_void_p, c.c_int32];
    total.restype = c.c_int32;
    const results = [];
    const callback = c.CFUNCTYPE(null)(() => {
      for (let count = 1; count <= 20; count++) {
        results.push(total(null, count, ...Array.from({ length: count }, (_, index) => index + 1)));
      }
    });
    assert.equal(total(c.cast(callback, c.c_void_p), 3, 10, 20, 30), 60);
    assert.deepEqual(
      results,
      Array.from({ length: 20 }, (_, index) => ((index + 1) * (index + 2)) / 2),
    );
    assert.equal(total(null, 3, 1, 2, 3), 6);
  });

  it("test_use_errno", { skip: process.platform === "win32" && "errno belongs to each C runtime on Windows" }, function () {
    const plain = new c.CDLL(FIXTURE);
    const with_errno = new c.CDLL(FIXTURE, { use_errno: true });
    const set_plain = plain.fixture_errno_set;
    set_plain.argtypes = [c.c_int32];
    set_plain.restype = null;
    const get_plain = plain.fixture_errno_get;
    get_plain.argtypes = [];
    get_plain.restype = c.c_int32;
    const set_private = with_errno.fixture_errno_set;
    set_private.argtypes = [c.c_int32];
    set_private.restype = null;
    const get_private = with_errno.fixture_errno_get;
    get_private.argtypes = [];
    get_private.restype = c.c_int32;
    set_plain(5);
    c.set_errno(77);
    assert.equal(get_private(), 77);
    set_private(123);
    assert.equal(c.get_errno(), 123);
    assert.equal(get_plain(), 5);
  });

  it("test_reentrant_long_strings", function () {
    const first = lib.fixture_first_char_after;
    first.argtypes = [c.c_char_p, c.c_void_p];
    first.restype = c.c_int32;
    const nested = [];
    const callback = c.CFUNCTYPE(null)(() => {
      nested.push(first("inner" + "x".repeat(90000), null));
    });
    assert.equal(first("outer" + "x".repeat(9000), c.cast(callback, c.c_void_p)), "o".charCodeAt(0));
    assert.equal(first("again" + "x".repeat(700), c.cast(callback, c.c_void_p)), "a".charCodeAt(0));
    assert.deepEqual(nested, ["i".charCodeAt(0), "i".charCodeAt(0)]);
  });

  it("test_point_values_and_defaults", function () {
    const total = lib.fixture_point_sum;
    total.argtypes = [Point];
    total.restype = c.c_int32;
    for (const [value, expected] of [
      [new Point(3, 4), 7],
      [new Point(new c.c_int32(-3), 4), 1],
      [new Point({ y: 4 }), 4],
      [new Point(), 0],
    ]) {
      assert.equal(total(value), expected);
    }
  });

  it("test_structure_subclass_constructor", function () {
    const calls = [];
    class CustomPoint extends Point {
      constructor(x, y) {
        super(x, y);
        calls.push([x, y]);
        this.x += 10;
      }
    }
    const total = lib.fixture_point_sum;
    total.argtypes = [CustomPoint];
    total.restype = c.c_int32;
    assert.equal(total(new CustomPoint(3, 4)), 17);
    assert.deepEqual(calls, [[3, 4]]);
  });

  it("test_paramflags_default_arguments", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32));
    const divide = prototype(
      ["fixture_divmod", lib],
      [
        [1, "a", 17],
        [1, "b", 5],
        [2, "remainder"],
      ],
    );
    assert.equal(divide(), 2);
    assert.equal(divide({ b: 4 }), 1);
    assert.equal(divide({ a: 23, b: 5 }), 3);
  });
});
