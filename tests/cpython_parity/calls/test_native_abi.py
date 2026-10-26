"""Exact C signatures and scalar callback results."""

import ctypes as c
import unittest
from .._support import FIXTURE


class TestNativeABI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib = c.CDLL(str(FIXTURE))

    def test_mixed_signature(self):
        fn = self.lib.fixture_exact_mixed
        fn.argtypes = [c.c_int32, c.c_double, c.c_float, c.c_int32]
        fn.restype = c.c_double
        self.assertEqual(fn(-7, 1.5, 2.25, 8), 10.75)

    def test_unsigned_four(self):
        fn = self.lib.fixture_exact_u64_four
        fn.argtypes = [c.c_uint64] * 4
        fn.restype = c.c_uint64
        values = [0xFFFFFFFFFFFFFFFF, 0x123456789ABCDEF0, 0x8765432101234567, 1]
        expected = 0
        for value in values:
            expected ^= value
        self.assertEqual(fn(*values), expected)

    def test_mixed_fallback(self):
        fn = self.lib.fixture_exact_fallback
        fn.argtypes = [c.c_int16, c.c_int32, c.c_uint64]
        fn.restype = c.c_int32
        self.assertEqual(fn(-7, 8, 9), 10)

    def test_callback_scalar_results(self):
        cases = [
            ("i8", c.c_int8, [-128, -1, 0, 127]),
            ("u8", c.c_uint8, [0, 1, 255]),
            ("i16", c.c_int16, [-32768, -1, 0, 32767]),
            ("u16", c.c_uint16, [0, 1, 65535]),
            ("i32", c.c_int32, [-2147483648, -1, 0, 2147483647]),
            ("u32", c.c_uint32, [0, 1, 4294967295]),
            ("i64", c.c_int64, [-(1 << 63), -1, 0, (1 << 63) - 1]),
            ("u64", c.c_uint64, [0, 1, (1 << 64) - 1]),
            ("long", c.c_long, [-7, 0, 7]),
            ("ulong", c.c_ulong, [0, 1, 7]),
            ("size", c.c_size_t, [0, 1, 7]),
            ("ssize", c.c_ssize_t, [-7, 0, 7]),
            ("char", c.c_char, [b"\0", b"A", b"\xff"]),
            ("wchar", c.c_wchar, ["\0", "\u4e2d"]),
            ("bool", c.c_bool, [False, True]),
            ("float", c.c_float, [-1.5, 0, 2.25]),
            ("double", c.c_double, [-1.5, 0, 2.25]),
        ]
        for name, kind, values in cases:
            prototype = c.CFUNCTYPE(kind, kind)
            callback = prototype(lambda value: value)
            fn = getattr(self.lib, f"fixture_callback_{name}")
            fn.argtypes = [prototype, kind]
            fn.restype = kind
            for value in values:
                with self.subTest(kind=name, value=value):
                    self.assertEqual(fn(callback, value), kind(value).value)
