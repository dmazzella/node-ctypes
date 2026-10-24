import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("arrays in endian containers", function () {
  for (const [name, Base] of [["structure", c.BigEndianStructure], ["union", c.BigEndianUnion]]) {
    it(`${name} reads, writes and serializes primitive arrays without changing the shared type`, function () {
      const A = c.array(c.c_uint16, 2);
      class BE extends Base { static _fields_ = [["values", A]]; }
      class LE extends c.Structure { static _fields_ = [["values", A]]; }
      const value = new BE();
      value.values = [0x1122, 0x3344];
      assert.equal(value._buffer.toString("hex"), "11223344");
      assert.deepEqual([...value.values], [0x1122, 0x3344]);
      assert.deepEqual([...value.toObject().values], [0x1122, 0x3344]);
      if (name === "union") {
        value.toObject().values = [0x1122, 0x3344];
        assert.equal(value._buffer.toString("hex"), "11223344");
      }
      value.values[1] = 0x5566;
      assert.equal(value._buffer.toString("hex"), "11225566");
      const little = new LE();
      little.values = [0x1122, 0x3344];
      assert.equal(little._buffer.toString("hex"), "22114433");
      assert.equal(A(0x1122, 0x3344)._buffer.toString("hex"), "22114433");
      assert.equal(c.array(c.c_uint16, 2), A);
    });

    it(`${name} handles multidimensional arrays and keeps nested struct byte order`, function () {
      class Item extends c.Structure { static _fields_ = [["value", c.c_uint16]]; }
      class BE extends Base {
        static _fields_ = [["matrix", c.array(c.array(c.c_uint16, 2), 2)]];
      }
      const value = new BE();
      value.matrix = [[0x1122, 0x3344], [0x5566, 0x7788]];
      assert.equal(value._buffer.toString("hex"), "1122334455667788");
      assert.deepEqual(Array.from(value.matrix, (row) => [...row]), [[0x1122, 0x3344], [0x5566, 0x7788]]);
      value.matrix[1][0] = 0x99aa;
      assert.equal(value._buffer.toString("hex"), "1122334499aa7788");
      class Nested extends Base { static _fields_ = [["items", c.array(Item, 2)]]; }
      const nested = new Nested();
      nested.items[0].value = 0x1122;
      nested.items[1].value = 0x3344;
      assert.equal(nested._buffer.toString("hex"), "22114433");
    });

    it(`${name} swaps floats and wide strings including mirrored memory`, function () {
      class Floats extends Base { static _fields_ = [["values", c.array(c.c_float, 2)]]; }
      const source = Buffer.alloc(8);
      const value = Floats.from_address(c.addressof(source));
      value.values = [1.5, -2.25];
      assert.equal(source.toString("hex"), "3fc00000c0100000");
      source.writeFloatBE(3.5, 4);
      assert.deepEqual([...value.values], [1.5, 3.5]);
      class Wide extends Base { static _fields_ = [["text", c.array(c.c_wchar, 3)]]; }
      const wideSource = Buffer.alloc(c.sizeof(Wide));
      const wide = Wide.from_address(c.addressof(wideSource));
      wide.text = "A\u4e2d";
      assert.equal(wide.text, "A\u4e2d");
      assert.equal(wideSource.toString("hex"), c.WCHAR_SIZE === 2 ? "00414e2d0000" : "0000004100004e2d00000000");
      assert.equal(wide.toObject().text, "A\u4e2d");
      c.WCHAR_SIZE === 2 ? wideSource.writeUInt16BE(0x5a, 0) : wideSource.writeUInt32BE(0x5a, 0);
      assert.equal(wide.text, "Z\u4e2d");
    });
  }
});
