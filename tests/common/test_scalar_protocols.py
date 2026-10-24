"""Scalar subtype and retval/outparam reference behavior."""

import ctypes as c
from pathlib import Path
import sys
import unittest

SUFFIX = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
FIXTURE = Path(__file__).resolve().parents[2] / "build" / "fixture" / f"ctypes_test_fixture{SUFFIX}"


@unittest.skipUnless(FIXTURE.exists(), "native fixture not built")
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


if __name__ == "__main__":
    unittest.main()
