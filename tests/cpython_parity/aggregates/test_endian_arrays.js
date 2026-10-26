import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRAY, BigEndianStructure, BigEndianUnion, Structure, addressof, c_float, c_uint8, c_uint16, sizeof, string_at } from "node-ctypes";

describe("TestEndianArrays", function () {
  it("test_primitive_arrays", function () {
    for (const Base of [BigEndianStructure, BigEndianUnion]) {
      const A = ARRAY(c_uint16, 2);
      class BE extends Base {
        static _fields_ = [["values", A]];
      }
      class LE extends Structure {
        static _fields_ = [["values", A]];
      }
      const value = new BE();
      value.values = [0x1122, 0x3344];
      assert.equal(Buffer.from(string_at(addressof(value), sizeof(value)), "latin1").toString("hex"), "11223344");
      assert.deepEqual(Array.from(value.values), [0x1122, 0x3344]);
      value.values[1] = 0x5566;
      assert.equal(Buffer.from(string_at(addressof(value), sizeof(value)), "latin1").toString("hex"), "11225566");
      const little = new LE();
      little.values = [0x1122, 0x3344];
      assert.equal(Buffer.from(string_at(addressof(little), sizeof(little)), "latin1").toString("hex"), "22114433");
      const native = A(0x1122, 0x3344);
      assert.equal(Buffer.from(string_at(addressof(native), sizeof(native)), "latin1").toString("hex"), "22114433");
      assert.equal(ARRAY(c_uint16, 2), A);
    }
  });

  it("test_multidimensional_and_nested_struct_arrays", function () {
    for (const Base of [BigEndianStructure, BigEndianUnion]) {
      class Item extends Structure {
        static _fields_ = [["value", c_uint16]];
      }
      class BE extends Base {
        static _fields_ = [["matrix", ARRAY(ARRAY(c_uint16, 2), 2)]];
      }
      const value = new BE();
      value.matrix = [
        [0x1122, 0x3344],
        [0x5566, 0x7788],
      ];
      assert.equal(Buffer.from(string_at(addressof(value), sizeof(value)), "latin1").toString("hex"), "1122334455667788");
      assert.deepEqual(
        Array.from(value.matrix, (row) => Array.from(row)),
        [
          [0x1122, 0x3344],
          [0x5566, 0x7788],
        ],
      );
      value.matrix[1][0] = 0x99aa;
      assert.equal(Buffer.from(string_at(addressof(value), sizeof(value)), "latin1").toString("hex"), "1122334499aa7788");
      class Nested extends Base {
        static _fields_ = [["items", ARRAY(Item, 2)]];
      }
      const nested = new Nested();
      nested.items[0].value = 0x1122;
      nested.items[1].value = 0x3344;
      assert.equal(Buffer.from(string_at(addressof(nested), sizeof(nested)), "latin1").toString("hex"), "22114433");
    }
  });

  it("test_float_arrays_on_existing_memory", function () {
    for (const Base of [BigEndianStructure, BigEndianUnion]) {
      class Floats extends Base {
        static _fields_ = [["values", ARRAY(c_float, 2)]];
      }
      const source = Buffer.alloc(8);
      const value = Floats.from_address(addressof(c_uint8.from_buffer(source)));
      value.values = [1.5, -2.25];
      assert.equal(source.toString("hex"), "3fc00000c0100000");
      source.writeFloatBE(3.5, 4);
      assert.deepEqual(Array.from(value.values), [1.5, 3.5]);
    }
  });
});
