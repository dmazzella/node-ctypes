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

    def test_char_values(self):
        self.assertEqual(c_char(b"A").value, b"A")
        self.assertEqual(c_char(66).value, b"B")
        self.assertEqual(c_wchar("é").value, "é")

    def test_char_rejects(self):
        for v, message in (
            (b"", "one character bytes, bytearray, or an integer in range(256) expected, not bytes of length 0"),
            (b"ab", "one character bytes, bytearray, or an integer in range(256) expected, not bytes of length 2"),
            (bytearray(b"ab"), "one character bytes, bytearray, or an integer in range(256) expected, not bytearray of length 2"),
            (None, "one character bytes, bytearray, or an integer in range(256) expected, not NoneType"),
            (256, "integer not in range(256)"),
            (-1, "integer not in range(256)"),
        ):
            with self.assertRaises(TypeError) as cm:
                c_char(v)
            self.assertEqual(str(cm.exception), message)
        for v, message in (
            ("", "a unicode character expected, not a string of length 0"),
            ("ab", "a unicode character expected, not a string of length 2"),
            (None, "a unicode character expected, not instance of NoneType"),
        ):
            with self.assertRaises(TypeError) as cm:
                c_wchar(v)
            self.assertEqual(str(cm.exception), message)

    def test_char_argument(self):
        strchr = self.libc.strchr
        strchr.restype = c_char_p
        strchr.argtypes = [c_char_p, c_char]
        self.assertEqual(strchr(b"abcdef", b"d"), b"def")
        self.assertEqual(strchr(b"abcdef", bytearray(b"e")), b"ef")
        with self.assertRaises(ArgumentError) as cm:
            strchr(b"abcdef", b"de")
        self.assertEqual(str(cm.exception), "argument 2: TypeError: one character bytes, bytearray, or an integer in range(256) expected, not bytes of length 2")

    def test_wide_strings_outside_bmp(self):
        wcslen = self.libc.wcslen
        wcslen.restype = c_size_t
        wcslen.argtypes = [ctypes.c_wchar_p]
        wcschr = self.libc.wcschr
        wcschr.restype = ctypes.c_wchar_p
        wcschr.argtypes = [ctypes.c_wchar_p, c_wchar]
        units = 4 if sizeof(c_wchar) == 2 else 3
        self.assertEqual(wcslen("a😀b"), units)
        self.assertEqual(wcschr("x😀ab", "a"), "ab")
        self.assertEqual(wcschr("a\ud800b", "b"), "b")
        self.assertEqual(ctypes.wstring_at(create_unicode_buffer("a\ud800b")), "a\ud800b")
        self.assertEqual(ctypes.wstring_at(create_unicode_buffer("a😀b")), "a😀b")
        if sizeof(c_wchar) == 4:
            self.assertEqual(wcschr("a😀b", "😀"), "😀b")
            self.assertEqual(c_wchar("😀").value, "😀")

    def test_wchar_argument(self):
        wcschr = self.libc.wcschr
        wcschr.restype = ctypes.c_wchar_p
        wcschr.argtypes = [ctypes.c_wchar_p, c_wchar]
        for value, message in (
            ("ab", "a unicode character expected, not a string of length 2"),
            ("", "a unicode character expected, not a string of length 0"),
            (None, "a unicode character expected, not instance of NoneType"),
            (b"a", "a unicode character expected, not instance of bytes"),
        ):
            with self.assertRaises(ArgumentError) as cm:
                wcschr("abc", value)
            self.assertEqual(str(cm.exception), f"argument 2: TypeError: {message}")


if __name__ == "__main__":
    unittest.main()
