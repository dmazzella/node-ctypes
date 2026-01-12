#!/usr/bin/env python3
"""
Test complex nested structures - Python ctypes version
This should match the behavior of test_nested_structs.js
"""

import unittest
import ctypes
import sys


class TestComplexNestedStructures(unittest.TestCase):
    """Test complex nested structure handling"""

    def test_multi_level_nesting(self):
        """Should handle 3-level nested structs"""

        class Point2D(ctypes.Structure):
            _fields_ = [
                ("x", ctypes.c_int32),
                ("y", ctypes.c_int32),
            ]

        class Point3D(ctypes.Structure):
            _fields_ = [
                ("point2d", Point2D),
                ("z", ctypes.c_int32),
            ]

        class BoundingBox(ctypes.Structure):
            _fields_ = [
                ("min", Point3D),
                ("max", Point3D),
            ]

        bbox = BoundingBox()

        # Set min point
        bbox.min.point2d.x = 10
        bbox.min.point2d.y = 20
        bbox.min.z = 30

        # Set max point
        bbox.max.point2d.x = 100
        bbox.max.point2d.y = 200
        bbox.max.z = 300

        # Verify values
        self.assertEqual(bbox.min.point2d.x, 10)
        self.assertEqual(bbox.min.point2d.y, 20)
        self.assertEqual(bbox.min.z, 30)
        self.assertEqual(bbox.max.point2d.x, 100)
        self.assertEqual(bbox.max.point2d.y, 200)
        self.assertEqual(bbox.max.z, 300)

    def test_correct_size_for_nested_structs(self):
        """Should calculate correct size for nested structs"""

        class Inner(ctypes.Structure):
            _fields_ = [("value", ctypes.c_int32)]

        class Middle(ctypes.Structure):
            _fields_ = [
                ("inner", Inner),
                ("extra", ctypes.c_int32),
            ]

        class Outer(ctypes.Structure):
            _fields_ = [
                ("middle", Middle),
                ("final", ctypes.c_int32),
            ]

        self.assertEqual(ctypes.sizeof(Inner), 4)
        self.assertEqual(ctypes.sizeof(Middle), 8)
        self.assertEqual(ctypes.sizeof(Outer), 12)

    def test_array_of_structs_within_struct(self):
        """Should handle array of structs within struct"""

        class Point(ctypes.Structure):
            _fields_ = [
                ("x", ctypes.c_int32),
                ("y", ctypes.c_int32),
            ]

        class Polygon(ctypes.Structure):
            _fields_ = [
                ("vertices", Point * 4),
                ("count", ctypes.c_int32),
            ]

        poly = Polygon()

        # Set vertex data
        poly.vertices[0].x = 0
        poly.vertices[0].y = 0
        poly.vertices[1].x = 100
        poly.vertices[1].y = 0
        poly.vertices[2].x = 100
        poly.vertices[2].y = 100
        poly.vertices[3].x = 0
        poly.vertices[3].y = 100
        poly.count = 4

        # Verify
        self.assertEqual(poly.vertices[0].x, 0)
        self.assertEqual(poly.vertices[0].y, 0)
        self.assertEqual(poly.vertices[1].x, 100)
        self.assertEqual(poly.vertices[1].y, 0)
        self.assertEqual(poly.vertices[2].x, 100)
        self.assertEqual(poly.vertices[2].y, 100)
        self.assertEqual(poly.vertices[3].x, 0)
        self.assertEqual(poly.vertices[3].y, 100)
        self.assertEqual(poly.count, 4)

    def test_union_nested_in_struct(self):
        """Should handle union nested in struct"""

        class Value(ctypes.Union):
            _fields_ = [
                ("asInt", ctypes.c_int32),
                ("asBytes", ctypes.c_uint8 * 4),
            ]

        class Tagged(ctypes.Structure):
            _fields_ = [
                ("tag", ctypes.c_uint16),
                ("value", Value),
            ]

        tagged = Tagged()
        tagged.tag = 1
        tagged.value.asInt = 0x12345678

        # Verify
        self.assertEqual(tagged.tag, 1)
        self.assertEqual(tagged.value.asInt, 0x12345678)

        # Verify union behavior - same memory (little endian)
        self.assertEqual(tagged.value.asBytes[0], 0x78)
        self.assertEqual(tagged.value.asBytes[1], 0x56)
        self.assertEqual(tagged.value.asBytes[2], 0x34)
        self.assertEqual(tagged.value.asBytes[3], 0x12)

    def test_network_packet_structure(self):
        """Should handle complex real-world network packet structure"""

        class IPv4Address(ctypes.Structure):
            _fields_ = [("octets", ctypes.c_uint8 * 4)]

        class MACAddress(ctypes.Structure):
            _fields_ = [("bytes", ctypes.c_uint8 * 6)]

        class EthernetHeader(ctypes.Structure):
            _fields_ = [
                ("destination", MACAddress),
                ("source", MACAddress),
                ("etherType", ctypes.c_uint16),
            ]

        class IPv4Header(ctypes.Structure):
            _fields_ = [
                ("versionAndHeaderLength", ctypes.c_uint8),
                ("typeOfService", ctypes.c_uint8),
                ("totalLength", ctypes.c_uint16),
                ("identification", ctypes.c_uint16),
                ("flagsAndFragmentOffset", ctypes.c_uint16),
                ("timeToLive", ctypes.c_uint8),
                ("protocol", ctypes.c_uint8),
                ("headerChecksum", ctypes.c_uint16),
                ("sourceAddress", IPv4Address),
                ("destinationAddress", IPv4Address),
            ]

        class Packet(ctypes.Structure):
            _fields_ = [
                ("ethernet", EthernetHeader),
                ("ipv4", IPv4Header),
            ]

        packet = Packet()

        # Set Ethernet header
        for i in range(6):
            packet.ethernet.destination.bytes[i] = 0xFF

        packet.ethernet.source.bytes[0] = 0x00
        packet.ethernet.source.bytes[1] = 0x11
        packet.ethernet.source.bytes[2] = 0x22
        packet.ethernet.source.bytes[3] = 0x33
        packet.ethernet.source.bytes[4] = 0x44
        packet.ethernet.source.bytes[5] = 0x55

        packet.ethernet.etherType = 0x0800  # IPv4

        # Set IPv4 header
        packet.ipv4.versionAndHeaderLength = 0x45
        packet.ipv4.typeOfService = 0
        packet.ipv4.totalLength = 40
        packet.ipv4.timeToLive = 64
        packet.ipv4.protocol = 6  # TCP

        packet.ipv4.sourceAddress.octets[0] = 192
        packet.ipv4.sourceAddress.octets[1] = 168
        packet.ipv4.sourceAddress.octets[2] = 1
        packet.ipv4.sourceAddress.octets[3] = 100

        packet.ipv4.destinationAddress.octets[0] = 8
        packet.ipv4.destinationAddress.octets[1] = 8
        packet.ipv4.destinationAddress.octets[2] = 8
        packet.ipv4.destinationAddress.octets[3] = 8

        # Verify Ethernet header
        self.assertEqual(packet.ethernet.destination.bytes[0], 0xFF)
        self.assertEqual(packet.ethernet.source.bytes[0], 0x00)
        self.assertEqual(packet.ethernet.etherType, 0x0800)

        # Verify IPv4 header
        self.assertEqual(packet.ipv4.versionAndHeaderLength, 0x45)
        self.assertEqual(packet.ipv4.protocol, 6)
        self.assertEqual(packet.ipv4.sourceAddress.octets[0], 192)
        self.assertEqual(packet.ipv4.sourceAddress.octets[1], 168)
        self.assertEqual(packet.ipv4.destinationAddress.octets[0], 8)
        self.assertEqual(packet.ipv4.destinationAddress.octets[3], 8)

    def test_deeply_nested_with_mixed_types(self):
        """Should handle complex nesting with arrays, unions, and structs"""

        class RGB(ctypes.Structure):
            _fields_ = [
                ("r", ctypes.c_uint8),
                ("g", ctypes.c_uint8),
                ("b", ctypes.c_uint8),
                ("a", ctypes.c_uint8),
            ]

        class Color(ctypes.Union):
            _fields_ = [
                ("rgb", RGB),
                ("value", ctypes.c_int32),
            ]

        class Pixel(ctypes.Structure):
            _fields_ = [
                ("x", ctypes.c_uint16),
                ("y", ctypes.c_uint16),
                ("color", Color),
            ]

        class Image(ctypes.Structure):
            _fields_ = [
                ("width", ctypes.c_uint16),
                ("height", ctypes.c_uint16),
                ("pixels", Pixel * 2),
            ]

        img = Image()
        img.width = 640
        img.height = 480

        # First pixel
        img.pixels[0].x = 10
        img.pixels[0].y = 20
        img.pixels[0].color.rgb.r = 255
        img.pixels[0].color.rgb.g = 0
        img.pixels[0].color.rgb.b = 0
        img.pixels[0].color.rgb.a = 255

        # Second pixel
        img.pixels[1].x = 30
        img.pixels[1].y = 40
        img.pixels[1].color.value = -16711936  # Same as 0xFF00FF00 but signed

        # Verify
        self.assertEqual(img.width, 640)
        self.assertEqual(img.height, 480)
        self.assertEqual(img.pixels[0].x, 10)
        self.assertEqual(img.pixels[0].y, 20)
        self.assertEqual(img.pixels[0].color.rgb.r, 255)
        self.assertEqual(img.pixels[0].color.rgb.g, 0)
        self.assertEqual(img.pixels[1].x, 30)
        self.assertEqual(img.pixels[1].y, 40)
        self.assertEqual(img.pixels[1].color.value, -16711936)

    def test_alignment_in_nested_structs(self):
        """Should handle alignment in nested structs"""

        class Inner(ctypes.Structure):
            _fields_ = [
                ("byte1", ctypes.c_uint8),
                ("int1", ctypes.c_int32),
            ]

        class Outer(ctypes.Structure):
            _fields_ = [
                ("byte2", ctypes.c_uint8),
                ("nested", Inner),
                ("byte3", ctypes.c_uint8),
            ]

        # Check sizes account for padding
        outer_size = ctypes.sizeof(Outer)
        inner_size = ctypes.sizeof(Inner)

        self.assertGreater(outer_size, 0)
        self.assertGreater(inner_size, 0)

        outer = Outer()
        outer.byte2 = 1
        outer.nested.byte1 = 2
        outer.nested.int1 = 12345
        outer.byte3 = 3

        # Verify
        self.assertEqual(outer.byte2, 1)
        self.assertEqual(outer.nested.byte1, 2)
        self.assertEqual(outer.nested.int1, 12345)
        self.assertEqual(outer.byte3, 3)


if __name__ == "__main__":
    # Run tests
    unittest.main()
