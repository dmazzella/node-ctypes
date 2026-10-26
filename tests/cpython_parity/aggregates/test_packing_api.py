import math
import sys
import unittest
from ctypes import Structure, Union, addressof, alignment, c_int32, c_uint8, c_uint32, sizeof, string_at


@unittest.skipIf(sys.version_info < (3, 14), "_layout_ requires Python 3.14+")
class TestPackingAPI(unittest.TestCase):
    def test_ms_pack_values(self):
        for pack in [0, 1, 2, 3, 4, 5, True, False, 3.9, "3", None]:
            for base in [Structure, Union]:
                with self.subTest(pack=pack, base=base.__name__):
                    class Record(base):
                        _layout_ = "ms"
                        _pack_ = pack
                        _fields_ = [("a", c_uint8), ("b", c_uint32)]

                    value = 0 if pack is None else int(pack)
                    expected_alignment = min(value, 4) if value else 4
                    offset = 0 if base is Union else value if value in [1, 2, 3] else 4
                    size = math.ceil((4 if base is Union else offset + 4) / expected_alignment) * expected_alignment
                    self.assertEqual(sizeof(Record), size)
                    self.assertEqual(alignment(Record), expected_alignment)
                    self.assertEqual(Record.b.offset, offset)
                    record = Record()
                    record.b = 0x11223344
                    self.assertEqual(int.from_bytes(string_at(addressof(record), sizeof(record))[offset:offset + 4], "little"), 0x11223344)

    def test_explicit_gcc_pack(self):
        for pack in [0, 1, 3, False]:
            with self.assertRaisesRegex(ValueError, "_pack_.*gcc-sysv"):
                class Record(Structure):
                    _layout_ = "gcc-sysv"
                    _pack_ = pack
                    _fields_ = [("value", c_int32)]

                sizeof(Record)

        class Unset(Structure):
            _layout_ = "gcc-sysv"
            _pack_ = None
            _fields_ = [("value", c_int32)]

        self.assertEqual(sizeof(Unset), 4)

    def test_invalid_pack_values(self):
        for pack in [-1, math.inf, math.nan, {}, "3.5", 2**31]:
            with self.assertRaises((ValueError, OverflowError)):
                class Record(Structure):
                    _pack_ = pack
                    _fields_ = [("value", c_int32)]

                sizeof(Record)

    def test_non_power_two_layout(self):
        class Record(Structure):
            _layout_ = "ms"
            _pack_ = 3
            _fields_ = [("a", c_uint8), ("b", c_uint32)]

        self.assertEqual(sizeof(Record), 9)
        self.assertEqual(alignment(Record), 3)
        self.assertEqual(Record.b.offset, 3)
        record = Record()
        record.b = 0x11223344
        self.assertEqual(int.from_bytes(string_at(addressof(record), sizeof(record))[3:7], "little"), 0x11223344)


if __name__ == "__main__":
    unittest.main()
