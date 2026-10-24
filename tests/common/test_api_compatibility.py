"""Phase 4 API reference contracts, without unsafe pointer reads."""

import ctypes as c
import unittest


class TestApiCompatibility(unittest.TestCase):
    def test_typed_pointer_compatibility(self):
        class Derived(c.c_int32):
            pass
        pointer = c.POINTER(c.c_int32)
        value = c.c_int32(7)
        for compatible in [None, value, Derived(7), c.pointer(value), (c.c_int32 * 2)(), c.byref(value)]:
            pointer.from_param(compatible)
        for incompatible in [c.c_double(2), c.pointer(c.c_double(2)), c.byref(c.c_double(2)), c.c_void_p()]:
            with self.assertRaises(TypeError):
                pointer.from_param(incompatible)

    def test_recursive_adapter(self):
        class Adapter:
            def __init__(self, value):
                self._as_parameter_ = value
        c.c_int32.from_param(Adapter(Adapter(c.c_int32(7))))

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

    def test_ms_pack(self):
        for pack in [0, 1, 2, 3, 4, 5, True, False, 3.9, "3", None]:
            class Record(c.Structure):
                _layout_ = "ms"
                _pack_ = pack
                _fields_ = [("a", c.c_uint8), ("b", c.c_uint32)]
            value = int(pack) if pack is not None else 0
            alignment = min(value, 4) if value else 4
            offset = value if value in [1, 2, 3] else 4
            self.assertEqual(c.alignment(Record), alignment)
            self.assertEqual(Record.b.offset, offset)

    def test_explicit_gcc_pack(self):
        for pack in [0, False, 3]:
            with self.assertRaises(ValueError):
                class Invalid(c.Structure):
                    _layout_ = "gcc-sysv"
                    _pack_ = pack
                    _fields_ = [("value", c.c_int32)]


if __name__ == "__main__":
    unittest.main()
