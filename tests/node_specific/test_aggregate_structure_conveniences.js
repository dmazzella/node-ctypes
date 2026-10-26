// Functional definitions, object initializers, create() and toObject() are Node APIs.
import assert from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";

describe("Node functional aggregate and object conversion APIs", function () {
  it("should create and use simple struct", function () {
    const Point = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
    });

    const p = Point.create({ x: 10, y: 20 });
    assert.strictEqual(Point.get(p, "x"), 10);
    assert.strictEqual(Point.get(p, "y"), 20);

    Point.set(p, "x", 100);
    assert.strictEqual(Point.get(p, "x"), 100);
  });

  it("should have correct size and alignment", function () {
    const Point = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
    });

    assert.strictEqual(Point.size, 8);
  });

  it("should support nested structs with dot notation", function () {
    const Point = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
    });

    const Rectangle = ctypes.struct({
      topLeft: Point,
      bottomRight: Point,
      color: ctypes.c_uint32,
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

  it("should also support bitfield() helper function", function () {
    // Alternative syntax with bitfield() helper
    const Flags = ctypes.struct({
      enabled: ctypes.bitfield(ctypes.c_uint32, 1),
      mode: ctypes.bitfield(ctypes.c_uint32, 3),
    });

    const f = Flags.create({ enabled: 1, mode: 5 });

    assert.strictEqual(Flags.get(f, "enabled"), 1);
    assert.strictEqual(Flags.get(f, "mode"), 5);
  });

  it("should support nested anonymous structures", function () {
    const Coords = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
    });

    const Entity = ctypes.struct({
      id: ctypes.c_uint32,
      pos: { type: Coords, anonymous: true },
      health: ctypes.c_int32,
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

  it("should support packed structs", function () {
    const Unpacked = ctypes.struct({
      a: ctypes.c_uint8,
      b: ctypes.c_uint32,
      c: ctypes.c_uint8,
    });

    const Packed = ctypes.struct(
      {
        a: ctypes.c_uint8,
        b: ctypes.c_uint32,
        c: ctypes.c_uint8,
      },
      { packed: true },
    );

    // Unpacked has padding for alignment
    assert(Unpacked.size >= 6); // At least 1 + 4 + 1

    // Packed has no padding
    assert.strictEqual(Packed.size, 6); // Exactly 1 + 4 + 1
  });

  it("should support arrays in struct fields", function () {
    const IntArray10 = ctypes.array(ctypes.c_int32, 10);

    const Data = ctypes.struct({
      count: ctypes.c_int32,
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

  it("should convert struct to/from JavaScript object", function () {
    const Point = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
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
    const Inner = ctypes.struct({ a: ctypes.c_int32, b: ctypes.c_int32 });
    class OuterCls extends ctypes.Structure {
      static _fields_ = { inner: Inner, tag: ctypes.c_int32 };
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
        ["i", ctypes.c_int32],
        ["f", ctypes.c_float],
      ];
    }
    const u = UCls.create({ f: 2.5 });
    assert.ok(u.i !== undefined);
  });

  it("should handle 3-level nested structs", function () {
    const Point2D = ctypes.struct({ x: ctypes.c_int32, y: ctypes.c_int32 });
    const Point3D = ctypes.struct({ point2d: Point2D, z: ctypes.c_int32 });
    const BoundingBox = ctypes.struct({ min: Point3D, max: Point3D });

    const bbox = BoundingBox.create();
    bbox.min.point2d.x = 10;
    bbox.min.point2d.y = 20;
    bbox.min.z = 30;
    bbox.max.point2d.x = 100;
    bbox.max.point2d.y = 200;
    bbox.max.z = 300;

    assert.strictEqual(bbox.min.point2d.x, 10);
    assert.strictEqual(bbox.min.point2d.y, 20);
    assert.strictEqual(bbox.min.z, 30);
    assert.strictEqual(bbox.max.point2d.x, 100);
    assert.strictEqual(bbox.max.point2d.y, 200);
    assert.strictEqual(bbox.max.z, 300);
  });

  it("should calculate correct size for nested structs", function () {
    const Inner = ctypes.struct({ value: ctypes.c_int32 });
    const Middle = ctypes.struct({ inner: Inner, extra: ctypes.c_int32 });
    const Outer = ctypes.struct({ middle: Middle, final: ctypes.c_int32 });

    assert.strictEqual(ctypes.sizeof(Inner), 4);
    assert.strictEqual(ctypes.sizeof(Middle), 8);
    assert.strictEqual(ctypes.sizeof(Outer), 12);
  });

  it("should handle fixed-size byte arrays in structs", function () {
    const Point = ctypes.struct({
      x: ctypes.c_int32,
      y: ctypes.c_int32,
      reserved: ctypes.array(ctypes.c_uint8, 4),
    });

    const pt = Point.create();
    pt.x = 100;
    pt.y = 200;
    pt.reserved[0] = 1;
    pt.reserved[1] = 2;
    pt.reserved[2] = 3;
    pt.reserved[3] = 4;

    assert.strictEqual(pt.x, 100);
    assert.strictEqual(pt.y, 200);
    assert.strictEqual(pt.reserved[0], 1);
    assert.strictEqual(pt.reserved[1], 2);
    assert.strictEqual(pt.reserved[2], 3);
    assert.strictEqual(pt.reserved[3], 4);
  });

  it("should handle network packet structure", function () {
    const IPv4Address = ctypes.struct({ octets: ctypes.array(ctypes.c_uint8, 4) });
    const MACAddress = ctypes.struct({ bytes: ctypes.array(ctypes.c_uint8, 6) });
    const EthernetHeader = ctypes.struct({
      destination: MACAddress,
      source: MACAddress,
      etherType: ctypes.c_uint16,
    });
    const IPv4Header = ctypes.struct({
      versionAndHeaderLength: ctypes.c_uint8,
      typeOfService: ctypes.c_uint8,
      totalLength: ctypes.c_uint16,
      identification: ctypes.c_uint16,
      flagsAndFragmentOffset: ctypes.c_uint16,
      timeToLive: ctypes.c_uint8,
      protocol: ctypes.c_uint8,
      headerChecksum: ctypes.c_uint16,
      sourceAddress: IPv4Address,
      destinationAddress: IPv4Address,
    });
    const Packet = ctypes.struct({ ethernet: EthernetHeader, ipv4: IPv4Header });

    const packet = Packet.create();
    for (let i = 0; i < 6; i++) packet.ethernet.destination.bytes[i] = 0xff;
    packet.ethernet.source.bytes[0] = 0x00;
    packet.ethernet.source.bytes[1] = 0x11;
    packet.ethernet.source.bytes[2] = 0x22;
    packet.ethernet.source.bytes[3] = 0x33;
    packet.ethernet.source.bytes[4] = 0x44;
    packet.ethernet.source.bytes[5] = 0x55;
    packet.ethernet.etherType = 0x0800;
    packet.ipv4.versionAndHeaderLength = 0x45;
    packet.ipv4.typeOfService = 0;
    packet.ipv4.totalLength = 40;
    packet.ipv4.timeToLive = 64;
    packet.ipv4.protocol = 6;
    packet.ipv4.sourceAddress.octets[0] = 192;
    packet.ipv4.sourceAddress.octets[1] = 168;
    packet.ipv4.sourceAddress.octets[2] = 1;
    packet.ipv4.sourceAddress.octets[3] = 100;
    packet.ipv4.destinationAddress.octets[0] = 8;
    packet.ipv4.destinationAddress.octets[1] = 8;
    packet.ipv4.destinationAddress.octets[2] = 8;
    packet.ipv4.destinationAddress.octets[3] = 8;

    assert.strictEqual(packet.ethernet.destination.bytes[0], 0xff);
    assert.strictEqual(packet.ethernet.source.bytes[0], 0x00);
    assert.strictEqual(packet.ethernet.etherType, 0x0800);
    assert.strictEqual(packet.ipv4.versionAndHeaderLength, 0x45);
    assert.strictEqual(packet.ipv4.protocol, 6);
    assert.strictEqual(packet.ipv4.sourceAddress.octets[0], 192);
    assert.strictEqual(packet.ipv4.sourceAddress.octets[1], 168);
    assert.strictEqual(packet.ipv4.destinationAddress.octets[0], 8);
    assert.strictEqual(packet.ipv4.destinationAddress.octets[3], 8);
  });

  it("should handle alignment in nested structs", function () {
    const Inner = ctypes.struct({ byte1: ctypes.c_uint8, int1: ctypes.c_int32 });
    const Outer = ctypes.struct({
      byte2: ctypes.c_uint8,
      nested: Inner,
      byte3: ctypes.c_uint8,
    });

    assert.ok(ctypes.sizeof(Outer) > 0);
    assert.ok(ctypes.sizeof(Inner) > 0);

    const outer = Outer.create();
    outer.byte2 = 1;
    outer.nested.byte1 = 2;
    outer.nested.int1 = 12345;
    outer.byte3 = 3;

    assert.strictEqual(outer.byte2, 1);
    assert.strictEqual(outer.nested.byte1, 2);
    assert.strictEqual(outer.nested.int1, 12345);
    assert.strictEqual(outer.byte3, 3);
  });
});

describe("Node object-initialized aggregate instances", function () {
  it("should support bit fields with Python-style syntax", function () {
    // Python: _fields_ = [("enabled", c_uint32, 1), ("mode", c_uint32, 3), ...]
    class Flags extends ctypes.Structure {
      static _fields_ = [
        ["enabled", ctypes.c_uint32, 1],
        ["mode", ctypes.c_uint32, 3],
        ["priority", ctypes.c_uint32, 4],
        ["reserved", ctypes.c_uint32, 24],
      ];
    }

    const f = new Flags({ enabled: 1, mode: 5, priority: 15 });

    assert.strictEqual(f.enabled, 1);
    assert.strictEqual(f.mode, 5);
    assert.strictEqual(f.priority, 15);
  });

  it("should handle bit field overflow correctly", function () {
    // Python: _fields_ = [("value", c_uint32, 3)]
    class Flags extends ctypes.Structure {
      static _fields_ = [
        ["value", ctypes.c_uint32, 3], // Max 7 (0b111)
      ];
    }

    const f = new Flags({ value: 15 }); // 0b1111 - overflow
    assert.strictEqual(f.value, 7); // Truncated to 0b111
  });

  it("should support anonymous union fields", function () {
    // Python: class Inner(Union): _fields_ = [("i", c_int32), ("f", c_float)]
    class Inner extends ctypes.Union {
      static _fields_ = [
        ["i", ctypes.c_int32],
        ["f", ctypes.c_float],
      ];
    }

    // Python: class Outer(Structure): _fields_ = [("tag", c_uint32), ("data", Inner)]; _anonymous_ = ["data"]
    class Outer extends ctypes.Structure {
      static _fields_ = [
        ["tag", ctypes.c_uint32],
        ["data", Inner],
      ];
      static _anonymous_ = ["data"];
    }

    const obj = new Outer({ tag: 1, i: 42 });

    // Anonymous field members are promoted to parent level
    assert.strictEqual(obj.i, 42);
    assert.strictEqual(obj.tag, 1);
  });

  it("should resolve field reads inside custom methods via `this`", function () {
    class Point extends ctypes.Structure {
      static _fields_ = [
        ["x", ctypes.c_int32],
        ["y", ctypes.c_int32],
      ];
      mag2() {
        return this.x * this.x + this.y * this.y;
      }
      scaled(f) {
        return new Point({ x: this.x * f, y: this.y * f });
      }
    }
    const p = new Point({ x: 3, y: 4 });
    assert.strictEqual(p.mag2(), 25);
    const q = p.scaled(2);
    assert.strictEqual(q.x, 6);
    assert.strictEqual(q.y, 8);
  });
});
