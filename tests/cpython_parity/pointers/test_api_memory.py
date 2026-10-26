"""Pointer compatibility, buffer bounds and memory return contracts."""

import ctypes as c
import unittest
from .._support import FIXTURE


class TestApiCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib = c.CDLL(str(FIXTURE))

    def test_typed_pointer_compatibility(self):
        class Derived(c.c_int32):
            pass
        value, derived = c.c_int32(7), Derived(7)
        array = (c.c_int32 * 2)()
        fn = self.lib.fixture_address
        fn.argtypes = [c.POINTER(c.c_int32)]
        fn.restype = c.c_size_t
        for source, expected in [
            (None, 0), (value, c.addressof(value)), (derived, c.addressof(derived)),
            (c.pointer(value), c.addressof(value)), (array, c.addressof(array)),
            (c.byref(value), c.addressof(value)),
        ]:
            self.assertEqual(fn(source), expected)
        for incompatible in [c.c_double(2), c.pointer(c.c_double(2)), c.byref(c.c_double(2)), c.c_void_p()]:
            with self.assertRaises(c.ArgumentError):
                fn(incompatible)

    def test_scalar_buffer_bounds(self):
        for kind in [c.c_int32, c.c_uint64, c.c_double, c.c_void_p]:
            for method in ["from_buffer", "from_buffer_copy"]:
                factory = getattr(kind, method)
                with self.assertRaises(ValueError):
                    factory(bytearray(c.sizeof(kind) - 1))
                with self.assertRaises(ValueError):
                    factory(bytearray(16), -1)
                with self.assertRaises(ValueError):
                    factory(bytearray(16), 17)

    def test_signed_byref_offset(self):
        value = c.c_int32()
        base = c.addressof(value)
        for offset in [-4, 0, 1, 4, 8]:
            self.assertEqual(c.cast(c.byref(value, offset), c.c_void_p).value, base + offset)

    def test_memory_returns(self):
        destination, source = c.create_string_buffer(8), c.create_string_buffer(b"abc")
        self.assertEqual(c.memmove(destination, source, 4), c.addressof(destination))
        self.assertEqual(c.memset(destination, 0, 4), c.addressof(destination))

    def test_structure_pointer_covariance(self):
        class Base(c.Structure):
            _fields_ = [("x", c.c_int32)]
        class Derived(Base):
            _fields_ = [("y", c.c_int32)]
        fn = self.lib.fixture_address
        fn.argtypes = [c.POINTER(Base)]
        fn.restype = c.c_size_t
        value = Derived(1, 2)
        self.assertEqual(fn(value), c.addressof(value))
        self.assertEqual(fn(c.pointer(value)), c.addressof(value))
