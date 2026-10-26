import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";
import { LIBC } from "../_support.js";

describe("TestBasicTypes", function () {
  it("test_char_p_c_char_p", function () {
    for (const text of ["Hello, World!", ""]) assert.equal(new c.c_char_p(text).value, text);
    assert.equal(new c.c_char_p(null).value, null);
    const value = new c.c_char_p("Test String");
    assert.equal(value.value, "Test String");
    value.value = "New String";
    assert.equal(value.value, "New String");
    const other = new c.c_char_p("Initial Value");
    other.value = "Modified Value";
    assert.equal(other.value, "Modified Value");
  });

  it("test_wchar_p_c_wchar_p", function () {
    for (const text of ["Hello, Wide World!", ""]) assert.equal(new c.c_wchar_p(text).value, text);
    assert.equal(new c.c_wchar_p(null).value, null);
    const value = new c.c_wchar_p("Test Wide String");
    assert.equal(value.value, "Test Wide String");
    value.value = "New Wide String";
    assert.equal(value.value, "New Wide String");
    const other = new c.c_wchar_p("Initial Wide Value");
    other.value = "Modified Wide Value";
    assert.equal(other.value, "Modified Wide Value");
  });

  it("test_int8_c_int8", function () {
    const buffer = c.create_string_buffer(1);
    const value = new c.c_int8(-128);
    c.memmove(buffer, c.byref(value), 1);
    assert.equal(c.c_int8.from_buffer(buffer).value, -128);
    value.value = 127;
    assert.equal(value.value, 127);
    assert.equal(new c.c_int8(127).value, 127);
    c.memmove(buffer, c.byref(value), 1);
    assert.equal(c.c_int8.from_buffer(buffer).value, 127);
    value.value = -128;
    assert.equal(value.value, -128);
  });

  it("test_uint8_c_uint8_c_ubyte", function () {
    assert.equal(new c.c_uint8(0).value, 0);
    assert.equal(new c.c_uint8(255).value, 255);
  });

  it("test_int16_c_int16_c_short", function () {
    const value = new c.c_int16(-32768);
    assert.equal(value.value, -32768);
    value.value = 32767;
    assert.equal(value.value, 32767);
    assert.equal(new c.c_int16(32767).value, 32767);
    value.value = -32768;
    assert.equal(value.value, -32768);
  });

  it("test_uint16_c_uint16_c_ushort", function () {
    assert.equal(new c.c_uint16(0).value, 0);
    assert.equal(new c.c_uint16(65535).value, 65535);
  });

  it("test_int32_c_int32_c_int", function () {
    const value = new c.c_int32(-2147483648);
    assert.equal(value.value, -2147483648);
    value.value = 2147483647;
    assert.equal(value.value, 2147483647);
    assert.equal(new c.c_int32(2147483647).value, 2147483647);
    value.value = -2147483648;
    assert.equal(value.value, -2147483648);
  });

  it("test_uint32_c_uint32_c_uint", function () {
    assert.equal(new c.c_uint32(0).value, 0);
    assert.equal(new c.c_uint32(4294967295).value, 4294967295);
  });

  it("test_int64_c_int64_c_longlong", function () {
    const value = new c.c_int64(-9223372036854775808n);
    assert.equal(value.value, -9223372036854775808n);
    value.value = 9223372036854775807n;
    assert.equal(value.value, 9223372036854775807n);
    assert.equal(new c.c_int64(9223372036854775807n).value, 9223372036854775807n);
    value.value = -9223372036854775808n;
    assert.equal(value.value, -9223372036854775808n);
  });

  it("test_uint64_c_uint64_c_ulonglong", function () {
    assert.equal(new c.c_uint64(0n).value, 0n);
    assert.equal(new c.c_uint64(18446744073709551615n).value, 18446744073709551615n);
  });

  it("test_float_c_float", function () {
    assert.ok(Math.abs(new c.c_float(3.14159).value - 3.14159) < 0.00001);
  });

  it("test_double_c_double", function () {
    assert.ok(Math.abs(new c.c_double(3.141592653589793).value - 3.141592653589793) < 1e-12);
  });

  it("test_bool_c_bool", function () {
    const value = new c.c_bool(true);
    assert.equal(value.value, true);
    value.value = false;
    assert.equal(value.value, false);
    assert.equal(new c.c_bool(false).value, false);
  });

  it("test_pointer_c_void_p", function () {
    assert.equal(new c.c_void_p(0x12345678n).value, 0x12345678n);
  });

  it("test_size_t_c_size_t", function () {
    assert.equal(new c.c_size_t(1024n).value, 1024n);
  });

  it("test_c_long_platform_dependent", function () {
    const size = c.sizeof(c.c_long);
    assert.ok([4, 8].includes(size));
    if (size === 4) {
      assert.equal(new c.c_long(2147483647).value, 2147483647n);
      assert.equal(new c.c_long(-1).value, -1n);
    } else assert.equal(new c.c_long(9223372036854775807n).value, 9223372036854775807n);
  });

  it("test_c_ulong_platform_dependent", function () {
    const size = c.sizeof(c.c_ulong);
    assert.ok([4, 8].includes(size));
    if (size === 4) {
      assert.equal(new c.c_ulong(4294967295).value, 4294967295n);
      assert.equal(new c.c_ulong(4294967296n + 5n).value, 5n);
    } else assert.equal(new c.c_ulong(18446744073709551615n).value, 18446744073709551615n);
  });

  it("test_sizeof", function () {
    for (const [Type, size] of [
      [c.c_int8, 1],
      [c.c_uint8, 1],
      [c.c_int16, 2],
      [c.c_uint16, 2],
      [c.c_int32, 4],
      [c.c_uint32, 4],
      [c.c_int64, 8],
      [c.c_uint64, 8],
      [c.c_float, 4],
      [c.c_double, 8],
      [c.c_bool, 1],
    ])
      assert.equal(c.sizeof(Type), size);
    assert.equal(c.sizeof(c.c_void_p), c.sizeof(c.c_size_t));
  });

  it("test_sizeof_instance", function () {
    assert.equal(c.sizeof(new c.c_uint64(42n)), 8);
  });

  it("test_byref_scalar_and_structure", function () {
    assert.notEqual(c.byref(new c.c_uint32(42)), null);
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    assert.notEqual(c.byref(new Point(10, 20)), null);
  });

  it("test_from_buffer_view", function () {
    const buffer = c.create_string_buffer(4);
    c.c_uint32.from_buffer(buffer).value = 0xdeadbeef;
    const value = c.c_uint32.from_buffer(buffer);
    assert.equal(value.value, 0xdeadbeef);
    value.value = 0x12345678;
    assert.equal(c.c_uint32.from_buffer(buffer).value, 0x12345678);
  });

  it("test_from_buffer_offset", function () {
    const buffer = c.create_string_buffer(8);
    c.c_uint32.from_buffer(buffer, 0).value = 0xaabbccdd;
    c.c_uint32.from_buffer(buffer, 4).value = 0x11223344;
    assert.equal(c.c_uint32.from_buffer(buffer, 0).value, 0xaabbccdd);
    assert.equal(c.c_uint32.from_buffer(buffer, 4).value, 0x11223344);
  });

  it("test_from_buffer_copy", function () {
    const buffer = c.create_string_buffer(4);
    c.c_uint32.from_buffer(buffer).value = 0xdeadbeef;
    const value = c.c_uint32.from_buffer_copy(buffer);
    assert.equal(value.value, 0xdeadbeef);
    value.value = 0x12345678;
    assert.equal(c.c_uint32.from_buffer(buffer).value, 0xdeadbeef);
  });

  it("test_aliases", function () {
    for (const [Type, value] of [
      [c.c_byte, -128],
      [c.c_ubyte, 255],
      [c.c_short, -32768],
      [c.c_ushort, 65535],
      [c.c_longlong, 9223372036854775807n],
      [c.c_ulonglong, 18446744073709551615n],
    ]) {
      assert.equal(new Type(value).value, value);
    }
    assert.equal(c.sizeof(c.c_byte), 1);
  });

  it("test_default_values", function () {
    assert.equal(new c.c_uint64().value, 0n);
    assert.equal(new c.c_int32().value, 0);
    assert.equal(new c.c_double().value, 0);
    assert.equal(new c.c_bool().value, false);
  });

  it("test_void_pointer_field", function () {
    class Record extends c.Structure {
      static _fields_ = [["p", c.c_void_p]];
    }
    const source = c.create_string_buffer("hi");
    const address = c.addressof(source);
    const record = new Record();
    for (const value of [address, new c.c_void_p(address)]) {
      record.p = value;
      assert.equal(record.p, address);
    }
    assert.throws(() => {
      record.p = {};
    }, TypeError);
  });
});

describe("TestCSsizeT", function () {
  it("test_stores_positive_values", function () {
    assert.equal(new c.c_ssize_t(42).value, c.sizeof(c.c_void_p) === 8 ? 42n : 42);
  });
  it("test_stores_negative_values", function () {
    assert.equal(new c.c_ssize_t(-42).value, c.sizeof(c.c_void_p) === 8 ? -42n : -42);
  });
  it("test_same_size_as_c_size_t", function () {
    assert.equal(c.sizeof(c.c_ssize_t), c.sizeof(c.c_size_t));
  });
  it("test_same_size_as_pointer", function () {
    assert.equal(c.sizeof(c.c_ssize_t), c.sizeof(c.c_void_p));
  });
  it("test_large_positive_value", function () {
    assert.equal(new c.c_ssize_t(2 ** 31 - 1).value, c.sizeof(c.c_void_p) === 8 ? BigInt(2 ** 31 - 1) : 2 ** 31 - 1);
  });
  it("test_large_negative_value", function () {
    assert.equal(new c.c_ssize_t(-(2 ** 31)).value, c.sizeof(c.c_void_p) === 8 ? BigInt(-(2 ** 31)) : -(2 ** 31));
  });
  it("test_in_struct_field", function () {
    class Record extends c.Structure {
      static _fields_ = [["len", c.c_ssize_t]];
    }
    assert.equal(new Record(-100).len, c.sizeof(c.c_void_p) === 8 ? -100n : -100);
  });
});

describe("TestAlignment", function () {
  it("test_primitive_types", function () {
    assert.equal(c.alignment(c.c_uint8), 1);
    assert.equal(c.alignment(c.c_int32), 4);
    assert.equal(c.alignment(c.c_double), 8);
  });
  it("test_pointer_type", function () {
    assert.equal(c.alignment(c.c_void_p), c.sizeof(c.c_void_p));
  });
  it("test_structure", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    assert.equal(c.alignment(Point), 4);
  });
  it("test_structure_mixed_types", function () {
    class Mixed extends c.Structure {
      static _fields_ = [
        ["a", c.c_uint8],
        ["b", c.c_double],
      ];
    }
    assert.equal(c.alignment(Mixed), 8);
  });
  it("test_array_type", function () {
    assert.equal(c.alignment(c.ARRAY(c.c_int32, 4)), 4);
  });
  it("test_alignment_of_instance", function () {
    assert.equal(c.alignment(new c.c_int32(42)), 4);
  });
  it("test_alignment_of_struct_instance", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    assert.equal(c.alignment(new Point(1, 2)), 4);
  });
  it("test_throws_for_invalid", function () {
    for (const value of [42, "string", null]) assert.throws(() => c.alignment(value), TypeError);
  });
});

describe("TestPointers", function () {
  it("test_pointer_to_int", function () {
    const value = new c.c_int32(42);
    const pointer = c.pointer(value);
    assert.notEqual(c.cast(pointer, c.c_void_p).value, null);
    assert.equal(pointer[0], 42);
    assert.equal(pointer.contents.value, 42);
  });
  it("test_pointer_write_through", function () {
    const value = new c.c_int32(42);
    const pointer = c.pointer(value);
    pointer[0] = 100;
    assert.equal(value.value, 100);
  });
  it("test_pointer_contents_repoints", function () {
    const first = new c.c_int32(42),
      second = new c.c_int32(99);
    const pointer = c.pointer(first);
    pointer.contents = second;
    assert.equal(pointer[0], 99);
    assert.equal(first.value, 42);
    pointer[0] = 7;
    assert.equal(second.value, 7);
  });
  it("test_pointer_to_structure", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    const point = new Point(10, 20);
    const pointer = c.pointer(point);
    assert.deepEqual([pointer.contents.x, pointer.contents.y], [10, 20]);
  });
  it("test_pointer_to_double", function () {
    const value = new c.c_double(3.14159);
    const pointer = c.pointer(value);
    assert.ok(Math.abs(pointer[0] - 3.14159) < 0.00001);
  });
  it("test_addressof_scalar", function () {
    const address = c.addressof(new c.c_int32(42));
    assert.equal(typeof address, "bigint");
    assert.ok(address > 0n);
  });
  it("test_addressof_matches_contents", function () {
    const value = new c.c_int32(42);
    const pointer = c.pointer(value);
    assert.equal(c.addressof(value), c.addressof(pointer.contents));
  });
  it("test_addressof_structure", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    const point = new Point(10, 20);
    const address = c.addressof(point);
    assert.equal(typeof address, "bigint");
    assert.ok(address > 0n);
  });
  it("test_addressof_cast_roundtrip", function () {
    const value = new c.c_int32(42);
    const pointer = c.cast(new c.c_void_p(c.addressof(value)), c.POINTER(c.c_int32));
    assert.equal(pointer[0], 42);
  });
  it("test_cast_array", function () {
    const array = c.ARRAY(c.c_int32, 3)(100, 200, 300);
    const pointer = c.cast(array, c.POINTER(c.c_int32));
    assert.deepEqual([pointer[0], pointer[1], pointer[2]], [100, 200, 300]);
  });
  it("test_cast_void_pointer", function () {
    const value = new c.c_int32(12345);
    const pointer = c.cast(new c.c_void_p(c.addressof(value)), c.POINTER(c.c_int32));
    assert.equal(pointer[0], 12345);
  });
  it("test_cast_preserves_type", function () {
    const value = new c.c_double(3.14);
    const pointer = c.cast(c.pointer(value), c.POINTER(c.c_double));
    assert.ok(Math.abs(pointer[0] - 3.14) < 0.01);
  });
  it("test_cast_reinterprets_float", function () {
    const value = new c.c_float(1.0);
    const pointer = c.cast(c.pointer(value), c.POINTER(c.c_uint32));
    assert.equal(pointer[0], 0x3f800000);
  });
  it("test_cast_write_through", function () {
    const array = c.ARRAY(c.c_int32, 2)(0, 0);
    const pointer = c.cast(array, c.POINTER(c.c_int32));
    pointer[0] = 111;
    pointer[1] = 222;
    assert.deepEqual([array[0], array[1]], [111, 222]);
  });
  it("test_cast_integer_address", function () {
    const pointer = c.cast(0x12345678, c.POINTER(c.c_int32));
    assert.equal(c.cast(pointer, c.c_void_p).value, 0x12345678n);
  });
  it("test_pointer_array_indexing", function () {
    const array = c.ARRAY(c.c_int32, 5)(10, 20, 30, 40, 50);
    const pointer = c.cast(array, c.POINTER(c.c_int32));
    for (let index = 0; index < 5; index++) assert.equal(pointer[index], (index + 1) * 10);
  });
  it("test_pointer_array_write", function () {
    const array = c.ARRAY(c.c_int32, 3)(0, 0, 0);
    const pointer = c.cast(array, c.POINTER(c.c_int32));
    pointer[0] = 11;
    pointer[1] = 22;
    pointer[2] = 33;
    assert.deepEqual([array[0], array[1], array[2]], [11, 22, 33]);
  });
  it("test_pointer_double_array", function () {
    const array = c.ARRAY(c.c_double, 3)(1.1, 2.2, 3.3);
    const pointer = c.cast(array, c.POINTER(c.c_double));
    for (const [index, expected] of [1.1, 2.2, 3.3].entries()) assert.ok(Math.abs(pointer[index] - expected) < 0.01);
  });
  it("test_null_pointer", function () {
    const pointer = c.cast(null, c.POINTER(c.c_int32));
    assert.equal(c.cast(pointer, c.c_void_p).value, null);
  });
  it("test_null_pointer_dereference", function () {
    const pointer = c.cast(null, c.POINTER(c.c_int32));
    assert.throws(() => pointer.contents, /NULL pointer/);
    assert.throws(() => pointer[0], /NULL pointer/);
  });
});

describe("TestInDll", function () {
  it("test_global", { skip: process.platform !== "win32" && "Windows exported _timezone" }, function () {
    const library = new c.CDLL(LIBC);
    try {
      assert.equal(typeof c.c_int32.in_dll(library, "_timezone").value, "number");
    } finally {
      library.close();
    }
  });
  it("test_missing_symbol", function () {
    const library = new c.CDLL(LIBC);
    try {
      assert.throws(() => c.c_int32.in_dll(library, "symbol_that_definitely_does_not_exist_12345"), /not found|Symbol/i);
    } finally {
      library.close();
    }
  });
  it("test_structure_factory", { skip: process.platform !== "win32" && "Original Windows-only inherited factory check" }, function () {
    class Dummy extends c.Structure {
      static _fields_ = [["x", c.c_int32]];
    }
    assert.equal(typeof Dummy.in_dll, "function");
  });
});

describe("TestAsParameterFromParam", function () {
  it("test_as_parameter_attribute", function () {
    class Wrapper {
      constructor(value) {
        this._as_parameter_ = value;
      }
    }
    assert.equal(new Wrapper(42)._as_parameter_, 42);
  });
  it("test_from_param_classmethod", function () {
    class StrLen extends c.c_int32 {
      static from_param(value) {
        return typeof value === "string" ? value.length : value;
      }
    }
    assert.equal(StrLen.from_param("hello"), 5);
    assert.equal(StrLen.from_param(42), 42);
  });
  it("test_as_parameter_native_call", function () {
    class Handle {
      constructor(value) {
        this._as_parameter_ = value;
      }
    }
    const library = new c.CDLL(LIBC);
    try {
      const abs = library.abs;
      abs.argtypes = [c.c_int32];
      abs.restype = c.c_int32;
      assert.equal(abs(new Handle(-42)), 42);
    } finally {
      library.close();
    }
  });
  it("test_from_param_native_call", function () {
    class StrLen extends c.c_int32 {
      static from_param(value) {
        return typeof value === "string" ? value.length : value;
      }
    }
    const library = new c.CDLL(LIBC);
    try {
      const abs = library.abs;
      abs.argtypes = [StrLen];
      abs.restype = c.c_int32;
      assert.equal(abs("hello"), 5);
      assert.equal(abs(-7), 7);
    } finally {
      library.close();
    }
  });
  it("test_from_param_receives_argument_as_passed", function () {
    const library = new c.CDLL(LIBC);
    const seen = [];
    class Strict extends c.c_int32 {
      static from_param(value) {
        seen.push(value?.constructor?.name ?? typeof value);
        if (typeof value === "string") throw new RangeError("no strings");
        return value;
      }
    }
    class Wrapped {
      constructor(value) {
        this._as_parameter_ = value;
      }
    }
    try {
      const abs = library.abs;
      abs.argtypes = [Strict];
      abs.restype = c.c_int32;
      assert.equal(abs(new Wrapped(-3)), 3);
      assert.equal(abs(-4), 4);
      assert.deepEqual(seen, ["Wrapped", "Number"]);
      const prototype = c.CFUNCTYPE(c.c_int32, Strict)(["abs", library]);
      assert.equal(prototype(new Wrapped(-9)), 9);
      for (const fn of [abs, prototype]) {
        assert.throws(
          () => fn("x"),
          (error) => error instanceof c.ArgumentError && error.message === "argument 1: RangeError: no strings",
        );
      }
    } finally {
      library.close();
    }
  });
});
