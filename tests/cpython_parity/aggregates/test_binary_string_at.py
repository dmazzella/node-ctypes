import unittest
from ctypes import ArgumentError, addressof, c_uint8, create_string_buffer, sizeof, string_at


class TestBinaryStringAt(unittest.TestCase):
    def test_exact_sized_bytes(self):
        value = (c_uint8 * 4)(0, 0x80, 0xFF, 0xDA)
        raw = string_at(addressof(value), sizeof(value))
        self.assertIsInstance(raw, bytes)
        self.assertEqual(len(raw), 4)
        self.assertEqual(raw, bytes([0, 0x80, 0xFF, 0xDA]))
        self.assertEqual(string_at(value, sizeof(value)), bytes([0, 0x80, 0xFF, 0xDA]))

    def test_sized_embedded_nul(self):
        value = create_string_buffer(bytes([0x41, 0, 0x42, 0xFF]), 4)
        raw = string_at(addressof(value), sizeof(value))
        self.assertEqual(raw, bytes([0x41, 0, 0x42, 0xFF]))

    def test_zero_length(self):
        value = create_string_buffer(b"Hello")
        for source in [value, addressof(value), None, 0]:
            self.assertEqual(string_at(source, 0), b"")

    def test_text_without_size(self):
        value = create_string_buffer(b"Hello\0ignored")
        self.assertEqual(string_at(addressof(value)), b"Hello")
        self.assertEqual(string_at(value), b"Hello")

    def test_sized_text(self):
        value = create_string_buffer(b"Hello, world!")
        self.assertEqual(string_at(addressof(value), 5), b"Hello")
        self.assertEqual(string_at(value, 5), b"Hello")

    def test_utf8_text_and_sized_bytes(self):
        value = create_string_buffer("café".encode("utf8"))
        self.assertEqual(string_at(addressof(value)), "café".encode("utf8"))
        self.assertEqual(string_at(addressof(value), sizeof(value)), "café\0".encode("utf8"))

    def test_invalid_address(self):
        with self.assertRaises(ArgumentError):
            string_at({})
        with self.assertRaises(ArgumentError):
            string_at({}, 0)
        with self.assertRaises(ArgumentError):
            string_at({}, 1)


if __name__ == "__main__":
    unittest.main()
