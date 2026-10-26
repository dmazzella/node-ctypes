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

    def test_memmove_memset(self):
        words = (ctypes.c_uint16 * 4)(1, 2, 3, 4)
        data = (ctypes.c_uint8 * 8)()
        ctypes.memmove(data, words, 8)
        self.assertEqual(list((ctypes.c_uint16 * 4).from_buffer(data)), [1, 2, 3, 4])
        raw = (ctypes.c_uint8 * 4)()
        ctypes.memset(raw, 0x7F, 2)
        self.assertEqual(list(raw), [0x7F, 0x7F, 0, 0])
        ints = (c_int * 4)(1, 2, 3, 4)
        ctypes.memmove(ctypes.addressof(ints) + sizeof(c_int), ints, 3 * sizeof(c_int))
        self.assertEqual(list(ints), [1, 1, 2, 3])

    def test_string_at_sources(self):
        buf = create_string_buffer(b"hello")
        addr = ctypes.addressof(buf)
        self.assertEqual(ctypes.string_at(buf), b"hello")
        self.assertEqual(ctypes.string_at(c_char_p(b"world")), b"world")
        self.assertEqual(ctypes.string_at(c_void_p(addr)), b"hello")
        self.assertEqual(ctypes.string_at(ctypes.cast(addr, POINTER(c_char))), b"hello")
        self.assertEqual(ctypes.string_at((c_char * 8).from_buffer(bytearray(b"arr\0xxxx"))), b"arr")

        class P:
            _as_parameter_ = addr

        self.assertEqual(ctypes.string_at(P(), 3), b"hel")
        self.assertEqual(ctypes.wstring_at(create_unicode_buffer("wide")), "wide")
        self.assertEqual(ctypes.wstring_at(ctypes.c_wchar_p("wz")), "wz")
        with self.assertRaises(ctypes.ArgumentError):
            ctypes.string_at(object())

    def test_long_strings(self):
        big = create_string_buffer(2 * 1024 * 1024)
        ctypes.memset(big, 0x41, len(big) - 1)
        self.assertEqual(len(ctypes.string_at(ctypes.addressof(big))), len(big) - 1)
        self.assertEqual(len(c_char_p(ctypes.addressof(big)).value), len(big) - 1)

    def test_string_at_exact_size(self):
        b = create_string_buffer(b"A\0BC", 6)
        self.assertEqual(ctypes.string_at(b, 4), b"A\0BC")
        self.assertEqual(ctypes.string_at(ctypes.addressof(b)), b"A")
        w = create_unicode_buffer("ab\0cd", 6)
        self.assertEqual(ctypes.wstring_at(w, 5), "ab\0cd")
        self.assertEqual(ctypes.wstring_at(ctypes.addressof(w)), "ab")

        class S(Structure):
            _fields_ = [("s", ctypes.c_wchar_p)]

        long = "x" * 5000 + "é😀"
        st = S()
        st.s = long
        self.assertEqual(st.s, long)

    def test_void_p_accepts_bytes(self):
        memcpy = self.libc.memcpy
        memcpy.restype = c_void_p
        memcpy.argtypes = [c_void_p, c_void_p, c_size_t]
        dst = create_string_buffer(3)
        memcpy(dst, b"abc", 3)
        self.assertEqual(dst.raw, b"abc")


if __name__ == "__main__":
    unittest.main()
