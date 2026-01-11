"""
Test Structs and Unions - Cross Platform
Tests struct/union creation, nested structs, bit fields, anonymous fields
"""

import unittest
from ctypes import Structure, Union, c_int32, c_uint32, c_int16, sizeof, c_uint8, c_float, c_double

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

if __name__ == '__main__':
    unittest.main()
