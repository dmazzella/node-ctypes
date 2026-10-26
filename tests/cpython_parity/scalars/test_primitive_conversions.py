"""Scalar conversions; adjacent bool bitfields remain a separate C-oracle test."""

import ctypes as c
from ctypes import wintypes
import math
import struct
import sys
import unittest
from .._support import FIXTURE, LIBC


INTEGERS = [
    ("i8", c.c_int8), ("u8", c.c_uint8), ("i16", c.c_int16), ("u16", c.c_uint16),
    ("i32", c.c_int32), ("u32", c.c_uint32), ("i64", c.c_int64), ("u64", c.c_uint64),
    ("size", c.c_size_t), ("ssize", c.c_ssize_t), ("long", c.c_long), ("ulong", c.c_ulong),
]
INTEGER_VALUES = [
    0, 1, -1, -2, -3, -1000, -2049, 255, 256, 65535, 65536, 2**32, -(2**32),
    2**53, -(2**53), 2**63, -(2**63), -(2**63) - 2048, 2**64, -(2**64),
    int(1e30), -int(1e30), int(sys.float_info.max), -int(sys.float_info.max),
    False, True, 2**64 + 7, 2**128 + 7, -(2**128) - 3,
]


class TestPrimitiveConversions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = c.CDLL(str(FIXTURE))

    def test_integer_wrapping(self):
        for _, kind in INTEGERS:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            record = Record()
            bits = c.sizeof(kind) * 8
            signed = kind(-1).value < 0
            for value in INTEGER_VALUES:
                expected = value % 2**bits
                if signed and expected >= 2**(bits - 1):
                    expected -= 2**bits
                self.assertEqual(kind(value).value, expected)
                record.value = value
                self.assertEqual(record.value, expected)
            self.assertEqual(kind().value, 0)

    def test_integer_fields_arrays_and_bitfields(self):
        for _, kind in INTEGERS:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            record = Record()
            record.value = kind(3)
            self.assertEqual(record.value, 3)
            array = (kind * 1)()
            array[0] = kind(3)
            self.assertEqual(array[0], 3)
            with self.assertRaises(TypeError):
                array[0] = c.c_double(2)
            class Bits(c.Structure):
                _fields_ = [("value", kind, 3)]
            bits = Bits()
            # CPython 3.14/3.15 segfault on matching scalar-instance bitfield
            # assignment; that existing scenario stays in the Node path suite.
            bits.value = 3
            self.assertEqual(bits.value, 3)
            for value in [None, "2", {}, c.c_double(2)]:
                with self.assertRaises(TypeError):
                    bits.value = value
            bits.value = -1
            self.assertEqual(bits.value, -1 if kind(-1).value < 0 else 7)

    def test_integer_input_validation(self):
        for _, kind in INTEGERS:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            record = Record()
            for value in [None, "2", {}, [], lambda: 2, 1.5, math.nan,
                          math.inf, -math.inf, kind(2)]:
                with self.assertRaises(TypeError):
                    kind(value)
                with self.assertRaises(TypeError):
                    kind().value = value
                if not isinstance(value, kind):
                    with self.assertRaises(TypeError):
                        record.value = value

    def test_integer_native_calls(self):
        for name, kind in INTEGERS:
            functions = [getattr(self.library, f"fixture_scalar_{name}"),
                         getattr(self.library, f"fixture_scalar_{name}_tail")]
            for tail, function in enumerate(functions):
                function.argtypes = [kind, c.c_char_p] if tail else [kind]
                function.restype = kind
                extra = [b"x" * 16384] if tail else []
                for value in INTEGER_VALUES:
                    expected = kind(value).value
                    self.assertEqual(function(value, *extra), expected)
                    self.assertEqual(function(kind(value), *extra), expected)
                for value in ["2", {}, [], lambda: 2, 1.5, math.nan,
                              math.inf, -math.inf, c.c_double(2)]:
                    with self.assertRaises(c.ArgumentError):
                        function(value, *extra)

    def test_integer_native_null_arguments(self):
        class Wrapped:
            _as_parameter_ = None
        for name, kind in INTEGERS:
            for tail in [False, True]:
                symbol = f"fixture_scalar_{name}" + ("_tail" if tail else "")
                arguments = [kind, c.c_char_p] if tail else [kind]
                function = getattr(self.library, symbol)
                function.argtypes = arguments
                function.restype = kind
                prototype = c.CFUNCTYPE(kind, *arguments)((symbol, self.library))
                extra = [b"x" * 16384] if tail else []
                for invoke in [function, prototype]:
                    for value in [None, Wrapped()]:
                        with self.assertRaises(c.ArgumentError):
                            invoke(value, *extra)
                    self.assertEqual(invoke(kind(3), *extra), 3)

    def test_nullable_pointer_arguments(self):
        # The oracle accepts const void*: every input here is a pointer type.
        for kind in [c.c_void_p, c.POINTER(c.c_int32), c.c_char_p, c.c_wchar_p]:
            function = self.library.fixture_address
            function.argtypes = [kind]
            function.restype = c.c_size_t
            prototype = c.CFUNCTYPE(c.c_size_t, kind)(("fixture_address", self.library))
            self.assertEqual(function(None), 0)
            self.assertEqual(prototype(None), 0)

    def test_untyped_variadic_null_pointer(self):
        library = c.CDLL(LIBC)
        function = library.sprintf
        function.argtypes = [c.c_void_p, c.c_char_p]
        function.restype = c.c_int32
        untyped, typed = c.create_string_buffer(64), c.create_string_buffer(64)
        self.assertEqual(function(untyped, b"%p", None),
                         function(typed, b"%p", c.c_void_p(None)))
        self.assertEqual(c.string_at(untyped), c.string_at(typed))
        self.assertGreater(len(c.string_at(untyped)), 0)

    def test_scalar_input_validation(self):
        for kind in [c.c_int32, c.c_uint64, c.c_float, c.c_double]:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            for value in [None, "2", {}, [], kind(2)]:
                with self.assertRaises(TypeError):
                    kind(value)
                if not isinstance(value, kind):
                    with self.assertRaises(TypeError):
                        Record().value = value
            record = Record()
            record.value = kind(3)
            self.assertEqual(record.value, 3)

    def test_float_input_validation(self):
        for name, kind in [("float", c.c_float), ("double", c.c_double)]:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            record = Record()
            for tail in [False, True]:
                function = getattr(self.library, f"fixture_scalar_{name}" + ("_tail" if tail else ""))
                function.argtypes = [kind, c.c_char_p] if tail else [kind]
                function.restype = kind
                extra = [b"x" * 16384] if tail else []
                for value in [None, "2", {}, [], lambda: 2, kind(2), c.c_int32(2)]:
                    with self.assertRaises(TypeError):
                        kind(value)
                    if not isinstance(value, kind):
                        with self.assertRaises(TypeError):
                            record.value = value
                        with self.assertRaises(c.ArgumentError):
                            function(value, *extra)
                self.assertEqual(function(kind(1.5), *extra), 1.5)

    def test_float_native_calls(self):
        for name, kind in [("float", c.c_float), ("double", c.c_double)]:
            for tail in [False, True]:
                function = getattr(self.library, f"fixture_scalar_{name}" + ("_tail" if tail else ""))
                function.argtypes = [kind, c.c_char_p] if tail else [kind]
                function.restype = kind
                extra = [b"x" * 16384] if tail else []
                for value in [False, True, 1.5, -2.25, 17, -(2**63),
                              2**64 - 1, math.nan, math.inf, -math.inf]:
                    expected = struct.unpack("f", struct.pack("f", float(value)))[0] if name == "float" else float(value)
                    for actual in [kind(value).value, function(value, *extra)]:
                        if math.isnan(expected):
                            self.assertTrue(math.isnan(actual))
                        else:
                            self.assertEqual(actual, expected)

    def test_float_large_integer_inputs(self):
        for name, kind in [("float", c.c_float), ("double", c.c_double)]:
            function = getattr(self.library, f"fixture_scalar_{name}")
            function.argtypes = [kind]
            function.restype = kind
            for value in [-(2**63) - 1, 2**64]:
                expected = struct.unpack("f", struct.pack("f", float(value)))[0] if name == "float" else float(value)
                self.assertEqual(kind(value).value, expected)
                self.assertEqual(function(value), expected)

    def test_float_integer_rounding(self):
        values = [2**54 + 2, 2**54 + 6, 2**64 + 2048, 2**64 + 6144,
                  2**128 - 2**104, 2**128 - 2**103, 2**128 - 2**103 - 2**75,
                  2**128 - 2**74, 2**128 + 2**75, 2**512 + 1,
                  2**1023, 2**1024 - 2**971]
        for name, kind in [("float", c.c_float), ("double", c.c_double)]:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            record, array = Record(), (kind * 1)()
            for tail in [False, True]:
                function = getattr(self.library, f"fixture_scalar_{name}" + ("_tail" if tail else ""))
                function.argtypes = [kind, c.c_char_p] if tail else [kind]
                function.restype = kind
                extra = [b"x" * 16384] if tail else []
                for magnitude in values:
                    for value in [magnitude, -magnitude]:
                        number = float(value)
                        expected = (math.copysign(math.inf, number) if abs(number) >= 2**128 - 2**103
                                    else struct.unpack("f", struct.pack("f", number))[0]) if name == "float" else number
                        self.assertEqual(kind(value).value, expected)
                        record.value = value
                        self.assertEqual(record.value, expected)
                        array[0] = value
                        self.assertEqual(array[0], expected)
                        self.assertEqual(function(value, *extra), expected)

    def test_float_integer_overflow(self):
        for name, kind in [("float", c.c_float), ("double", c.c_double)]:
            class Record(c.Structure):
                _fields_ = [("value", kind)]
            scalar, record, array = kind(3), Record(3), (kind * 1)(3)
            function = getattr(self.library, f"fixture_scalar_{name}")
            function.argtypes = [kind]
            function.restype = kind
            for value in [2**1024 - 2**970, 2**1024, -(2**1024 - 2**970), -(2**1024)]:
                with self.assertRaisesRegex(OverflowError, "int too large to convert to float"):
                    kind(value)
                with self.assertRaises(OverflowError):
                    scalar.value = value
                with self.assertRaises(OverflowError):
                    record.value = value
                with self.assertRaises(OverflowError):
                    array[0] = value
                with self.assertRaises(c.ArgumentError):
                    function(value)
                self.assertEqual([scalar.value, record.value, array[0]], [3, 3, 3])

    def test_char_native_calls(self):
        for tail in [False, True]:
            function = getattr(self.library, "fixture_scalar_char" + ("_tail" if tail else ""))
            function.argtypes = [c.c_char, c.c_char_p] if tail else [c.c_char]
            function.restype = c.c_char
            extra = [b"x" * 16384] if tail else []
            for value in [b"A", b"\xff", 0, 255, False, True, b"Z"]:
                expected = c.c_char(value).value
                self.assertEqual(function(value, *extra), expected)
                self.assertEqual(function(c.c_char(value), *extra), expected)

    def test_bool_native_calls(self):
        for tail in [False, True]:
            function = getattr(self.library, "fixture_scalar_bool" + ("_tail" if tail else ""))
            function.argtypes = [c.c_bool, c.c_char_p] if tail else [c.c_bool]
            function.restype = c.c_bool
            extra = [b"x" * 16384] if tail else []
            for value in [False, True, 0, 2, None, "", "x", c.c_bool(False), c.c_int32(0)]:
                expected = c.c_bool(value).value
                self.assertEqual(function(value, *extra), expected)
                self.assertEqual(function(c.c_bool(value), *extra), expected)

    def test_variadic_wchar_argument(self):
        function = self.library.fixture_variadic_wchar
        function.argtypes = [c.c_int32]
        function.restype = c.c_uint32
        self.assertEqual(function(0, c.c_wchar_p("\u4e2d")), 0x4e2d)

    def test_wchar_native_calls(self):
        for tail in [False, True]:
            function = getattr(self.library, "fixture_scalar_wchar" + ("_tail" if tail else ""))
            function.argtypes = [c.c_wchar, c.c_char_p] if tail else [c.c_wchar]
            function.restype = c.c_wchar
            extra = [b"x" * 16384] if tail else []
            characters = ["A", "\u4e2d", "\ud800", "\0"]
            if c.sizeof(c.c_wchar) == 4:
                characters.append("\U0001f600")
            for value in characters:
                self.assertEqual(function(value, *extra), value)
                self.assertEqual(function(c.c_wchar(value), *extra), value)

    def test_wchar_input_validation(self):
        function = self.library.fixture_scalar_wchar
        function.argtypes = [c.c_wchar]
        function.restype = c.c_wchar
        for value in ["", "ab", None, 1.5, math.nan, math.inf, b"A"]:
            with self.assertRaises(TypeError):
                c.c_wchar(value)
            with self.assertRaises(c.ArgumentError):
                function(value)

    def test_variant_bool_instances(self):
        kind = wintypes.VARIANT_BOOL
        for value in [False, True, 0, 2, kind(False), kind(True), c.c_bool(False), c.c_int32(0)]:
            self.assertEqual(kind(value).value, bool(value))

    def test_variant_bool_native_calls(self):
        kind = wintypes.VARIANT_BOOL
        function = self.library.fixture_scalar_i16
        function.argtypes = [kind]
        function.restype = kind
        for value in [False, True, 0, 2, kind(False), kind(True), c.c_bool(False), c.c_int32(0)]:
            self.assertEqual(function(value), bool(value))

    def test_variant_bool_fields(self):
        kind = wintypes.VARIANT_BOOL
        class Record(c.Structure):
            _fields_ = [("value", kind)]
        record = Record()
        for value in [False, True, 0, 2, kind(False), kind(True)]:
            record.value = value
            self.assertEqual(record.value, bool(value))
            self.assertEqual(c.c_int16.from_buffer(record).value, -1 if bool(value) else 0)

    def test_variant_bool_callback(self):
        kind = wintypes.VARIANT_BOOL
        function = self.library.fixture_variant_callback
        function.argtypes = [c.c_void_p, c.c_int16]
        function.restype = c.c_int16
        for answer in [False, True, kind(False), kind(True)]:
            def invoke(value):
                self.assertIsInstance(value, bool)
                self.assertIs(value, False)
                return answer
            callback = c.CFUNCTYPE(kind, kind)(invoke)
            self.assertEqual(function(callback, 0), -1 if bool(answer) else 0)

    def test_recursive_endian_arrays(self):
        for base in [c.BigEndianStructure, c.BigEndianUnion]:
            class Record(base):
                _fields_ = [("values", (c.c_uint16 * 2) * 2)]
            record = Record()
            record.values[0][:] = [0x1122, 0x3344]
            record.values[1][:] = [0x5566, 0x7788]
            self.assertEqual(bytes(record).hex(), "1122334455667788")
            class Item(c.Structure):
                _fields_ = [("value", c.c_uint16)]
            class Nested(base):
                _fields_ = [("items", Item * 2)]
            nested = Nested()
            nested.items[0].value = 0x1122
            nested.items[1].value = 0x3344
            self.assertEqual(bytes(nested).hex(), "22114433")


if __name__ == "__main__":
    unittest.main()
