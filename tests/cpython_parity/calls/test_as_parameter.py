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

    def test_from_param_returns_stateful_adapter(self):
        library = c.CDLL(str(FIXTURE))
        for binding in ["attribute", "prototype"]:
            for count in [2, 3, 32, 129]:
                events = []
                argument = Adapter(123)

                class Changing:
                    reads = 0

                    @property
                    def _as_parameter_(self):
                        events.append("parameter")
                        self.reads += 1
                        return 7 if self.reads >= count else self

                class Adapted(c.c_int32):
                    @classmethod
                    def from_param(cls, value):
                        self.assertIs(value, argument)
                        events.append("from_param")
                        return Changing()

                if binding == "attribute":
                    function = library.fixture_scalar_i32
                    function.argtypes = [Adapted]
                    function.restype = c.c_int32
                else:
                    function = c.CFUNCTYPE(c.c_int32, Adapted)(
                        ("fixture_scalar_i32", library)
                    )
                with self.subTest(binding=binding, count=count):
                    self.assertEqual(function(argument), 7)
                    self.assertEqual(events, ["from_param"] + ["parameter"] * count)

    def test_argument_conversion_order_and_failure(self):
        expected = [
            "from_param 0", "parameter 0",
            "from_param 1", "parameter 1",
            "from_param 2", "parameter 2",
            "from_param 3", "parameter 3",
        ]
        for stage in [None, "from_param", "parameter"]:
            for failure in range(1 if stage is None else 4):
                events = []

                class Parameter:
                    def __init__(self, value):
                        self.value = value

                    @property
                    def _as_parameter_(self):
                        events.append(f"parameter {self.value}")
                        if stage == "parameter" and self.value == failure:
                            raise RuntimeError("adapter sentinel")
                        return 1 << self.value

                class Word(c.c_uint64):
                    @classmethod
                    def from_param(cls, value):
                        events.append(f"from_param {value}")
                        if stage == "from_param" and value == failure:
                            raise RuntimeError("adapter sentinel")
                        return Parameter(value)

                function = c.CFUNCTYPE(c.c_uint64, Word, Word, Word, Word)(
                    ("fixture_exact_u64_four", self.lib)
                )

                def check(result, invoked, arguments):
                    events.append("errcheck")
                    self.assertIs(invoked, function)
                    self.assertEqual(arguments, (0, 1, 2, 3))
                    return result

                function.errcheck = check
                with self.subTest(stage=stage, failure=failure):
                    if stage is None:
                        self.assertEqual(function(0, 1, 2, 3), 15)
                        self.assertEqual(events, expected + ["errcheck"])
                    else:
                        with self.assertRaisesRegex(
                            c.ArgumentError, f"argument {failure + 1}: .*adapter sentinel"
                        ):
                            function(0, 1, 2, 3)
                        length = 2 * failure + (1 if stage == "from_param" else 2)
                        self.assertEqual(events, expected[:length])

    def test_conversion_failure_prevents_native_write(self):
        for stage in ["from_param", "parameter"]:
            class Raising:
                @property
                def _as_parameter_(self):
                    raise RuntimeError("adapter sentinel")

            class Value(c.c_int32):
                @classmethod
                def from_param(cls, value):
                    if value == 7:
                        return value
                    if stage == "from_param":
                        raise RuntimeError("adapter sentinel")
                    return Raising()

            function = c.CFUNCTYPE(None, c.POINTER(c.c_int32), Value)(
                ("fixture_fill_int4", self.lib)
            )
            values = (c.c_int32 * 4)(-99, -99, -99, -99)
            with self.subTest(stage=stage):
                self.assertIsNone(function(values, 7))
                self.assertEqual(list(values), [7, 8, 9, 10])
                for index in range(4):
                    values[index] = -99
                with self.assertRaisesRegex(c.ArgumentError, "argument 2: .*adapter sentinel"):
                    function(values, 9)
                self.assertEqual(list(values), [-99, -99, -99, -99])

    def test_from_param_argument_error_wrapping(self):
        library = c.CDLL(str(FIXTURE))
        for binding in ["attribute", "prototype"]:
            for failure in [0, 1, 3]:
                sentinel = c.ArgumentError("adapter sentinel")
                calls = []

                class Word(c.c_uint64):
                    @classmethod
                    def from_param(cls, value):
                        calls.append(value)
                        if value == failure:
                            raise sentinel
                        return value

                if binding == "attribute":
                    function = library.fixture_exact_u64_four
                    function.argtypes = [Word, Word, Word, Word]
                    function.restype = c.c_uint64
                else:
                    function = c.CFUNCTYPE(c.c_uint64, Word, Word, Word, Word)(
                        ("fixture_exact_u64_four", library)
                    )
                with self.subTest(binding=binding, failure=failure):
                    with self.assertRaises(c.ArgumentError) as raised:
                        function(0, 1, 2, 3)
                    self.assertIsNot(raised.exception, sentinel)
                    self.assertEqual(
                        str(raised.exception),
                        f"argument {failure + 1}: ArgumentError: adapter sentinel",
                    )
                    self.assertEqual(calls, list(range(failure + 1)))


if __name__ == "__main__":
    unittest.main()
