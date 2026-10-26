import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

describe("TestScalarProtocols", function () {
  let library;
  before(() => {
    library = new c.CDLL(FIXTURE);
  });
  after(() => library?.close());

  it("test_representation_bypasses_constructor", function () {
    class Value extends c.c_int32 {
      constructor(value = 0) {
        super(value + 100);
      }
    }
    const fn = library.fixture_scalar_i32;
    fn.argtypes = [c.c_int32];
    fn.restype = Value;
    const value = fn(7);
    assert.ok(value instanceof Value);
    assert.equal(value.value, 7);
    class Record extends c.Structure {
      static _fields_ = [["value", Value]];
    }
    const record = new Record();
    record.value = 7;
    assert.ok(record.value instanceof Value);
    assert.equal(record.value.value, 7);
    const seen = [];
    const callback = c.CFUNCTYPE(
      c.c_int32,
      Value,
    )((argument) => {
      seen.push(argument);
      return argument.value;
    });
    try {
      assert.equal(callback(7), 7);
      assert.ok(seen[0] instanceof Value);
      assert.equal(seen[0].value, 7);
    } finally {
      callback.release();
    }
  });

  it("test_retval_checker_is_cached_per_binding", function () {
    class Value extends c.c_int32 {
      static _check_retval_(value) {
        return value.value + 100;
      }
    }
    const fn = library.fixture_scalar_i32;
    fn.argtypes = [c.c_int32];
    fn.restype = Value;
    assert.equal(fn(7), 107);
    Value._check_retval_ = (value) => value.value + 200;
    assert.equal(fn(7), 107);
    fn.restype = Value;
    assert.equal(fn(7), 207);
  });

  it("test_out_hook_and_inout_identity", function () {
    class Out extends c.c_int32 {
      __ctypes_from_outparam__() {
        return this.value * 10;
      }
    }
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out));
    const out = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    assert.equal(out(17, 5), 20);
    const value = new Out(99);
    const inout = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [3, "remainder", value],
      ],
    );
    assert.equal(inout({ a: 17, b: 5 }), value);
    assert.equal(value.value, 2);
  });

  it("test_default_derived_out_is_an_instance", function () {
    class Out extends c.c_int32 {}
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out));
    const out = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    const value = out(17, 5);
    assert.ok(value instanceof Out);
    assert.equal(value.value, 2);
  });

  it("test_retval_before_errcheck_and_errors", function () {
    const order = [];
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        assert.ok(value instanceof this);
        order.push("retval");
        if (value.value < 0) throw new RangeError("negative result");
        return value.value + 100;
      }
    }
    const fn = library.fixture_scalar_i32;
    fn.argtypes = [c.c_int32];
    fn.restype = Result;
    fn.errcheck = (value, func) => {
      assert.equal(value, 107);
      assert.equal(func, fn);
      order.push("errcheck");
      return value + 1;
    };
    try {
      assert.equal(fn(7), 108);
      assert.deepEqual(order, ["retval", "errcheck"]);
      order.length = 0;
      assert.throws(() => fn(-1), /negative result/);
      assert.deepEqual(order, ["retval"]);
    } finally {
      fn.errcheck = null;
    }
  });

  it("test_native_nan_payload", function () {
    class Result extends c.c_double {
      constructor() {
        throw new Error("constructor must not run");
      }
    }
    const fn = library.fixture_nan_payload;
    fn.argtypes = [];
    fn.restype = Result;
    const value = fn();
    assert.ok(value instanceof Result);
    assert.ok(Number.isNaN(value.value));
    assert.equal(c.c_uint64.from_buffer(value).value, 0x7ff8000000001234n);
  });

  it("test_derived_scalar_field_live_views", function () {
    class Value extends c.c_int32 {
      constructor() {
        throw new Error("constructor must not run");
      }
    }
    for (const Base of [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]) {
      class Record extends Base {
        static _fields_ = [["value", Value]];
      }
      const record = new Record();
      record.value = 7;
      const field = record.value;
      if (Base === c.Structure || Base === c.Union) assert.ok(field instanceof Value);
      assert.equal(field.value, 7);
      field.value = 8;
      assert.equal(record.value.value, 8);
      record.value = 9;
      assert.equal(field.value, 9);
    }
  });

  it("test_derived_array_and_pointer_live_views", function () {
    class Value extends c.c_int32 {}
    const source = c.ARRAY(c.c_int32, 2)(7, 8);
    const array = c.ARRAY(Value, 2).from_buffer(source);
    assert.ok(array[0] instanceof Value);
    array[0].value = 9;
    assert.equal(source[0], 9);
    const pointer = c.cast(source, c.POINTER(Value));
    assert.ok(pointer[1] instanceof Value);
    pointer[1].value = 10;
    assert.equal(source[1], 10);
    const value = Value.from_buffer(source, c.sizeof(c.c_int32));
    assert.ok(value instanceof Value);
    value.value = 11;
    assert.equal(source[1], 11);
  });

  it("test_derived_scalar_result_types", function () {
    for (const [name, Base, value, expected] of [
      ["i64", c.c_int64, -7n, -7n],
      ["u64", c.c_uint64, -1n, 2n ** 64n - 1n],
      ["long", c.c_long, -7, -7n],
      ["ulong", c.c_ulong, 7, 7n],
      ["float", c.c_float, 1.5, 1.5],
      ["double", c.c_double, -2.25, -2.25],
      ["char", c.c_char, "A", "A"],
      ["wchar", c.c_wchar, "\u4e2d", "\u4e2d"],
      ["bool", c.c_bool, false, false],
    ]) {
      class Result extends Base {
        constructor() {
          throw new Error("constructor must not run");
        }
      }
      const fn = library[`fixture_scalar_${name}`];
      fn.argtypes = [Base];
      fn.restype = Result;
      const first = fn(value),
        second = fn(value);
      assert.ok(first instanceof Result);
      assert.ok(second instanceof Result);
      assert.equal(first.value, expected);
      assert.equal(second.value, expected);
      assert.notEqual(c.addressof(first), c.addressof(second));
    }
  });

  it("test_callback_derived_scalar_arguments", function () {
    class Value extends c.c_int32 {}
    const saved = [];
    const callback = c.CFUNCTYPE(
      c.c_int32,
      Value,
    )((value) => {
      assert.ok(value instanceof Value);
      saved.push(value);
      return value.value + 1;
    });
    const fn = library.fixture_scalar_callback;
    fn.argtypes = [c.c_void_p, c.c_int32];
    fn.restype = c.c_int32;
    try {
      assert.equal(fn(callback, 7), 8);
      assert.equal(saved.at(-1).value, 7);
      assert.equal(fn(callback, 90), 91);
      assert.equal(saved.at(-1).value, 90);
    } finally {
      callback.release();
    }
  });

  it("test_aggregate_retval_before_errcheck", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
      static _check_retval_(value) {
        assert.ok(value instanceof Point);
        return value.x + value.y;
      }
    }
    const fn = library.fixture_point_make;
    fn.argtypes = [c.c_int32, c.c_int32];
    fn.restype = Point;
    fn.errcheck = (value) => value + 100;
    try {
      assert.equal(fn(3, 4), 107);
    } finally {
      fn.errcheck = null;
    }
  });

  it("test_invalid_retval_checker", function () {
    class Invalid extends c.c_int32 {
      static _check_retval_ = 123;
    }
    const fn = library.fixture_scalar_i32;
    fn.argtypes = [c.c_int32];
    fn.restype = Invalid;
    assert.throws(() => fn(7), /callable/);
  });

  it("test_invalid_outparam_hook", function () {
    class Out extends c.c_int32 {
      __ctypes_from_outparam__ = null;
    }
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out));
    const fn = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    assert.throws(() => fn(17, 5), /callable/);
  });

  it("test_mixed_out_inout_declared_order", function () {
    class Out extends c.c_int32 {
      __ctypes_from_outparam__() {
        return this.value * 10;
      }
    }
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out), c.POINTER(Out));
    const fn = prototype(
      ["fixture_divmod_pair", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "quotient"],
        [3, "remainder"],
      ],
    );
    const remainder = new Out();
    assert.deepEqual(fn(17, 5, remainder), [30, remainder]);
    assert.equal(remainder.value, 2);
    assert.deepEqual(fn({ a: 17, b: 5, remainder }), [30, remainder]);
  });

  it("test_out_hooks_follow_retval_errcheck", function () {
    const order = [];
    class Result extends c.c_int32 {
      static _check_retval_(value) {
        order.push(`retval:${value.value}`);
        return value.value + 100;
      }
    }
    class Out extends c.c_int32 {
      __ctypes_from_outparam__() {
        order.push(`out:${this.value}`);
        return this.value * 10;
      }
    }
    const prototype = c.CFUNCTYPE(Result, c.c_int32, c.c_int32, c.POINTER(Out));
    const out = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ],
    );
    out.errcheck = (value, func, args) => {
      assert.equal(value, 103);
      assert.equal(func, out);
      assert.ok(args[2] instanceof Out);
      order.push("errcheck");
      return args;
    };
    assert.equal(out(17, 5), 20);
    assert.deepEqual(order, ["retval:3", "errcheck", "out:2"]);
    const value = new Out(99);
    const inout = prototype(
      ["fixture_divmod", library],
      [
        [1, "a"],
        [1, "b"],
        [3, "remainder", value],
      ],
    );
    assert.equal(inout({ a: 17, b: 5 }), value);
    assert.equal(value.value, 2);
    assert.equal(order.filter((entry) => entry.startsWith("out:")).length, 1);
    order.length = 0;
    inout.errcheck = (result, func, args) => {
      assert.equal(args[2], value);
      return "replacement";
    };
    assert.equal(inout(17, 5, value), "replacement");
    assert.deepEqual(order, ["retval:3"]);
  });
});

describe("TestHResultProtocols", function () {
  it("test_hresult_before_errcheck", { skip: process.platform !== "win32" && "HRESULT is a Windows ctypes type" }, function () {
    for (const Loader of [c.CDLL, c.WinDLL, c.OleDLL]) {
      const library = new Loader(FIXTURE);
      try {
        const fn = library.fixture_scalar_i32;
        fn.argtypes = [c.c_int32];
        fn.restype = c.HRESULT;
        const checked = [];
        fn.errcheck = (value) => {
          checked.push(value);
          return value;
        };
        assert.throws(() => fn(-1), /HRESULT/);
        assert.deepEqual(checked, []);
        assert.equal(fn(7), 7);
      } finally {
        library.close();
      }
    }
  });
  it("test_hresult_prototype", { skip: process.platform !== "win32" && "HRESULT is a Windows ctypes type" }, function () {
    const library = new c.CDLL(FIXTURE);
    try {
      const fn = c.CFUNCTYPE(c.HRESULT, c.c_int32)(["fixture_scalar_i32", library]);
      assert.throws(() => fn(-1), /HRESULT/);
      assert.equal(fn(7), 7);
    } finally {
      library.close();
    }
  });
});
