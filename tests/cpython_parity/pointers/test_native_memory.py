"""Live C allocations observed through public ctypes views."""

import ctypes as c
import unittest
from .._support import FIXTURE, LIBC


class Point(c.Structure):
    _fields_ = [("x", c.c_int32), ("y", c.c_int32)]


class TestNativeMemory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.libc = c.CDLL(LIBC)
        cls.malloc = cls.libc.malloc
        cls.malloc.argtypes = [c.c_size_t]
        cls.malloc.restype = c.c_void_p
        cls.free = cls.libc.free
        cls.free.argtypes = [c.c_void_p]
        cls.free.restype = None
        cls.cmemset = cls.libc.memset
        cls.cmemset.argtypes = [c.c_void_p, c.c_int32, c.c_size_t]
        cls.cmemset.restype = c.c_void_p
        cls.cmemcpy = cls.libc.memcpy
        cls.cmemcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t]
        cls.cmemcpy.restype = c.c_void_p
        cls.fixture = c.CDLL(str(FIXTURE))

    def setUp(self):
        self.blocks = []

    def tearDown(self):
        for address in self.blocks:
            self.free(address)

    def allocate(self, size):
        address = self.malloc(size)
        self.assertTrue(address)
        self.blocks.append(address)
        self.cmemset(address, 0, size)
        return address

    def test_scalar_views(self):
        address = self.allocate(4)
        value = c.c_int32.from_address(address)
        self.cmemset(address, 1, 4)
        self.assertEqual(value.value, 0x01010101)
        value.value = -7
        self.assertEqual(c.c_int32.from_buffer_copy(c.string_at(address, 4)).value, -7)
        self.assertEqual(c.addressof(value), address)

    def test_nested_views(self):
        class Shape(c.Structure):
            _fields_ = [("id", c.c_int32), ("origin", Point), ("weights", c.c_double * 3), ("flags", c.c_int32, 4)]
        address = self.allocate(c.sizeof(Shape))
        shape = Shape.from_address(address)
        shape.id = 42
        nested = shape.origin
        nested.x = 5
        shape.weights[2] = -1.25
        shape.flags = 7
        copied = Shape.from_buffer_copy(c.string_at(address, c.sizeof(Shape)))
        self.assertEqual([copied.id, copied.origin.x, copied.weights[2], copied.flags], [42, 5, -1.25, 7])
        self.cmemset(address + Shape.origin.offset, 0x01, c.sizeof(c.c_int32))
        self.assertEqual(nested.x, 0x01010101)
        self.assertEqual(c.addressof(nested), address + Shape.origin.offset)

    def test_pointer_views(self):
        address = self.allocate(16)
        p = c.cast(address, c.POINTER(c.c_int32))
        p[2] = 77
        self.assertEqual(c.c_int32.from_address(address + 8).value, 77)
        self.cmemset(address + 4, 1, 4)
        self.assertEqual(p[1], 0x01010101)
        p.contents.value = 13
        self.assertEqual(c.c_int32.from_address(address).value, 13)
        point_pointer = c.cast(address, c.POINTER(Point))
        point_pointer.contents.y = 21
        self.assertEqual(c.c_int32.from_address(address + 4).value, 21)
        self.assertEqual(point_pointer[1].x, 77)

    def test_byref_uses_native_memory(self):
        address = self.allocate(c.sizeof(Point))
        point = Point.from_address(address)
        source = Point(3, 4)
        self.cmemcpy(c.byref(point), c.byref(source), c.sizeof(Point))
        self.assertEqual([point.x, point.y], [3, 4])
        source.x = 30
        self.cmemcpy(c.byref(point), c.byref(source), c.sizeof(Point))
        point.y = 40
        copy = Point()
        self.cmemcpy(c.byref(copy), c.byref(point), c.sizeof(Point))
        self.assertEqual([copy.x, copy.y], [30, 40])

    def test_struct_by_value_uses_current_bytes(self):
        address = self.allocate(c.sizeof(Point))
        point = Point.from_address(address)
        source = Point(-6, 7)
        self.cmemcpy(address, c.byref(source), c.sizeof(Point))
        fn = self.fixture.fixture_point_sum
        fn.argtypes = [Point]
        fn.restype = c.c_int32
        self.assertEqual(fn(point), 1)

    def test_array_views(self):
        address = self.allocate(16)
        values = (c.c_uint8 * 16).from_address(address)
        self.cmemset(address, 2, 4)
        self.assertEqual(values[3], 2)
        values[5] = 9
        self.assertEqual(c.string_at(address, 16)[5], 9)
        self.assertEqual(c.addressof(values), address)
        c.memmove(values, b"\x07\x07", 2)
        self.assertEqual(c.string_at(address, 2), b"\x07\x07")
