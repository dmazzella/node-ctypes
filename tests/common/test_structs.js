/**
 * Test Structs and Unions - Cross Platform
 * Tests struct/union creation, nested structs, bit fields, anonymous fields
 */

import assert, { strictEqual, throws } from "node:assert";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

describe("Structs and Unions", function () {
  describe("Basic Struct", function () {
    it("should create and use simple struct", function () {
      const Point = ctypes.struct({
        x: "int32",
        y: "int32",
      });

      const p = Point.create({ x: 10, y: 20 });
      assert.strictEqual(Point.get(p, "x"), 10);
      assert.strictEqual(Point.get(p, "y"), 20);

      Point.set(p, "x", 100);
      assert.strictEqual(Point.get(p, "x"), 100);
    });

    it("should have correct size and alignment", function () {
      const Point = ctypes.struct({
        x: "int32",
        y: "int32",
      });

      assert.strictEqual(Point.size, 8);
    });
  });

  describe("Nested Structs", function () {
    it("should support nested structs with dot notation", function () {
      const Point = ctypes.struct({
        x: "int32",
        y: "int32",
      });

      const Rectangle = ctypes.struct({
        topLeft: Point,
        bottomRight: Point,
        color: "uint32",
      });

      const rect = Rectangle.create({
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
        color: 0xff0000,
      });

      assert.strictEqual(Rectangle.get(rect, "topLeft.x"), 0);
      assert.strictEqual(Rectangle.get(rect, "topLeft.y"), 0);
      assert.strictEqual(Rectangle.get(rect, "bottomRight.x"), 100);
      assert.strictEqual(Rectangle.get(rect, "bottomRight.y"), 200);
      assert.strictEqual(Rectangle.get(rect, "color"), 0xff0000);
    });
  });

  describe("Unions", function () {
    it("should create and use unions", function () {
      const IntOrFloat = ctypes.union({
        i: "int32",
        f: "float",
      });

      const u = IntOrFloat.create();
      IntOrFloat.set(u, "f", 3.14159);

      // Union shares memory - reading as int gives bit pattern
      const asInt = IntOrFloat.get(u, "i");
      assert(typeof asInt === "number");

      // Reading back as float gives original value
      const asFloat = IntOrFloat.get(u, "f");
      assert(Math.abs(asFloat - 3.14159) < 0.00001);
    });

    it("should have size of largest member", function () {
      const IntOrDouble = ctypes.union({
        i: "int32", // 4 bytes
        d: "double", // 8 bytes
      });

      assert.strictEqual(IntOrDouble.size, 8);
    });
  });

  describe("Bit Fields", function () {
    it("should support bit fields", function () {
      const Flags = ctypes.struct({
        enabled: ctypes.bitfield("uint32", 1),
        mode: ctypes.bitfield("uint32", 3),
        priority: ctypes.bitfield("uint32", 4),
        reserved: ctypes.bitfield("uint32", 24),
      });

      const f = Flags.create({
        enabled: 1,
        mode: 5,
        priority: 15,
      });

      assert.strictEqual(Flags.get(f, "enabled"), 1);
      assert.strictEqual(Flags.get(f, "mode"), 5);
      assert.strictEqual(Flags.get(f, "priority"), 15);
    });

    it("should handle bit field overflow correctly", function () {
      const Flags = ctypes.struct({
        value: ctypes.bitfield("uint32", 3), // Max 7 (0b111)
      });

      const f = Flags.create({ value: 15 }); // 0b1111 - overflow
      assert.strictEqual(Flags.get(f, "value"), 7); // Truncated to 0b111
    });
  });

  describe("Anonymous Fields", function () {
    it("should support anonymous union fields", function () {
      const Inner = ctypes.union({
        i: "int32",
        f: "float",
      });

      const Outer = ctypes.struct({
        tag: "uint32",
        data: { type: Inner, anonymous: true },
      });

      const obj = Outer.create({ tag: 1, i: 42 });

      // Anonymous field members are promoted to parent level
      assert.strictEqual(Outer.get(obj, "i"), 42);
      assert.strictEqual(Outer.get(obj, "tag"), 1);
    });

    it("should support nested anonymous structures", function () {
      const Coords = ctypes.struct({
        x: "int32",
        y: "int32",
      });

      const Entity = ctypes.struct({
        id: "uint32",
        pos: { type: Coords, anonymous: true },
        health: "int32",
      });

      const ent = Entity.create({
        id: 1,
        x: 100,
        y: 200,
        health: 100,
      });

      assert.strictEqual(Entity.get(ent, "id"), 1);
      assert.strictEqual(Entity.get(ent, "x"), 100); // From anonymous Coords
      assert.strictEqual(Entity.get(ent, "y"), 200); // From anonymous Coords
      assert.strictEqual(Entity.get(ent, "health"), 100);
    });
  });

  describe("Packed Structs", function () {
    it("should support packed structs", function () {
      const Unpacked = ctypes.struct({
        a: "uint8",
        b: "uint32",
        c: "uint8",
      });

      const Packed = ctypes.struct(
        {
          a: "uint8",
          b: "uint32",
          c: "uint8",
        },
        { packed: true },
      );

      // Unpacked has padding for alignment
      assert(Unpacked.size >= 6); // At least 1 + 4 + 1

      // Packed has no padding
      assert.strictEqual(Packed.size, 6); // Exactly 1 + 4 + 1
    });
  });

  describe("Struct Arrays", function () {
    it("should support arrays in struct fields", function () {
      const IntArray10 = ctypes.array("int32", 10);

      const Data = ctypes.struct({
        count: "int32",
        values: IntArray10,
      });

      const data = Data.create({
        count: 3,
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      });

      assert.strictEqual(Data.get(data, "count"), 3);

      // Access array field
      const values = Data.get(data, "values");
      assert.strictEqual(values[0], 1);
      assert.strictEqual(values[9], 10);
    });
  });

  describe("toObject() and fromObject()", function () {
    it("should convert struct to/from JavaScript object", function () {
      const Point = ctypes.struct({
        x: "int32",
        y: "int32",
      });

      const Rectangle = ctypes.struct({
        topLeft: Point,
        bottomRight: Point,
      });

      const rect = Rectangle.create({
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
      });

      const obj = Rectangle.toObject(rect);
      assert.deepStrictEqual(obj, {
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
      });
    });
  });

  describe("Subclassing compatibility", function () {
    it("should support class extends Structure with positional args and properties", function () {
      class PointCls extends ctypes.Structure {
        static _fields_ = [
          ["x", ctypes.c_int],
          ["y", ctypes.c_int],
        ];
      }

      const p = new PointCls(10, 20);
      assert.strictEqual(p.x, 10);
      assert.strictEqual(p.y, 20);

      const p2 = PointCls.create({ x: 1, y: 2 });
      assert.ok(p2 instanceof PointCls);
      assert.strictEqual(p2.x, 1);
    });

    it("should support anonymous nested fields via static _anonymous_", function () {
      const Inner = ctypes.struct({ a: "int32", b: "int32" });
      class OuterCls extends ctypes.Structure {
        static _fields_ = { inner: Inner, tag: "int32" };
        static _anonymous_ = ["inner"];
      }

      const o = new OuterCls({ a: 5, b: 6, tag: 9 });
      assert.strictEqual(o.a, 5);
      assert.strictEqual(o.b, 6);
      assert.strictEqual(o.tag, 9);
    });

    it("should support Union subclassing", function () {
      class UCls extends ctypes.Union {
        static _fields_ = [
          ["i", "int32"],
          ["f", "float"],
        ];
      }
      const u = UCls.create({ f: 2.5 });
      assert.ok(u.i !== undefined);
    });
  });
});
