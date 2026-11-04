"""Scalar argument storage and conversion-order reference contracts."""

import ctypes as c
import unittest
from .._support import FIXTURE


class TestScalarMarshalling(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.library = c.CDLL(str(FIXTURE))

    def test_scalar_argument_ignores_value_getter(self):
        for name, base, stored in [
            ("i32", c.c_int32, 7),
            ("u64", c.c_uint64, 5),
            ("double", c.c_double, 1.5),
            ("char", c.c_char, b"A"),
            ("wchar", c.c_wchar, "\u03a9"),
            ("bool", c.c_bool, False),
        ]:
            reads = []

            class Value(base):
                @property
                def value(self):
                    reads.append("getter")
                    raise AssertionError("public value getter must not run")

                @value.setter
                def value(self, value):
                    base.value.__set__(self, value)

            producer = c.CFUNCTYPE(Value, base)(
                (f"fixture_scalar_{name}", self.library)
            )
            for binding in ["attribute", "prototype"]:
                if binding == "attribute":
                    function = getattr(self.library, f"fixture_scalar_{name}")
                    function.argtypes = [base]
                    function.restype = base
                else:
                    function = c.CFUNCTYPE(base, base)(
                        (f"fixture_scalar_{name}", self.library)
                    )
                for argument in [
                    Value(stored),
                    Value.from_buffer(base(stored)),
                    producer(stored),
                ]:
                    self.assertEqual(function(argument), stored)
                    self.assertEqual(reads, [])

    def test_scalar_arguments_snapshot_before_later_conversion(self):
        for binding in ["attribute", "prototype"]:
            first = c.c_uint64(1)

            class Later(c.c_uint64):
                @classmethod
                def from_param(cls, value):
                    first.value = 8
                    return cls(value)

            types = [c.c_uint64, Later, c.c_uint64, c.c_uint64]
            if binding == "attribute":
                function = self.library.fixture_exact_u64_four
                function.argtypes = types
                function.restype = c.c_uint64
            else:
                function = c.CFUNCTYPE(c.c_uint64, *types)(
                    ("fixture_exact_u64_four", self.library)
                )
            self.assertEqual(function(first, 2, 4, 0), 7)
            self.assertEqual(first.value, 8)

    def test_untyped_scalar_argument_ignores_value_getter(self):
        reads = []

        class Value(c.c_uint64):
            @property
            def value(self):
                reads.append("getter")
                raise AssertionError("public value getter must not run")

            @value.setter
            def value(self, value):
                c.c_uint64.value.__set__(self, value)

        function = c.CFUNCTYPE(c.c_uint64)(("fixture_exact_u64_four", self.library))
        self.assertEqual(
            function(Value(5), c.c_uint64(0), c.c_uint64(0), c.c_uint64(0)), 5
        )
        self.assertEqual(reads, [])

    def test_untyped_scalar_snapshot_before_later_adapter(self):
        first = c.c_uint64(1)

        class Later:
            @property
            def _as_parameter_(self):
                first.value = 8
                return c.c_uint64(2)

        function = c.CFUNCTYPE(c.c_uint64)(("fixture_exact_u64_four", self.library))
        self.assertEqual(function(first, Later(), c.c_uint64(4), c.c_uint64(0)), 7)
        self.assertEqual(first.value, 8)

    def test_from_param_accepts_same_storage_type(self):
        class Adapted(c.c_uint64):
            @classmethod
            def from_param(cls, value):
                return c.c_uint64(value + 1)

        function = c.CFUNCTYPE(c.c_uint64, Adapted, c.c_uint64, c.c_uint64, c.c_uint64)(
            ("fixture_exact_u64_four", self.library)
        )
        self.assertEqual(function(1, 2, 4, 0), 4)


if __name__ == "__main__":
    unittest.main()
