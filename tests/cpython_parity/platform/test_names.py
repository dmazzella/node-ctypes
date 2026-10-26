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

    def test_names(self):
        self.assertIs(ctypes.c_voidp, c_void_p)
        self.assertEqual(sizeof(ctypes.c_time_t), 8)
        self.assertEqual(ctypes.SIZEOF_TIME_T, 8)
        self.assertIsInstance(ctypes.RTLD_GLOBAL, int)
        self.assertIsInstance(ctypes.RTLD_LOCAL, int)
        self.assertEqual(ctypes.DEFAULT_MODE, ctypes.RTLD_LOCAL)
        self.assertEqual(sizeof(ARRAY(c_int, 3)), 3 * sizeof(c_int))
        self.assertEqual(c_buffer(b"ab").value, b"ab")

    @unittest.skipUnless(platform.system() == "Windows", "Python exposes get/set_last_error only on Windows")
    def test_set_last_error_returns_previous(self):
        old = ctypes.set_last_error(5)
        self.assertEqual(ctypes.set_last_error(old), 5)
        self.assertEqual(ctypes.get_last_error(), old)


if __name__ == "__main__":
    unittest.main()
