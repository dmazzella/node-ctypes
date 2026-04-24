"""
Test Structs and Unions - Cross Platform
Tests struct/union creation, nested structs, bit fields, anonymous fields
"""

import unittest
from ctypes import (
    Structure, Union, c_int32, c_uint32, c_uint16, c_int16, c_int64,
    sizeof, c_uint8, c_float, c_double,
    c_void_p, POINTER, pointer,
    c_int8, c_int,
    BigEndianStructure, LittleEndianStructure, BigEndianUnion, LittleEndianUnion,
)

class TestStructsAndUnions(unittest.TestCase):
    def test_basic_struct(self):
        """Test create and use simple struct"""
        class Point(Structure):
            _fields_ = [
                ("x", c_int32),
                ("y", c_int32)
            ]
        
        p = Point(10, 20)
        self.assertEqual(p.x, 10)
        self.assertEqual(p.y, 20)
        
        p.x = 100
        self.assertEqual(p.x, 100)
    
    def test_struct_size_and_alignment(self):
        """Test struct has correct size and alignment"""
        class Point(Structure):
            _fields_ = [
                ("x", c_int32),
                ("y", c_int32)
            ]
        
        self.assertEqual(sizeof(Point), 8)
    
    def test_nested_structs(self):
        """Test nested structs"""
        class Point(Structure):
            _fields_ = [
                ("x", c_int32),
                ("y", c_int32)
            ]
        
        class Rectangle(Structure):
            _fields_ = [
                ("topLeft", Point),
                ("bottomRight", Point),
                ("color", c_uint32)
            ]
        
        rect = Rectangle()
        rect.topLeft.x = 0
        rect.topLeft.y = 0
        rect.bottomRight.x = 100
        rect.bottomRight.y = 200
        rect.color = 0xFF0000
        
        self.assertEqual(rect.topLeft.x, 0)
        self.assertEqual(rect.topLeft.y, 0)
        self.assertEqual(rect.bottomRight.x, 100)
        self.assertEqual(rect.bottomRight.y, 200)
        self.assertEqual(rect.color, 0xFF0000)
    
    def test_union(self):
        """Test create and use unions"""
        class IntOrFloat(Union):
            _fields_ = [
                ("i", c_int32),
                ("f", c_float)
            ]
        
        u = IntOrFloat()
        u.f = 3.14159
        
        # Union shares memory - reading as int gives bit pattern
        self.assertIsInstance(u.i, int)
        
        # Reading back as float gives original value
        self.assertAlmostEqual(u.f, 3.14159, places=5)
    
    def test_union_size(self):
        """Test union has size of largest member"""
        class IntOrDouble(Union):
            _fields_ = [
                ("i", c_int32),   # 4 bytes
                ("d", c_double)   # 8 bytes
            ]
        
        self.assertEqual(sizeof(IntOrDouble), 8)
    
    def test_bit_fields(self):
        """Test bit fields"""
        class Flags(Structure):
            _fields_ = [
                ("enabled", c_uint32, 1),
                ("mode", c_uint32, 3),
                ("priority", c_uint32, 4),
                ("reserved", c_uint32, 24)
            ]
        
        f = Flags()
        f.enabled = 1
        f.mode = 5
        f.priority = 15
        
        self.assertEqual(f.enabled, 1)
        self.assertEqual(f.mode, 5)
        self.assertEqual(f.priority, 15)
    
    def test_bit_field_overflow(self):
        """Test bit field overflow is handled correctly"""
        class Flags(Structure):
            _fields_ = [
                ("value", c_uint32, 3)  # Max 7 (0b111)
            ]
        
        f = Flags()
        f.value = 15  # 0b1111 - overflow
        self.assertEqual(f.value, 7)  # Truncated to 0b111
    
    def test_anonymous_union_fields(self):
        """Test anonymous union fields"""
        class Inner(Union):
            _fields_ = [
                ("i", c_int32),
                ("f", c_float)
            ]
        
        class Outer(Structure):
            _anonymous_ = ("data",)
            _fields_ = [
                ("tag", c_uint32),
                ("data", Inner)
            ]
        
        obj = Outer()
        obj.tag = 1
        obj.i = 42
        
        # Anonymous field members are promoted to parent level
        self.assertEqual(obj.i, 42)
        self.assertEqual(obj.tag, 1)
    
    def test_nested_anonymous_structures(self):
        """Test nested anonymous structures"""
        class Coords(Structure):
            _fields_ = [
                ("x", c_int32),
                ("y", c_int32)
            ]
        
        class Entity(Structure):
            _anonymous_ = ("pos",)
            _fields_ = [
                ("id", c_uint32),
                ("pos", Coords),
                ("health", c_int32)
            ]
        
        ent = Entity()
        ent.id = 1
        ent.x = 100   # From anonymous Coords
        ent.y = 200   # From anonymous Coords
        ent.health = 100
        
        self.assertEqual(ent.id, 1)
        self.assertEqual(ent.x, 100)
        self.assertEqual(ent.y, 200)
        self.assertEqual(ent.health, 100)
    
    def test_packed_structs(self):
        """Test packed structs"""
        class Unpacked(Structure):
            _fields_ = [
                ("a", c_uint8),
                ("b", c_uint32),
                ("c", c_uint8)
            ]
        
        class Packed(Structure):
            _pack_ = 1
            _fields_ = [
                ("a", c_uint8),
                ("b", c_uint32),
                ("c", c_uint8)
            ]
        
        # Unpacked has padding for alignment
        self.assertGreaterEqual(sizeof(Unpacked), 6)
        
        # Packed has no padding
        self.assertEqual(sizeof(Packed), 6)
    
    def test_struct_with_arrays(self):
        """Test arrays in struct fields"""
        class Data(Structure):
            _fields_ = [
                ("count", c_int32),
                ("values", c_int32 * 10)
            ]
        
        data = Data()
        data.count = 3
        data.values[0] = 1
        data.values[9] = 10
        
        self.assertEqual(data.count, 3)
        self.assertEqual(data.values[0], 1)
        self.assertEqual(data.values[9], 10)


# ─── POINTER() in Structure _fields_ ───

class TestPOINTERInStructFields(unittest.TestCase):
    """Test POINTER() in Structure _fields_"""

    def test_pointer_field_null(self):
        class S(Structure):
            _fields_ = [("pData", POINTER(c_int32))]
        s = S()
        self.assertFalse(bool(s.pData))

    def test_pointer_field_struct_size(self):
        class S(Structure):
            _fields_ = [("value", c_int32), ("pData", POINTER(c_int32))]
        ptr_size = sizeof(c_void_p)
        expected = 16 if ptr_size == 8 else 8
        self.assertEqual(sizeof(S), expected)

    def test_pointer_field_assign_via_pointer(self):
        """Python: s.pData = pointer(val)"""
        class S(Structure):
            _fields_ = [("pData", POINTER(c_int32))]
        val = c_int32(999)
        s = S()
        s.pData = pointer(val)
        self.assertEqual(s.pData[0], 999)

    def test_pointer_field_contents(self):
        """Python: s.pData.contents.value"""
        class S(Structure):
            _fields_ = [("pData", POINTER(c_int32))]
        val = c_int32(42)
        s = S()
        s.pData = pointer(val)
        self.assertEqual(s.pData.contents.value, 42)

    def test_pointer_field_modify_through_pointer(self):
        """Modifying via pointer field changes original"""
        class S(Structure):
            _fields_ = [("pData", POINTER(c_int32))]
        val = c_int32(10)
        s = S()
        s.pData = pointer(val)
        s.pData[0] = 99
        self.assertEqual(val.value, 99)

    def test_multiple_pointer_fields(self):
        """Struct with multiple POINTER fields"""
        class S(Structure):
            _fields_ = [
                ("pInt", POINTER(c_int32)),
                ("pDbl", POINTER(c_double)),
            ]
        iv = c_int32(10)
        dv = c_double(3.14)
        s = S()
        s.pInt = pointer(iv)
        s.pDbl = pointer(dv)
        self.assertEqual(s.pInt[0], 10)
        self.assertAlmostEqual(s.pDbl[0], 3.14, places=2)

    def test_pointer_field_with_struct_pointer(self):
        """POINTER to struct in _fields_"""
        class Inner(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        class Outer(Structure):
            _fields_ = [("pInner", POINTER(Inner))]
        inner = Inner(100, 200)
        outer = Outer()
        outer.pInner = pointer(inner)
        self.assertEqual(outer.pInner.contents.x, 100)
        self.assertEqual(outer.pInner.contents.y, 200)


class TestPOINTERInUnionFields(unittest.TestCase):
    """Test POINTER() in Union _fields_"""

    def test_pointer_field_in_union(self):
        class U(Union):
            _fields_ = [("asInt", c_uint32), ("asPtr", POINTER(c_int32))]
        u = U()
        self.assertFalse(bool(u.asPtr))
        expected = 8 if sizeof(c_void_p) == 8 else 4
        self.assertEqual(sizeof(U), expected)


class TestStructureSubclassMethods(unittest.TestCase):
    """Python: metodi custom su una Structure subclass leggono i field
    via `self.<name>` come qualsiasi attributo (niente indirezioni)."""

    def test_custom_method_reads_fields_via_self(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]

            def mag2(self):
                return self.x * self.x + self.y * self.y

            def scaled(self, f):
                return Point(self.x * f, self.y * f)

        p = Point(3, 4)
        self.assertEqual(p.mag2(), 25)
        q = p.scaled(2)
        self.assertEqual(q.x, 6)
        self.assertEqual(q.y, 8)


class TestBigEndianStructure(unittest.TestCase):
    """ctypes.BigEndianStructure: scalar fields serialized in BE order.
    Python sets this per-class — nested non-BE structures keep their own
    byte order."""

    def test_scalar_fields_in_big_endian_order(self):
        class H(BigEndianStructure):
            _fields_ = [("magic", c_uint32), ("version", c_uint16), ("flags", c_uint8)]
        h = H()
        h.magic = 0x12345678
        h.version = 0x0102
        h.flags = 0xAB
        raw = bytes(h)
        self.assertEqual(raw[0], 0x12)
        self.assertEqual(raw[1], 0x34)
        self.assertEqual(raw[2], 0x56)
        self.assertEqual(raw[3], 0x78)
        self.assertEqual(raw[4], 0x01)
        self.assertEqual(raw[5], 0x02)
        self.assertEqual(raw[6], 0xAB)
        self.assertEqual(h.magic, 0x12345678)
        self.assertEqual(h.version, 0x0102)
        self.assertEqual(h.flags, 0xAB)

    def test_float_and_double_in_be(self):
        class F(BigEndianStructure):
            _fields_ = [("f", c_float), ("d", c_double)]
        f = F()
        f.f = 3.14
        f.d = 2.7182818284590451
        self.assertAlmostEqual(f.f, 3.14, places=5)
        self.assertAlmostEqual(f.d, 2.7182818284590451, places=15)
        # First byte of 3.14 in BE IEEE-754 is 0x40
        self.assertEqual(bytes(f)[0], 0x40)

    def test_int64_be(self):
        class Q(BigEndianStructure):
            _fields_ = [("n", c_int64)]
        q = Q()
        q.n = 0x0102030405060708
        raw = bytes(q)
        self.assertEqual(raw[0], 0x01)
        self.assertEqual(raw[7], 0x08)
        self.assertEqual(q.n, 0x0102030405060708)

    def test_nested_le_inside_be_keeps_le(self):
        class InnerLE(Structure):
            _fields_ = [("x", c_uint32)]
        class OuterBE(BigEndianStructure):
            _fields_ = [("hdr", c_uint16), ("inner", InnerLE)]
        o = OuterBE()
        o.hdr = 0x1234
        o.inner.x = 0xAABBCCDD
        raw = bytes(o)
        self.assertEqual(raw[0], 0x12)
        self.assertEqual(raw[1], 0x34)
        self.assertEqual(raw[4], 0xDD)
        self.assertEqual(raw[5], 0xCC)
        self.assertEqual(raw[6], 0xBB)
        self.assertEqual(raw[7], 0xAA)

    def test_nested_be_inside_be_is_be(self):
        class InnerBE(BigEndianStructure):
            _fields_ = [("x", c_uint32)]
        class OuterBE(BigEndianStructure):
            _fields_ = [("inner", InnerBE)]
        o = OuterBE()
        o.inner.x = 0xAABBCCDD
        raw = bytes(o)
        self.assertEqual(raw[0], 0xAA)
        self.assertEqual(raw[1], 0xBB)
        self.assertEqual(raw[2], 0xCC)
        self.assertEqual(raw[3], 0xDD)


class TestLittleEndianStructure(unittest.TestCase):
    def test_matches_native_on_le_host(self):
        class L(LittleEndianStructure):
            _fields_ = [("magic", c_uint32)]
        l = L()
        l.magic = 0x12345678
        raw = bytes(l)
        self.assertEqual(raw[0], 0x78)
        self.assertEqual(raw[3], 0x12)


class TestBigEndianUnion(unittest.TestCase):
    def test_be_union_primitive(self):
        class V(BigEndianUnion):
            _fields_ = [("i", c_uint32), ("bytes", c_uint8 * 4)]
        v = V()
        v.i = 0x12345678
        raw = bytes(v)
        self.assertEqual(raw[0], 0x12)
        self.assertEqual(raw[3], 0x78)
        self.assertEqual(v.i, 0x12345678)
        self.assertEqual(v.bytes[0], 0x12)


class TestComplexNestedStructures(unittest.TestCase):
    """Test complex nested structure handling"""

    def test_multi_level_nesting(self):
        class Point2D(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]

        class Point3D(Structure):
            _fields_ = [("point2d", Point2D), ("z", c_int32)]

        class BoundingBox(Structure):
            _fields_ = [("min", Point3D), ("max", Point3D)]

        bbox = BoundingBox()
        bbox.min.point2d.x = 10
        bbox.min.point2d.y = 20
        bbox.min.z = 30
        bbox.max.point2d.x = 100
        bbox.max.point2d.y = 200
        bbox.max.z = 300

        self.assertEqual(bbox.min.point2d.x, 10)
        self.assertEqual(bbox.min.point2d.y, 20)
        self.assertEqual(bbox.min.z, 30)
        self.assertEqual(bbox.max.point2d.x, 100)
        self.assertEqual(bbox.max.point2d.y, 200)
        self.assertEqual(bbox.max.z, 300)

    def test_correct_size_for_nested_structs(self):
        class Inner(Structure):
            _fields_ = [("value", c_int32)]
        class Middle(Structure):
            _fields_ = [("inner", Inner), ("extra", c_int32)]
        class Outer(Structure):
            _fields_ = [("middle", Middle), ("final", c_int32)]

        self.assertEqual(sizeof(Inner), 4)
        self.assertEqual(sizeof(Middle), 8)
        self.assertEqual(sizeof(Outer), 12)

    def test_array_of_structs_within_struct(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]

        class Polygon(Structure):
            _fields_ = [("vertices", Point * 4), ("count", c_int32)]

        poly = Polygon()
        poly.vertices[0].x = 0
        poly.vertices[0].y = 0
        poly.vertices[1].x = 100
        poly.vertices[1].y = 0
        poly.vertices[2].x = 100
        poly.vertices[2].y = 100
        poly.vertices[3].x = 0
        poly.vertices[3].y = 100
        poly.count = 4

        self.assertEqual(poly.vertices[1].x, 100)
        self.assertEqual(poly.vertices[2].y, 100)
        self.assertEqual(poly.count, 4)

    def test_union_nested_in_struct(self):
        class Value(Union):
            _fields_ = [("asInt", c_int32), ("asBytes", c_uint8 * 4)]
        class Tagged(Structure):
            _fields_ = [("tag", c_uint16), ("value", Value)]

        tagged = Tagged()
        tagged.tag = 1
        tagged.value.asInt = 0x12345678

        self.assertEqual(tagged.tag, 1)
        self.assertEqual(tagged.value.asInt, 0x12345678)
        self.assertEqual(tagged.value.asBytes[0], 0x78)
        self.assertEqual(tagged.value.asBytes[1], 0x56)
        self.assertEqual(tagged.value.asBytes[2], 0x34)
        self.assertEqual(tagged.value.asBytes[3], 0x12)

    def test_network_packet_structure(self):
        class IPv4Address(Structure):
            _fields_ = [("octets", c_uint8 * 4)]
        class MACAddress(Structure):
            _fields_ = [("bytes", c_uint8 * 6)]
        class EthernetHeader(Structure):
            _fields_ = [("destination", MACAddress), ("source", MACAddress), ("etherType", c_uint16)]
        class IPv4Header(Structure):
            _fields_ = [
                ("versionAndHeaderLength", c_uint8),
                ("typeOfService", c_uint8),
                ("totalLength", c_uint16),
                ("identification", c_uint16),
                ("flagsAndFragmentOffset", c_uint16),
                ("timeToLive", c_uint8),
                ("protocol", c_uint8),
                ("headerChecksum", c_uint16),
                ("sourceAddress", IPv4Address),
                ("destinationAddress", IPv4Address),
            ]
        class Packet(Structure):
            _fields_ = [("ethernet", EthernetHeader), ("ipv4", IPv4Header)]

        packet = Packet()
        for i in range(6):
            packet.ethernet.destination.bytes[i] = 0xFF
        packet.ethernet.source.bytes[0] = 0x00
        packet.ethernet.source.bytes[5] = 0x55
        packet.ethernet.etherType = 0x0800
        packet.ipv4.versionAndHeaderLength = 0x45
        packet.ipv4.protocol = 6
        packet.ipv4.sourceAddress.octets[0] = 192
        packet.ipv4.destinationAddress.octets[0] = 8

        self.assertEqual(packet.ethernet.destination.bytes[0], 0xFF)
        self.assertEqual(packet.ethernet.etherType, 0x0800)
        self.assertEqual(packet.ipv4.versionAndHeaderLength, 0x45)
        self.assertEqual(packet.ipv4.protocol, 6)
        self.assertEqual(packet.ipv4.sourceAddress.octets[0], 192)
        self.assertEqual(packet.ipv4.destinationAddress.octets[0], 8)

    def test_alignment_in_nested_structs(self):
        class Inner(Structure):
            _fields_ = [("byte1", c_uint8), ("int1", c_int32)]
        class Outer(Structure):
            _fields_ = [("byte2", c_uint8), ("nested", Inner), ("byte3", c_uint8)]

        outer = Outer()
        outer.byte2 = 1
        outer.nested.byte1 = 2
        outer.nested.int1 = 12345
        outer.byte3 = 3

        self.assertEqual(outer.byte2, 1)
        self.assertEqual(outer.nested.byte1, 2)
        self.assertEqual(outer.nested.int1, 12345)
        self.assertEqual(outer.byte3, 3)


class TestSignedBitfields(unittest.TestCase):
    def test_c_int8_bitfield_roundtrip_negative(self):
        class B(Structure):
            _fields_ = [("a", c_int8, 3), ("b", c_int8, 5)]
        s = B()
        for v in (-4, -1, 0, 1, 3):
            s.a = v
            self.assertEqual(s.a, v, f"c_int8x3: {v}")
        for v in (-16, -1, 0, 1, 15):
            s.b = v
            self.assertEqual(s.b, v, f"c_int8x5: {v}")

    def test_c_int16_bitfield_roundtrip(self):
        class B(Structure):
            _fields_ = [("a", c_int16, 7)]
        s = B()
        for v in (-64, -1, 0, 1, 63):
            s.a = v
            self.assertEqual(s.a, v)

    def test_c_int32_bitfield_roundtrip_large_signed(self):
        class B(Structure):
            _fields_ = [("a", c_int32, 30)]
        s = B()
        mx = (1 << 29) - 1
        mn = -(1 << 29)
        for v in (mn, -1, 0, 1, mx):
            s.a = v
            self.assertEqual(s.a, v)

    def test_c_int64_bitfield_roundtrip(self):
        class B(Structure):
            _fields_ = [("a", c_int64, 40)]
        s = B()
        for v in (-(1 << 30), -1, 0, 1, (1 << 30) - 1):
            s.a = v
            self.assertEqual(s.a, v)

    def test_unsigned_bitfield_still_unsigned(self):
        class B(Structure):
            _fields_ = [("a", c_uint8, 3), ("b", c_uint32, 16)]
        s = B()
        s.a = 7
        self.assertEqual(s.a, 7)
        s.b = 0xFFFF
        self.assertEqual(s.b, 0xFFFF)
        s.a = -1
        self.assertEqual(s.a, 7)


if __name__ == '__main__':
    unittest.main()
