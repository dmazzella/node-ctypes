import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE } from "../_support.js";

const { ARRAY } = c;

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
class Number extends c.Union {
  static _fields_ = [
    ["scalar", c.c_int64],
    ["values", ARRAY(c.c_int32, 2)],
  ];
}
class Large extends c.Structure {
  static _fields_ = [["values", ARRAY(c.c_int32, 96)]];
}
class TaggedValue extends c.Union {
  static _fields_ = [
    ["f", c.c_float],
    ["i", c.c_int32],
  ];
}
class Tagged extends c.Structure {
  static _fields_ = [
    ["tag", c.c_int32],
    ["value", TaggedValue],
  ];
}

describe("TestResultLifetime", function () {
  let library;
  beforeEach(() => {
    library = new c.CDLL(FIXTURE);
  });

  it("test_point_results", function () {
    const attribute = library.fixture_point_make;
    attribute.argtypes = [c.c_int32, c.c_int32];
    attribute.restype = Point;
    const independent = c.CFUNCTYPE(Point, c.c_int32, c.c_int32)(["fixture_point_make", library]);
    for (const make of [attribute, independent]) {
      const first = make(1, 2);
      assert.ok(first instanceof Point);
      const later = Array.from({ length: 32 }, (_, index) => make(index + 2, index + 3));
      assert.deepEqual([first.x, first.y], [1, 2]);
      for (const [index, result] of later.entries()) assert.deepEqual([result.x, result.y], [index + 2, index + 3]);
      first.x = -100;
      assert.deepEqual([later[0].x, later[0].y], [2, 3]);
      later[0].x = -101;
      assert.deepEqual([first.x, first.y], [-100, 2]);
      assert.deepEqual([make(100, 101).x, first.x], [100, -100]);
    }
  });

  it("test_nested_arrays", function () {
    const attribute = library.fixture_polyline_make;
    attribute.argtypes = [c.c_int32];
    attribute.restype = Polyline;
    const independent = c.CFUNCTYPE(Polyline, c.c_int32)(["fixture_polyline_make", library]);
    for (const make of [attribute, independent]) {
      const first = make(1);
      const later = Array.from({ length: 32 }, (_, index) => make(index + 2));
      assert.ok(first instanceof Polyline);
      assert.deepEqual([first.count, first.points[0].x, first.points[0].y, first.points[1].x, first.points[1].y], [2, 1, 2, 3, 4]);
      for (const [index, result] of later.entries()) assert.deepEqual([result.count, result.points[0].x, result.points[0].y, result.points[1].x, result.points[1].y], [2, index + 2, index + 3, index + 4, index + 5]);
      first.points[0].x = -100;
      assert.equal(later[0].points[0].x, 2);
      later[0].points[0].x = -101;
      assert.equal(first.points[0].x, -100);
      assert.equal(make(100).points[0].x, 100);
      assert.equal(first.points[0].x, -100);
    }
  });

  it("test_union_arrays", function () {
    const attribute = library.fixture_return_union_make;
    attribute.argtypes = [c.c_int32, c.c_int32];
    attribute.restype = Number;
    const independent = c.CFUNCTYPE(Number, c.c_int32, c.c_int32)(["fixture_return_union_make", library]);
    for (const make of [attribute, independent]) {
      const first = make(1, 2);
      const later = Array.from({ length: 32 }, (_, index) => make(index + 2, index + 3));
      const special = make(90, 91);
      assert.ok(first instanceof Number);
      assert.deepEqual([...first.values], [1, 2]);
      for (const [index, result] of later.entries()) assert.deepEqual([...result.values], [index + 2, index + 3]);
      first.values[0] = -100;
      assert.deepEqual([...special.values], [90, 91]);
      assert.deepEqual([...later[0].values], [2, 3]);
      later[0].values[0] = -101;
      assert.deepEqual([...first.values], [-100, 2]);
      assert.deepEqual([...make(100, 101).values], [100, 101]);
      assert.deepEqual([...first.values], [-100, 2]);
    }
  });

  it("test_large_results", function () {
    const attribute = library.fixture_return_block_make;
    attribute.argtypes = [c.c_int32];
    attribute.restype = Large;
    const independent = c.CFUNCTYPE(Large, c.c_int32)(["fixture_return_block_make", library]);
    for (const make of [attribute, independent]) {
      const results = Array.from({ length: 34 }, (_, seed) => make(seed));
      for (const [seed, result] of results.entries()) {
        assert.ok(result instanceof Large);
        assert.deepEqual(
          [...result.values],
          Array.from({ length: 96 }, (_, index) => seed + index),
        );
      }
      results[0].values[0] = -100;
      assert.equal(results[1].values[0], 1);
      assert.deepEqual(
        [...make(100).values],
        Array.from({ length: 96 }, (_, index) => 100 + index),
      );
      assert.equal(results[0].values[0], -100);
    }
  });

  it("test_tagged_union_results", function () {
    const attribute = library.fixture_tagged_make;
    attribute.argtypes = [c.c_int32, c.c_int32];
    attribute.restype = Tagged;
    const independent = c.CFUNCTYPE(Tagged, c.c_int32, c.c_int32)(["fixture_tagged_make", library]);
    for (const make of [attribute, independent]) {
      const first = make(0, 1);
      const later = Array.from({ length: 32 }, (_, index) => make(0, index + 2));
      assert.ok(first instanceof Tagged);
      assert.deepEqual([first.tag, first.value.i], [0, 1]);
      for (const [index, result] of later.entries()) assert.deepEqual([result.tag, result.value.i], [0, index + 2]);
      first.value.i = -100;
      assert.equal(later[0].value.i, 2);
      later[0].value.i = -101;
      assert.equal(first.value.i, -100);
      assert.equal(make(0, 100).value.i, 100);
    }
  });

  it("test_reentrant_errcheck", function () {
    const attribute = library.fixture_polyline_make;
    attribute.argtypes = [c.c_int32];
    attribute.restype = Polyline;
    const independent = c.CFUNCTYPE(Polyline, c.c_int32)(["fixture_polyline_make", library]);
    for (const make of [attribute, independent]) {
      const nested = [];
      make.errcheck = (result, function_) => {
        if (nested.length === 0) {
          nested.push(null);
          nested[0] = function_(90);
        }
        return result;
      };
      const first = make(1);
      assert.equal(first.points[0].x, 1);
      assert.equal(nested[0].points[0].x, 90);
      assert.equal(make(200).points[0].x, 200);
      assert.equal(first.points[0].x, 1);
    }
  });

  it("test_paramflags_errcheck_results", function () {
    const make = c.CFUNCTYPE(Polyline, c.c_int32)(["fixture_polyline_make", library], [[1, "seed"]]);
    make.errcheck = (result) => result;
    const first = make(1);
    const second = make(90);
    assert.equal(first.points[0].x, 1);
    assert.equal(second.points[0].x, 90);
    assert.equal(make(200).points[0].x, 200);
    assert.equal(first.points[0].x, 1);
  });

  it("test_nested_view_ownership", function () {
    const make = library.fixture_polyline_make;
    make.argtypes = [c.c_int32];
    make.restype = Polyline;
    function escape() {
      return make(1).points;
    }
    const points = escape();
    const later = Array.from({ length: 32 }, (_, index) => make(index + 2));
    assert.deepEqual([points[0].x, points[1].y], [1, 4]);
    points[0].x = -100;
    assert.equal(later[0].points[0].x, 2);
    assert.equal(points[0].x, -100);
  });

  it("test_long_string_results", function () {
    const make = library.fixture_point_make_tail;
    make.argtypes = [c.c_int32, c.c_int32, c.c_char_p];
    make.restype = Point;
    const nested = [];
    make.errcheck = (result, function_) => {
      if (nested.length === 0) {
        nested.push(null);
        nested[0] = function_(90, 91, "x".repeat(16384));
      }
      return result;
    };
    const first = make(1, 2, "x".repeat(16384));
    assert.deepEqual([first.x, first.y], [1, 2]);
    assert.deepEqual([nested[0].x, nested[0].y], [90, 91]);
  });
});
