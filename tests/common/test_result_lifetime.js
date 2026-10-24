import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

const PointDef = c.struct({ x: c.c_int32, y: c.c_int32 });
const NumberDef = c.union({ scalar: c.c_int64, values: c.array(c.c_int32, 2) });
const TaggedValue = c.union({ f: c.c_float, i: c.c_int32 });
class Point extends c.Structure {
  static _fields_ = [
    ["x", c.c_int32],
    ["y", c.c_int32],
  ];
}
class NumberValue extends c.Union {
  static _fields_ = [
    ["scalar", c.c_int64],
    ["values", c.array(c.c_int32, 2)],
  ];
}
class Large extends c.Structure {
  static _fields_ = [["values", c.array(c.c_int32, 96)]];
}

const cases = [
  {
    name: "plain functional structure",
    type: PointDef,
    symbol: "fixture_point_make",
    argtypes: [c.c_int32, c.c_int32],
    args: (seed) => [seed, seed + 1],
    read: (value) => [value.x, value.y],
    expected: (seed) => [seed, seed + 1],
    mutate: (value) => {
      value.x = -100;
    },
    shape: (value) => assert.equal(Object.getPrototypeOf(value), Object.prototype),
  },
  {
    name: "structure class",
    type: Point,
    symbol: "fixture_point_make",
    argtypes: [c.c_int32, c.c_int32],
    args: (seed) => [seed, seed + 1],
    read: (value) => [value.x, value.y],
    expected: (seed) => [seed, seed + 1],
    mutate: (value) => {
      value.x = -100;
    },
    shape: (value) => assert.ok(value instanceof Point),
  },
  {
    name: "functional union with array getters",
    type: NumberDef,
    symbol: "fixture_return_union_make",
    argtypes: [c.c_int32, c.c_int32],
    args: (seed) => [seed, seed + 1],
    read: (value) => [...value.values],
    expected: (seed) => [seed, seed + 1],
    mutate: (value) => {
      value.values = [-100, -101];
    },
    shape: (value) => {
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
      assert.equal(typeof Object.getOwnPropertyDescriptor(value, "scalar").get, "function");
      assert.ok(Array.isArray(value.values));
    },
  },
  {
    name: "union class with array views",
    type: NumberValue,
    symbol: "fixture_return_union_make",
    argtypes: [c.c_int32, c.c_int32],
    args: (seed) => [seed, seed + 1],
    read: (value) => [...value.values],
    expected: (seed) => [seed, seed + 1],
    mutate: (value) => {
      value.values[0] = -100;
    },
    shape: (value) => assert.ok(value instanceof NumberValue),
  },
  {
    name: "functional array of nested structures",
    type: c.struct({ count: c.c_int32, points: c.array(PointDef, 2) }),
    symbol: "fixture_polyline_make",
    argtypes: [c.c_int32],
    args: (seed) => [seed],
    read: (value) => [value.count, ...Array.from(value.points, (point) => [point.x, point.y]).flat()],
    expected: (seed) => [2, seed, seed + 1, seed + 2, seed + 3],
    mutate: (value) => {
      value.points[0].x = -100;
    },
    shape: (value) => {
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
      assert.equal(value.points._arrayType.elementType, PointDef);
    },
  },
  {
    name: "functional nested union",
    type: c.struct({ tag: c.c_int32, value: TaggedValue }),
    symbol: "fixture_tagged_make",
    argtypes: [c.c_int32, c.c_int32],
    args: (seed) => [0, seed],
    read: (value) => [value.tag, value.value.i],
    expected: (seed) => [0, seed],
    mutate: (value) => {
      value.value.i = -100;
    },
    shape: (value) => assert.equal(typeof Object.getOwnPropertyDescriptor(value.value, "i").get, "function"),
  },
  {
    name: "large functional array",
    type: c.struct({ values: c.array(c.c_int32, 96) }),
    symbol: "fixture_return_block_make",
    argtypes: [c.c_int32],
    args: (seed) => [seed],
    read: (value) => [...value.values],
    expected: (seed) => Array.from({ length: 96 }, (_, i) => seed + i),
    mutate: (value) => {
      value.values[0] = -100;
    },
    shape: (value) => assert.equal(value.values.length, 96),
  },
  {
    name: "large structure class",
    type: Large,
    symbol: "fixture_return_block_make",
    argtypes: [c.c_int32],
    args: (seed) => [seed],
    read: (value) => [...value.values],
    expected: (seed) => Array.from({ length: 96 }, (_, i) => seed + i),
    mutate: (value) => {
      value.values[0] = -100;
    },
    shape: (value) => assert.ok(value instanceof Large),
  },
];

describe("returned structure and union ownership", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  function bind(kind, symbol, type, argtypes) {
    if (kind === "func") return lib.func(symbol, type, argtypes);
    if (kind === "attribute") {
      const fn = lib[symbol];
      fn.restype = type;
      fn.argtypes = argtypes;
      return fn;
    }
    const factory = c.CFUNCTYPE(type, ...argtypes);
    return kind === "prototype" ? factory([symbol, lib]) : factory(lib.symbol(symbol));
  }

  for (const kind of ["func", "attribute", "prototype", "address"]) {
    for (const test of cases) {
      for (const mode of ["sync", "async"]) {
        it(`${kind} ${mode}: ${test.name} retains its own values and public shape`, async function () {
          const fn = bind(kind, test.symbol, test.type, test.argtypes);
          const invoke = (seed) => (mode === "sync" ? fn(...test.args(seed)) : fn.callAsync(...test.args(seed)));
          const first = await invoke(1);
          test.shape(first);
          assert.deepEqual(test.read(first), test.expected(1));
          const later = mode === "sync" ? Array.from({ length: 32 }, (_, i) => invoke(i + 2)) : await Promise.all(Array.from({ length: 32 }, (_, i) => invoke(i + 2)));
          assert.deepEqual(test.read(first), test.expected(1));
          for (let i = 0; i < later.length; i++) assert.deepEqual(test.read(later[i]), test.expected(i + 2));
          const firstBytes = first._buffer ?? first.points?._buffer ?? first.values?._buffer ?? first.value?._buffer;
          const laterBytes = later[0]._buffer ?? later[0].points?._buffer ?? later[0].values?._buffer ?? later[0].value?._buffer;
          if (firstBytes !== undefined) assert.notEqual(firstBytes.buffer, laterBytes.buffer);
          test.mutate(first);
          const changed = test.read(first);
          assert.deepEqual(test.read(later[0]), test.expected(2));
          test.mutate(later[0]);
          assert.deepEqual(test.read(first), changed);
          const next = await invoke(100);
          assert.deepEqual(test.read(next), test.expected(100));
          assert.deepEqual(test.read(first), changed);
        });
      }
    }

    it(`${kind}: a reentrant toObject cannot overwrite even a purely eager result`, function () {
      const type = c.struct({ x: c.c_int32, y: c.c_int32 });
      const convert = type.toObject;
      const fn = bind(kind, "fixture_point_make", type, [c.c_int32, c.c_int32]);
      let nested;
      let reenter = true;
      type.toObject = function (bytes) {
        if (reenter) {
          reenter = false;
          nested = fn(90, 91);
        }
        return convert.call(this, bytes);
      };
      assert.deepEqual(fn(1, 2), { x: 1, y: 2 });
      assert.deepEqual(nested, { x: 90, y: 91 });
    });

    it(`${kind}: reentrant errcheck cannot mutate its already converted result`, function () {
      const type = c.struct({ count: c.c_int32, points: c.array(PointDef, 2) });
      const fn = bind(kind, "fixture_polyline_make", type, [c.c_int32]);
      let nested;
      let reenter = true;
      fn.errcheck = (result) => {
        if (reenter) {
          reenter = false;
          nested = fn(90);
        }
        return result;
      };
      try {
        const first = fn(1);
        assert.equal(first.points[0].x, 1);
        assert.equal(nested.points[0].x, 90);
        assert.equal(fn(200).points[0].x, 200);
        assert.equal(first.points[0].x, 1);
      } finally {
        fn.errcheck = null;
      }
    });
  }

  it("generic long-string calls snapshot even eagerly converted functional results", function () {
    const type = c.struct({ x: c.c_int32, y: c.c_int32 });
    const fn = lib.func("fixture_point_make_tail", type, [c.c_int32, c.c_int32, c.c_char_p]);
    const convert = type.toObject;
    let reenter = true;
    type.toObject = function (bytes) {
      if (reenter) {
        reenter = false;
        fn(90, 91, "x".repeat(16384));
      }
      return convert.call(this, bytes);
    };
    assert.deepEqual(fn(1, 2, "x".repeat(16384)), { x: 1, y: 2 });
  });

  it("class constructors can reenter without corrupting the outer snapshot", function () {
    let fn;
    let nested;
    let reenter = true;
    class Result extends Point {
      constructor(bytes) {
        if (reenter) {
          reenter = false;
          nested = fn(90, 91);
        }
        super(bytes);
      }
    }
    fn = lib.func("fixture_point_make", Result, [c.c_int32, c.c_int32]);
    const result = fn(1, 2);
    assert.ok(result instanceof Result);
    assert.deepEqual([result.x, result.y], [1, 2]);
    assert.deepEqual([nested.x, nested.y], [90, 91]);
  });

  it("paramflags errcheck receives independent results for sync and async calls", async function () {
    const type = c.struct({ count: c.c_int32, points: c.array(PointDef, 2) });
    const fn = c.CFUNCTYPE(type, c.c_int32).bind(lib, "fixture_polyline_make", [[1, "seed"]]);
    fn.errcheck = (result) => result;
    try {
      const first = fn(1);
      const second = fn(90);
      assert.equal(first.points[0].x, 1);
      assert.equal(second.points[0].x, 90);
      const asyncResults = await Promise.all([fn.callAsync(200), fn.callAsync(300)]);
      assert.equal(asyncResults[0].points[0].x, 200);
      assert.equal(asyncResults[1].points[0].x, 300);
      assert.equal(first.points[0].x, 1);
    } finally {
      fn.errcheck = null;
    }
  });

  it("explicit toObject(buffer) remains a view rather than changing helper semantics", function () {
    const bytes = Buffer.alloc(8);
    const value = NumberDef.toObject(bytes);
    bytes.writeBigInt64LE(7n);
    assert.equal(value.scalar, 7n);
    value.scalar = 8n;
    assert.equal(bytes.readBigInt64LE(), 8n);
  });

  it("raw native struct_buffer remains borrowed while public results own their snapshot", function () {
    const fn = lib.func("fixture_point_make", PointDef, [c.c_int32, c.c_int32]);
    const result = fn(1, 2);
    const first = fn._ffi.call(90, 91);
    assert.ok(Buffer.isBuffer(first));
    const second = fn._ffi.call(100, 101);
    assert.equal(first, second);
    assert.equal(first.readInt32LE(), 100);
    assert.deepEqual(result, { x: 1, y: 2 });
  });
});
