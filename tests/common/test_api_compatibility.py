"""Phase 4 API reference contracts, without unsafe pointer reads."""

import ctypes as c
import unittest


class TestApiCompatibility(unittest.TestCase):
    def test_typed_pointer_compatibility(self):
        class Derived(c.c_int32):
            pass
        pointer = c.POINTER(c.c_int32)
        value = c.c_int32(7)
        for compatible in [None, value, Derived(7), c.pointer(value), (c.c_int32 * 2)(), c.byref(value)]:
            pointer.from_param(compatible)
        for incompatible in [c.c_double(2), c.pointer(c.c_double(2)), c.byref(c.c_double(2)), c.c_void_p()]:
            with self.assertRaises(TypeError):
                pointer.from_param(incompatible)

    def test_recursive_adapter(self):
        class Adapter:
            def __init__(self, value):
                self._as_parameter_ = value
        c.c_int32.from_param(Adapter(Adapter(c.c_int32(7))))

    def test_recursive_adapter_chains_above_128(self):
        class Adapter:
            def __init__(self, value):
                self._as_parameter_ = value

        identity = c.CFUNCTYPE(c.c_int32, c.c_int32)(lambda value: value)
        for count in [128, 129, 256]:
            value = 7
            for _ in range(count):
                value = Adapter(value)
            with self.subTest(count=count):
                self.assertEqual(identity(value), 7)

    def test_recursive_adapter_getter_can_change(self):
        class Adapter:
            def __init__(self, count):
                self.count = count
                self.reads = 0

            @property
            def _as_parameter_(self):
                self.reads += 1
                return 7 if self.reads >= self.count else self

        identity = c.CFUNCTYPE(c.c_int32, c.c_int32)(lambda value: value)
        for count in [2, 3, 32, 129]:
            value = Adapter(count)
            with self.subTest(count=count):
                self.assertEqual(identity(value), 7)
                self.assertEqual(value.reads, count)

    def test_unbounded_adapter_recursion_reports_an_error(self):
        class Adapter:
            pass

        first, second = Adapter(), Adapter()
        first._as_parameter_ = second
        second._as_parameter_ = first
        with self.assertRaises(RecursionError):
            c.c_int32.from_param(first)
        identity = c.CFUNCTYPE(c.c_int32, c.c_int32)(lambda value: value)
        with self.assertRaises(c.ArgumentError) as raised:
            identity(first)
        self.assertIn("RecursionError", str(raised.exception))

    def test_recursive_adapter_getter_errors(self):
        class Adapter:
            reads = 0

            @property
            def _as_parameter_(self):
                self.reads += 1
                if self.reads == 3:
                    raise ValueError("adapter sentinel")
                return self

        identity = c.CFUNCTYPE(c.c_int32, c.c_int32)(lambda value: value)
        value = Adapter()
        with self.assertRaises(c.ArgumentError) as raised:
            identity(value)
        self.assertIn("adapter sentinel", str(raised.exception))
        self.assertEqual(value.reads, 3)

    def test_scalar_buffer_bounds(self):
        for kind in [c.c_int32, c.c_uint64, c.c_double, c.c_void_p]:
            for method in ["from_buffer", "from_buffer_copy"]:
                factory = getattr(kind, method)
                with self.assertRaises(ValueError):
                    factory(bytearray(c.sizeof(kind) - 1))
                with self.assertRaises(ValueError):
                    factory(bytearray(16), -1)
                with self.assertRaises(ValueError):
                    factory(bytearray(16), 17)

    def test_signed_byref_offset(self):
        value = c.c_int32()
        base = c.addressof(value)
        for offset in [-4, 0, 1, 4, 8]:
            self.assertEqual(c.cast(c.byref(value, offset), c.c_void_p).value, base + offset)

    def test_memory_returns(self):
        destination, source = c.create_string_buffer(8), c.create_string_buffer(b"abc")
        self.assertEqual(c.memmove(destination, source, 4), c.addressof(destination))
        self.assertEqual(c.memset(destination, 0, 4), c.addressof(destination))

    def test_ms_pack(self):
        for pack in [0, 1, 2, 3, 4, 5, True, False, 3.9, "3", None]:
            class Record(c.Structure):
                _layout_ = "ms"
                _pack_ = pack
                _fields_ = [("a", c.c_uint8), ("b", c.c_uint32)]
            value = int(pack) if pack is not None else 0
            alignment = min(value, 4) if value else 4
            offset = value if value in [1, 2, 3] else 4
            self.assertEqual(c.alignment(Record), alignment)
            self.assertEqual(Record.b.offset, offset)

    def test_explicit_gcc_pack(self):
        for pack in [0, False, 3]:
            with self.assertRaises(ValueError):
                class Invalid(c.Structure):
                    _layout_ = "gcc-sysv"
                    _pack_ = pack
                    _fields_ = [("value", c.c_int32)]


if __name__ == "__main__":
    unittest.main()
