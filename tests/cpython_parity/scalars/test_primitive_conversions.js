import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE, LIBC } from "../_support.js";

const integers = [
  ["i8", c.c_int8],
  ["u8", c.c_uint8],
  ["i16", c.c_int16],
  ["u16", c.c_uint16],
  ["i32", c.c_int32],
  ["u32", c.c_uint32],
  ["i64", c.c_int64],
  ["u64", c.c_uint64],
  ["size", c.c_size_t],
  ["ssize", c.c_ssize_t],
  ["long", c.c_long],
  ["ulong", c.c_ulong],
];
const integerValues = [
  0,
  1,
  -1,
  -2,
  -3,
  -1000,
  -2049,
  255,
  256,
  65535,
  65536,
  2 ** 32,
  -(2 ** 32),
  2 ** 53,
  -(2 ** 53),
  2 ** 63,
  -(2 ** 63),
  -(2 ** 63) - 2048,
  2 ** 64,
  -(2 ** 64),
  1e30,
  -1e30,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  false,
  true,
  2n ** 64n + 7n,
  2n ** 128n + 7n,
  -(2n ** 128n) - 3n,
];

function integerResult(Type, value) {
  const width = c.sizeof(Type) * 8;
  const bits = BigInt(value);
  const result = new Type(-1).value < 0 ? BigInt.asIntN(width, bits) : BigInt.asUintN(width, bits);
  return width === 64 || Type === c.c_long || Type === c.c_ulong ? result : Number(result);
}

describe("TestPrimitiveConversions", function () {
  let library;
  before(() => {
    library = new c.CDLL(FIXTURE);
  });
  after(() => library?.close());

  it("test_integer_wrapping", function () {
    for (const [, Type] of integers) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const record = new Record();
      for (const value of integerValues) {
        const expected = integerResult(Type, value);
        assert.equal(new Type(value).value, expected);
        record.value = value;
        assert.equal(record.value, expected);
      }
      assert.equal(new Type().value, integerResult(Type, 0));
    }
  });

  it("test_integer_fields_arrays_and_bitfields", function () {
    for (const [, Type] of integers) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const record = new Record();
      record.value = new Type(3);
      assert.equal(record.value, integerResult(Type, 3));
      const array = c.ARRAY(Type, 1)();
      array[0] = new Type(3);
      assert.equal(array[0], integerResult(Type, 3));
      assert.throws(() => {
        array[0] = new c.c_double(2);
      }, TypeError);
      class Bits extends c.Structure {
        static _fields_ = [["value", Type, 3]];
      }
      const bits = new Bits();
      // Matching scalar-instance assignment segfaults in CPython 3.14/3.15;
      // its original regression remains in test_primitive_conversion_paths.
      bits.value = 3;
      assert.equal(bits.value, 3);
      for (const value of [null, "2", {}, new c.c_double(2)])
        assert.throws(() => {
          bits.value = value;
        }, TypeError);
      bits.value = -1;
      assert.equal(bits.value, new Type(-1).value < 0 ? -1 : 7);
    }
  });

  it("test_integer_input_validation", function () {
    for (const [, Type] of integers) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const record = new Record();
      for (const value of [null, "2", {}, [], () => 2, 1.5, NaN, Infinity, -Infinity, new Type(2)]) {
        assert.throws(() => new Type(value), TypeError);
        assert.throws(() => {
          new Type().value = value;
        }, TypeError);
        if (!(value instanceof Type))
          assert.throws(() => {
            record.value = value;
          }, TypeError);
      }
    }
  });

  it("test_integer_native_calls", function () {
    for (const [name, Type] of integers) {
      const functions = [library[`fixture_scalar_${name}`], library[`fixture_scalar_${name}_tail`]];
      for (const [tail, fn] of functions.entries()) {
        fn.argtypes = tail ? [Type, c.c_char_p] : [Type];
        fn.restype = Type;
        const extra = tail ? ["x".repeat(16384)] : [];
        for (const value of integerValues) {
          const expected = new Type(value).value;
          assert.equal(fn(value, ...extra), expected);
          assert.equal(fn(new Type(value), ...extra), expected);
        }
        for (const value of ["2", {}, [], () => 2, 1.5, NaN, Infinity, -Infinity, new c.c_double(2)]) assert.throws(() => fn(value, ...extra), c.ArgumentError);
      }
    }
  });

  it("test_integer_native_null_arguments", function () {
    class Wrapped {
      _as_parameter_ = null;
    }
    for (const [name, Type] of integers) {
      for (const tail of [false, true]) {
        const symbol = `fixture_scalar_${name}${tail ? "_tail" : ""}`;
        const args = tail ? [Type, c.c_char_p] : [Type];
        const fn = library[symbol];
        fn.argtypes = args;
        fn.restype = Type;
        const prototype = c.CFUNCTYPE(Type, ...args)([symbol, library]);
        const extra = tail ? ["x".repeat(16384)] : [];
        for (const invoke of [fn, prototype]) {
          for (const value of [null, new Wrapped()]) assert.throws(() => invoke(value, ...extra), c.ArgumentError);
          assert.equal(invoke(new Type(3), ...extra), integerResult(Type, 3));
        }
      }
    }
  });

  it("test_nullable_pointer_arguments", function () {
    // The oracle accepts const void*: every input here is a pointer type.
    for (const Type of [c.c_void_p, c.POINTER(c.c_int32), c.c_char_p, c.c_wchar_p]) {
      const fn = library.fixture_address;
      fn.argtypes = [Type];
      fn.restype = c.c_size_t;
      const prototype = c.CFUNCTYPE(c.c_size_t, Type)(["fixture_address", library]);
      assert.equal(fn(null), new c.c_size_t(0).value);
      assert.equal(prototype(null), new c.c_size_t(0).value);
    }
  });

  it("test_untyped_variadic_null_pointer", function () {
    const library = new c.CDLL(LIBC);
    try {
      const fn = library.sprintf;
      fn.argtypes = [c.c_void_p, c.c_char_p];
      fn.restype = c.c_int32;
      const untyped = c.create_string_buffer(64),
        typed = c.create_string_buffer(64);
      assert.equal(fn(untyped, "%p", null), fn(typed, "%p", new c.c_void_p(null)));
      assert.equal(c.string_at(untyped), c.string_at(typed));
      assert.ok(c.string_at(untyped).length > 0);
    } finally {
      library.close();
    }
  });

  it("test_scalar_input_validation", function () {
    for (const Type of [c.c_int32, c.c_uint64, c.c_float, c.c_double]) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      for (const value of [null, "2", {}, [], new Type(2)]) {
        assert.throws(() => new Type(value), TypeError);
        if (!(value instanceof Type))
          assert.throws(() => {
            new Record().value = value;
          }, TypeError);
      }
      const record = new Record();
      record.value = new Type(3);
      assert.equal(record.value, Type === c.c_uint64 ? 3n : 3);
    }
  });

  it("test_float_input_validation", function () {
    for (const [name, Type] of [
      ["float", c.c_float],
      ["double", c.c_double],
    ]) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const record = new Record();
      for (const tail of [false, true]) {
        const fn = library[`fixture_scalar_${name}${tail ? "_tail" : ""}`];
        fn.argtypes = tail ? [Type, c.c_char_p] : [Type];
        fn.restype = Type;
        const extra = tail ? ["x".repeat(16384)] : [];
        for (const value of [null, "2", {}, [], () => 2, new Type(2), new c.c_int32(2)]) {
          assert.throws(() => new Type(value), TypeError);
          if (!(value instanceof Type)) {
            assert.throws(() => {
              record.value = value;
            }, TypeError);
            assert.throws(() => fn(value, ...extra), c.ArgumentError);
          }
        }
        assert.equal(fn(new Type(1.5), ...extra), 1.5);
      }
    }
  });

  it("test_float_native_calls", function () {
    for (const [name, Type] of [
      ["float", c.c_float],
      ["double", c.c_double],
    ]) {
      for (const tail of [false, true]) {
        const fn = library[`fixture_scalar_${name}${tail ? "_tail" : ""}`];
        fn.argtypes = tail ? [Type, c.c_char_p] : [Type];
        fn.restype = Type;
        const extra = tail ? ["x".repeat(16384)] : [];
        for (const value of [false, true, 1.5, -2.25, 17n, -(2n ** 63n), 2n ** 64n - 1n, NaN, Infinity, -Infinity]) {
          const expected = name === "float" ? Math.fround(Number(value)) : Number(value);
          assert.equal(new Type(value).value, expected);
          assert.equal(fn(value, ...extra), expected);
        }
      }
    }
  });

  it("test_float_large_integer_inputs", function () {
    for (const [name, Type] of [
      ["float", c.c_float],
      ["double", c.c_double],
    ]) {
      const fn = library[`fixture_scalar_${name}`];
      fn.argtypes = [Type];
      fn.restype = Type;
      for (const value of [-(2n ** 63n) - 1n, 2n ** 64n]) {
        const expected = name === "float" ? Math.fround(Number(value)) : Number(value);
        assert.equal(new Type(value).value, expected);
        assert.equal(fn(value), expected);
      }
    }
  });

  it("test_float_integer_rounding", function () {
    const values = [
      2n ** 54n + 2n,
      2n ** 54n + 6n,
      2n ** 64n + 2048n,
      2n ** 64n + 6144n,
      2n ** 128n - 2n ** 104n,
      2n ** 128n - 2n ** 103n,
      2n ** 128n - 2n ** 103n - 2n ** 75n,
      2n ** 128n - 2n ** 74n,
      2n ** 128n + 2n ** 75n,
      2n ** 512n + 1n,
      2n ** 1023n,
      2n ** 1024n - 2n ** 971n,
    ];
    for (const [name, Type] of [
      ["float", c.c_float],
      ["double", c.c_double],
    ]) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const record = new Record(),
        array = c.ARRAY(Type, 1)();
      for (const tail of [false, true]) {
        const fn = library[`fixture_scalar_${name}${tail ? "_tail" : ""}`];
        fn.argtypes = tail ? [Type, c.c_char_p] : [Type];
        fn.restype = Type;
        const extra = tail ? ["x".repeat(16384)] : [];
        for (const magnitude of values) {
          for (const value of [magnitude, -magnitude]) {
            const expected = name === "float" ? Math.fround(Number(value)) : Number(value);
            assert.equal(new Type(value).value, expected);
            record.value = value;
            assert.equal(record.value, expected);
            array[0] = value;
            assert.equal(array[0], expected);
            assert.equal(fn(value, ...extra), expected);
          }
        }
      }
    }
  });

  it("test_float_integer_overflow", function () {
    for (const [name, Type] of [
      ["float", c.c_float],
      ["double", c.c_double],
    ]) {
      class Record extends c.Structure {
        static _fields_ = [["value", Type]];
      }
      const scalar = new Type(3),
        record = new Record(3),
        array = c.ARRAY(Type, 1)(3);
      const fn = library[`fixture_scalar_${name}`];
      fn.argtypes = [Type];
      fn.restype = Type;
      for (const value of [2n ** 1024n - 2n ** 970n, 2n ** 1024n, -(2n ** 1024n - 2n ** 970n), -(2n ** 1024n)]) {
        assert.throws(() => new Type(value), { name: "RangeError", message: "int too large to convert to float" });
        assert.throws(() => {
          scalar.value = value;
        }, RangeError);
        assert.throws(() => {
          record.value = value;
        }, RangeError);
        assert.throws(() => {
          array[0] = value;
        }, RangeError);
        assert.throws(() => fn(value), c.ArgumentError);
        assert.deepEqual([scalar.value, record.value, array[0]], [3, 3, 3]);
      }
    }
  });

  it("test_char_native_calls", function () {
    for (const tail of [false, true]) {
      const fn = library[`fixture_scalar_char${tail ? "_tail" : ""}`];
      fn.argtypes = tail ? [c.c_char, c.c_char_p] : [c.c_char];
      fn.restype = c.c_char;
      const extra = tail ? ["x".repeat(16384)] : [];
      for (const value of ["A", "\u00ff", 0, 255, false, true, "Z"]) {
        const expected = new c.c_char(value).value;
        assert.equal(fn(value, ...extra), expected);
        assert.equal(fn(new c.c_char(value), ...extra), expected);
      }
    }
  });

  it("test_bool_native_calls", function () {
    for (const tail of [false, true]) {
      const fn = library[`fixture_scalar_bool${tail ? "_tail" : ""}`];
      fn.argtypes = tail ? [c.c_bool, c.c_char_p] : [c.c_bool];
      fn.restype = c.c_bool;
      const extra = tail ? ["x".repeat(16384)] : [];
      for (const value of [false, true, 0, 2, null, "", "x", new c.c_bool(false), new c.c_int32(0)]) {
        const expected = new c.c_bool(value).value;
        assert.equal(fn(value, ...extra), expected);
        assert.equal(fn(new c.c_bool(value), ...extra), expected);
      }
    }
  });

  it("test_variadic_wchar_argument", function () {
    const fn = library.fixture_variadic_wchar;
    fn.argtypes = [c.c_int32];
    fn.restype = c.c_uint32;
    assert.equal(fn(0, new c.c_wchar_p("\u4e2d")), 0x4e2d);
  });

  it("test_wchar_native_calls", function () {
    for (const tail of [false, true]) {
      const fn = library[`fixture_scalar_wchar${tail ? "_tail" : ""}`];
      fn.argtypes = tail ? [c.c_wchar, c.c_char_p] : [c.c_wchar];
      fn.restype = c.c_wchar;
      const extra = tail ? ["x".repeat(16384)] : [];
      const characters = ["A", "\u4e2d", "\ud800", "\0"];
      if (c.sizeof(c.c_wchar) === 4) characters.push("\u{1f600}");
      for (const value of characters) {
        assert.equal(fn(value, ...extra), value);
        assert.equal(fn(new c.c_wchar(value), ...extra), value);
      }
    }
  });

  it("test_wchar_input_validation", function () {
    const fn = library.fixture_scalar_wchar;
    fn.argtypes = [c.c_wchar];
    fn.restype = c.c_wchar;
    for (const value of ["", "ab", null, 1.5, NaN, Infinity, Buffer.from("A")]) {
      assert.throws(() => new c.c_wchar(value), TypeError);
      assert.throws(() => fn(value), c.ArgumentError);
    }
  });

  it("test_variant_bool_instances", function () {
    const Type = c.wintypes.VARIANT_BOOL;
    for (const value of [false, true, 0, 2, new Type(false), new Type(true), new c.c_bool(false), new c.c_int32(0)]) {
      assert.equal(new Type(value).value, Boolean(value?.value ?? value));
    }
  });

  it("test_variant_bool_native_calls", function () {
    const Type = c.wintypes.VARIANT_BOOL;
    const fn = library.fixture_scalar_i16;
    fn.argtypes = [Type];
    fn.restype = Type;
    for (const value of [false, true, 0, 2, new Type(false), new Type(true), new c.c_bool(false), new c.c_int32(0)]) {
      assert.equal(fn(value), Boolean(value?.value ?? value));
    }
  });

  it("test_variant_bool_fields", function () {
    const Type = c.wintypes.VARIANT_BOOL;
    class Record extends c.Structure {
      static _fields_ = [["value", Type]];
    }
    const record = new Record();
    for (const value of [false, true, 0, 2, new Type(false), new Type(true)]) {
      record.value = value;
      const expected = Boolean(value?.value ?? value);
      assert.equal(record.value, expected);
      assert.equal(c.c_int16.from_buffer(record).value, expected ? -1 : 0);
    }
  });

  it("test_variant_bool_callback", function () {
    const Type = c.wintypes.VARIANT_BOOL;
    const fn = library.fixture_variant_callback;
    fn.argtypes = [c.c_void_p, c.c_int16];
    fn.restype = c.c_int16;
    for (const answer of [false, true, new Type(false), new Type(true)]) {
      const callback = c.CFUNCTYPE(
        Type,
        Type,
      )((value) => {
        assert.equal(typeof value, "boolean");
        assert.equal(value, false);
        return answer;
      });
      try {
        assert.equal(fn(callback, 0), Boolean(answer?.value ?? answer) ? -1 : 0);
      } finally {
        callback.release();
      }
    }
  });

  it("test_recursive_endian_arrays", function () {
    for (const Base of [c.BigEndianStructure, c.BigEndianUnion]) {
      class Record extends Base {
        static _fields_ = [["values", c.ARRAY(c.ARRAY(c.c_uint16, 2), 2)]];
      }
      const record = new Record();
      [record.values[0][0], record.values[0][1]] = [0x1122, 0x3344];
      [record.values[1][0], record.values[1][1]] = [0x5566, 0x7788];
      assert.deepEqual(Array.from(c.ARRAY(c.c_uint8, 8).from_buffer(record)), [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
      class Item extends c.Structure {
        static _fields_ = [["value", c.c_uint16]];
      }
      class Nested extends Base {
        static _fields_ = [["items", c.ARRAY(Item, 2)]];
      }
      const nested = new Nested();
      nested.items[0].value = 0x1122;
      nested.items[1].value = 0x3344;
      assert.deepEqual(Array.from(c.ARRAY(c.c_uint8, 4).from_buffer(nested)), [0x22, 0x11, 0x44, 0x33]);
    }
  });
});
