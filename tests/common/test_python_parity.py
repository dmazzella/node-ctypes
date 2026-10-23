"""
Test Python ctypes parity (2.0) - reference behavior for test_python_parity.js
"""

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

    # Wide characters

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

    # Buffers and arrays

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
        with self.assertRaises(TypeError) as cm:
            Chars(b"ab")
        self.assertEqual(str(cm.exception), "one character bytes, bytearray, or an integer in range(256) expected, not bytes of length 2")

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

    # Variadic arguments

    def test_variadic_instances_keep_type(self):
        sprintf = self.libc.sprintf
        sprintf.restype = c_int
        sprintf.argtypes = [c_char_p, c_char_p]
        buf = ctypes.create_string_buffer(128)
        # Python does not promote c_float, c_int8, c_char... (ffi_prep_cif_var
        # fails); node-ctypes applies the C variadic promotions.
        sprintf(buf, b"%.1f %d %lld|", ctypes.c_double(2.0), c_int(-3), ctypes.c_longlong(1 << 40))
        self.assertEqual(buf.value, b"2.0 -3 1099511627776|")

    # Numeric arguments

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

    # Pointer arguments and results

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

    def test_float_for_integer_types(self):
        libc = CDLL(ctypes.util.find_library("c"))
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

    def test_errcheck_func(self):
        libc = CDLL(ctypes.util.find_library("c"))
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
        libc.free(malloc(8))
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

    def test_rejects_non_pointers(self):
        memset = self.libc.memset
        memset.restype = c_void_p
        memset.argtypes = [c_void_p, c_int, c_size_t]
        for v in (lambda: 0, object(), 3.5):
            with self.assertRaises(ArgumentError) as cm:
                memset(v, 0, 0)
            name = type(v).__name__
            self.assertEqual(str(cm.exception), f"argument 1: TypeError: '{name}' object cannot be interpreted as ctypes.c_void_p")

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
