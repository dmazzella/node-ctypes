import struct
import unittest
from ctypes import BigEndianStructure, BigEndianUnion, Structure, addressof, c_float, c_uint8, c_uint16, sizeof, string_at


class TestEndianArrays(unittest.TestCase):
    def test_primitive_arrays(self):
        for base in [BigEndianStructure, BigEndianUnion]:
            A = c_uint16 * 2

            class BE(base):
                _fields_ = [("values", A)]

            class LE(Structure):
                _fields_ = [("values", A)]

            value = BE()
            value.values = (0x1122, 0x3344)
            self.assertEqual(string_at(addressof(value), sizeof(value)).hex(), "11223344")
            self.assertEqual(list(value.values), [0x1122, 0x3344])
            value.values[1] = 0x5566
            self.assertEqual(string_at(addressof(value), sizeof(value)).hex(), "11225566")
            little = LE()
            little.values = (0x1122, 0x3344)
            self.assertEqual(string_at(addressof(little), sizeof(little)).hex(), "22114433")
            native = A(0x1122, 0x3344)
            self.assertEqual(string_at(addressof(native), sizeof(native)).hex(), "22114433")
            self.assertIs(c_uint16 * 2, A)

    def test_multidimensional_and_nested_struct_arrays(self):
        for base in [BigEndianStructure, BigEndianUnion]:
            class Item(Structure):
                _fields_ = [("value", c_uint16)]

            class BE(base):
                _fields_ = [("matrix", (c_uint16 * 2) * 2)]

            value = BE()
            value.matrix = ((0x1122, 0x3344), (0x5566, 0x7788))
            self.assertEqual(string_at(addressof(value), sizeof(value)).hex(), "1122334455667788")
            self.assertEqual([list(row) for row in value.matrix], [[0x1122, 0x3344], [0x5566, 0x7788]])
            value.matrix[1][0] = 0x99AA
            self.assertEqual(string_at(addressof(value), sizeof(value)).hex(), "1122334499aa7788")

            class Nested(base):
                _fields_ = [("items", Item * 2)]

            nested = Nested()
            nested.items[0].value = 0x1122
            nested.items[1].value = 0x3344
            self.assertEqual(string_at(addressof(nested), sizeof(nested)).hex(), "22114433")

    def test_float_arrays_on_existing_memory(self):
        for base in [BigEndianStructure, BigEndianUnion]:
            class Floats(base):
                _fields_ = [("values", c_float * 2)]

            source = bytearray(8)
            value = Floats.from_address(addressof(c_uint8.from_buffer(source)))
            value.values = (1.5, -2.25)
            self.assertEqual(source.hex(), "3fc00000c0100000")
            source[4:8] = struct.pack(">f", 3.5)
            self.assertEqual(list(value.values), [1.5, 3.5])


if __name__ == "__main__":
    unittest.main()
