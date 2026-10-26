"""Explicit layout mode and packing conversion contracts."""

import ctypes as c
import unittest


class TestApiCompatibility(unittest.TestCase):
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
                c.sizeof(Invalid)
