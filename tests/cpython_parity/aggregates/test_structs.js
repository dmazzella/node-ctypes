import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARRAY,
  Structure,
  Union,
  BigEndianStructure,
  LittleEndianStructure,
  BigEndianUnion,
  LittleEndianUnion,
  POINTER,
  pointer,
  addressof,
  string_at,
  sizeof,
  c_void_p,
  c_int8,
  c_uint8,
  c_int16,
  c_uint16,
  c_int32,
  c_uint32,
  c_int64,
  c_float,
  c_double,
} from "node-ctypes";

describe("TestStructsAndUnions", function () {
  it("test_basic_struct", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    const p = new Point(10, 20);
    assert.equal(p.x, 10);
    assert.equal(p.y, 20);
    p.x = 100;
    assert.equal(p.x, 100);
  });

  it("test_struct_size_and_alignment", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    assert.equal(sizeof(Point), 8);
  });

  it("test_nested_structs", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Rectangle extends Structure {
      static _fields_ = [
        ["topLeft", Point],
        ["bottomRight", Point],
        ["color", c_uint32],
      ];
    }
    const rect = new Rectangle();
    rect.topLeft.x = 0;
    rect.topLeft.y = 0;
    rect.bottomRight.x = 100;
    rect.bottomRight.y = 200;
    rect.color = 0xff0000;
    assert.equal(rect.topLeft.x, 0);
    assert.equal(rect.topLeft.y, 0);
    assert.equal(rect.bottomRight.x, 100);
    assert.equal(rect.bottomRight.y, 200);
    assert.equal(rect.color, 0xff0000);
  });

  it("test_union", function () {
    class IntOrFloat extends Union {
      static _fields_ = [
        ["i", c_int32],
        ["f", c_float],
      ];
    }
    const u = new IntOrFloat();
    u.f = 3.14159;
    assert.equal(typeof u.i, "number");
    assert.ok(Math.abs(u.f - 3.14159) < 0.00001);
  });

  it("test_union_size", function () {
    class IntOrDouble extends Union {
      static _fields_ = [
        ["i", c_int32],
        ["d", c_double],
      ];
    }
    assert.equal(sizeof(IntOrDouble), 8);
  });

  it("test_bit_fields", function () {
    class Flags extends Structure {
      static _fields_ = [
        ["enabled", c_uint32, 1],
        ["mode", c_uint32, 3],
        ["priority", c_uint32, 4],
        ["reserved", c_uint32, 24],
      ];
    }
    const f = new Flags();
    f.enabled = 1;
    f.mode = 5;
    f.priority = 15;
    assert.equal(f.enabled, 1);
    assert.equal(f.mode, 5);
    assert.equal(f.priority, 15);
  });

  it("test_bit_field_overflow", function () {
    class Flags extends Structure {
      static _fields_ = [["value", c_uint32, 3]];
    }
    const f = new Flags();
    f.value = 15;
    assert.equal(f.value, 7);
  });

  it("test_anonymous_union_fields", function () {
    class Inner extends Union {
      static _fields_ = [
        ["i", c_int32],
        ["f", c_float],
      ];
    }
    class Outer extends Structure {
      static _anonymous_ = ["data"];
      static _fields_ = [
        ["tag", c_uint32],
        ["data", Inner],
      ];
    }
    const obj = new Outer();
    obj.tag = 1;
    obj.i = 42;
    assert.equal(obj.i, 42);
    assert.equal(obj.tag, 1);
  });

  it("test_nested_anonymous_structures", function () {
    class Coords extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Entity extends Structure {
      static _anonymous_ = ["pos"];
      static _fields_ = [
        ["id", c_uint32],
        ["pos", Coords],
        ["health", c_int32],
      ];
    }
    const ent = new Entity();
    ent.id = 1;
    ent.x = 100;
    ent.y = 200;
    ent.health = 100;
    assert.equal(ent.id, 1);
    assert.equal(ent.x, 100);
    assert.equal(ent.y, 200);
    assert.equal(ent.health, 100);
  });

  it("test_packed_structs", function () {
    class Unpacked extends Structure {
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
        ["c", c_uint8],
      ];
    }
    class Packed extends Structure {
      static _layout_ = "ms";
      static _pack_ = 1;
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
        ["c", c_uint8],
      ];
    }
    assert.ok(sizeof(Unpacked) >= 6);
    assert.equal(sizeof(Packed), 6);
  });

  it("test_struct_with_arrays", function () {
    class Data extends Structure {
      static _fields_ = [
        ["count", c_int32],
        ["values", ARRAY(c_int32, 10)],
      ];
    }
    const data = new Data();
    data.count = 3;
    data.values[0] = 1;
    data.values[9] = 10;
    assert.equal(data.count, 3);
    assert.equal(data.values[0], 1);
    assert.equal(data.values[9], 10);
  });

  it("test_union_bit_fields", function () {
    class Flags extends Union {
      static _fields_ = [
        ["low", c_uint32, 16],
        ["high", c_uint32, 16],
      ];
    }
    const f = new Flags();
    f.low = 0xabcd;
    assert.equal(f.low, 0xabcd);
    f.high = 0x1234;
    assert.equal(f.high, 0x1234);
  });

  it("test_numeric_pack", function () {
    for (const [pack, expected] of [
      [1, 5],
      [2, 6],
      [4, 8],
    ]) {
      class Packed extends Structure {
        static _layout_ = "ms";
        static _pack_ = pack;
        static _fields_ = [
          ["a", c_uint8],
          ["b", c_uint32],
        ];
      }
      assert.equal(sizeof(Packed), expected);
    }
    class Unpacked extends Structure {
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
      ];
    }
    assert.equal(sizeof(Unpacked), 8);
  });

  it("test_invalid_pack", function () {
    assert.throws(() => {
      class Bad extends Structure {
        static _pack_ = -1;
        static _fields_ = [["a", c_uint8]];
      }
      sizeof(Bad);
    }, /_pack_/);
  });

  it("test_nested_pack_alignment", function () {
    class Inner extends Structure {
      static _layout_ = "ms";
      static _pack_ = 4;
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
      ];
    }
    assert.equal(sizeof(Inner), 8);
    for (const [pack, expected] of [
      [1, 9],
      [2, 10],
    ]) {
      class Outer extends Structure {
        static _layout_ = "ms";
        static _pack_ = pack;
        static _fields_ = [
          ["i", c_uint8],
          ["n", Inner],
        ];
      }
      assert.equal(sizeof(Outer), expected);
    }
    class OuterN extends Structure {
      static _fields_ = [
        ["i", c_uint8],
        ["n", Inner],
      ];
    }
    assert.equal(sizeof(OuterN), 12);
  });
});

describe("TestPOINTERInStructFields", function () {
  it("test_pointer_field_null", function () {
    class S extends Structure {
      static _fields_ = [["pData", POINTER(c_int32)]];
    }
    const s = new S();
    assert.equal(s.pData, null);
  });

  it("test_pointer_field_struct_size", function () {
    class S extends Structure {
      static _fields_ = [
        ["value", c_int32],
        ["pData", POINTER(c_int32)],
      ];
    }
    const ptr_size = sizeof(c_void_p);
    const expected = ptr_size === 8 ? 16 : 8;
    assert.equal(sizeof(S), expected);
  });

  it("test_pointer_field_assign_via_pointer", function () {
    class S extends Structure {
      static _fields_ = [["pData", POINTER(c_int32)]];
    }
    const val = new c_int32(999);
    const s = new S();
    s.pData = pointer(val);
    assert.equal(s.pData[0], 999);
  });

  it("test_pointer_field_contents", function () {
    class S extends Structure {
      static _fields_ = [["pData", POINTER(c_int32)]];
    }
    const val = new c_int32(42);
    const s = new S();
    s.pData = pointer(val);
    assert.equal(s.pData.contents.value, 42);
  });

  it("test_pointer_field_modify_through_pointer", function () {
    class S extends Structure {
      static _fields_ = [["pData", POINTER(c_int32)]];
    }
    const val = new c_int32(10);
    const s = new S();
    s.pData = pointer(val);
    s.pData[0] = 99;
    assert.equal(val.value, 99);
  });

  it("test_multiple_pointer_fields", function () {
    class S extends Structure {
      static _fields_ = [
        ["pInt", POINTER(c_int32)],
        ["pDbl", POINTER(c_double)],
      ];
    }
    const iv = new c_int32(10);
    const dv = new c_double(3.14);
    const s = new S();
    s.pInt = pointer(iv);
    s.pDbl = pointer(dv);
    assert.equal(s.pInt[0], 10);
    assert.ok(Math.abs(s.pDbl[0] - 3.14) < 0.01);
  });

  it("test_pointer_field_with_struct_pointer", function () {
    class Inner extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Outer extends Structure {
      static _fields_ = [["pInner", POINTER(Inner)]];
    }
    const inner = new Inner(100, 200);
    const outer = new Outer();
    outer.pInner = pointer(inner);
    assert.equal(outer.pInner.contents.x, 100);
    assert.equal(outer.pInner.contents.y, 200);
  });
});

describe("TestPOINTERInUnionFields", function () {
  it("test_pointer_field_in_union", function () {
    class U extends Union {
      static _fields_ = [
        ["asInt", c_uint32],
        ["asPtr", POINTER(c_int32)],
      ];
    }
    const u = new U();
    assert.equal(u.asPtr, null);
    const expected = sizeof(c_void_p) === 8 ? 8 : 4;
    assert.equal(sizeof(U), expected);
  });
});

describe("TestStructureSubclassMethods", function () {
  it("test_custom_method_reads_fields_via_self", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
      mag2() {
        return this.x * this.x + this.y * this.y;
      }
      scaled(f) {
        return new Point(this.x * f, this.y * f);
      }
    }
    const p = new Point(3, 4);
    assert.equal(p.mag2(), 25);
    const q = p.scaled(2);
    assert.equal(q.x, 6);
    assert.equal(q.y, 8);
  });
});

describe("TestBigEndianStructure", function () {
  it("test_scalar_fields_in_big_endian_order", function () {
    class H extends BigEndianStructure {
      static _fields_ = [
        ["magic", c_uint32],
        ["version", c_uint16],
        ["flags", c_uint8],
      ];
    }
    const h = new H();
    h.magic = 0x12345678;
    h.version = 0x0102;
    h.flags = 0xab;
    const raw = Buffer.from(string_at(addressof(h), sizeof(h)), "latin1");
    assert.equal(raw[0], 0x12);
    assert.equal(raw[1], 0x34);
    assert.equal(raw[2], 0x56);
    assert.equal(raw[3], 0x78);
    assert.equal(raw[4], 0x01);
    assert.equal(raw[5], 0x02);
    assert.equal(raw[6], 0xab);
    assert.equal(h.magic, 0x12345678);
    assert.equal(h.version, 0x0102);
    assert.equal(h.flags, 0xab);
  });

  it("test_float_and_double_in_be", function () {
    class F extends BigEndianStructure {
      static _fields_ = [
        ["f", c_float],
        ["d", c_double],
      ];
    }
    const f = new F();
    f.f = 3.14;
    f.d = 2.7182818284590451;
    assert.ok(Math.abs(f.f - 3.14) < 0.00001);
    assert.ok(Math.abs(f.d - 2.7182818284590451) < 1e-15);
    assert.equal(Buffer.from(string_at(addressof(f), sizeof(f)), "latin1")[0], 0x40);
  });

  it("test_int64_be", function () {
    class Q extends BigEndianStructure {
      static _fields_ = [["n", c_int64]];
    }
    const q = new Q();
    q.n = 0x0102030405060708n;
    const raw = Buffer.from(string_at(addressof(q), sizeof(q)), "latin1");
    assert.equal(raw[0], 0x01);
    assert.equal(raw[7], 0x08);
    assert.equal(q.n, 0x0102030405060708n);
  });

  it("test_nested_le_inside_be_keeps_le", function () {
    class InnerLE extends Structure {
      static _fields_ = [["x", c_uint32]];
    }
    class OuterBE extends BigEndianStructure {
      static _fields_ = [
        ["hdr", c_uint16],
        ["inner", InnerLE],
      ];
    }
    const o = new OuterBE();
    o.hdr = 0x1234;
    o.inner.x = 0xaabbccdd;
    const raw = Buffer.from(string_at(addressof(o), sizeof(o)), "latin1");
    assert.equal(raw[0], 0x12);
    assert.equal(raw[1], 0x34);
    assert.equal(raw[2], 0x00);
    assert.equal(raw[3], 0x00);
    assert.equal(raw[4], 0xdd);
    assert.equal(raw[5], 0xcc);
    assert.equal(raw[6], 0xbb);
    assert.equal(raw[7], 0xaa);
    assert.equal(o.hdr, 0x1234);
    assert.equal(o.inner.x, 0xaabbccdd);
  });

  it("test_nested_be_inside_be_is_be", function () {
    class InnerBE extends BigEndianStructure {
      static _fields_ = [["x", c_uint32]];
    }
    class OuterBE extends BigEndianStructure {
      static _fields_ = [["inner", InnerBE]];
    }
    const o = new OuterBE();
    o.inner.x = 0xaabbccdd;
    const raw = Buffer.from(string_at(addressof(o), sizeof(o)), "latin1");
    assert.equal(raw[0], 0xaa);
    assert.equal(raw[1], 0xbb);
    assert.equal(raw[2], 0xcc);
    assert.equal(raw[3], 0xdd);
    assert.equal(o.inner.x, 0xaabbccdd);
  });

  it("test_one_byte_fields_unaffected", function () {
    class B extends BigEndianStructure {
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint8],
      ];
    }
    const b = new B();
    b.a = 0xab;
    b.b = 0xcd;
    const raw = Buffer.from(string_at(addressof(b), sizeof(b)), "latin1");
    assert.equal(raw[0], 0xab);
    assert.equal(raw[1], 0xcd);
  });
});

describe("TestLittleEndianStructure", function () {
  it("test_matches_native_on_le_host", function () {
    class L extends LittleEndianStructure {
      static _fields_ = [["magic", c_uint32]];
    }
    const l = new L();
    l.magic = 0x12345678;
    const raw = Buffer.from(string_at(addressof(l), sizeof(l)), "latin1");
    assert.equal(raw[0], 0x78);
    assert.equal(raw[3], 0x12);
  });
});

describe("TestBigEndianUnion", function () {
  it("test_be_union_primitive", function () {
    class V extends BigEndianUnion {
      static _fields_ = [
        ["i", c_uint32],
        ["bytes", ARRAY(c_uint8, 4)],
      ];
    }
    const v = new V();
    v.i = 0x12345678;
    const raw = Buffer.from(string_at(addressof(v), sizeof(v)), "latin1");
    assert.equal(raw[0], 0x12);
    assert.equal(raw[3], 0x78);
    assert.equal(v.i, 0x12345678);
    assert.equal(v.bytes[0], 0x12);
  });
});

describe("TestComplexNestedStructures", function () {
  it("test_multi_level_nesting", function () {
    class Point2D extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Point3D extends Structure {
      static _fields_ = [
        ["point2d", Point2D],
        ["z", c_int32],
      ];
    }
    class BoundingBox extends Structure {
      static _fields_ = [
        ["min", Point3D],
        ["max", Point3D],
      ];
    }
    const bbox = new BoundingBox();
    bbox.min.point2d.x = 10;
    bbox.min.point2d.y = 20;
    bbox.min.z = 30;
    bbox.max.point2d.x = 100;
    bbox.max.point2d.y = 200;
    bbox.max.z = 300;
    assert.equal(bbox.min.point2d.x, 10);
    assert.equal(bbox.min.point2d.y, 20);
    assert.equal(bbox.min.z, 30);
    assert.equal(bbox.max.point2d.x, 100);
    assert.equal(bbox.max.point2d.y, 200);
    assert.equal(bbox.max.z, 300);
  });

  it("test_correct_size_for_nested_structs", function () {
    class Inner extends Structure {
      static _fields_ = [["value", c_int32]];
    }
    class Middle extends Structure {
      static _fields_ = [
        ["inner", Inner],
        ["extra", c_int32],
      ];
    }
    class Outer extends Structure {
      static _fields_ = [
        ["middle", Middle],
        ["final", c_int32],
      ];
    }
    assert.equal(sizeof(Inner), 4);
    assert.equal(sizeof(Middle), 8);
    assert.equal(sizeof(Outer), 12);
  });

  it("test_array_of_structs_within_struct", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Polygon extends Structure {
      static _fields_ = [
        ["vertices", ARRAY(Point, 4)],
        ["count", c_int32],
      ];
    }
    const poly = new Polygon();
    poly.vertices[0].x = 0;
    poly.vertices[0].y = 0;
    poly.vertices[1].x = 100;
    poly.vertices[1].y = 0;
    poly.vertices[2].x = 100;
    poly.vertices[2].y = 100;
    poly.vertices[3].x = 0;
    poly.vertices[3].y = 100;
    poly.count = 4;
    assert.equal(poly.vertices[1].x, 100);
    assert.equal(poly.vertices[2].y, 100);
    assert.equal(poly.count, 4);
  });

  it("test_union_nested_in_struct", function () {
    class Value extends Union {
      static _fields_ = [
        ["asInt", c_int32],
        ["asBytes", ARRAY(c_uint8, 4)],
      ];
    }
    class Tagged extends Structure {
      static _fields_ = [
        ["tag", c_uint16],
        ["value", Value],
      ];
    }
    const tagged = new Tagged();
    tagged.tag = 1;
    tagged.value.asInt = 0x12345678;
    assert.equal(tagged.tag, 1);
    assert.equal(tagged.value.asInt, 0x12345678);
    assert.equal(tagged.value.asBytes[0], 0x78);
    assert.equal(tagged.value.asBytes[1], 0x56);
    assert.equal(tagged.value.asBytes[2], 0x34);
    assert.equal(tagged.value.asBytes[3], 0x12);
  });

  it("test_network_packet_structure", function () {
    class IPv4Address extends Structure {
      static _fields_ = [["octets", ARRAY(c_uint8, 4)]];
    }
    class MACAddress extends Structure {
      static _fields_ = [["bytes", ARRAY(c_uint8, 6)]];
    }
    class EthernetHeader extends Structure {
      static _fields_ = [
        ["destination", MACAddress],
        ["source", MACAddress],
        ["etherType", c_uint16],
      ];
    }
    class IPv4Header extends Structure {
      static _fields_ = [
        ["versionAndHeaderLength", c_uint8],
        ["typeOfService", c_uint8],
        ["totalLength", c_uint16],
        ["identification", c_uint16],
        ["flagsAndFragmentOffset", c_uint16],
        ["timeToLive", c_uint8],
        ["protocol", c_uint8],
        ["headerChecksum", c_uint16],
        ["sourceAddress", IPv4Address],
        ["destinationAddress", IPv4Address],
      ];
    }
    class Packet extends Structure {
      static _fields_ = [
        ["ethernet", EthernetHeader],
        ["ipv4", IPv4Header],
      ];
    }
    const packet = new Packet();
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
    assert.equal(packet.ethernet.destination.bytes[0], 0xff);
    assert.equal(packet.ethernet.source.bytes[0], 0x00);
    assert.equal(packet.ethernet.etherType, 0x0800);
    assert.equal(packet.ipv4.versionAndHeaderLength, 0x45);
    assert.equal(packet.ipv4.protocol, 6);
    assert.equal(packet.ipv4.sourceAddress.octets[0], 192);
    assert.equal(packet.ipv4.sourceAddress.octets[1], 168);
    assert.equal(packet.ipv4.destinationAddress.octets[0], 8);
    assert.equal(packet.ipv4.destinationAddress.octets[3], 8);
  });

  it("test_alignment_in_nested_structs", function () {
    class Inner extends Structure {
      static _fields_ = [
        ["byte1", c_uint8],
        ["int1", c_int32],
      ];
    }
    class Outer extends Structure {
      static _fields_ = [
        ["byte2", c_uint8],
        ["nested", Inner],
        ["byte3", c_uint8],
      ];
    }
    assert.ok(sizeof(Outer) > 0);
    assert.ok(sizeof(Inner) > 0);
    const outer = new Outer();
    outer.byte2 = 1;
    outer.nested.byte1 = 2;
    outer.nested.int1 = 12345;
    outer.byte3 = 3;
    assert.equal(outer.byte2, 1);
    assert.equal(outer.nested.byte1, 2);
    assert.equal(outer.nested.int1, 12345);
    assert.equal(outer.byte3, 3);
  });

  it("test_fixed_size_byte_arrays", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
        ["reserved", ARRAY(c_uint8, 4)],
      ];
    }
    const pt = new Point();
    pt.x = 100;
    pt.y = 200;
    pt.reserved[0] = 1;
    pt.reserved[1] = 2;
    pt.reserved[2] = 3;
    pt.reserved[3] = 4;
    assert.equal(pt.x, 100);
    assert.equal(pt.y, 200);
    assert.deepEqual(Array.from(pt.reserved), [1, 2, 3, 4]);
  });

  it("test_union_with_nested_struct", function () {
    class RGB extends Structure {
      static _fields_ = [
        ["r", c_uint8],
        ["g", c_uint8],
        ["b", c_uint8],
        ["a", c_uint8],
      ];
    }
    class Color extends Union {
      static _fields_ = [
        ["rgb", RGB],
        ["value", c_int32],
      ];
    }
    class Pixel extends Structure {
      static _fields_ = [
        ["x", c_uint16],
        ["y", c_uint16],
        ["color", Color],
      ];
    }
    const pixel = new Pixel();
    pixel.x = 10;
    pixel.y = 20;
    pixel.color.rgb.r = 255;
    pixel.color.rgb.g = 0;
    pixel.color.rgb.b = 0;
    pixel.color.rgb.a = 255;
    assert.equal(pixel.x, 10);
    assert.equal(pixel.y, 20);
    assert.equal(pixel.color.rgb.r, 255);
    assert.equal(pixel.color.rgb.g, 0);
    assert.equal(pixel.color.rgb.b, 0);
    assert.equal(pixel.color.rgb.a, 255);
  });

  it("test_count_before_array_of_structs", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Polygon extends Structure {
      static _fields_ = [
        ["count", c_int32],
        ["vertices", ARRAY(Point, 4)],
      ];
    }
    const poly = new Polygon();
    poly.count = 4;
    poly.vertices[0].x = 0;
    poly.vertices[0].y = 0;
    poly.vertices[1].x = 10;
    poly.vertices[1].y = 0;
    poly.vertices[2].x = 10;
    poly.vertices[2].y = 10;
    poly.vertices[3].x = 0;
    poly.vertices[3].y = 10;
    assert.equal(poly.count, 4);
    assert.equal(poly.vertices[0].x, 0);
    assert.equal(poly.vertices[1].x, 10);
    assert.equal(poly.vertices[2].y, 10);
    assert.equal(poly.vertices[3].y, 10);
    assert.equal(sizeof(Polygon), 4 + 4 * sizeof(Point));
  });
});

describe("TestSignedBitfields", function () {
  it("test_c_int8_bitfield_roundtrip_negative", function () {
    class B extends Structure {
      static _fields_ = [
        ["a", c_int8, 3],
        ["b", c_int8, 5],
      ];
    }
    const s = new B();
    for (const v of [-4, -1, 0, 1, 3]) {
      s.a = v;
      assert.equal(s.a, v);
    }
    for (const v of [-16, -1, 0, 1, 15]) {
      s.b = v;
      assert.equal(s.b, v);
    }
  });

  it("test_c_int16_bitfield_roundtrip", function () {
    class B extends Structure {
      static _fields_ = [["a", c_int16, 7]];
    }
    const s = new B();
    for (const v of [-64, -1, 0, 1, 63]) {
      s.a = v;
      assert.equal(s.a, v);
    }
  });

  it("test_c_int32_bitfield_roundtrip_large_signed", function () {
    class B extends Structure {
      static _fields_ = [["a", c_int32, 30]];
    }
    const s = new B();
    const mx = 2 ** 29 - 1;
    const mn = -(2 ** 29);
    for (const v of [mn, -1, 0, 1, mx]) {
      s.a = v;
      assert.equal(s.a, v);
    }
  });

  it("test_c_int64_bitfield_roundtrip", function () {
    class B extends Structure {
      static _fields_ = [["a", c_int64, 40]];
    }
    const s = new B();
    for (const v of [-(2 ** 30), -1, 0, 1, 2 ** 30 - 1]) {
      s.a = v;
      assert.equal(s.a, v);
    }
  });

  it("test_unsigned_bitfield_still_unsigned", function () {
    class B extends Structure {
      static _fields_ = [
        ["a", c_uint8, 3],
        ["b", c_uint32, 16],
      ];
    }
    const s = new B();
    s.a = 7;
    assert.equal(s.a, 7);
    s.b = 0xffff;
    assert.equal(s.b, 0xffff);
    s.a = -1;
    assert.equal(s.a, 7);
  });
});

describe("TestLittleEndianUnion", function () {
  it("test_matches_native_on_le_host", function () {
    class V extends LittleEndianUnion {
      static _fields_ = [["i", c_uint32]];
    }
    const v = new V();
    v.i = 0x12345678;
    assert.equal(Buffer.from(string_at(addressof(v), sizeof(v)), "latin1")[0], 0x78);
  });
});

describe("TestStructureFromMemory", function () {
  class RECT extends Structure {
    static _fields_ = [
      ["left", c_int32],
      ["top", c_int32],
      ["right", c_int32],
      ["bottom", c_int32],
    ];
  }

  it("test_from_buffer_shares_memory", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer(src);
    assert.equal(r.left, 42);
    r.left = 999;
    assert.equal(src.readInt32LE(0), 999);
  });

  it("test_from_buffer_with_offset", function () {
    const src = Buffer.alloc(32);
    src.writeInt32LE(7, 16);
    const r = RECT.from_buffer(src, 16);
    assert.equal(r.left, 7);
  });

  it("test_from_buffer_rejects_small_source", function () {
    const tiny = Buffer.alloc(4);
    assert.throws(() => RECT.from_buffer(tiny), /too small/);
  });

  it("test_from_buffer_copy_is_independent", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer_copy(src);
    r.left = 99;
    assert.equal(src.readInt32LE(0), 42);
  });

  it("test_from_buffer_copy_accepts_memoryview", function () {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setInt32(0, 42, true);
    const r = RECT.from_buffer_copy(bytes);
    assert.equal(r.left, 42);
  });

  it("test_from_address", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(1234, 0);
    const addr = addressof(src);
    const r = RECT.from_address(addr);
    assert.equal(r.left, 1234);
  });

  it("test_union_from_buffer", function () {
    class V extends Union {
      static _fields_ = [
        ["as_int", c_int32],
        ["as_float", c_float],
      ];
    }
    const b = Buffer.alloc(4);
    b.writeFloatLE(3.14, 0);
    const v = V.from_buffer(b);
    assert.ok(Math.abs(v.as_float - 3.14) < 1e-6);
  });
});
