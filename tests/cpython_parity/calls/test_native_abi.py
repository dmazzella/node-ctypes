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

    def test_record_matrix_by_value(self):
        class IntCell(c.Structure):
            _fields_ = [("value", c.c_int32)]

        class PackedCell(c.Structure):
            _layout_ = "ms"
            _pack_ = 1
            _fields_ = [("tag", c.c_uint8), ("value", c.c_uint32)]

        for cell, name, size, align in (
            (IntCell, "int", 16, 4),
            (PackedCell, "packed", 20, 1),
        ):
            with self.subTest(cell=name):

                class Matrix(c.Structure):
                    _fields_ = [("rows", (cell * 2) * 2)]

                self.assertEqual((c.sizeof(Matrix), c.alignment(Matrix)), (size, align))
                expected = Matrix()
                ref = getattr(self.lib, f"fixture_{name}_matrix_reference")
                ref.argtypes, ref.restype = [c.c_void_p], c.c_double
                score = ref(c.byref(expected))
                read = getattr(self.lib, f"fixture_{name}_matrix_read")
                read.argtypes, read.restype = [Matrix], c.c_double
                self.assertEqual(read(expected), score)
                arg = Matrix()
                arg.rows[1][0].value = 7
                self.assertEqual(read(arg), 21)
                make = getattr(self.lib, f"fixture_{name}_matrix_make")
                make.argtypes, make.restype = [], Matrix
                result = make()
                for r in range(2):
                    for col in range(2):
                        actual, wanted = result.rows[r][col], expected.rows[r][col]
                        self.assertEqual(actual.value, wanted.value)
                        if cell is PackedCell:
                            self.assertEqual(actual.tag, wanted.tag)

    def test_by_value_snapshot_before_later_from_param(self):
        word = c.sizeof(c.c_void_p)
        for size in (word, word + 1, 33):

            class Block(c.Structure):
                _fields_ = [("values", c.c_uint8 * size)]

            block = Block()

            class Later(c.c_int8):
                @classmethod
                def from_param(cls, value):
                    block.values[0] = 99
                    return c.c_int8(value)

            name = f"fixture_bytes_{size}_stack"
            types = [c.c_int64] * 7 + [Block, Later, c.c_uint16]
            fn = getattr(self.lib, name)
            fn.argtypes, fn.restype = types, c.c_int64
            prototype = c.CFUNCTYPE(c.c_int64, *types)((name, self.lib))
            for call in (fn, prototype):
                for arg in (block, Block.from_address(c.addressof(block))):
                    block.values[0] = 7
                    self.assertEqual(
                        call(*([0] * 7), arg, 0, 0), 7 if size > word else 99
                    )
                    self.assertEqual(block.values[0], 99)

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
