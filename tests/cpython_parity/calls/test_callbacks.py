"""CFUNCTYPE callbacks, using the same qsort signatures and vectors in JS."""

import ctypes as c
import unittest

from .._support import LIBC


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
