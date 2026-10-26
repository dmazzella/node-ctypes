"""Reference contracts for test_as_parameter.js, using the same C entry points."""

import ctypes as c
import unittest
from .._support import FIXTURE


class Adapter:
    def __init__(self, value):
        self._as_parameter_ = value


class TestAsParameter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lib = c.CDLL(str(FIXTURE))
        cls.integer = cls.lib.fixture_scalar_i32
        cls.integer.argtypes = [c.c_int32]
        cls.integer.restype = c.c_int32
        cls.typed_pointer = cls.lib.fixture_address
        cls.typed_pointer.argtypes = [c.POINTER(c.c_int32)]
        cls.typed_pointer.restype = c.c_size_t
        cls.void_pointer = c.CFUNCTYPE(c.c_size_t, c.c_void_p)(("fixture_address", cls.lib))
        cls.length = cls.lib.fixture_string_length
        cls.length.argtypes = [c.c_char_p]
        cls.length.restype = c.c_size_t

    def test_nested_scalar_adapter(self):
        self.assertEqual(self.integer(Adapter(Adapter(c.c_int32(7)))), 7)

    def test_from_param_returns_nested_adapter(self):
        class Adapted(c.c_int32):
            @classmethod
            def from_param(cls, value):
                return Adapter(Adapter(value))

        adapted = c.CFUNCTYPE(c.c_int32, Adapted)(("fixture_scalar_i32", self.lib))
        self.assertEqual(adapted(9), 9)

    def test_nested_typed_pointer_adapter(self):
        value = c.c_int32(11)
        self.assertEqual(self.typed_pointer(Adapter(Adapter(c.pointer(value)))), c.addressof(value))

    def test_nested_byref_adapter(self):
        value = c.c_int32(11)
        self.assertEqual(self.typed_pointer(Adapter(Adapter(c.byref(value)))), c.addressof(value))

    def test_typed_null_pointer_adapter(self):
        value = c.cast(None, c.POINTER(c.c_int32))
        self.assertEqual(self.typed_pointer(Adapter(Adapter(value))), 0)

    def test_typed_pointer_direct_conversions(self):
        for value in [c.c_int32(11), (c.c_int32 * 2)(11, 12), None]:
            expected = 0 if value is None else c.addressof(value)
            self.assertEqual(self.typed_pointer(value), expected)

    def test_typed_pointer_adapter_rejections(self):
        for source in [c.c_int32(11), (c.c_int32 * 2)(11, 12), None]:
            for depth in [1, 2]:
                value = source
                for _ in range(depth):
                    value = Adapter(value)
                with self.subTest(source=source, depth=depth), self.assertRaises(c.ArgumentError):
                    self.typed_pointer(value)

    def test_prototype_typed_pointer_conversions(self):
        prototype = c.CFUNCTYPE(c.c_size_t, c.POINTER(c.c_int32))
        fn = prototype(("fixture_address", self.lib))
        scalar = c.c_int32(11)
        array = (c.c_int32 * 2)(11, 12)
        for source, expected, implicit in [
            (scalar, c.addressof(scalar), True),
            (array, c.addressof(array), True),
            (None, 0, True),
            (c.pointer(scalar), c.addressof(scalar), False),
            (c.byref(scalar), c.addressof(scalar), False),
            (c.cast(None, c.POINTER(c.c_int32)), 0, False),
        ]:
            for depth in [0, 1, 2]:
                value = source
                for _ in range(depth):
                    value = Adapter(value)
                with self.subTest(source=source, depth=depth):
                    if implicit and depth > 0:
                        with self.assertRaises(c.ArgumentError):
                            fn(value)
                    else:
                        self.assertEqual(fn(value), expected)

    def test_aggregate_pointer_adapters(self):
        for base in [c.Structure, c.Union]:
            class Record(base):
                _fields_ = [("value", c.c_int32)]

            fn = c.CFUNCTYPE(c.c_size_t, c.POINTER(Record))(("fixture_address", self.lib))
            value = Record(11)
            array = (Record * 2)()
            for source, expected, implicit in [
                (value, c.addressof(value), True),
                (array, c.addressof(array), True),
                (None, 0, True),
                (c.pointer(value), c.addressof(value), False),
                (c.byref(value), c.addressof(value), False),
            ]:
                for depth in [0, 1, 2]:
                    argument = source
                    for _ in range(depth):
                        argument = Adapter(argument)
                    with self.subTest(base=base.__name__, source=source, depth=depth):
                        if implicit and depth > 0:
                            with self.assertRaises(c.ArgumentError):
                                fn(argument)
                        else:
                            self.assertEqual(fn(argument), expected)

    def test_integer_terminal_read_once(self):
        class Terminal:
            reads = 0

            @property
            def _as_parameter_(self):
                self.reads += 1
                return -7

        adapter = Terminal()
        self.assertEqual(self.integer(adapter), -7)
        self.assertEqual(adapter.reads, 1)

    def test_boolean_terminal_read_once(self):
        for value, expected in [(True, 1), (False, 0)]:
            class Terminal:
                reads = 0

                @property
                def _as_parameter_(self):
                    self.reads += 1
                    return value

            with self.subTest(value=value):
                adapter = Terminal()
                self.assertEqual(self.integer(adapter), expected)
                self.assertEqual(adapter.reads, 1)

    def test_null_pointer_terminal(self):
        self.assertEqual(self.void_pointer(Adapter(None)), 0)

    def test_utf8_bytes_terminal(self):
        data = bytes([0xC3, 0xA9, 0])
        self.assertEqual(self.length(Adapter(data)), 2)

    def test_invalid_integer_terminal(self):
        for value in [1.5, float("nan"), float("inf"), None]:
            with self.subTest(value=value), self.assertRaises(c.ArgumentError):
                self.integer(Adapter(value))

    def test_finite_adapter_chains(self):
        for count in [128, 129, 256]:
            value = 7
            for _ in range(count):
                value = Adapter(value)
            with self.subTest(count=count):
                self.assertEqual(self.integer(value), 7)

    def test_stateful_self_revisits(self):
        for count in [2, 3, 32, 129]:
            class Changing:
                reads = 0

                @property
                def _as_parameter_(self):
                    self.reads += 1
                    return 7 if self.reads >= count else self

            with self.subTest(count=count):
                adapter = Changing()
                self.assertEqual(self.integer(adapter), 7)
                self.assertEqual(adapter.reads, count)

    def test_nested_getter_order(self):
        reads = []

        class Inner:
            @property
            def _as_parameter_(self):
                reads.append("inner")
                return 7

        inner = Inner()

        class Outer:
            @property
            def _as_parameter_(self):
                reads.append("outer")
                return inner

        self.assertEqual(self.integer(Outer()), 7)
        self.assertEqual(reads, ["outer", "inner"])

    def test_self_recursion_error(self):
        adapter = Adapter(None)
        adapter._as_parameter_ = adapter
        with self.assertRaises(c.ArgumentError) as raised:
            self.integer(adapter)
        self.assertIn("RecursionError", str(raised.exception))

    def test_mutual_recursion_error(self):
        first, second = Adapter(None), Adapter(None)
        first._as_parameter_ = second
        second._as_parameter_ = first
        with self.assertRaises(c.ArgumentError) as raised:
            self.integer(first)
        self.assertIn("RecursionError", str(raised.exception))

    def test_getter_exception(self):
        class Raising:
            reads = 0

            @property
            def _as_parameter_(self):
                self.reads += 1
                if self.reads == 3:
                    raise ValueError("adapter sentinel")
                return self

        adapter = Raising()
        with self.assertRaises(c.ArgumentError) as raised:
            self.integer(adapter)
        self.assertIn("adapter sentinel", str(raised.exception))
        self.assertEqual(adapter.reads, 3)


if __name__ == "__main__":
    unittest.main()
