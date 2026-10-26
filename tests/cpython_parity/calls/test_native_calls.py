"""Exact C-fixture calls migrated from common/test_native_fixture."""

import ctypes as c
import platform
import sys
import unittest

from .._support import FIXTURE


SKIP_OLD_LIBFFI = unittest.skipIf(
    sys.platform == "linux" and platform.machine() == "x86_64",
    "CPython with libffi 3.1 (manylinux_2_28 x86-64) aborts on these structures by value",
)
SKIP_SYSV_UNIONS = unittest.skipIf(
    platform.machine().lower() in ("x86_64", "amd64") and sys.platform != "win32",
    "CPython passes unions to libffi as structures (libffi#33): wrong registers on x86-64 System V",
)
SKIP_SYSV_PACKED = unittest.skipIf(
    platform.machine().lower() in ("x86_64", "amd64") and sys.platform != "win32",
    "CPython passes structures with misaligned fields in registers on x86-64 System V (GCC and clang use memory)",
)


class Bits(c.Structure):
    _fields_ = [("a", c.c_uint8, 3), ("b", c.c_uint32, 5), ("tail", c.c_uint8)]


class Point(c.Structure):
    _fields_ = [("x", c.c_int32), ("y", c.c_int32)]


class Polyline(c.Structure):
    _fields_ = [("count", c.c_int32), ("points", Point * 2)]


class Base(c.Structure):
    _fields_ = [("x", c.c_int32), ("y", c.c_int8)]


class Derived(Base):
    _fields_ = [("z", c.c_int8)]


class Aligned(c.Structure):
    _align_ = 16
    _fields_ = [("a", c.c_uint8), ("b", c.c_uint32)]


class Packed(c.Structure):
    _pack_ = 1
    _layout_ = "ms"
    _fields_ = [
        ("a", c.c_uint8),
        ("b", c.c_uint32),
        ("c", c.c_double),
        ("d", c.c_uint16),
    ]


class BitsFloat(c.Structure):
    _fields_ = [("bits", c.c_uint64, 60), ("f", c.c_float)]


class TestNativeFixture(unittest.TestCase):
    def setUp(self):
        self.lib = c.CDLL(str(FIXTURE))

    def test_array_parameters(self):
        Int4 = c.c_int32 * 4
        values = Int4(1, 2, 3, 4)
        total = self.lib.fixture_sum_int4
        total.argtypes = [Int4]
        total.restype = c.c_int32
        address = self.lib.fixture_address
        address.argtypes = [Int4]
        address.restype = c.c_size_t
        fill = self.lib.fixture_fill_int4
        fill.argtypes = [Int4, c.c_int32]
        fill.restype = None
        self.assertEqual(total(values), 10)
        self.assertEqual(address(values), c.addressof(values))
        fill(values, 7)
        self.assertEqual(list(values), [7, 8, 9, 10])
        self.assertEqual(total((c.c_int32 * 4)(5, 5, 5, 5)), 20)
        for value in ([1, 2, 3, 4], None, (c.c_int32 * 3)(1, 2, 3), 7):
            with self.assertRaises(c.ArgumentError):
                total(value)

    def test_structures_by_value(self):
        size = self.lib.fixture_bits_size
        size.argtypes = []
        size.restype = c.c_size_t
        total = self.lib.fixture_bits_sum
        total.argtypes = [Bits]
        total.restype = c.c_uint32
        make = self.lib.fixture_bits_make
        make.argtypes = [c.c_uint8, c.c_uint32, c.c_uint8]
        make.restype = Bits
        self.assertEqual(c.sizeof(Bits), size())
        self.assertEqual(total(Bits(5, 17, 66)), 51766)
        made = make(5, 17, 66)
        self.assertIsInstance(made, Bits)
        self.assertEqual([made.a, made.b, made.tail], [5, 17, 66])
        last_y = self.lib.fixture_polyline_last_y
        last_y.argtypes = [Polyline]
        last_y.restype = c.c_int32
        polyline = Polyline()
        polyline.count = 2
        polyline.points[1].y = 99
        self.assertEqual(last_y(polyline), 99)

    @SKIP_OLD_LIBFFI
    def test_derived_by_value(self):
        total = self.lib.fixture_derived_sum
        total.argtypes = [Derived]
        total.restype = c.c_int32
        make = self.lib.fixture_derived_make
        make.argtypes = [c.c_int32, c.c_int8, c.c_int8]
        make.restype = Derived
        self.assertEqual(total(Derived(3, 4, 5)), 30405)
        made = make(3, 4, 5)
        self.assertIsInstance(made, Derived)
        self.assertEqual([made.x, made.y, made.z], [3, 4, 5])

    @unittest.skipIf(sys.version_info < (3, 13), "_align_ requires Python 3.13+")
    @SKIP_OLD_LIBFFI
    def test_aligned_by_value(self):
        total = self.lib.fixture_aligned_sum
        total.argtypes = [Aligned]
        total.restype = c.c_uint32
        make = self.lib.fixture_aligned_make
        make.argtypes = [c.c_uint8, c.c_uint32]
        make.restype = Aligned
        self.assertEqual([c.sizeof(Aligned), c.alignment(Aligned)], [16, 16])
        self.assertEqual(total(Aligned(7, 42)), 7042)
        made = make(7, 42)
        self.assertEqual([made.a, made.b], [7, 42])

    def test_paramflags_errcheck(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        flags = ((1, "a"), (1, "b"), (2, "remainder"))
        self.assertEqual(prototype(("fixture_divmod", self.lib), flags)(17, 5), 2)
        divide = prototype(("fixture_divmod", self.lib), flags)
        divide.errcheck = lambda result, function, arguments: [
            result, function is divide, arguments[0], arguments[1], arguments[2].value
        ]
        self.assertEqual(divide(17, 5), [3, True, 17, 5, 2])
        divide.errcheck = lambda result, function, arguments: arguments
        self.assertEqual(divide(17, 5), 2)

        def fail(result, function, arguments):
            raise ValueError("checked")

        divide.errcheck = fail
        with self.assertRaisesRegex(ValueError, "checked"):
            divide(17, 5)

    @SKIP_SYSV_UNIONS
    def test_unions_by_value(self):
        class Num(c.Union):
            _fields_ = [("d", c.c_double), ("i", c.c_int64)]

        class Floats(c.Union):
            _fields_ = [("f", c.c_float * 2), ("d", c.c_double)]

        class Inner(c.Union):
            _fields_ = [("f", c.c_float), ("i", c.c_int32)]

        class Tagged(c.Structure):
            _fields_ = [("tag", c.c_int32), ("value", Inner)]

        bits = self.lib.fixture_number_bits
        bits.argtypes = [Num]
        bits.restype = c.c_int64
        from_bits = self.lib.fixture_number_from_bits
        from_bits.argtypes = [c.c_int64]
        from_bits.restype = Num
        total = self.lib.fixture_floats_sum
        total.argtypes = [Floats]
        total.restype = c.c_double
        tagged_int = self.lib.fixture_tagged_int
        tagged_int.argtypes = [Tagged, c.c_double]
        tagged_int.restype = c.c_int32
        tagged_make = self.lib.fixture_tagged_make
        tagged_make.argtypes = [c.c_int32, c.c_int32]
        tagged_make.restype = Tagged
        number = Num()
        number.i = 0x123456789
        self.assertEqual(bits(number), 0x123456789)
        self.assertEqual(from_bits(42).i, 42)
        floats = Floats()
        floats.f[0] = 1.5
        floats.f[1] = 2
        self.assertEqual(total(floats), 3.5)
        tagged = Tagged()
        tagged.tag = 1
        tagged.value.f = 2.5
        self.assertEqual(tagged_int(tagged, 4), 10)
        self.assertEqual(tagged_make(0, 7).value.i, 7)

    @SKIP_SYSV_PACKED
    def test_packed_structure_by_value(self):
        size = self.lib.fixture_packed_size
        size.argtypes = []
        size.restype = c.c_size_t
        total = self.lib.fixture_packed_sum
        total.argtypes = [Packed]
        total.restype = c.c_double
        make = self.lib.fixture_packed_make
        make.argtypes = [c.c_uint8, c.c_uint32, c.c_double, c.c_uint16]
        make.restype = Packed
        self.assertEqual(c.sizeof(Packed), size())
        self.assertEqual(total(Packed(1, 2, 3.5, 4)), 10.5)
        made = make(1, 2, 3.5, 4)
        self.assertEqual([made.a, made.b, made.c, made.d], [1, 2, 3.5, 4])

    def test_structure_argument_rejects_tuple(self):
        total = self.lib.fixture_bits_sum
        total.argtypes = [Bits]
        total.restype = c.c_uint32
        with self.assertRaises(c.ArgumentError):
            total((5, 17, 66))

    def test_bit_field_and_float_by_value(self):
        size = self.lib.fixture_bits_float_size
        size.argtypes = []
        size.restype = c.c_size_t
        get = self.lib.fixture_bits_float_get
        get.argtypes = [BitsFloat]
        get.restype = c.c_float
        make = self.lib.fixture_bits_float_make
        make.argtypes = [c.c_uint64, c.c_float]
        make.restype = BitsFloat
        self.assertEqual(c.sizeof(BitsFloat), size())
        self.assertEqual(get(BitsFloat(2, 1.5)), 3.5)
        made = make(3, 2.5)
        self.assertEqual([made.bits, made.f], [3, 2.5])

    def test_byref_pointer(self):
        point_to_static = self.lib.fixture_point_to_static
        point_to_static.argtypes = [c.c_void_p]
        point_to_static.restype = None
        pointer = c.cast(None, c.POINTER(c.c_int32))
        point_to_static(c.byref(pointer))
        self.assertEqual(pointer.contents.value, 42)
        self.assertNotEqual(c.addressof(pointer), c.cast(pointer, c.c_void_p).value)
        other = c.pointer(c.c_int32(7))
        self.assertNotEqual(c.addressof(other), c.addressof(other.contents))

    def test_reentrant_calls(self):
        first = self.lib.fixture_first_char_after
        first.argtypes = [c.c_char_p, c.c_void_p]
        first.restype = c.c_int32
        inner_results = []
        inner = c.CFUNCTYPE(None)(lambda: inner_results.append(first(b"inner", None)))
        self.assertEqual(first(b"outer", c.cast(inner, c.c_void_p)), ord("o"))
        self.assertEqual(inner_results, [ord("i")])
        total = self.lib.fixture_variadic_sum
        total.argtypes = [c.c_void_p, c.c_int32]
        total.restype = c.c_int32
        results = []

        def nested():
            for count in range(1, 21):
                results.append(total(None, count, *range(1, count + 1)))

        callback = c.CFUNCTYPE(None)(nested)
        self.assertEqual(total(c.cast(callback, c.c_void_p), 3, 10, 20, 30), 60)
        self.assertEqual(results, [count * (count + 1) // 2 for count in range(1, 21)])
        self.assertEqual(total(None, 3, 1, 2, 3), 6)

    @unittest.skipIf(sys.platform == "win32", "errno belongs to each C runtime on Windows")
    def test_use_errno(self):
        plain = c.CDLL(str(FIXTURE))
        with_errno = c.CDLL(str(FIXTURE), use_errno=True)
        set_plain = plain.fixture_errno_set
        set_plain.argtypes = [c.c_int32]
        set_plain.restype = None
        get_plain = plain.fixture_errno_get
        get_plain.argtypes = []
        get_plain.restype = c.c_int32
        set_private = with_errno.fixture_errno_set
        set_private.argtypes = [c.c_int32]
        set_private.restype = None
        get_private = with_errno.fixture_errno_get
        get_private.argtypes = []
        get_private.restype = c.c_int32
        set_plain(5)
        c.set_errno(77)
        self.assertEqual(get_private(), 77)
        set_private(123)
        self.assertEqual(c.get_errno(), 123)
        self.assertEqual(get_plain(), 5)

    def test_reentrant_long_strings(self):
        first = self.lib.fixture_first_char_after
        first.argtypes = [c.c_char_p, c.c_void_p]
        first.restype = c.c_int32
        nested = []
        callback = c.CFUNCTYPE(None)(
            lambda: nested.append(first(b"inner" + b"x" * 90000, None))
        )
        self.assertEqual(first(b"outer" + b"x" * 9000, c.cast(callback, c.c_void_p)), ord("o"))
        self.assertEqual(first(b"again" + b"x" * 700, c.cast(callback, c.c_void_p)), ord("a"))
        self.assertEqual(nested, [ord("i"), ord("i")])

    def test_point_values_and_defaults(self):
        total = self.lib.fixture_point_sum
        total.argtypes = [Point]
        total.restype = c.c_int32
        for value, expected in [
            (Point(3, 4), 7),
            (Point(c.c_int32(-3), 4), 1),
            (Point(y=4), 4),
            (Point(), 0),
        ]:
            self.assertEqual(total(value), expected)

    def test_structure_subclass_constructor(self):
        calls = []

        class CustomPoint(Point):
            def __init__(self, x, y):
                super().__init__(x, y)
                calls.append((x, y))
                self.x += 10

        total = self.lib.fixture_point_sum
        total.argtypes = [CustomPoint]
        total.restype = c.c_int32
        self.assertEqual(total(CustomPoint(3, 4)), 17)
        self.assertEqual(calls, [(3, 4)])

    def test_paramflags_default_arguments(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        divide = prototype(
            ("fixture_divmod", self.lib),
            ((1, "a", 17), (1, "b", 5), (2, "remainder")),
        )
        self.assertEqual(divide(), 2)
        self.assertEqual(divide(b=4), 1)
        self.assertEqual(divide(a=23, b=5), 3)
