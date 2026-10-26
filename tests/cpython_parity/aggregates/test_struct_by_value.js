import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ARRAY, CDLL, CFUNCTYPE, Structure, c_int, c_uint32, sizeof } from "node-ctypes";
import { LIBC } from "../_support.js";

class DivT extends Structure {
  static _fields_ = [
    ["quot", c_int],
    ["rem", c_int],
  ];
}

describe("TestStructByValue", function () {
  let libc, div;
  before(() => {
    libc = new CDLL(LIBC);
    div = libc.div;
    div.argtypes = [c_int, c_int];
    div.restype = DivT;
  });
  after(() => libc.close());

  it("test_div_returns_struct", function () {
    const r = div(17, 5);
    assert.equal(r.quot, 3);
    assert.equal(r.rem, 2);
  });

  it("test_div_negative_numerator", function () {
    const r = div(-17, 5);
    assert.equal(r.quot, -3);
    assert.equal(r.rem, -2);
  });

  it("test_div_multiple_calls", function () {
    const a = div(100, 7);
    const b = div(42, 6);
    assert.deepEqual([a.quot, a.rem], [14, 2]);
    assert.deepEqual([b.quot, b.rem], [7, 0]);
  });
});

describe("TestStructByValueCompositeFields", function () {
  it("test_array_field", function () {
    const IntArr4 = ARRAY(c_int, 4);
    class S extends Structure {
      static _fields_ = [
        ["n", c_int],
        ["items", IntArr4],
      ];
    }
    assert.equal(sizeof(S), 20);
    const prototype = CFUNCTYPE(c_int, S);
    assert.equal(typeof prototype, "function");
  });

  it("test_bitfield_field", function () {
    class Flags extends Structure {
      static _fields_ = [
        ["low", c_uint32, 16],
        ["high", c_uint32, 16],
      ];
    }
    assert.equal(sizeof(Flags), 4);
    const f = new Flags();
    f.low = 0xaaaa;
    f.high = 0xbbbb;
    assert.equal(f.low, 0xaaaa);
    assert.equal(f.high, 0xbbbb);
    const prototype = CFUNCTYPE(c_uint32, Flags);
    assert.equal(typeof prototype, "function");
  });

  it("test_array_of_struct_field", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    const PointArr3 = ARRAY(Point, 3);
    class Polyline extends Structure {
      static _fields_ = [
        ["count", c_int],
        ["pad", c_int],
        ["points", PointArr3],
      ];
    }
    assert.equal(sizeof(Polyline), 32);
    const prototype = CFUNCTYPE(c_int, Polyline);
    assert.equal(typeof prototype, "function");
  });
});
