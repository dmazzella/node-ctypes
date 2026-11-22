"""CFUNCTYPE callbacks, using the same qsort signatures and vectors in JS."""

import ctypes as c
import unittest

from .._support import FIXTURE, LIBC


class TestCallbacks(unittest.TestCase):
    def setUp(self):
        self.libc = c.CDLL(LIBC)

    def test_qsort_callback(self):
        values = (c.c_int * 5)(5, 2, 8, 1, 9)
        compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
        compare = compare_type(
            lambda first, second: c.cast(first, c.POINTER(c.c_int)).contents.value
            - c.cast(second, c.POINTER(c.c_int)).contents.value
        )
        qsort = self.libc.qsort
        qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p]
        qsort.restype = None
        qsort(values, 5, c.sizeof(c.c_int), compare)
        self.assertEqual(list(values), [1, 2, 5, 8, 9])

    def test_qsort_reverse_callback(self):
        values = (c.c_int * 4)(3, 1, 4, 2)
        compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
        compare = compare_type(
            lambda first, second: c.cast(second, c.POINTER(c.c_int)).contents.value
            - c.cast(first, c.POINTER(c.c_int)).contents.value
        )
        qsort = self.libc.qsort
        qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p]
        qsort.restype = None
        qsort(values, 4, c.sizeof(c.c_int), compare)
        self.assertEqual(list(values), [4, 3, 2, 1])

    def test_qsort_float_callback(self):
        values = (c.c_float * 3)(3.14, 1.41, 2.71)
        compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)

        def compare(first, second):
            first_value = c.cast(first, c.POINTER(c.c_float)).contents.value
            second_value = c.cast(second, c.POINTER(c.c_float)).contents.value
            return (first_value > second_value) - (first_value < second_value)

        callback = compare_type(compare)
        qsort = self.libc.qsort
        qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p]
        qsort.restype = None
        qsort(values, 3, c.sizeof(c.c_float), callback)
        for actual, expected in zip(values, [1.41, 2.71, 3.14]):
            self.assertLess(abs(actual - expected), 0.0005)

    def test_callback_properties(self):
        callback = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)(lambda first, second: 0)
        self.assertTrue(callable(callback))
        self.assertEqual(callback(None, None), 0)
        self.assertTrue(c.cast(callback, c.c_void_p).value)

    def test_aggregate_callback_constructs_before_copying_c_fields(self):
        lib = c.CDLL(str(FIXTURE))
        words = c.c_int32 * 2
        for base in (c.Structure, c.Union):
            initialized, received = [], []

            class Record(base):
                _fields_ = (
                    [("x", c.c_int32), ("y", c.c_int32)]
                    if base is c.Structure
                    else [("scalar", c.c_int64), ("values", words)]
                )

                def __init__(self, *args):
                    view = words.from_buffer(self)
                    initialized.append((self, len(args), tuple(view), view))
                    view[0] = 90

            def handle(record):
                received.append(record)
                return (
                    record.x + record.y if base is c.Structure else sum(record.values)
                )

            prototype = c.CFUNCTYPE(c.c_int32, Record)
            callback = prototype(handle)
            if base is c.Structure:
                invoke = lib.fixture_point_callback
                invoke.argtypes = [prototype, c.c_int32, c.c_int32]
                invoke.restype = c.c_int32
                result = invoke(callback, 3, 4)
            else:
                make = lib.fixture_return_union_make
                make.argtypes = [c.c_int32, c.c_int32]
                make.restype = Record
                result = callback(make(3, 4))

            self.assertEqual(result, 7)
            self.assertEqual(len(initialized), 1)
            obj, argc, before, view = initialized[0]
            self.assertEqual((argc, before), (0, (0, 0)))
            self.assertIs(received[0], obj)
            self.assertEqual(tuple(view), (3, 4))
            view[1] = 12
            self.assertEqual(obj.y if base is c.Structure else obj.values[1], 12)

    def test_callback_ignores_instance_call_attribute(self):
        # The callable is invoked through its type (tp_call), not an attribute.
        def add(first, second):
            return first + second

        add.__call__ = lambda *args: 99
        callback = c.CFUNCTYPE(c.c_int, c.c_int, c.c_int)(add)
        self.assertEqual(callback(3, 4), 7)

    def test_function_pointer_ignores_as_parameter_attribute(self):
        callback = c.CFUNCTYPE(c.c_int, c.c_int, c.c_int)(lambda first, second: first + second)
        address = c.cast(callback, c.c_void_p).value
        callback._as_parameter_ = 0x1234
        # memmove(dst, src, 0) copies nothing and returns dst.
        memmove = self.libc.memmove
        memmove.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t]
        memmove.restype = c.c_void_p
        self.assertEqual(memmove(callback, None, 0), address)
        self.assertEqual(callback(3, 4), 7)

    def test_callback_two_by_value_aggregates(self):
        lib = c.CDLL(str(FIXTURE))

        class Bytes33(c.Structure):
            _fields_ = [("values", c.c_uint8 * 33)]

        cb_type = c.CFUNCTYPE(c.c_int32, Bytes33, Bytes33, c.c_void_p)
        seen = []

        def handle(first, second, raw_ptr):
            first.values[0] = 99
            seen.append((first.values[0], second.values[0], second.values[32], raw_ptr != 0))
            return first.values[0] + second.values[0] + second.values[32]

        cb = cb_type(handle)
        invoke = lib.fixture_callback_large_alias
        invoke.argtypes = [cb_type, c.c_uint8]
        invoke.restype = c.c_int32
        self.assertEqual(invoke(cb, 10), 99 + 10 + 42)
        self.assertEqual(seen, [(99, 10, 42, True)])
