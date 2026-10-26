import unittest
from ctypes import alignment, c_int, c_int32, c_uint16, sizeof


class TestArrayCache(unittest.TestCase):
    def test_reuses_live_array_types(self):
        class Int(c_int32):
            pass

        array_type = c_int32 * 17
        distinct_element = Int * 17
        distinct_length = c_int32 * 18
        empty = c_int32 * 0
        self.assertIs(c_int32 * 17, array_type)
        self.assertIs(c_int * 17, array_type)
        self.assertIs(Int * 17, distinct_element)
        self.assertIs(c_int32 * 18, distinct_length)
        self.assertIs(c_int32 * -0, empty)
        self.assertIsNot(array_type, distinct_element)
        self.assertIsNot(array_type, distinct_length)

    def test_array_type_layout(self):
        array_type = c_uint16 * 11001
        self.assertIs(c_uint16 * 11001, array_type)
        self.assertEqual(len(array_type()), 11001)
        self.assertEqual(sizeof(array_type), 22002)
        self.assertEqual(alignment(array_type), alignment(c_uint16))


if __name__ == "__main__":
    unittest.main()
