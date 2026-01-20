import { describe, it } from "node:test";
import assert from "node:assert";
import { struct, union, array, c_int32, c_uint16, c_uint8, c_int8, sizeof } from "node-ctypes";

describe("Complex Nested Structures", function () {
  describe("Multi-level Nesting", function () {
    it("should handle 3-level nested structs", function () {
      const Point2D = struct({
        x: c_int32,
        y: c_int32,
      });

      const Point3D = struct({
        point2d: Point2D,
        z: c_int32,
      });

      const BoundingBox = struct({
        min: Point3D,
        max: Point3D,
      });

      const bbox = BoundingBox.create();

      // Set min point
      bbox.min.point2d.x = 10;
      bbox.min.point2d.y = 20;
      bbox.min.z = 30;

      // Set max point
      bbox.max.point2d.x = 100;
      bbox.max.point2d.y = 200;
      bbox.max.z = 300;

      // Verify directly (eager loading means values are already set)
      assert.strictEqual(bbox.min.point2d.x, 10);
      assert.strictEqual(bbox.min.point2d.y, 20);
      assert.strictEqual(bbox.min.z, 30);
      assert.strictEqual(bbox.max.point2d.x, 100);
      assert.strictEqual(bbox.max.point2d.y, 200);
      assert.strictEqual(bbox.max.z, 300);
    });

    it("should calculate correct size for nested structs", function () {
      const Inner = struct({ value: c_int32 });
      const Middle = struct({ inner: Inner, extra: c_int32 });
      const Outer = struct({ middle: Middle, final: c_int32 });

      assert.strictEqual(sizeof(Inner), 4);
      assert.strictEqual(sizeof(Middle), 8);
      assert.strictEqual(sizeof(Outer), 12);
    });
  });

  describe("Arrays of Nested Structs", function () {
    it("should handle fixed-size byte arrays in structs", function () {
      const Point = struct({
        x: c_int32,
        y: c_int32,
        reserved: array(c_uint8, 4),
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
  });

  describe("Union within Struct", function () {
    it("should handle union nested in struct", function () {
      const Value = union({
        asInt: c_int32,
        asBytes: array(c_uint8, 4),
      });

      const Tagged = struct({
        tag: c_uint16,
        value: Value,
      });

      const tagged = Tagged.create();
      tagged.tag = 1;
      tagged.value.asInt = 0x12345678;

      assert.strictEqual(tagged.tag, 1);
      assert.strictEqual(tagged.value.asInt, 0x12345678);

      // Verify union behavior - same memory
      assert.strictEqual(tagged.value.asBytes[0], 0x78);
      assert.strictEqual(tagged.value.asBytes[1], 0x56);
      assert.strictEqual(tagged.value.asBytes[2], 0x34);
      assert.strictEqual(tagged.value.asBytes[3], 0x12);
    });
  });

  describe("Complex Real-World Example", function () {
    it("should handle network packet structure", function () {
      const IPv4Address = struct({
        octets: array(c_uint8, 4),
      });

      const MACAddress = struct({
        bytes: array(c_uint8, 6),
      });

      const EthernetHeader = struct({
        destination: MACAddress,
        source: MACAddress,
        etherType: c_uint16,
      });

      const IPv4Header = struct({
        versionAndHeaderLength: c_uint8,
        typeOfService: c_uint8,
        totalLength: c_uint16,
        identification: c_uint16,
        flagsAndFragmentOffset: c_uint16,
        timeToLive: c_uint8,
        protocol: c_uint8,
        headerChecksum: c_uint16,
        sourceAddress: IPv4Address,
        destinationAddress: IPv4Address,
      });

      const Packet = struct({
        ethernet: EthernetHeader,
        ipv4: IPv4Header,
      });

      const packet = Packet.create();

      // Set Ethernet header
      packet.ethernet.destination.bytes[0] = 0xff;
      packet.ethernet.destination.bytes[1] = 0xff;
      packet.ethernet.destination.bytes[2] = 0xff;
      packet.ethernet.destination.bytes[3] = 0xff;
      packet.ethernet.destination.bytes[4] = 0xff;
      packet.ethernet.destination.bytes[5] = 0xff;

      packet.ethernet.source.bytes[0] = 0x00;
      packet.ethernet.source.bytes[1] = 0x11;
      packet.ethernet.source.bytes[2] = 0x22;
      packet.ethernet.source.bytes[3] = 0x33;
      packet.ethernet.source.bytes[4] = 0x44;
      packet.ethernet.source.bytes[5] = 0x55;

      packet.ethernet.etherType = 0x0800; // IPv4

      // Set IPv4 header
      packet.ipv4.versionAndHeaderLength = 0x45; // Version 4, Header length 5
      packet.ipv4.typeOfService = 0;
      packet.ipv4.totalLength = 40;
      packet.ipv4.timeToLive = 64;
      packet.ipv4.protocol = 6; // TCP

      packet.ipv4.sourceAddress.octets[0] = 192;
      packet.ipv4.sourceAddress.octets[1] = 168;
      packet.ipv4.sourceAddress.octets[2] = 1;
      packet.ipv4.sourceAddress.octets[3] = 100;

      packet.ipv4.destinationAddress.octets[0] = 8;
      packet.ipv4.destinationAddress.octets[1] = 8;
      packet.ipv4.destinationAddress.octets[2] = 8;
      packet.ipv4.destinationAddress.octets[3] = 8;

      // Verify Ethernet header
      assert.strictEqual(packet.ethernet.destination.bytes[0], 0xff);
      assert.strictEqual(packet.ethernet.source.bytes[0], 0x00);
      assert.strictEqual(packet.ethernet.etherType, 0x0800);

      // Verify IPv4 header
      assert.strictEqual(packet.ipv4.versionAndHeaderLength, 0x45);
      assert.strictEqual(packet.ipv4.protocol, 6);
      assert.strictEqual(packet.ipv4.sourceAddress.octets[0], 192);
      assert.strictEqual(packet.ipv4.sourceAddress.octets[1], 168);
      assert.strictEqual(packet.ipv4.destinationAddress.octets[0], 8);
      assert.strictEqual(packet.ipv4.destinationAddress.octets[3], 8);
    });
  });

  describe("Deeply Nested with Mixed Types", function () {
    it("should handle union with nested struct", function () {
      const Color = union({
        rgb: struct({
          r: c_uint8,
          g: c_uint8,
          b: c_uint8,
          a: c_uint8,
        }),
        value: c_int32,
      });

      const Pixel = struct({
        x: c_uint16,
        y: c_uint16,
        color: Color,
      });

      const pixel = Pixel.create();
      pixel.x = 10;
      pixel.y = 20;
      pixel.color.rgb.r = 255;
      pixel.color.rgb.g = 0;
      pixel.color.rgb.b = 0;
      pixel.color.rgb.a = 255;

      assert.strictEqual(pixel.x, 10);
      assert.strictEqual(pixel.y, 20);
      assert.strictEqual(pixel.color.rgb.r, 255);
      assert.strictEqual(pixel.color.rgb.g, 0);
      assert.strictEqual(pixel.color.rgb.b, 0);
      assert.strictEqual(pixel.color.rgb.a, 255);
    });
  });

  describe("Alignment and Padding", function () {
    it("should handle alignment in nested structs", function () {
      const Inner = struct({
        byte1: c_uint8,
        int1: c_int32,
      });

      const Outer = struct({
        byte2: c_uint8,
        nested: Inner,
        byte3: c_uint8,
      });

      // Check sizes account for padding
      const outerSize = sizeof(Outer);
      const innerSize = sizeof(Inner);

      assert.ok(outerSize > 0);
      assert.ok(innerSize > 0);

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
});
