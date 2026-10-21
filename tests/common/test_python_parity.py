"""
Test Python ctypes parity (2.0) - reference behavior for test_python_parity.js
"""

import unittest
import platform
import ctypes
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

if platform.system() == "Windows":
    LIBC = "msvcrt.dll"
elif platform.system() == "Darwin":
    LIBC = "libc.dylib"
else:
    LIBC = "libc.so.6"


class TestPythonParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.libc = CDLL(LIBC)

    # Names

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

    def test_load_library_new_instance(self):
        a = ctypes.cdll.LoadLibrary(LIBC)
        b = ctypes.LibraryLoader(CDLL).LoadLibrary(LIBC)
        self.assertIsNot(a, b)
        self.assertEqual(a.abs(-3), 3)

    def test_default_restype_c_int(self):
        self.assertEqual(self.libc.abs(-5), 5)

    # c_char / c_wchar

    def test_char_values(self):
        self.assertEqual(c_char(b"A").value, b"A")
        self.assertEqual(c_char(66).value, b"B")
        self.assertEqual(c_wchar("é").value, "é")

    def test_char_rejects(self):
        for v in (b"", b"ab", 256, -1):
            with self.assertRaisesRegex(TypeError, "^one character bytes, bytearray or integer expected$"):
                c_char(v)
        for v in ("", "ab"):
            with self.assertRaisesRegex(TypeError, "^one character unicode string expected$"):
                c_wchar(v)

    def test_char_argument(self):
        strchr = self.libc.strchr
        strchr.restype = c_char_p
        strchr.argtypes = [c_char_p, c_char]
        self.assertEqual(strchr(b"abcdef", b"d"), b"def")
        self.assertEqual(strchr(b"abcdef", bytearray(b"e")), b"ef")
        with self.assertRaises(ArgumentError) as cm:
            strchr(b"abcdef", b"de")
        self.assertEqual(str(cm.exception), "argument 2: TypeError: one character bytes, bytearray or integer expected")

    # Buffers and arrays

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
        with self.assertRaisesRegex(TypeError, "one character bytes, bytearray or integer expected"):
            Chars(b"ab")

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

    def test_array_of_arrays(self):
        Matrix = (c_int * 2) * 2
        m = Matrix()
        m[1][0] = 5
        self.assertEqual(m[1][0], 5)
        self.assertEqual(sizeof(Matrix), 4 * sizeof(c_int))

    # Structures

    def test_struct_positional_instance(self):
        class POINT(Structure):
            _fields_ = [("x", c_int), ("y", c_int)]

        class RECT(Structure):
            _fields_ = [("a", POINT), ("b", POINT)]

        r = RECT(POINT(1, 2), POINT(3, 4))
        self.assertEqual([r.a.x, r.b.y], [1, 4])

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

    # Pointer arguments and results

    def test_pointer_restype(self):
        strchr = self.libc.strchr
        strchr.restype = POINTER(c_char)
        strchr.argtypes = [c_char_p, c_int]
        p = strchr(b"abc", 98)
        self.assertEqual(p.contents.value, b"b")
        self.assertFalse(strchr(b"abc", 120))

    def test_rejects_non_pointers(self):
        memset = self.libc.memset
        memset.restype = c_void_p
        memset.argtypes = [c_void_p, c_int, c_size_t]
        for v in (lambda: 0, object(), 3.5):
            with self.assertRaises(ArgumentError) as cm:
                memset(v, 0, 0)
            self.assertEqual(str(cm.exception), "argument 1: TypeError: wrong type")

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

    def test_void_p_accepts_bytes(self):
        memcpy = self.libc.memcpy
        memcpy.restype = c_void_p
        memcpy.argtypes = [c_void_p, c_void_p, c_size_t]
        dst = create_string_buffer(3)
        memcpy(dst, b"abc", 3)
        self.assertEqual(dst.raw, b"abc")


if __name__ == "__main__":
    unittest.main()
