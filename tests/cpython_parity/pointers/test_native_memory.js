import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE, LIBC } from "../_support.js";

class Point extends c.Structure {
  static _fields_ = [
    ["x", c.c_int32],
    ["y", c.c_int32],
  ];
}

describe("TestNativeMemory", function () {
  let libc, fixture, malloc, free, cmemset, cmemcpy, blocks;
  before(() => {
    libc = new c.CDLL(LIBC);
    fixture = new c.CDLL(FIXTURE);
    malloc = libc.malloc;
    malloc.argtypes = [c.c_size_t];
    malloc.restype = c.c_void_p;
    free = libc.free;
    free.argtypes = [c.c_void_p];
    free.restype = null;
    cmemset = libc.memset;
    cmemset.argtypes = [c.c_void_p, c.c_int32, c.c_size_t];
    cmemset.restype = c.c_void_p;
    cmemcpy = libc.memcpy;
    cmemcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t];
    cmemcpy.restype = c.c_void_p;
  });
  beforeEach(() => {
    blocks = [];
  });
  afterEach(() => {
    for (const address of blocks) free(address);
  });
  after(() => {
    if (fixture) fixture.close();
    if (libc) libc.close();
  });
  function allocate(size) {
    const address = malloc(size);
    assert.ok(address);
    blocks.push(address);
    cmemset(address, 0, size);
    return address;
  }

  it("test_scalar_views", function () {
    const address = allocate(4);
    const value = c.c_int32.from_address(address);
    cmemset(address, 1, 4);
    assert.equal(value.value, 0x01010101);
    value.value = -7;
    assert.equal(c.c_int32.from_buffer_copy(Buffer.from(c.string_at(address, 4), "latin1")).value, -7);
    assert.equal(c.addressof(value), address);
  });

  it("test_nested_views", function () {
    class Shape extends c.Structure {
      static _fields_ = [
        ["id", c.c_int32],
        ["origin", Point],
        ["weights", c.ARRAY(c.c_double, 3)],
        ["flags", c.c_int32, 4],
      ];
    }
    const address = allocate(c.sizeof(Shape));
    const shape = Shape.from_address(address);
    shape.id = 42;
    const nested = shape.origin;
    nested.x = 5;
    shape.weights[2] = -1.25;
    shape.flags = 7;
    const copied = Shape.from_buffer_copy(Buffer.from(c.string_at(address, c.sizeof(Shape)), "latin1"));
    assert.deepEqual([copied.id, copied.origin.x, copied.weights[2], copied.flags], [42, 5, -1.25, 7]);
    const origin = Shape.fields.find((field) => field.name === "origin");
    assert.ok(origin, "the nested field must expose its byte offset");
    cmemset(address + BigInt(origin.offset), 1, c.sizeof(c.c_int32));
    assert.equal(nested.x, 0x01010101);
    assert.equal(c.addressof(nested), address + BigInt(origin.offset));
  });

  it("test_pointer_views", function () {
    const address = allocate(16);
    const p = c.cast(address, c.POINTER(c.c_int32));
    p[2] = 77;
    assert.equal(c.c_int32.from_address(address + 8n).value, 77);
    cmemset(address + 4n, 1, 4);
    assert.equal(p[1], 0x01010101);
    p.contents.value = 13;
    assert.equal(c.c_int32.from_address(address).value, 13);
    const point_pointer = c.cast(address, c.POINTER(Point));
    point_pointer.contents.y = 21;
    assert.equal(c.c_int32.from_address(address + 4n).value, 21);
    assert.equal(point_pointer[1].x, 77);
  });

  it("test_byref_uses_native_memory", function () {
    const address = allocate(c.sizeof(Point));
    const point = Point.from_address(address);
    const source = new Point(3, 4);
    cmemcpy(c.byref(point), c.byref(source), c.sizeof(Point));
    assert.deepEqual([point.x, point.y], [3, 4]);
    source.x = 30;
    cmemcpy(c.byref(point), c.byref(source), c.sizeof(Point));
    point.y = 40;
    const copy = new Point();
    cmemcpy(c.byref(copy), c.byref(point), c.sizeof(Point));
    assert.deepEqual([copy.x, copy.y], [30, 40]);
  });

  it("test_struct_by_value_uses_current_bytes", function () {
    const address = allocate(c.sizeof(Point));
    const point = Point.from_address(address);
    const source = new Point(-6, 7);
    cmemcpy(address, c.byref(source), c.sizeof(Point));
    const fn = fixture.fixture_point_sum;
    fn.argtypes = [Point];
    fn.restype = c.c_int32;
    assert.equal(fn(point), 1);
  });

  it("test_array_views", function () {
    const address = allocate(16);
    const values = c.ARRAY(c.c_uint8, 16).from_address(address);
    cmemset(address, 2, 4);
    assert.equal(values[3], 2);
    values[5] = 9;
    assert.equal(c.string_at(address, 16).charCodeAt(5), 9);
    assert.equal(c.addressof(values), address);
    c.memmove(values, Buffer.from([7, 7]), 2);
    assert.equal(c.string_at(address, 2), "\x07\x07");
  });
});
