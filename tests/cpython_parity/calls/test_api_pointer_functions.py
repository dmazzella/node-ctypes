"""Native function fields, arrays and explicit function pointer casts."""

import ctypes as c
import unittest
from .._support import FIXTURE


class TestApiConversions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib = c.CDLL(str(FIXTURE))

    def test_function_pointer_fields_roundtrip(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)
        class Record(c.Structure):
            _fields_ = [("function", prototype)]
        source = Record.in_dll(self.lib, "fixture_global_function")
        fn = source.function
        copy = Record()
        copy.function = fn
        self.assertEqual(copy.function(7), 8)
        values = (prototype * 1)()
        values[0] = fn
        self.assertEqual(values[0](7), 8)
        invoke = self.lib.fixture_scalar_callback
        invoke.argtypes = [prototype, c.c_int32]
        invoke.restype = c.c_int32
        self.assertEqual(invoke(fn, 7), 8)
        with self.assertRaises(TypeError):
            copy.function = lambda value: value
        with self.assertRaises(c.ArgumentError):
            invoke(lambda value: value, 7)

    def test_explicit_function_pointer_casts(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)
        invoke = self.lib.fixture_scalar_callback
        invoke.argtypes = [prototype, c.c_int32]
        invoke.restype = c.c_int32
        direct = prototype(("fixture_scalar_i32", self.lib))
        attribute = self.lib.fixture_scalar_i32
        attribute.argtypes = [c.c_int32]
        attribute.restype = c.c_int32
        self.assertEqual(invoke(direct, 7), 7)
        self.assertEqual(invoke(c.cast(attribute, prototype), 8), 8)
