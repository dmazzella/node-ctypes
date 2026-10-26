import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("TestValidation", function () {
  it("test_empty_field_name", function () {
    class Record extends c.Structure {
      static _fields_ = [["", c.c_int32]];
    }
    const record = new Record();
    assert.equal(c.sizeof(Record), c.sizeof(c.c_int32));
    assert.equal(record[""], 0);
    record[""] = 7;
    assert.equal(record[""], 7);
  });
  it("test_inherited_empty_field_names", function () {
    for (const Base of [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]) {
      for (const name of ["", " ", "\t"]) {
        class Parent extends Base {
          static _fields_ = [[name, c.c_int32]];
        }
        class Inherited extends Parent {}
        class Child extends Inherited {
          static _fields_ = [["extra", c.c_int32]];
        }
        const parent = new Parent(3),
          inherited = new Inherited(4),
          child = new Child(5, 6);
        const isUnion = Base === c.Union || Base === c.BigEndianUnion;
        assert.equal(parent[name], 3);
        assert.equal(inherited[name], 4);
        assert.equal(child[name], isUnion ? 6 : 5);
        child[name] = 7;
        assert.equal(child[name], 7);
        assert.equal(child.extra, isUnion ? 7 : 6);
        assert.equal(parent[name], 3);
        assert.equal(Inherited.from_buffer(inherited)[name], 4);
      }
    }
  });
  it("test_inherited_prototype_field_names", function () {
    for (const Base of [c.Structure, c.Union]) {
      for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "toObject"]) {
        class Parent extends Base {
          static _fields_ = [[name, c.c_int32]];
        }
        class Inherited extends Parent {}
        class Child extends Inherited {
          static _fields_ = [["extra", c.c_int32]];
        }
        const parent = new Parent(3),
          inherited = new Inherited(4),
          child = new Child(5, 6);
        assert.equal(parent[name], 3);
        assert.equal(inherited[name], 4);
        assert.equal(child[name], Base === c.Union ? 6 : 5);
        child[name] = 7;
        assert.equal(child[name], 7);
        assert.equal(parent[name], 3);
        const view = Parent.from_buffer(parent);
        assert.equal(view[name], 3);
        const pointer = c.cast(c.byref(parent), c.POINTER(Parent));
        pointer.contents[name] = 8;
        assert.equal(parent[name], 8);
        const array = c.ARRAY(Inherited, 1)();
        array[0][name] = 9;
        assert.equal(array[0][name], 9);
      }
    }
  });
  it("test_anonymous_empty_field_name", function () {
    class Item extends c.Structure {
      static _fields_ = [["value", c.c_int32]];
    }
    for (const Base of [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]) {
      class Parent extends Base {
        static _anonymous_ = [""];
        static _fields_ = [["", Item]];
      }
      class Inherited extends Parent {}
      const record = new Inherited();
      record.value = 11;
      assert.equal(record[""].value, 11);
      record[""].value = 12;
      assert.equal(record.value, 12);
    }
  });
  it("test_structure_from_buffer_size", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    assert.throws(() => Point.from_buffer(c.create_string_buffer(4)), RangeError);
  });
  it("test_from_buffer_negative_offset", function () {
    const buffer = c.create_string_buffer(8);
    assert.throws(() => c.c_int32.from_buffer(buffer, -1), RangeError);
  });
  it("test_from_buffer_read_bounds", function () {
    const buffer = c.create_string_buffer(4);
    assert.throws(() => c.c_int32.from_buffer(buffer, 2).value, RangeError);
  });
  it("test_from_buffer_write_bounds", function () {
    const buffer = c.create_string_buffer(4);
    assert.throws(() => {
      c.c_int32.from_buffer(buffer, 2).value = 42;
    }, RangeError);
    assert.equal(c.c_int32.from_buffer(buffer).value, 0);
  });
  it("test_cast_arguments", function () {
    assert.throws(() => c.cast(null, c.c_int32), TypeError);
    assert.throws(() => c.cast(c.create_string_buffer(4), null), TypeError);
  });
});
