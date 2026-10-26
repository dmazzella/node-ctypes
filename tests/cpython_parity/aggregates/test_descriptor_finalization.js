import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Structure, Union, alignment, c_int32, c_int64, sizeof } from "node-ctypes";

describe("TestDescriptorFinalization", function () {
  it("test_nested_incomplete_field_is_final", function () {
    for (const Base of [Structure, Union]) {
      for (const ChildBase of [Structure, Union]) {
        class Child extends ChildBase {}
        class Parent extends Base {
          static _fields_ = [["child", Child]];
        }

        // JS class definitions are lazy; sizeof is the shared materialization point.
        assert.equal(sizeof(Parent), 0);
        assert.throws(() => {
          Child._fields_ = [["x", c_int32]];
        }, /final/);
        assert.equal(sizeof(Parent), 0);
      }
    }
  });

  it("test_materialized_incomplete_value_is_final", function () {
    for (const Base of [Structure, Union]) {
      class Value extends Base {}
      const value = new Value();

      assert.throws(() => {
        Value._fields_ = [["x", c_int32]];
      }, /final/);
      assert.equal(sizeof(value), 0);
    }
  });

  it("test_defined_fields_are_final", function () {
    for (const Base of [Structure, Union]) {
      class Value extends Base {
        static _fields_ = [["x", c_int32]];
      }
      assert.equal(sizeof(Value), 4);
      const fields = Value._fields_;
      assert.throws(() => {
        Value._fields_ = fields;
      }, /final/);
      assert.throws(() => {
        Value._fields_ = [["y", c_int64]];
      }, /final/);
      const value = new Value(7);
      assert.equal(value.x, 7);
      assert.equal(sizeof(value), 4);
    }
  });

  it("test_layout_queries_leave_incomplete_fields_open", function () {
    for (const Base of [Structure, Union]) {
      class Value extends Base {}
      assert.equal(sizeof(Value), 0);
      alignment(Value);
      Value._fields_ = [["x", c_int32]];
      assert.equal(sizeof(Value), 4);
      assert.equal(new Value(7).x, 7);
    }
  });

  it("test_subclass_fields_extend_final_base", function () {
    class Base extends Structure {
      static _fields_ = [["x", c_int32]];
    }
    assert.equal(sizeof(Base), 4);
    class Derived extends Base {}
    assert.equal(sizeof(Derived), 4);
    Derived._fields_ = [["y", c_int32]];
    assert.equal(sizeof(Derived), 8);
    const value = new Derived(1, 2);
    assert.deepEqual([value.x, value.y], [1, 2]);
    assert.throws(() => {
      Base._fields_ = [["z", c_int64]];
    }, /final/);
  });

  it("test_inherited_layout_instance_is_final", function () {
    for (const Base of [Structure, Union]) {
      class Parent extends Base {
        static _fields_ = [["x", c_int32]];
      }
      class Value extends Parent {}
      const value = new Value(7);
      assert.throws(() => {
        Value._fields_ = [["y", c_int64]];
      }, /final/);
      assert.equal(value.x, 7);
      assert.equal(sizeof(value), 4);
    }
  });

  it("test_exposed_field_list_mutation_does_not_change_layout", function () {
    for (const Base of [Structure, Union]) {
      class Value extends Base {
        static _fields_ = [["x", c_int32]];
      }
      const value = new Value(7);
      Value._fields_[0] = ["y", c_int64];
      Value._fields_.push(["z", c_int64]);
      assert.equal(sizeof(Value), 4);
      assert.equal(value.x, 7);
      assert.equal("y" in value, false);
      assert.equal("z" in value, false);
      const next = new Value();
      next.x = 8;
      assert.equal(next.x, 8);
    }
  });
});
