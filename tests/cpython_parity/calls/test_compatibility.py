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

    def test_load_library_new_instance(self):
        a = ctypes.cdll.LoadLibrary(LIBC)
        b = ctypes.LibraryLoader(CDLL).LoadLibrary(LIBC)
        self.assertIsNot(a, b)
        self.assertEqual(a.abs(-3), 3)

    def test_default_restype_c_int(self):
        self.assertEqual(self.libc.abs(-5), 5)

    def test_none_restype_returns_none(self):
        srand = self.libc.srand
        srand.argtypes = [ctypes.c_uint32]
        srand.restype = None
        self.assertIsNone(srand(1))
        prototype = CFUNCTYPE(None, ctypes.c_uint32)
        self.assertIsNone(prototype(("srand", self.libc))(2))

    def test_prototype_as_parameter(self):
        class Argument:
            _as_parameter_ = -9

        prototype = CFUNCTYPE(c_int, c_int)
        self.assertEqual(prototype(("abs", self.libc))(Argument()), 9)

    @SKIP_CPYTHON_WINDOWS_ARM64_VARIADIC
    def test_variadic_instances_keep_type(self):
        sprintf = self.libc.sprintf
        sprintf.restype = c_int
        sprintf.argtypes = [c_char_p, c_char_p]
        buf = ctypes.create_string_buffer(128)
        # Python does not promote c_float, c_int8, c_char... (ffi_prep_cif_var
        # fails); node-ctypes applies the C variadic promotions.
        sprintf(buf, b"%.1f %d %lld|", ctypes.c_double(2.0), c_int(-3), ctypes.c_longlong(1 << 40))
        self.assertEqual(buf.value, b"2.0 -3 1099511627776|")

    def test_errcheck_func(self):
        libc = CDLL(LIBC)
        abs_ = libc.abs
        abs_.argtypes = [c_int]
        seen = []
        abs_.errcheck = lambda result, func, args: (seen.append(func), result)[1]
        self.assertEqual(abs_(-3), 3)
        self.assertIs(seen[-1], abs_)
        malloc = libc.malloc
        malloc.argtypes = [c_size_t]
        malloc.restype = POINTER(c_int)
        malloc.errcheck = lambda result, func, args: (seen.append(func), result)[1]
        free = libc.free
        free.argtypes = [c_void_p]
        free.restype = None
        free(malloc(8))
        self.assertIs(seen[-1], malloc)
        del abs_.errcheck  # JS: errcheck = null / undefined
        abs_.argtypes = None
        self.assertIsNone(abs_.argtypes)
        self.assertEqual(abs_(-5), 5)

    def test_callback_struct_by_value(self):
        class P(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        T = CFUNCTYPE(c_int, P, c_int)
        cb = T(lambda p, k: p.x * k + p.y)
        self.assertEqual(T(ctypes.cast(cb, c_void_p).value)(P(3, 4), 10), 34)
        with self.assertRaisesRegex(TypeError, "invalid result type for callback function"):
            CFUNCTYPE(P, c_int)(lambda i: P(1, 2))

    def test_callback_returns_string(self):
        import warnings

        with warnings.catch_warnings():
            # "memory leak in callback function": Python keeps the bytes alive.
            warnings.simplefilter("ignore", RuntimeWarning)
            T = CFUNCTYPE(c_char_p)
            cb = T(lambda: b"abc")
            self.assertEqual(T(ctypes.cast(cb, c_void_p).value)(), b"abc")
            W = CFUNCTYPE(ctypes.c_wchar_p)
            wcb = W(lambda: "xy")
            self.assertEqual(W(ctypes.cast(wcb, c_void_p).value)(), "xy")

    def test_prototype_name_library_paramflags(self):
        strlen = CFUNCTYPE(c_size_t, c_char_p)(("strlen", self.libc))
        self.assertEqual(strlen(b"hello"), 5)
        modf = CFUNCTYPE(ctypes.c_double, ctypes.c_double, POINTER(ctypes.c_double))(("modf", self.libc), ((1, "x"), (2, "iptr")))
        self.assertEqual(modf(3.75), 3)
        self.assertEqual(modf(x=-2.5), -2)

    def test_function_not_cfunctype_argument(self):
        CMP = CFUNCTYPE(c_int, c_void_p, c_void_p)
        qsort = self.libc.qsort
        qsort.restype = None
        qsort.argtypes = [c_void_p, c_size_t, c_size_t, CMP]
        with self.assertRaises(ArgumentError) as cm:
            qsort(create_string_buffer(8), 2, 4, lambda a, b: 0)
        self.assertTrue(str(cm.exception).startswith("argument 4: TypeError"))


if __name__ == "__main__":
    unittest.main()
