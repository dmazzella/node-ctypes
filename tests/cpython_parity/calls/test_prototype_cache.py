"""Prototype identity and converter capture from common/test_prototype_cache.js."""

import ctypes as c
import sys
import unittest

from .._support import FIXTURE


class TestPrototypeCache(unittest.TestCase):
    def setUp(self):
        self.lib = c.CDLL(str(FIXTURE))

    def test_signature_identity(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)
        self.assertIs(c.CFUNCTYPE(c.c_int, c.c_int), prototype)
        self.assertIsNot(c.CFUNCTYPE(c.c_uint32, c.c_int32), prototype)
        self.assertIsNot(c.CFUNCTYPE(c.c_int32), prototype)
        self.assertIsNot(c.CFUNCTYPE(c.c_int32, c.c_uint32), prototype)

        class Int(c.c_int32):
            pass

        class First(c.Structure):
            _fields_ = [("value", c.c_int32)]

        class Second(c.Structure):
            _fields_ = [("value", c.c_int32)]

        self.assertIsNot(c.CFUNCTYPE(Int, c.c_int32), prototype)
        self.assertIsNot(c.CFUNCTYPE(c.c_int32, Int), prototype)
        self.assertIsNot(
            c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_int32)),
            c.CFUNCTYPE(c.c_int32, c.POINTER(c.c_uint32)),
        )
        self.assertIsNot(
            c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_uint32),
            c.CFUNCTYPE(c.c_int32, c.c_uint32, c.c_int32),
        )
        self.assertIsNot(c.CFUNCTYPE(First, First), c.CFUNCTYPE(Second, Second))

    @unittest.skipUnless(sys.platform == "win32", "WINFUNCTYPE requires Windows")
    def test_stdcall_identity(self):
        self.assertIsNot(c.WINFUNCTYPE(c.c_int32, c.c_int32), c.CFUNCTYPE(c.c_int32, c.c_int32))
        self.assertIs(c.WINFUNCTYPE(c.c_int32, c.c_int32), c.WINFUNCTYPE(c.c_int32, c.c_int32))

    def test_zero_to_seven_argument_signatures(self):
        for count in range(8):
            prototype = c.CFUNCTYPE(c.c_int32, *([c.c_int32] * count))
            callback = prototype(lambda *values: sum(values))
            function = prototype(c.cast(callback, c.c_void_p).value)
            values = list(range(1, count + 1))
            self.assertEqual(function(*values), sum(values))

    def test_library_binding_arguments(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)
        function = prototype(("fixture_scalar_i32", self.lib))
        self.assertEqual(function(-7), -7)
        with self.assertRaises(TypeError):
            function()
        value = c.c_int32(-7)
        received = []

        def check(result, invoked, arguments):
            received.append((invoked is function, arguments[0] is value, len(arguments)))
            return result + 1

        function.errcheck = check
        self.assertEqual(function(value), -6)
        self.assertEqual(received, [(True, True, 1)])
        del function.errcheck
        self.assertEqual(function(-7), -7)

    def test_address_binding_arguments(self):
        address = c.cast(self.lib.fixture_scalar_i32, c.c_void_p).value
        function = c.CFUNCTYPE(c.c_int32, c.c_int32)(address)
        self.assertEqual(function(-7), -7)
        with self.assertRaises(TypeError):
            function()
        value = c.c_int32(-7)
        received = []

        def check(result, invoked, arguments):
            received.append((invoked is function, arguments[0] is value, len(arguments)))
            return result + 1

        function.errcheck = check
        self.assertEqual(function(value), -6)
        self.assertEqual(received, [(True, True, 1)])
        del function.errcheck
        self.assertEqual(function(-7), -7)

    def test_variadic_prototype(self):
        function = c.CFUNCTYPE(c.c_int32, c.c_void_p, c.c_int32)(
            ("fixture_variadic_sum", self.lib)
        )
        self.assertEqual(function(None, 0), 0)
        self.assertEqual(function(None, 3, 7, 8, 9), 24)
        self.assertEqual(function(None, 1, -7), -7)
        with self.assertRaises(TypeError):
            function(None)

    def test_retval_hook_capture(self):
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 1

        prototype = c.CFUNCTYPE(Result, c.c_int32)
        first = prototype(("fixture_scalar_i32", self.lib))
        Result._check_retval_ = lambda value: value.value + 2
        self.assertIs(c.CFUNCTYPE(Result, c.c_int32), prototype)
        second = prototype(("fixture_scalar_i32", self.lib))
        self.assertEqual(first(7), 8)
        self.assertEqual(second(7), 8)

    def test_replaced_retval_not_revalidated(self):
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 1

        prototype = c.CFUNCTYPE(Result, c.c_int32)
        Result._check_retval_ = 7
        function = prototype(("fixture_scalar_i32", self.lib))
        self.assertEqual(function(7), 8)

    def test_argument_converter_capture(self):
        class Value(c.c_int32):
            pass

        prototype = c.CFUNCTYPE(c.c_int32, Value)
        first = prototype(("fixture_scalar_i32", self.lib))
        Value.from_param = lambda value: Value(value + 1)
        second = prototype(("fixture_scalar_i32", self.lib))
        first.errcheck = lambda result, function, arguments: result + 10
        self.assertEqual(first(7), 17)
        self.assertEqual(second(7), 7)
        Value.from_param = lambda value: Value(value + 2)
        self.assertEqual(first(7), 17)
        self.assertEqual(second(7), 7)

    def test_independent_errcheck(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)
        first = prototype(("fixture_scalar_i32", self.lib))
        second = prototype(("fixture_scalar_i32", self.lib))
        self.assertIsNot(first, second)
        first.errcheck = lambda result, function, arguments: result + 10
        self.assertEqual(first(7), 17)
        self.assertEqual(second(7), 7)

    def test_existing_converter_callable_capture(self):
        class Value(c.c_int32):
            @staticmethod
            def from_param(value):
                return Value(value + 1)

        prototype = c.CFUNCTYPE(c.c_int32, Value)
        function = prototype(("fixture_scalar_i32", self.lib))
        self.assertEqual(function(7), 8)
        Value.from_param = lambda value: Value(value + 2)
        self.assertEqual(function(7), 8)
        self.assertEqual(prototype(("fixture_scalar_i32", self.lib))(7), 8)

    def test_paramflags_converter_capture(self):
        class Value(c.c_int32):
            @staticmethod
            def from_param(value):
                return Value(value + 1)

        prototype = c.CFUNCTYPE(c.c_int32, Value, c.c_int32, c.POINTER(c.c_int32))
        flags = ((1, "a"), (1, "b"), (2, "remainder"))
        Value.from_param = lambda value: Value(value + 2)
        divide = prototype(("fixture_divmod", self.lib), flags)
        self.assertEqual(divide(17, 5), 3)
        Value.from_param = lambda value: Value(value + 3)
        self.assertEqual(divide(17, 5), 3)
        self.assertEqual(prototype(("fixture_divmod", self.lib), flags)(17, 5), 3)

    def test_paramflags_retval_hook_capture(self):
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 1

        prototype = c.CFUNCTYPE(Result, c.c_int32, c.c_int32, c.POINTER(c.c_int32))
        Result._check_retval_ = lambda value: value.value + 2
        for _ in range(2):
            divide = prototype(
                ("fixture_divmod", self.lib), ((1, "a"), (1, "b"), (2, "remainder"))
            )
            divide.errcheck = lambda result, function, arguments: [
                result, function is divide, arguments[2].value
            ]
            self.assertEqual(divide(17, 5), [4, True, 2])

    def test_attribute_converter_capture(self):
        class Value(c.c_int32):
            @staticmethod
            def from_param(value):
                return Value(value + 1)

        function = self.lib.fixture_scalar_i32
        function.argtypes = [Value]
        function.restype = c.c_int32
        Value.from_param = lambda value: Value(value + 2)
        self.assertEqual(function(7), 8)
        function.argtypes = [Value]
        self.assertEqual(function(7), 9)

    def test_attribute_retval_hook_capture(self):
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 1

        function = self.lib.fixture_scalar_i32
        function.argtypes = [c.c_int32]
        function.restype = Result
        Result._check_retval_ = lambda value: value.value + 2
        self.assertEqual(function(7), 8)
        function.restype = Result
        self.assertEqual(function(7), 9)

    def test_initial_invalid_retval_deferred(self):
        class Result(c.c_int32):
            _check_retval_ = 7

        prototype = c.CFUNCTYPE(Result, c.c_int32)
        function = prototype(("fixture_scalar_i32", self.lib))
        with self.assertRaises(TypeError):
            function(7)

    def test_initial_invalid_converter_deferred(self):
        class Value(c.c_int32):
            from_param = 7

        prototype = c.CFUNCTYPE(c.c_int32, Value)
        function = prototype(("fixture_scalar_i32", self.lib))
        with self.assertRaises(c.ArgumentError):
            function(7)

    def test_custom_string_converter_pointer_result(self):
        owner = c.create_string_buffer(b"Hello")

        class Value(c.c_char_p):
            @staticmethod
            def from_param(value):
                return c.c_void_p(c.addressof(owner))

        prototype = c.CFUNCTYPE(c.c_size_t, Value)
        function = prototype(("fixture_string_length", self.lib))
        self.assertEqual(function(0), 5)
        Value.from_param = lambda value: c.c_void_p(c.addressof(owner) + 1)
        self.assertEqual(function(0), 5)
        self.assertEqual(prototype(("fixture_string_length", self.lib))(0), 5)

    def test_callback_retval_hook_capture(self):
        class Result(c.c_int32):
            @staticmethod
            def _check_retval_(value):
                return value.value + 1

        prototype = c.CFUNCTYPE(Result, c.c_int32)
        Result._check_retval_ = lambda value: value.value + 2
        callback = prototype(lambda value: value)
        self.assertEqual(callback(7), 8)

    def test_callback_converter_capture(self):
        class Value(c.c_int32):
            @staticmethod
            def from_param(value):
                return Value(value + 1)

        prototype = c.CFUNCTYPE(c.c_int32, Value)
        Value.from_param = lambda value: Value(value + 2)
        callback = prototype(lambda value: value.value)
        self.assertEqual(callback(7), 8)

    def test_binding_keeps_argument_type(self):
        def make():
            class Value(c.c_int32):
                pass

            return c.CFUNCTYPE(c.c_int32, Value)(("fixture_scalar_i32", self.lib))

        function = make()
        self.assertEqual(function(7), 7)

    def test_callback_keeps_argument_type(self):
        def make():
            class Value(c.c_int32):
                pass

            prototype = c.CFUNCTYPE(c.c_int32, Value)
            return prototype(lambda value: value.value)

        callback = make()
        function = c.CFUNCTYPE(c.c_int32, c.c_int32)(c.cast(callback, c.c_void_p).value)
        self.assertEqual(function(7), 7)

    def test_paramflags_keeps_argument_type(self):
        def make():
            class Value(c.c_int32):
                pass

            prototype = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(Value))
            return prototype(
                ("fixture_divmod", self.lib), ((1, "a"), (1, "b"), (2, "remainder"))
            )

        function = make()
        self.assertEqual(function(17, 5).value, 2)
