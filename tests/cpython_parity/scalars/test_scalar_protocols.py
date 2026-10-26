"""Scalar subtype and retval/outparam reference behavior."""

import ctypes as c
import math
import sys
import unittest
from .._support import FIXTURE


class TestScalarProtocols(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = c.CDLL(str(FIXTURE))

    def test_representation_bypasses_constructor(self):
        class Value(c.c_int32):
            def __init__(self, value=0):
                self.value = value + 100
        fn = self.library.fixture_scalar_i32
        fn.argtypes = [c.c_int32]
        fn.restype = Value
        value = fn(7)
        self.assertIsInstance(value, Value)
        self.assertEqual(value.value, 7)
        class Record(c.Structure):
            _fields_ = [("value", Value)]
        record = Record()
        record.value = 7
        self.assertIsInstance(record.value, Value)
        self.assertEqual(record.value.value, 7)
        seen = []
        callback = c.CFUNCTYPE(c.c_int32, Value)(lambda value: seen.append(value) or value.value)
        self.assertEqual(callback(7), 7)
        self.assertIsInstance(seen[0], Value)
        self.assertEqual(seen[0].value, 7)

    def test_retval_checker_is_cached_per_binding(self):
        class Value(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 100
        fn = self.library.fixture_scalar_i32
        fn.argtypes = [c.c_int32]
        fn.restype = Value
        self.assertEqual(fn(7), 107)
        Value._check_retval_ = staticmethod(lambda value: value.value + 200)
        self.assertEqual(fn(7), 107)
        fn.restype = Value
        self.assertEqual(fn(7), 207)

    def test_out_hook_and_inout_identity(self):
        class Out(c.c_int32):
            def __ctypes_from_outparam__(self):
                return self.value * 10
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out))
        out = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (2, "remainder")))
        self.assertEqual(out(17, 5), 20)
        value = Out(99)
        inout = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (3, "remainder", value)))
        self.assertIs(inout(a=17, b=5), value)
        self.assertEqual(value.value, 2)

    def test_default_derived_out_is_an_instance(self):
        class Out(c.c_int32):
            pass
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out))
        out = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (2, "remainder")))
        value = out(17, 5)
        self.assertIsInstance(value, Out)
        self.assertEqual(value.value, 2)

    def test_retval_before_errcheck_and_errors(self):
        order = []
        class Result(c.c_int32):
            @classmethod
            def _check_retval_(cls, value):
                self.assertIsInstance(value, cls)
                order.append("retval")
                if value.value < 0:
                    raise ValueError("negative result")
                return value.value + 100
        function = self.library.fixture_scalar_i32
        function.argtypes = [c.c_int32]
        function.restype = Result
        def check(value, func, args):
            self.assertEqual(value, 107)
            self.assertIs(func, function)
            order.append("errcheck")
            return value + 1
        function.errcheck = check
        try:
            self.assertEqual(function(7), 108)
            self.assertEqual(order, ["retval", "errcheck"])
            order.clear()
            with self.assertRaisesRegex(ValueError, "negative result"):
                function(-1)
            self.assertEqual(order, ["retval"])
        finally:
            del function.errcheck

    def test_native_nan_payload(self):
        class Result(c.c_double):
            def __init__(self, *args):
                raise AssertionError("constructor must not run")
        function = self.library.fixture_nan_payload
        function.argtypes = []
        function.restype = Result
        value = function()
        self.assertIsInstance(value, Result)
        self.assertTrue(math.isnan(value.value))
        self.assertEqual(c.c_uint64.from_buffer(value).value, 0x7ff8000000001234)

    def test_derived_scalar_field_live_views(self):
        class Value(c.c_int32):
            def __init__(self, *args):
                raise AssertionError("constructor must not run")
        for base in [c.Structure, c.Union, c.BigEndianStructure, c.BigEndianUnion]:
            class Record(base):
                _fields_ = [("value", Value)]
            record = Record()
            record.value = 7
            field = record.value
            if base in [c.Structure, c.Union]:
                self.assertIsInstance(field, Value)
            self.assertEqual(field.value, 7)
            field.value = 8
            self.assertEqual(record.value.value, 8)
            record.value = 9
            self.assertEqual(field.value, 9)

    def test_derived_array_and_pointer_live_views(self):
        class Value(c.c_int32):
            pass
        source = (c.c_int32 * 2)(7, 8)
        array = (Value * 2).from_buffer(source)
        self.assertIsInstance(array[0], Value)
        array[0].value = 9
        self.assertEqual(source[0], 9)
        pointer = c.cast(source, c.POINTER(Value))
        self.assertIsInstance(pointer[1], Value)
        pointer[1].value = 10
        self.assertEqual(source[1], 10)
        value = Value.from_buffer(source, c.sizeof(c.c_int32))
        self.assertIsInstance(value, Value)
        value.value = 11
        self.assertEqual(source[1], 11)

    def test_derived_scalar_result_types(self):
        for name, base, value, expected in [
            ("i64", c.c_int64, -7, -7), ("u64", c.c_uint64, -1, 2**64 - 1),
            ("long", c.c_long, -7, -7), ("ulong", c.c_ulong, 7, 7),
            ("float", c.c_float, 1.5, 1.5), ("double", c.c_double, -2.25, -2.25),
            ("char", c.c_char, b"A", b"A"), ("wchar", c.c_wchar, "\u4e2d", "\u4e2d"),
            ("bool", c.c_bool, False, False),
        ]:
            class Result(base):
                def __init__(self, *args):
                    raise AssertionError("constructor must not run")
            function = getattr(self.library, f"fixture_scalar_{name}")
            function.argtypes = [base]
            function.restype = Result
            first, second = function(value), function(value)
            self.assertIsInstance(first, Result)
            self.assertIsInstance(second, Result)
            self.assertEqual(first.value, expected)
            self.assertEqual(second.value, expected)
            self.assertNotEqual(c.addressof(first), c.addressof(second))

    def test_callback_derived_scalar_arguments(self):
        class Value(c.c_int32):
            pass
        saved = []
        def invoke(value):
            self.assertIsInstance(value, Value)
            saved.append(value)
            return value.value + 1
        callback = c.CFUNCTYPE(c.c_int32, Value)(invoke)
        function = self.library.fixture_scalar_callback
        function.argtypes = [c.c_void_p, c.c_int32]
        function.restype = c.c_int32
        self.assertEqual(function(callback, 7), 8)
        self.assertEqual(saved[-1].value, 7)
        self.assertEqual(function(callback, 90), 91)
        self.assertEqual(saved[-1].value, 90)

    def test_aggregate_retval_before_errcheck(self):
        class Point(c.Structure):
            _fields_ = [("x", c.c_int32), ("y", c.c_int32)]
            @staticmethod
            def _check_retval_(value):
                self.assertIsInstance(value, Point)
                return value.x + value.y
        function = self.library.fixture_point_make
        function.argtypes = [c.c_int32, c.c_int32]
        function.restype = Point
        function.errcheck = lambda value, func, args: value + 100
        try:
            self.assertEqual(function(3, 4), 107)
        finally:
            del function.errcheck

    def test_invalid_retval_checker(self):
        class Invalid(c.c_int32):
            _check_retval_ = 123
        function = self.library.fixture_scalar_i32
        function.argtypes = [c.c_int32]
        function.restype = Invalid
        with self.assertRaisesRegex(TypeError, "callable"):
            function(7)

    def test_invalid_outparam_hook(self):
        class Out(c.c_int32):
            __ctypes_from_outparam__ = None
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out))
        function = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (2, "remainder")))
        with self.assertRaisesRegex(TypeError, "callable"):
            function(17, 5)

    def test_mixed_out_inout_declared_order(self):
        class Out(c.c_int32):
            def __ctypes_from_outparam__(self):
                return self.value * 10
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Out), c.POINTER(Out))
        function = prototype(("fixture_divmod_pair", self.library),
                             ((1, "a"), (1, "b"), (2, "quotient"), (3, "remainder")))
        remainder = Out()
        self.assertEqual(function(17, 5, remainder), (30, remainder))
        self.assertEqual(remainder.value, 2)
        self.assertEqual(function(a=17, b=5, remainder=remainder), (30, remainder))

    def test_out_hooks_follow_retval_errcheck(self):
        order = []
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                order.append(f"retval:{value.value}")
                return value.value + 100
        class Out(c.c_int32):
            def __ctypes_from_outparam__(self):
                order.append(f"out:{self.value}")
                return self.value * 10
        prototype = c.CFUNCTYPE(Result, c.c_int32, c.c_int32, c.POINTER(Out))
        out = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (2, "remainder")))
        def check(value, func, args):
            self.assertEqual(value, 103)
            self.assertIs(func, out)
            self.assertIsInstance(args[2], Out)
            order.append("errcheck")
            return args
        out.errcheck = check
        self.assertEqual(out(17, 5), 20)
        self.assertEqual(order, ["retval:3", "errcheck", "out:2"])
        value = Out(99)
        inout = prototype(("fixture_divmod", self.library), ((1, "a"), (1, "b"), (3, "remainder", value)))
        self.assertIs(inout(a=17, b=5), value)
        self.assertEqual(value.value, 2)
        self.assertEqual(sum(entry.startswith("out:") for entry in order), 1)
        order.clear()
        def replacement(result, func, args):
            self.assertIs(args[2], value)
            return "replacement"
        inout.errcheck = replacement
        self.assertEqual(inout(17, 5, value), "replacement")
        self.assertEqual(order, ["retval:3"])


@unittest.skipUnless(sys.platform == "win32", "HRESULT is a Windows ctypes type")
class TestHResultProtocols(unittest.TestCase):
    def test_hresult_before_errcheck(self):
        for loader in [c.CDLL, c.WinDLL, c.OleDLL]:
            library = loader(str(FIXTURE))
            function = library.fixture_scalar_i32
            function.argtypes = [c.c_int32]
            function.restype = c.HRESULT
            checked = []
            function.errcheck = lambda value, func, args: checked.append(value) or value
            with self.assertRaises(OSError):
                function(-1)
            self.assertEqual(checked, [])
            self.assertEqual(function(7), 7)

    def test_hresult_prototype(self):
        library = c.CDLL(str(FIXTURE))
        function = c.CFUNCTYPE(c.HRESULT, c.c_int32)(("fixture_scalar_i32", library))
        with self.assertRaises(OSError):
            function(-1)
        self.assertEqual(function(7), 7)


if __name__ == "__main__":
    unittest.main()
