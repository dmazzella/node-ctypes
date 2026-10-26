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

    def test_integer_arguments_reject_non_numbers(self):
        functions = []
        llabs = "_abs64" if platform.system() == "Windows" else "llabs"
        for name, ctype in ((llabs, ctypes.c_longlong), ("labs", ctypes.c_long), ("abs", c_int)):
            f = getattr(self.libc, name)
            f.restype = ctype
            f.argtypes = [ctype]
            functions.append(f)
        for value in ("1", object(), None, 1.5):
            for f in functions:
                with self.assertRaises(ArgumentError) as cm:
                    f(value)
                self.assertEqual(str(cm.exception), f"argument 1: TypeError: '{type(value).__name__}' object cannot be interpreted as an integer")
        self.assertEqual(functions[0](2**64 - 3), 3)
        self.assertEqual(functions[0](True), 1)

    def test_integer_values_wrap(self):
        cases = [
            (ctypes.c_uint8, 256, 0),
            (ctypes.c_int8, 200, -56),
            (ctypes.c_uint16, -1, 65535),
            (ctypes.c_int16, 40000, -25536),
            (ctypes.c_int32, 2**40 + 5, 5),
            (ctypes.c_int32, 2**64 + 7, 7),
            (ctypes.c_uint32, -1, 4294967295),
            (ctypes.c_uint64, -1, 2**64 - 1),
            (ctypes.c_int64, 2**64 + 7, 7),
            (ctypes.c_long, 2**64 + 9, 9),
        ]
        for T, value, expected in cases:
            self.assertEqual(T(value).value, expected, f"{T.__name__}({value})")
        self.assertEqual(c_size_t(-1).value, 2 ** (8 * sizeof(c_size_t)) - 1)

        class S(Structure):
            _fields_ = [("a", ctypes.c_uint8), ("b", ctypes.c_int16), ("c", ctypes.c_uint64)]

        s = S()
        s.a = 300
        s.b = 40000
        s.c = -2
        self.assertEqual([s.a, s.b, s.c], [44, -25536, 2**64 - 2])
        self.assertEqual(list((ctypes.c_uint8 * 2)(300, -1)), [44, 255])

    def test_float_arguments_reject_non_numbers(self):
        # glibc has fabs in libm only.
        libm = CDLL(ctypes.util.find_library("m")) if platform.system() == "Linux" else self.libc
        fabs = libm.fabs
        fabs.restype = ctypes.c_double
        fabs.argtypes = [ctypes.c_double]
        self.assertEqual(fabs(-1.5), 1.5)
        with self.assertRaises(ArgumentError) as cm:
            fabs("1")
        self.assertEqual(str(cm.exception), "argument 1: TypeError: must be real number, not str")

    def test_float_for_integer_types(self):
        libc = CDLL(LIBC)
        abs_ = libc.abs
        abs_.argtypes = [c_int]
        for value in (3.7, float("nan"), float("inf")):
            with self.assertRaisesRegex(ArgumentError, "argument 1: TypeError: 'float' object cannot be interpreted as an integer"):
                abs_(value)
        self.assertEqual(abs_(-3), 3)  # JS: -3.0 === -3
        with self.assertRaisesRegex(TypeError, "'float' object cannot be interpreted as an integer"):
            ctypes.c_int32(3.7)

        class S(Structure):
            _fields_ = [("i", c_int)]

        with self.assertRaisesRegex(TypeError, "'float' object cannot be interpreted as an integer"):
            S().i = 3.5


if __name__ == "__main__":
    unittest.main()
