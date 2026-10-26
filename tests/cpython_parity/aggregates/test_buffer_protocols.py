"""Matched public contracts extracted from the original compatibility suite."""

import unittest
import platform
import ctypes
import ctypes.util
from ctypes import (
    CDLL,
    Structure,
    Union,
    POINTER,
    pointer,
    ARRAY,
    sizeof,
    alignment,
    CFUNCTYPE,
    ArgumentError,
    create_string_buffer,
    create_unicode_buffer,
    c_buffer,
    c_int,
    c_char,
    c_wchar,
    c_char_p,
    c_void_p,
    c_size_t,
)
from .._support import LIBC

SKIP_CPYTHON_WINDOWS_ARM64_VARIADIC = unittest.skipIf(
    platform.system() == "Windows" and platform.machine().lower() in ("arm64", "aarch64"),
    "CPython on Windows does not use ffi_prep_cif_var: variadic doubles go in the wrong registers on ARM64",
)


class TestPythonParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.libc = CDLL(LIBC)

    def test_rejections(self):
        class P(Structure):
            _fields_ = [("x", c_int)]

        with self.assertRaisesRegex(TypeError, "too many initializers"):
            P(1, 2)
        self.assertEqual(P(c_int(5)).x, 5)
        with self.assertRaisesRegex(TypeError, "incompatible types, c_double instance instead of"):
            P().x = ctypes.c_double(1)

        class N(Structure):
            _fields_ = [("name", c_char * 4)]

        n = N()
        with self.assertRaisesRegex(ValueError, r"bytes too long \(7, maximum length 4\)"):
            n.name = b"toolong"
        n.name = b"ab"
        self.assertEqual(n.name, b"ab")
        with self.assertRaisesRegex(TypeError, "bit fields not allowed for type c_float"):

            class B(Structure):
                _fields_ = [("f", ctypes.c_float, 3)]

        a = (c_char * 8)()
        a.value = "héllo".encode()
        self.assertEqual(a.value.decode(), "héllo")

    def test_from_buffer_offset(self):
        class P(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        buf = bytearray(16)
        with self.assertRaisesRegex(ValueError, "offset cannot be negative"):
            P.from_buffer(buf, -4)
        with self.assertRaisesRegex(ValueError, "offset cannot be negative"):
            P.from_buffer_copy(bytes(buf), -1)
        with self.assertRaisesRegex(ValueError, r"Buffer size too small \(16 instead of at least 20 bytes\)"):
            P.from_buffer(buf, 12)
        self.assertEqual(P.from_buffer((c_int * 4)(1, 2, 3, 4), 4).x, 2)

    def test_array_elements(self):
        a = (c_int * 3)(1, 2, 300)
        self.assertEqual(a[0:2], [1, 2])
        self.assertEqual(a[-1], 300)
        self.assertIn(300, a)
        self.assertEqual(list(a).index(2), 1)
        self.assertEqual([v * 2 for v in a], [2, 4, 600])
        self.assertEqual(",".join(map(str, a)), "1,2,300")
        a[:] = [7] * 3
        self.assertEqual(list(a), [7, 7, 7])
        s = (c_char * 6)()
        s.value = b"abc"
        self.assertEqual(s[0:3], b"abc")
        self.assertEqual((c_wchar * 4)("x", "y")[0:2], "xy")

    def test_create_string_buffer(self):
        buf = create_string_buffer(b"Hello", 10)
        self.assertEqual(sizeof(buf), 10)
        self.assertEqual(buf.value, b"Hello")
        self.assertEqual(list(buf.raw), [72, 101, 108, 108, 111, 0, 0, 0, 0, 0])
        buf.value = b"Hi"
        self.assertEqual(buf.value, b"Hi")
        with self.assertRaises(ValueError):
            create_string_buffer(b"Hello", 3)
        self.assertEqual(create_unicode_buffer("ok", 5).value, "ok")

    def test_array_call(self):
        Int3 = c_int * 3
        a = Int3(1, 2, 3)
        self.assertEqual([a[0], a[1], a[2]], [1, 2, 3])
        self.assertEqual(Int3(4)[0], 4)

    def test_char_array(self):
        Chars = c_char * 4
        c = Chars(b"a", b"b")
        self.assertEqual(c.value, b"ab")
        self.assertEqual(list(c.raw), [97, 98, 0, 0])
        with self.assertRaises(TypeError) as cm:
            Chars(b"ab")
        self.assertEqual(str(cm.exception), "one character bytes, bytearray, or an integer in range(256) expected, not bytes of length 2")

    def test_array_of_arrays(self):
        Matrix = (c_int * 2) * 2
        m = Matrix()
        m[1][0] = 5
        self.assertEqual(m[1][0], 5)
        self.assertEqual(sizeof(Matrix), 4 * sizeof(c_int))


if __name__ == "__main__":
    unittest.main()
