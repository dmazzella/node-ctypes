import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRAY, alignment, c_int, c_int32, c_uint16, sizeof } from "node-ctypes";

describe("TestArrayCache", function () {
  it("test_reuses_live_array_types", function () {
    class Int extends c_int32 {}
    const type = ARRAY(c_int32, 17);
    const distinct_element = ARRAY(Int, 17);
    const distinct_length = ARRAY(c_int32, 18);
    const empty = ARRAY(c_int32, 0);
    assert.equal(ARRAY(c_int32, 17), type);
    assert.equal(ARRAY(c_int, 17), type);
    assert.equal(ARRAY(Int, 17), distinct_element);
    assert.equal(ARRAY(c_int32, 18), distinct_length);
    assert.equal(ARRAY(c_int32, -0), empty);
    assert.notEqual(type, distinct_element);
    assert.notEqual(type, distinct_length);
  });

  it("test_array_type_layout", function () {
    const type = ARRAY(c_uint16, 11001);
    assert.equal(ARRAY(c_uint16, 11001), type);
    assert.equal(type().length, 11001);
    assert.equal(sizeof(type), 22002);
    assert.equal(alignment(type), alignment(c_uint16));
  });
});
