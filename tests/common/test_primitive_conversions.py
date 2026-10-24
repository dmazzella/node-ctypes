"""Scalar and endian reference contracts; bool bitfields use the C oracle."""

import ctypes as c
from ctypes import wintypes
import unittest


class TestPrimitiveConversions(unittest.TestCase):
    def test_integer_wrapping(self):
        values = [0, 1, -1, -2, -3, -1000, -2049, 255, 256, 2**32,
                  -(2**32), 2**53, -(2**53), 2**63, -(2**63),
                  -(2**63) - 2048, 2**64, -(2**64), 2**128 + 7]
        for kind in [c.c_int8, c.c_uint8, c.c_int16, c.c_uint16,
                     c.c_int32, c.c_uint32, c.c_int64, c.c_uint64,
                     c.c_size_t, c.c_ssize_t, c.c_long, c.c_ulong]:
            bits = c.sizeof(kind) * 8
            signed = kind(-1).value < 0
            for value in values:
                expected = value % 2**bits
                if signed and expected >= 2**(bits - 1):
                    expected -= 2**bits
                self.assertEqual(kind(value).value, expected)

    def test_scalar_input_validation(self):
        for kind in [c.c_int32, c.c_uint64, c.c_float, c.c_double]:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            for value in [None, "2", {}, [], kind(2)]:
                with self.assertRaises(TypeError):
                    kind(value)
                if not isinstance(value, kind):
                    with self.assertRaises(TypeError):
                        Record().value = value
            record = Record()
            record.value = kind(3)
            self.assertEqual(record.value, 3)

    def test_variant_bool_instances(self):
        kind = wintypes.VARIANT_BOOL
        for value in [False, True, 0, 2, kind(False), kind(True), c.c_bool(False), c.c_int32(0)]:
            self.assertEqual(kind(value).value, bool(value))

    def test_recursive_endian_arrays(self):
        for base in [c.BigEndianStructure, c.BigEndianUnion]:
            class Record(base):
                _fields_ = [("values", (c.c_uint16 * 2) * 2)]
            record = Record()
            record.values[0][:] = [0x1122, 0x3344]
            record.values[1][:] = [0x5566, 0x7788]
            self.assertEqual(bytes(record).hex(), "1122334455667788")
            class Item(c.Structure):
                _fields_ = [("value", c.c_uint16)]
            class Nested(base):
                _fields_ = [("items", Item * 2)]
            nested = Nested()
            nested.items[0].value = 0x1122
            nested.items[1].value = 0x3344
            self.assertEqual(bytes(nested).hex(), "22114433")


if __name__ == "__main__":
    unittest.main()
