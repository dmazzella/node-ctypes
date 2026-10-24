import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
import { _toNativeType } from "../../lib/core/types.js";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
const finalized = /finalized|finalised|frozen/i;

function point() {
  return new c.StructType().addField("x", c.CType.INT32).addField("y", c.CType.INT32);
}

function cannotGrow(type) {
  const size = type.getSize();
  const alignment = type.getAlignment();
  assert.throws(() => type.addField("late", c.CType.INT64), finalized);
  assert.equal(type.getSize(), size);
  assert.equal(type.getAlignment(), alignment);
}

describe("native descriptor finalization", function () {
  it("size/alignment queries leave a standalone builder open", function () {
    const type = new c.StructType();
    assert.equal(type.getSize(), 0);
    assert.equal(type.getAlignment(), 1);
    type.addField("x", c.CType.INT32);
    assert.equal(type.getSize(), 4);
    type.addField("y", c.CType.INT32);
    assert.equal(type.getSize(), 8);
  });

  for (const union of [false, true]) {
    it(`a ${union ? "union" : "struct"} field captures and finalizes its child`, function () {
      const child = point();
      const outer = new c.StructType({ union }).addField("value", child);
      cannotGrow(child);
      outer.addField("tail", c.CType.INT32);
      assert.equal(outer.getSize(), union ? 8 : 12);
      const value = outer.create({ value: { x: 1, y: 2 }, tail: 0 });
      cannotGrow(outer);
      assert.equal(value._buffer.length, outer.getSize());
    });
  }

  for (const count of [0, 1, 3]) {
    it(`an array of length ${count} captures its struct element layout`, function () {
      const element = point();
      const array = new c.ArrayType(element, count);
      cannotGrow(element);
      assert.equal(array.getSize(), count * 8);
      assert.equal(array.getAlignment(), 4);
      const values = array.create(Array.from({ length: count }, (_, i) => ({ x: i, y: i + 1 })));
      assert.equal(values.length, count * 8);
    });
  }

  it("invalid array construction does not consume a valid element builder", function () {
    const type = new c.StructType().addField("x", c.CType.INT32);
    assert.throws(() => new c.ArrayType(type, -1), RangeError);
    assert.throws(() => new c.ArrayType(type, 1.5), RangeError);
    type.addField("y", c.CType.INT32);
    assert.equal(type.getSize(), 8);
  });

  it("nested arrays freeze descendants without prematurely freezing the outer builder", function () {
    const element = point();
    const array = new c.ArrayType(element, 2);
    const child = new c.StructType().addField("items", { _native: array });
    const parent = new c.StructType().addField("child", child, { anonymous: true });
    cannotGrow(element);
    cannotGrow(child);
    parent.addField("tail", c.CType.INT32);
    assert.equal(parent.getSize(), 20);
    const value = parent.create({
      items: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      tail: 5,
    });
    cannotGrow(parent);
    assert.deepEqual([...value._buffer], [...Buffer.from(new Int32Array([1, 2, 3, 4, 5]).buffer)]);
  });

  for (const method of ["create", "read", "toObject-buffer", "toObject-instance"]) {
    it(`${method} finalizes the layout used by the native value`, function () {
      const type = point();
      const bytes = Buffer.from(new Int32Array([1, 2]).buffer);
      const value = method === "create" ? type.create({ x: 1, y: 2 }) : method === "read" ? type.read(bytes) : type.toObject(method === "toObject-buffer" ? bytes : { _buffer: bytes });
      cannotGrow(type);
      assert.equal(value.x, 1);
      assert.equal(value.y, 2);
    });
  }

  it("invalid native views are rejected before consuming an open builder", function () {
    const type = point();
    assert.throws(() => type.read(Buffer.alloc(4)), /small|size/i);
    assert.throws(() => type.toObject(Buffer.alloc(4)), /small|size/i);
    assert.throws(() => type.toObject({ _buffer: Buffer.alloc(4) }), /small|size/i);
    type.addField("z", c.CType.INT32);
    assert.equal(type.getSize(), 12);
  });

  it("a value getter cannot grow the layout while it is being materialized", function () {
    const type = point();
    const value = type.create({
      get x() {
        cannotGrow(type);
        return 1;
      },
      y: 2,
    });
    assert.equal(value.x, 1);
    assert.equal(value.y, 2);
  });

  it("an already finalized builder rejects mutations before reading new type/options getters", function () {
    const type = point();
    new c.ArrayType(type, 1);
    let touched = false;
    assert.throws(
      () =>
        type.addField(
          "late",
          {
            get _native() {
              touched = true;
              return new c.ArrayType(c.CType.INT32, 1);
            },
          },
          {
            get anonymous() {
              touched = true;
              return false;
            },
          },
        ),
      finalized,
    );
    assert.equal(touched, false);
  });

  it("a reentrant option getter cannot add a field after another consumer finalizes the type", function () {
    const type = point();
    assert.throws(
      () =>
        type.addField("late", c.CType.INT32, {
          get anonymous() {
            new c.ArrayType(type, 1);
            return false;
          },
        }),
      finalized,
    );
    assert.equal(type.getSize(), 8);
  });

  it("rejects direct by-value recursion without consuming the builder", function () {
    const type = new c.StructType();
    assert.throws(() => type.addField("self", type), /itself|recursive|recursion/i);
    type.addField("x", c.CType.INT32);
    assert.equal(type.getSize(), 4);
  });

  it("freezing a child prevents indirect by-value recursion", function () {
    const first = point();
    const second = new c.StructType().addField("first", first);
    assert.throws(() => first.addField("second", second), finalized);
    second.addField("tail", c.CType.INT32);
    assert.equal(second.getSize(), 12);
  });
});

describe("finalized ABI descriptors in prepared calls", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  it("function arguments keep a stable CIF and call plan after rejected mutations", async function () {
    const type = point();
    const fn = lib._lib.func("fixture_point_sum", c.CType.INT32, [type]);
    cannotGrow(type);
    for (let i = 0; i < 32; i++) assert.equal(fn.call({ x: i, y: i + 1 }), 2 * i + 1);
    assert.equal(await fn.callAsync({ x: 7, y: 8 }), 15);
  });

  it("function return layouts remain stable, including while async results are pending", async function () {
    const type = point();
    const fn = lib._lib.func("fixture_point_make", type, [c.CType.INT32, c.CType.INT32]);
    cannotGrow(type);
    const pending = fn.callAsync(3, 4);
    cannotGrow(type);
    assert.deepEqual(await pending, { x: 3, y: 4 });
    assert.deepEqual(fn.call(1, 2), { x: 1, y: 2 });
  });

  for (const threadSafe of [false, true]) {
    it(`${threadSafe ? "thread-safe" : "ordinary"} callback signatures freeze aggregate arguments`, async function () {
      const type = point();
      const make = threadSafe ? c.threadSafeCallback : c.callback;
      const callback = make((bytes) => bytes.readInt32LE(0) + bytes.readInt32LE(4), c.c_int32, [type]);
      try {
        cannotGrow(type);
        const invoke = lib.func("fixture_point_callback", c.c_int32, [c.c_void_p, c.c_int32, c.c_int32]);
        assert.equal(threadSafe ? await invoke.callAsync(callback, 3, 4) : invoke(callback, 3, 4), 7);
      } finally {
        callback.release();
      }
    });
  }

  it("variadic CIF cache entries retain immutable aggregate descriptors", function () {
    const type = point();
    const fn = lib._lib.func("fixture_point_sum_extra", c.CType.INT32, [type, c.CType.INT32]);
    cannotGrow(type);
    for (let count = 0; count < 20; count++) {
      assert.equal(fn.call({ x: 1, y: 2 }, count, ...Array(count).fill(2)), 3 + 2 * count);
    }
  });

  it("native array and nested layout sizes agree with a live by-value call", function () {
    const element = point();
    const array = new c.ArrayType(element, 2);
    const type = new c.StructType().addField("count", c.CType.INT32).addField("points", array);
    const fn = lib._lib.func("fixture_polyline_last_y", c.CType.INT32, [type]);
    cannotGrow(element);
    cannotGrow(type);
    assert.equal(type.getSize(), 20);
    assert.equal(array.getSize(), 16);
    assert.equal(
      fn.call({
        count: 2,
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      }),
      4,
    );
  });

  it("native union arguments and returns keep their merged ABI class", function () {
    const type = new c.StructType({ union: true }).addField("d", c.CType.DOUBLE).addField("i", c.CType.INT64);
    const make = lib._lib.func("fixture_number_from_bits", type, [c.CType.INT64]);
    const bits = lib._lib.func("fixture_number_bits", c.CType.INT64, [type]);
    cannotGrow(type);
    const value = make.call(0x102030405060708n);
    assert.equal(value.i, 0x102030405060708n);
    assert.equal(bits.call({ i: 0x102030405060708n }), 0x102030405060708n);
  });

  it("minimum alignment and memory-class markers remain valid after finalization", function () {
    const aligned = new c.StructType({ alignment: 16 }).addField("a", c.CType.UINT8).addField("b", c.CType.UINT32);
    const fn = lib._lib.func("fixture_aligned_sum", c.CType.UINT32, [aligned]);
    cannotGrow(aligned);
    assert.equal(aligned.getSize(), 16);
    assert.equal(aligned.getAlignment(), 16);
    assert.equal(fn.call({ a: 2, b: 7 }), 2007);
  });

  it("generated packed/bitfield descriptors are sealed without disrupting their builders", function () {
    class Packed extends c.Structure {
      static _pack_ = 1;
      static _fields_ = [
        ["a", c.c_uint8],
        ["b", c.c_uint32],
        ["c", c.c_double],
        ["d", c.c_uint16],
      ];
    }
    class Bits extends c.Structure {
      static _fields_ = [
        ["a", c.c_uint8, 3],
        ["b", c.c_uint32, 5],
        ["tail", c.c_uint8],
      ];
    }
    const sum = lib.func("fixture_packed_sum", c.c_double, [Packed]);
    const bits = lib.func("fixture_bits_sum", c.c_uint32, [Bits]);
    cannotGrow(_toNativeType(Packed, c));
    cannotGrow(_toNativeType(Bits, c));
    assert.equal(sum(new Packed(1, 2, 3.5, 4)), 10.5);
    assert.equal(bits(new Bits(5, 17, 66)), 51766);
  });
});
