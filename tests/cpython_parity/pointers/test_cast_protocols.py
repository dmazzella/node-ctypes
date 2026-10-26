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

    def test_addressof_array_and_pointer_arrays(self):
        ints = (c_int * 3)(7, 8, 9)
        p = ctypes.cast(ctypes.addressof(ints), POINTER(c_int))
        self.assertEqual([p[0], p[2]], [7, 9])

        class Mod(Structure):
            _fields_ = [("op", c_int), ("name", ctypes.c_wchar_p)]

        PMods = POINTER(Mod) * 3
        a, b = Mod(1, "cn"), Mod(2, "mail")
        mods = PMods(pointer(a), pointer(b))
        self.assertEqual(sizeof(PMods), 3 * sizeof(c_void_p))
        self.assertEqual([mods[0].contents.name, mods[1].contents.op, bool(mods[2])], ["cn", 2, False])
        with self.assertRaises(TypeError):
            mods[2] = lambda: 0

        pp = ctypes.cast(ctypes.addressof(mods), POINTER(POINTER(Mod)))
        self.assertEqual([pp[0].contents.name, pp[1].contents.op, bool(pp[2])], ["cn", 2, False])
        c = Mod(3, "sn")
        pp[2] = pointer(c)
        self.assertEqual(mods[2].contents.name, "sn")

    def test_pointer_restype(self):
        strchr = self.libc.strchr
        strchr.restype = POINTER(c_char)
        strchr.argtypes = [c_char_p, c_int]
        p = strchr(b"abc", 98)
        self.assertEqual(p.contents.value, b"b")
        self.assertFalse(strchr(b"abc", 120))

    def test_cast_char_p(self):
        p = ctypes.cast(c_char_p(b"abc"), POINTER(c_char))
        self.assertEqual([p[0], p[1], p[2]], [b"a", b"b", b"c"])
        w = ctypes.cast(ctypes.c_wchar_p("xy"), POINTER(c_wchar))
        self.assertEqual([w[0], w[1]], ["x", "y"])

    def test_cast_to_simple_pointers(self):
        import gc

        buf = create_string_buffer(b"hello")
        v = ctypes.cast(buf, c_void_p)
        self.assertIsInstance(v, c_void_p)
        self.assertEqual(v.value, ctypes.addressof(buf))
        self.assertEqual(ctypes.cast(ctypes.addressof(buf), c_char_p).value, b"hello")
        self.assertEqual(ctypes.cast(c_void_p(ctypes.addressof(buf)), c_char_p).value, b"hello")
        s = ctypes.cast(create_string_buffer(b"kept"), c_char_p)
        gc.collect()
        self.assertEqual(s.value, b"kept")
        self.assertEqual(ctypes.cast(create_unicode_buffer("wz"), ctypes.c_wchar_p).value, "wz")
        p = pointer(c_int(7))
        self.assertEqual(ctypes.cast(p, c_void_p).value, ctypes.addressof(p.contents))

    def test_type_identity(self):
        self.assertIs(POINTER(c_int), POINTER(c_int))
        self.assertIs(c_int * 4, c_int * 4)
        self.assertIsNot(c_int * 4, c_int * 5)
        self.assertIs(type(pointer(c_int(1))), POINTER(c_int))

    def test_pointer_to_array(self):
        a = (c_int * 3)(1, 2, 3)
        p = pointer(a)
        self.assertEqual(p.contents[1], 2)
        p.contents[1] = 20
        self.assertEqual(a[1], 20)
        self.assertEqual(ctypes.addressof(p.contents), ctypes.addressof(a))

    def test_contents_same_size_type(self):
        p = POINTER(ctypes.c_uint32)()
        p.contents = c_int(-1)
        self.assertEqual(p.contents.value, 4294967295)

    def test_rejects_non_pointers(self):
        memset = self.libc.memset
        memset.restype = c_void_p
        memset.argtypes = [c_void_p, c_int, c_size_t]
        for v in (lambda: 0, object(), 3.5):
            with self.assertRaises(ArgumentError) as cm:
                memset(v, 0, 0)
            name = type(v).__name__
            self.assertEqual(str(cm.exception), f"argument 1: TypeError: '{name}' object cannot be interpreted as ctypes.c_void_p")


if __name__ == "__main__":
    unittest.main()
