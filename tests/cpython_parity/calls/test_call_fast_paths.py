"""Public conversion vectors from common/test_call_fast_paths.js."""

import ctypes as c
from ctypes.util import find_library
import sys
import unittest

from .._support import FIXTURE, LIBC


class TestCallFastPaths(unittest.TestCase):
    def setUp(self):
        self.libc = c.CDLL(LIBC)
        self.libm = c.CDLL(find_library("m") if sys.platform == "linux" else LIBC)
        self.fixture = c.CDLL(str(FIXTURE))

    def test_signed_narrow_arguments(self):
        promote8 = self.fixture.fixture_promote_i8
        promote8.argtypes = [c.c_int8]
        promote8.restype = c.c_int32
        for value, expected in [(-5, -5), (-128, -128), (True, 1)]:
            self.assertEqual(promote8(value), expected)
        promote16 = self.fixture.fixture_promote_i16
        promote16.argtypes = [c.c_int16]
        promote16.restype = c.c_int32
        for value in [-300, -32768]:
            self.assertEqual(promote16(value), value)

    def test_unsigned_narrow_arguments(self):
        promote8 = self.fixture.fixture_promote_u8
        promote8.argtypes = [c.c_uint8]
        promote8.restype = c.c_int32
        promote16 = self.fixture.fixture_promote_u16
        promote16.argtypes = [c.c_uint16]
        promote16.restype = c.c_int32
        self.assertEqual(promote8(250), 250)
        self.assertEqual(promote16(65535), 65535)

    def test_bool_argument(self):
        promote = self.fixture.fixture_promote_bool
        promote.argtypes = [c.c_bool]
        promote.restype = c.c_int32
        self.assertEqual(promote(True), 1)
        self.assertEqual(promote(False), 0)

    def test_eight_bit_returns(self):
        signed = self.fixture.fixture_narrow_i8
        signed.argtypes = [c.c_int32]
        signed.restype = c.c_int8
        unsigned = self.fixture.fixture_narrow_u8
        unsigned.argtypes = [c.c_int32]
        unsigned.restype = c.c_uint8
        self.assertEqual(signed(200), -56)
        self.assertEqual(unsigned(200), 200)

    def test_sixteen_bit_returns(self):
        signed = self.fixture.fixture_narrow_i16
        signed.argtypes = [c.c_int32]
        signed.restype = c.c_int16
        unsigned = self.fixture.fixture_narrow_u16
        unsigned.argtypes = [c.c_int32]
        unsigned.restype = c.c_uint16
        self.assertEqual(signed(40000), -25536)
        self.assertEqual(unsigned(40000), 40000)

    def test_bool_return(self):
        narrow = self.fixture.fixture_narrow_bool
        narrow.argtypes = [c.c_int32]
        narrow.restype = c.c_bool
        self.assertIs(narrow(-2), True)
        self.assertIs(narrow(0), False)

    def test_double_and_int_arguments(self):
        ldexp = self.libm.ldexp
        ldexp.argtypes = [c.c_double, c.c_int32]
        ldexp.restype = c.c_double
        self.assertEqual(ldexp(1.5, 3), 12)
        self.assertEqual(ldexp(-0.75, -2), -0.1875)

    def test_pointer_int_size_arguments(self):
        memchr = self.libc.memchr
        memchr.argtypes = [c.c_void_p, c.c_int32, c.c_size_t]
        memchr.restype = c.c_void_p
        buffer = c.create_string_buffer(b"abcdefgh", 8)
        base = c.addressof(buffer)
        self.assertEqual(memchr(buffer, ord("e"), 8) - base, 4)
        self.assertEqual(memchr(base, ord("h"), 8) - base, 7)
        self.assertIsNone(memchr(buffer, ord("z"), 8))

    def test_four_arguments(self):
        memccpy = getattr(self.libc, "_memccpy" if sys.platform == "win32" else "memccpy")
        memccpy.argtypes = [c.c_void_p, c.c_void_p, c.c_int32, c.c_size_t]
        memccpy.restype = c.c_void_p
        destination = c.create_string_buffer(16)
        source = c.create_string_buffer(b"hello,world")
        end = memccpy(destination, source, ord(","), 11)
        self.assertEqual(destination.raw[:6], b"hello,")
        self.assertEqual(end - c.addressof(destination), 6)

    def test_single_long_string(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        self.assertEqual(strlen(b"x" * 5000), 5000)

    def test_inline_boundary_lengths(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        for length in range(505, 516):
            self.assertEqual(strlen(b"x" * length), length)

    def test_multibyte_boundary_lengths(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        for length in range(250, 261):
            self.assertEqual(strlen(("é" * length).encode()), 2 * length)
            self.assertEqual(strlen(("a" + "€" * length).encode()), 1 + 3 * length)

    def test_inline_and_heap_strings(self):
        compare = self.libc.strcmp
        compare.argtypes = [c.c_char_p, c.c_char_p]
        compare.restype = c.c_int32
        self.assertEqual(compare(b"k" * 400, b"k" * 400), 0)
        self.assertLess(compare(b"k" * 400, b"k" * 399 + b"l"), 0)
        self.assertGreater(compare(("é" * 200).encode(), ("é" * 199).encode()), 0)

    def test_several_long_strings(self):
        compare = self.libc.strcmp
        compare.argtypes = [c.c_char_p, c.c_char_p]
        compare.restype = c.c_int32
        text = b"a" * 3000
        self.assertEqual(compare(text, b"a" * 3000), 0)
        self.assertLess(compare(text + b"b", text + b"c"), 0)
        self.assertGreater(compare(b"z" * 700, b"y" * 90000), 0)

    def test_growing_utf8_and_embedded_nuls(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        compare = self.libc.strcmp
        compare.argtypes = [c.c_char_p, c.c_char_p]
        compare.restype = c.c_int32
        for length in [1020, 4096, 90000, 700, 8192, 513]:
            text = ("🙂" * length + "\ufffd").encode()
            self.assertEqual(strlen(text), len(text))
            self.assertEqual(strlen(text + b"\0ignored"), len(text))
            self.assertEqual(compare(text, text), 0)
            self.assertLess(compare(text + b"a", text + b"b"), 0)

    def test_reuse_after_argument_failure(self):
        compare = self.libc.strcmp
        compare.argtypes = [c.c_char_p, c.c_char_p]
        compare.restype = c.c_int32
        self.assertEqual(compare(b"x" * 3000, b"x" * 3000), 0)
        with self.assertRaises(c.ArgumentError):
            compare(b"q" * 90000, {})
        self.assertEqual(compare(("é" * 700).encode(), ("é" * 700).encode()), 0)
        self.assertLess(compare(b"a" * 8192, b"b" * 8192), 0)

    def test_multimegabyte_strings(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        for length in [9 * 1024 * 1024, 9 * 1024 * 1024 - 1, 11 * 1024 * 1024, 700, 9 * 1024 * 1024]:
            self.assertEqual(strlen(b"x" * length), length)

    def test_mixed_string_alignment(self):
        lengths = self.fixture.fixture_mixed_string_lengths
        lengths.argtypes = [c.c_char_p, c.c_wchar_p, c.c_char_p]
        lengths.restype = c.c_size_t
        for count in [1000, 9000, 700]:
            first = ("é" * count + "a").encode()
            middle = "中" * 700
            last = ("🙂" * count).encode()
            self.assertEqual(lengths(first, middle, last), len(first) + len(middle) + len(last))

    def test_call_after_failed_marshalling(self):
        compare = self.libc.strcmp
        compare.argtypes = [c.c_char_p, c.c_char_p]
        compare.restype = c.c_int32
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        with self.assertRaises(c.ArgumentError):
            compare(b"q" * 1000, {})
        self.assertEqual(absolute(-3), 3)

    def test_invalid_numeric_arguments(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        sqrt = self.libm.sqrt
        sqrt.argtypes = [c.c_double]
        sqrt.restype = c.c_double
        for value in ["12", None, {}]:
            with self.assertRaises(c.ArgumentError):
                absolute(value)
        for value in ["4", None]:
            with self.assertRaises(c.ArgumentError):
                sqrt(value)
        self.assertEqual(absolute(-12), 12)
        self.assertEqual(sqrt(4), 2)

    def test_booleans_are_numeric(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        sqrt = self.libm.sqrt
        sqrt.argtypes = [c.c_double]
        sqrt.restype = c.c_double
        self.assertEqual(absolute(True), 1)
        self.assertEqual(absolute(False), 0)
        self.assertEqual(sqrt(True), 1)

    def test_big_integer_arguments(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        sqrt = self.libm.sqrt
        sqrt.argtypes = [c.c_double]
        sqrt.restype = c.c_double
        self.assertEqual(absolute(-5), 5)
        self.assertEqual(absolute(2 ** 40 + 3), 3)
        self.assertEqual(sqrt(16), 4)
