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

    def test_integer_like_field_names_keep_order(self):
        class S(Structure):
            _fields_ = [("a", ctypes.c_int8), ("1", c_int)]

        s = S()
        s.a = 1
        setattr(s, "1", 2)
        self.assertEqual(sizeof(S), 8)
        self.assertEqual(list(bytes(s)), [1, 0, 0, 0, 2, 0, 0, 0])

    def test_union_anonymous_members(self):
        class P(Structure):
            _fields_ = [("x", c_int)]

        class Q(Structure):
            _fields_ = [("p", P), ("z", c_int)]
            _anonymous_ = ["p"]

        class U(Union):
            _fields_ = [("q", Q), ("i", c_int)]
            _anonymous_ = ["q"]

        u = U()
        u.x = 7
        self.assertEqual([u.i, u.x, u.z, u.q.p.x], [7, 7, 0, 7])

    def test_malformed_fields(self):
        with self.assertRaisesRegex(ValueError, r"_fields_ must be a sequence of \(name, C type\) pairs"):
            class M(Structure):
                _fields_ = [("x",)]

    def test_struct_positional_instance(self):
        class POINT(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        class RECT(Structure):
            _fields_ = [("a", POINT), ("b", POINT)]

        r = RECT(POINT(1, 2), POINT(3, 4))
        self.assertEqual([r.a.x, r.b.y], [1, 4])

    def test_nested_field_is_instance_on_same_memory(self):
        class POINT(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        class RECT(Structure):
            _fields_ = [("a", POINT), ("b", POINT)]

        class Value(Union):
            _fields_ = [("p", POINT), ("n", ctypes.c_int64)]

        r = RECT(POINT(1, 2), POINT(3, 4))
        a = r.a
        self.assertIsInstance(a, POINT)
        a.x = 10
        self.assertEqual(r.a.x, 10)
        r.a = POINT(5, 6)
        self.assertEqual([a.x, a.y], [5, 6])
        self.assertEqual(ctypes.addressof(r.b), ctypes.addressof(r) + sizeof(POINT))
        v = Value()
        v.p.y = 7
        self.assertIsInstance(v.p, POINT)
        self.assertEqual(v.n, 7 << 32)

    def test_nested_instances_copied_bytewise(self):
        class Data(Union):
            _fields_ = [("s", ctypes.c_wchar_p), ("Integer", ctypes.c_ulong)]

        class Value(Structure):
            _fields_ = [("dwType", ctypes.c_ulong), ("Value", Data)]

        v = Value(7, Data(Integer=1000))
        self.assertEqual([v.dwType, v.Value.Integer], [7, 1000])
        prefs = (Value * 2)(v, Value(6, Data(s="text")))
        self.assertEqual([prefs[0].Value.Integer, prefs[1].Value.s], [1000, "text"])

    def test_char_array_field(self):
        class Named(Structure):
            _fields_ = [("name", c_char * 8)]

        n = Named()
        n.name = b"abc"
        self.assertEqual(n.name, b"abc")

    def test_null_pointer_field(self):
        class Node(Structure):
            _fields_ = [("next", POINTER(c_int))]

        self.assertFalse(Node().next)

    def test_pointer_contents_instance(self):
        class POINT(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        p = POINT(3, 4)
        pp = pointer(p)
        self.assertIsInstance(pp.contents, POINT)
        pp.contents.x = 7
        self.assertEqual(p.x, 7)

    def test_cfunctype_fields(self):
        FT = CFUNCTYPE(c_int, c_int)

        class Ops(Structure):
            _fields_ = [("n", c_int), ("f", FT)]

        class OpsU(Union):
            _fields_ = [("f", FT), ("i", c_int)]

        cb = FT(lambda x: x * 3)
        o = Ops(1, cb)
        self.assertEqual(o.f(14), 42)
        self.assertFalse(Ops().f)
        u = OpsU()
        u.f = cb
        self.assertEqual(u.f(5), 15)
        with self.assertRaises(TypeError):
            o.f = lambda x: x
        self.assertEqual(sizeof(Ops), 2 * sizeof(c_void_p))
        self.assertEqual(sizeof(FT), sizeof(c_void_p))
        self.assertEqual(alignment(FT), alignment(c_void_p))


if __name__ == "__main__":
    unittest.main()
