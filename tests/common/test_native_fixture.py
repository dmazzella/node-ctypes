"""
Test calls into tests/fixtures/ctypes_test_fixture.c - reference behavior for
test_native_fixture.js (build the fixture with `npm run build:test-fixture`).
"""

import ctypes
import pathlib
import platform
import sys
import unittest
from ctypes import CDLL, CFUNCTYPE, POINTER, ArgumentError, Structure, c_char_p, c_int8, c_int32, c_size_t, c_uint8, c_uint32, c_void_p

SUFFIX = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "build" / "fixture" / f"ctypes_test_fixture{SUFFIX}"

# CPython of manylinux_2_28 x86-64 uses the system libffi 3.1, which aborts on
# some structures by value (a subclass as result, `_align_`).
SKIP_OLD_LIBFFI = unittest.skipIf(
    sys.platform == "linux" and platform.machine() == "x86_64",
    "CPython with libffi 3.1 (manylinux_2_28 x86-64) aborts on these structures by value",
)


def func(lib, name, restype, argtypes):
    f = getattr(lib, name)
    f.restype = restype
    f.argtypes = argtypes
    return f


@unittest.skipUnless(FIXTURE.exists(), f"{FIXTURE} not built (npm run build:test-fixture)")
class TestNativeFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib = CDLL(str(FIXTURE))

    def test_array_parameters(self):
        Int4 = c_int32 * 4
        values = Int4(1, 2, 3, 4)
        self.assertEqual(func(self.lib, "fixture_sum_int4", c_int32, [Int4])(values), 10)
        self.assertEqual(func(self.lib, "fixture_address", c_size_t, [Int4])(values), ctypes.addressof(values))
        func(self.lib, "fixture_fill_int4", None, [Int4, c_int32])(values, 7)
        self.assertEqual(list(values), [7, 8, 9, 10])
        total = func(self.lib, "fixture_sum_int4", c_int32, [Int4])
        for value in ([1, 2, 3, 4], None, (c_int32 * 3)(1, 2, 3), 7):
            with self.assertRaises(ArgumentError):
                total(value)

    def test_structures_by_value(self):
        class Bits(Structure):
            _fields_ = [("a", c_uint8, 3), ("b", c_uint32, 5), ("tail", c_uint8)]

        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]

        class Polyline(Structure):
            _fields_ = [("count", c_int32), ("points", Point * 2)]

        self.assertEqual(ctypes.sizeof(Bits), func(self.lib, "fixture_bits_size", c_size_t, [])())
        self.assertEqual(func(self.lib, "fixture_bits_sum", c_uint32, [Bits])(Bits(5, 17, 66)), 51766)
        made = func(self.lib, "fixture_bits_make", Bits, [c_uint8, c_uint32, c_uint8])(5, 17, 66)
        self.assertEqual([made.a, made.b, made.tail], [5, 17, 66])
        polyline = Polyline()
        polyline.count = 2
        polyline.points[1].y = 99
        self.assertEqual(func(self.lib, "fixture_polyline_last_y", c_int32, [Polyline])(polyline), 99)

    @SKIP_OLD_LIBFFI
    def test_derived_by_value(self):
        class Base(Structure):
            _fields_ = [("x", c_int32), ("y", c_int8)]

        class Derived(Base):
            _fields_ = [("z", c_int8)]

        self.assertEqual(func(self.lib, "fixture_derived_sum", c_int32, [Derived])(Derived(3, 4, 5)), 30405)
        made = func(self.lib, "fixture_derived_make", Derived, [c_int32, c_int8, c_int8])(3, 4, 5)
        self.assertEqual([made.x, made.y, made.z], [3, 4, 5])

    @unittest.skipIf(sys.version_info < (3, 13), "_align_ requires Python 3.13+")
    @SKIP_OLD_LIBFFI
    def test_aligned_by_value(self):
        class Aligned(Structure):
            _align_ = 16
            _fields_ = [("a", c_uint8), ("b", c_uint32)]

        self.assertEqual([ctypes.sizeof(Aligned), ctypes.alignment(Aligned)], [16, 16])
        self.assertEqual(func(self.lib, "fixture_aligned_sum", c_uint32, [Aligned])(Aligned(7, 42)), 7042)
        made = func(self.lib, "fixture_aligned_make", Aligned, [c_uint8, c_uint32])(7, 42)
        self.assertEqual([made.a, made.b], [7, 42])

    def test_paramflags_errcheck(self):
        prototype = CFUNCTYPE(c_int32, c_int32, c_int32, POINTER(c_int32))
        flags = ((1, "a"), (1, "b"), (2, "remainder"))
        self.assertEqual(prototype(("fixture_divmod", self.lib), flags)(17, 5), 2)
        divmod = prototype(("fixture_divmod", self.lib), flags)
        divmod.errcheck = lambda result, f, args: [result, f is divmod, args[0], args[1], args[2].value]
        self.assertEqual(divmod(17, 5), [3, True, 17, 5, 2])
        divmod.errcheck = lambda result, f, args: args
        self.assertEqual(divmod(17, 5), 2)

    @unittest.skipIf(
        platform.machine().lower() in ("x86_64", "amd64") and sys.platform != "win32",
        "CPython passes unions to libffi as structures (libffi#33): wrong registers on x86-64 System V",
    )
    def test_unions_by_value(self):
        class Num(ctypes.Union):
            _fields_ = [("d", ctypes.c_double), ("i", ctypes.c_int64)]

        class Floats(ctypes.Union):
            _fields_ = [("f", ctypes.c_float * 2), ("d", ctypes.c_double)]

        class Inner(ctypes.Union):
            _fields_ = [("f", ctypes.c_float), ("i", ctypes.c_int32)]

        class Tagged(Structure):
            _fields_ = [("tag", ctypes.c_int32), ("value", Inner)]

        n = Num()
        n.i = 0x123456789
        self.assertEqual(func(self.lib, "fixture_number_bits", ctypes.c_int64, [Num])(n), 0x123456789)
        self.assertEqual(func(self.lib, "fixture_number_from_bits", Num, [ctypes.c_int64])(42).i, 42)
        fl = Floats()
        fl.f[0] = 1.5
        fl.f[1] = 2
        self.assertEqual(func(self.lib, "fixture_floats_sum", ctypes.c_double, [Floats])(fl), 3.5)
        tagged = Tagged()
        tagged.tag = 1
        tagged.value.f = 2.5
        self.assertEqual(func(self.lib, "fixture_tagged_int", ctypes.c_int32, [Tagged, ctypes.c_double])(tagged, 4), 10)
        self.assertEqual(func(self.lib, "fixture_tagged_make", Tagged, [ctypes.c_int32, ctypes.c_int32])(0, 7).value.i, 7)

    @unittest.skipIf(
        platform.machine().lower() in ("x86_64", "amd64") and sys.platform != "win32",
        "CPython passes structures with misaligned fields in registers on x86-64 System V (GCC and clang use memory)",
    )
    def test_packed_structure_by_value(self):
        class Packed(Structure):
            _pack_ = 1
            _layout_ = "ms"
            _fields_ = [("a", c_uint8), ("b", c_uint32), ("c", ctypes.c_double), ("d", ctypes.c_uint16)]

        self.assertEqual(ctypes.sizeof(Packed), func(self.lib, "fixture_packed_size", c_size_t, [])())
        self.assertEqual(func(self.lib, "fixture_packed_sum", ctypes.c_double, [Packed])(Packed(1, 2, 3.5, 4)), 10.5)
        made = func(self.lib, "fixture_packed_make", Packed, [c_uint8, c_uint32, ctypes.c_double, ctypes.c_uint16])(1, 2, 3.5, 4)
        self.assertEqual([made.a, made.b, made.c, made.d], [1, 2, 3.5, 4])

    def test_structure_argument_rejects_tuple(self):
        class Bits(Structure):
            _fields_ = [("a", c_uint8, 3), ("b", c_uint32, 5), ("tail", c_uint8)]

        with self.assertRaises(ArgumentError):
            func(self.lib, "fixture_bits_sum", c_uint32, [Bits])((5, 17, 66))

    def test_bit_field_and_float_by_value(self):
        class BitsFloat(Structure):
            _fields_ = [("bits", ctypes.c_uint64, 60), ("f", ctypes.c_float)]

        self.assertEqual(ctypes.sizeof(BitsFloat), func(self.lib, "fixture_bits_float_size", c_size_t, [])())
        self.assertEqual(func(self.lib, "fixture_bits_float_get", ctypes.c_float, [BitsFloat])(BitsFloat(2, 1.5)), 3.5)
        made = func(self.lib, "fixture_bits_float_make", BitsFloat, [ctypes.c_uint64, ctypes.c_float])(3, 2.5)
        self.assertEqual([made.bits, made.f], [3, 2.5])

    def test_byref_pointer(self):
        p = POINTER(c_int32)()
        func(self.lib, "fixture_point_to_static", None, [c_void_p])(ctypes.byref(p))
        self.assertEqual(p.contents.value, 42)
        self.assertNotEqual(ctypes.addressof(p), ctypes.cast(p, c_void_p).value)
        q = ctypes.pointer(ctypes.c_int32(7))
        self.assertNotEqual(ctypes.addressof(q), ctypes.addressof(q.contents))

    def test_reentrant_calls(self):
        first = func(self.lib, "fixture_first_char_after", c_int32, [c_char_p, c_void_p])
        inner = CFUNCTYPE(None)(lambda: first(b"inner", None))
        self.assertEqual(first(b"outer", ctypes.cast(inner, c_void_p)), ord("o"))

        total = func(self.lib, "fixture_variadic_sum", c_int32, [c_void_p, c_int32])
        results = []

        def nested():
            for n in range(1, 21):
                results.append(total(None, n, *range(1, n + 1)))

        callback = CFUNCTYPE(None)(nested)
        self.assertEqual(total(ctypes.cast(callback, c_void_p), 3, 10, 20, 30), 60)
        self.assertEqual(results, [n * (n + 1) // 2 for n in range(1, 21)])


    @unittest.skipIf(sys.platform == "win32", "errno belongs to each C runtime on Windows")
    def test_use_errno(self):
        plain = CDLL(str(FIXTURE))
        with_errno = CDLL(str(FIXTURE), use_errno=True)
        func(plain, "fixture_errno_set", None, [c_int32])(5)
        get = func(with_errno, "fixture_errno_get", c_int32, [])
        ctypes.set_errno(77)
        self.assertEqual(get(), 77)
        func(with_errno, "fixture_errno_set", None, [c_int32])(123)
        self.assertEqual(ctypes.get_errno(), 123)
        self.assertEqual(func(plain, "fixture_errno_get", c_int32, [])(), 5)


if __name__ == "__main__":
    unittest.main()
