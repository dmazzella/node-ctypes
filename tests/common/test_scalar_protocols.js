import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("scalar representations and result protocols", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => { lib = new c.CDLL(fixture); });
  after(() => lib.close());

  function bind(kind, name, type, args) {
    if (kind === "func") return lib.func(name, type, args);
    if (kind === "attribute") {
      const fn = lib[name];
      fn.argtypes = args;
      fn.restype = type;
      return fn;
    }
    const factory = c.CFUNCTYPE(type, ...args);
    return kind === "prototype" ? factory([name, lib]) : factory(lib.symbol(name));
  }

  for (const kind of ["func", "attribute", "prototype", "address"]) {
    for (const async of [false, true]) {
      it(`${kind} ${async ? "async" : "sync"} returns derived scalar bytes without constructors or writers`, async function () {
        let constructed = 0;
        let written = 0;
        class Result extends c.c_int32 {
          constructor(value) { constructed++; super(value); }
          static _writer(buf, off, value) { written++; c.c_int32._writer(buf, off, value + 100); }
          static from_buffer() { throw new Error("public factory must not be used"); }
        }
        const fn = bind(kind, "fixture_scalar_i32", Result, [c.c_int32]);
        const value = async ? await fn.callAsync(7) : fn(7);
        assert.ok(value instanceof Result);
        assert.equal(value.value, 7);
        assert.equal(value._buffer.readInt32LE(), 7);
        assert.equal(constructed, 0);
        assert.equal(written, 0);
        value.value = 8;
        assert.equal(value.value, 108);
      });

      it(`${kind} ${async ? "async" : "sync"} runs retval before errcheck and propagates its errors`, async function () {
        const order = [];
        class Result extends c.c_int32 {
          static _check_retval_(value) {
            assert.ok(value instanceof Result);
            assert.equal(this, Result);
            order.push("retval");
            if (value.value < 0) throw new RangeError("negative result");
            return value.value + 100;
          }
        }
        const fn = bind(kind, "fixture_scalar_i32", Result, [c.c_int32]);
        fn.errcheck = (value, func) => {
          assert.equal(value, 107);
          assert.equal(func, fn);
          order.push("errcheck");
          return value + 1;
        };
        try {
          assert.equal(async ? await fn.callAsync(7) : fn(7), 108);
          assert.deepEqual(order, ["retval", "errcheck"]);
          order.length = 0;
          if (async) await assert.rejects(fn.callAsync(-1), /negative result/);
          else assert.throws(() => fn(-1), /negative result/);
          assert.deepEqual(order, ["retval"]);
        } finally { fn.errcheck = null; }
      });
    }
  }

  it("caches the retval checker at binding, not through a per-call lookup", function () {
    class Result extends c.c_int32 { static _check_retval_(value) { return value.value + 100; } }
    const first = lib._createFunction("fixture_scalar_i32", Result, [c.c_int32]);
    Result._check_retval_ = (value) => value.value + 200;
    assert.equal(first(7), 107);
    const second = lib._createFunction("fixture_scalar_i32", Result, [c.c_int32]);
    assert.equal(second(7), 207);
  });

  it("preserves native floating-point payload bytes for derived results", function () {
    class Result extends c.c_double {
      static _writer() { throw new Error("writer must not run"); }
    }
    const value = lib.func("fixture_nan_payload", Result, [])();
    assert.ok(value instanceof Result);
    assert.ok(Number.isNaN(value.value));
    assert.equal(value._buffer.readBigUInt64LE(), 0x7ff8000000001234n);
  });

  for (const Base of [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]) {
    it(`${Base.name} derived scalar fields are live views without write-back conversion`, function () {
      class Value extends c.c_int32 {
        static _writer(buf, off, value) { c.c_int32._writer(buf, off, value + 100); }
        static _writerBE(buf, off, value) { c.c_int32._writerBE(buf, off, value + 100); }
      }
      class Record extends Base { static _fields_ = [["value", Value]]; }
      const source = Buffer.alloc(4);
      const swapped = Base === c.BigEndianStructure || Base === c.BigEndianUnion;
      swapped ? source.writeInt32BE(7) : source.writeInt32LE(7);
      const record = Record.from_address(c.addressof(source));
      const field = record.value;
      assert.ok(field instanceof Value);
      assert.equal(field.value, 7);
      field.value = 8;
      assert.equal(swapped ? source.readInt32BE() : source.readInt32LE(), 108);
      swapped ? source.writeInt32BE(9) : source.writeInt32LE(9);
      assert.equal(field.value, 9);
    });
  }

  it("derived array elements and pointer indexing expose the original storage", function () {
    class Value extends c.c_int32 {}
    const source = Buffer.from(new Int32Array([7, 8]).buffer);
    const array = c.array(Value, 2).from_buffer(source);
    assert.ok(array[0] instanceof Value);
    array[0].value = 9;
    assert.equal(source.readInt32LE(), 9);
    const pointer = c.cast(source, c.POINTER(Value));
    assert.ok(pointer[1] instanceof Value);
    pointer[1].value = 10;
    assert.equal(source.readInt32LE(4), 10);
    const read = c.readValue(source, Value, 4);
    assert.ok(read instanceof Value);
    read.value = 11;
    assert.equal(source.readInt32LE(4), 11);
  });

  for (const [name, Base, input, expected] of [
    ["i64", c.c_int64, -7n, -7n], ["u64", c.c_uint64, -1n, 2n ** 64n - 1n],
    ["long", c.c_long, -7, -7n], ["ulong", c.c_ulong, 7, 7n],
    ["float", c.c_float, 1.5, 1.5], ["double", c.c_double, -2.25, -2.25],
    ["char", c.c_char, "A", "A"], ["wchar", c.c_wchar, "\u4e2d", "\u4e2d"],
    ["bool", c.c_bool, false, false],
  ]) {
    it(`${name} raw result bytes preserve the derived representation in sync and async calls`, async function () {
      class Result extends Base {
        constructor() { throw new Error("constructor must not run"); }
        static _writer() { throw new Error("writer must not run"); }
      }
      const fn = lib.func(`fixture_scalar_${name}`, Result, [Base]);
      const first = fn(input);
      const second = await fn.callAsync(input);
      assert.ok(first instanceof Result);
      assert.ok(second instanceof Result);
      assert.equal(first.value, expected);
      assert.equal(second.value, expected);
      assert.notEqual(first._buffer.buffer, second._buffer.buffer);
    });
  }

  it("library callback creation uses the same derived argument protocol", function () {
    class Value extends c.c_int32 {}
    const callback = lib.callback((value) => {
      assert.ok(value instanceof Value);
      return value.value + 1;
    }, c.c_int32, [Value]);
    try {
      const fn = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
      assert.equal(fn(callback.pointer, 7), 8);
    } finally { callback.release(); }
  });

  for (const threadSafe of [false, true]) {
    it(`${threadSafe ? "thread-safe" : "ordinary"} callbacks receive derived scalar byte instances`, async function () {
      class Value extends c.c_int32 {
        constructor() { throw new Error("constructor must not run"); }
        static _writer() { throw new Error("writer must not run"); }
      }
      let saved;
      const make = threadSafe ? c.threadSafeCallback : c.callback;
      const callback = make((value) => {
        assert.ok(value instanceof Value);
        saved = value;
        return value.value + 1;
      }, c.c_int32, [Value]);
      try {
        const fn = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
        assert.equal(threadSafe ? await fn.callAsync(callback, 7) : fn(callback, 7), 8);
        assert.equal(saved.value, 7);
        assert.equal(threadSafe ? await fn.callAsync(callback, 90) : fn(callback, 90), 91);
        assert.equal(saved.value, 90);
      } finally { callback.release(); }
    });
  }

  for (const Loader of [c.CDLL, c.WinDLL, c.OleDLL]) {
    it(`${Loader.name} checks explicit HRESULT before errcheck`, async function () {
      const library = new Loader(fixture);
      try {
        const fn = library.func("fixture_scalar_i32", c.HRESULT, [c.c_int32]);
        let checked = 0;
        fn.errcheck = (value) => { checked++; return value; };
        assert.throws(() => fn(-1), /HRESULT 0xFFFFFFFF/);
        await assert.rejects(fn.callAsync(-1), /HRESULT 0xFFFFFFFF/);
        assert.equal(checked, 0);
        assert.equal(fn(7), 7);
      } finally { library.close(); }
    });
  }

  it("prototype callers apply explicit HRESULT validation too", function () {
    const fn = c.CFUNCTYPE(c.HRESULT, c.c_int32)(["fixture_scalar_i32", lib]);
    assert.throws(() => fn(-1), /HRESULT 0xFFFFFFFF/);
    assert.equal(fn(7), 7);
  });

  it("aggregate retval checks run on the converted instance before errcheck", function () {
    class Point extends c.Structure {
      static _fields_ = [["x", c.c_int32], ["y", c.c_int32]];
      static _check_retval_(value) {
        assert.ok(value instanceof Point);
        return value.x + value.y;
      }
    }
    const fn = lib.func("fixture_point_make", Point, [c.c_int32, c.c_int32]);
    fn.errcheck = (value) => value + 100;
    try { assert.equal(fn(3, 4), 107); }
    finally { fn.errcheck = null; }
  });

  it("non-callable retval and outparam hooks report explicit errors", async function () {
    class Invalid extends c.c_int32 { static _check_retval_ = 123; }
    assert.throws(() => lib.func("fixture_scalar_i32", Invalid, [c.c_int32]), /_check_retval_ must be callable/);
    class Out extends c.c_int32 { __ctypes_from_outparam__ = null; }
    const fn = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out))
      .bind(lib, "fixture_divmod", [[1, "a"], [1, "b"], [2, "remainder"]]);
    assert.throws(() => fn(17, 5), /__ctypes_from_outparam__ must be callable/);
    await assert.rejects(fn.callAsync(17, 5), /__ctypes_from_outparam__ must be callable/);
  });

  it("mixed OUT and INOUT keep their declared order and bypass only the INOUT hook", async function () {
    class Out extends c.c_int32 { __ctypes_from_outparam__() { return this.value * 10; } }
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out), c.POINTER(Out));
    const fn = prototype.bind(lib, "fixture_divmod_pair", [
      { dir: "in", name: "a" }, { dir: "in", name: "b" },
      { dir: "out", name: "quotient" }, { dir: "inout", name: "remainder" },
    ]);
    const remainder = new Out();
    assert.deepEqual(fn(17, 5, remainder), [30, remainder]);
    assert.equal(remainder.value, 2);
    assert.deepEqual(await fn.callAsync({ a: 17, b: 5, remainder }), [30, remainder]);
  });
  for (const async of [false, true]) {
    it(`OUT hooks, defaults and INOUT identity follow retval/errcheck for ${async ? "async" : "sync"} calls`, async function () {
      const order = [];
      class Result extends c.c_int32 {
        static _check_retval_(value) { order.push(`retval:${value.value}`); return value.value + 100; }
      }
      class Out extends c.c_int32 {
        __ctypes_from_outparam__() { order.push(`out:${this.value}`); return this.value * 10; }
      }
      const prototype = c.CFUNCTYPE(Result, c.c_int32, c.c_int32, c.POINTER(Out));
      const out = prototype.bind(lib, "fixture_divmod", [[1, "a"], [1, "b"], [2, "remainder"]]);
      out.errcheck = (value, func, args) => {
        assert.equal(value, 103);
        assert.equal(func, out);
        assert.ok(args[2] instanceof Out);
        order.push("errcheck");
        return args;
      };
      const invoke = (fn, ...args) => async ? fn.callAsync(...args) : fn(...args);
      assert.equal(await invoke(out, 17, 5), 20);
      assert.deepEqual(order, ["retval:3", "errcheck", "out:2"]);
      const input = new Out(99);
      const inout = prototype.bind(lib, "fixture_divmod", [[1, "a"], [1, "b"], [3, "remainder", input]]);
      const result = await invoke(inout, { a: 17, b: 5 });
      assert.equal(result, input);
      assert.equal(input.value, 2);
      assert.equal(order.filter((entry) => entry.startsWith("out:")).length, 1);
      order.length = 0;
      inout.errcheck = (value, func, args) => {
        assert.equal(args[2], input);
        return "replacement";
      };
      assert.equal(await invoke(inout, 17, 5, input), "replacement");
      assert.deepEqual(order, ["retval:3"]);
    });

    it(`default OUT conversion preserves a derived scalar instance for ${async ? "async" : "sync"}`, async function () {
      class Out extends c.c_int32 {}
      const fn = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out))
        .bind(lib, "fixture_divmod", [[1, "a"], [1, "b"], [2, "remainder"]]);
      const value = async ? await fn.callAsync(17, 5) : fn(17, 5);
      assert.ok(value instanceof Out);
      assert.equal(value.value, 2);
    });
  }
});
