"""
Test Callbacks - Cross Platform
Tests callback functionality with qsort example
"""

import unittest
import sys
from ctypes import (
    CDLL,
    c_int,
    c_size_t,
    c_void_p,
    CFUNCTYPE,
    c_int32,
    sizeof,
    create_string_buffer,
    cast,
    POINTER,
    c_float,
)


class TestCallbacks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform == "win32":
            cls.libc = CDLL("msvcrt")
        else:
            cls.libc = CDLL("libc.so.6")

    def test_qsort_callback(self):
        """Test qsort with integer comparison callback"""
        # Create array of integers
        IntArray5 = c_int * 5
        arr = IntArray5(5, 2, 8, 1, 9)

        # Define callback function type
        CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

        def compare(a, b):
            a_val = cast(a, POINTER(c_int)).contents.value
            b_val = cast(b, POINTER(c_int)).contents.value
            return a_val - b_val

        # Create callback
        cmp_callback = CMPFUNC(compare)

        # Call qsort
        self.libc.qsort(arr, 5, sizeof(c_int), cmp_callback)

        # Verify sorted order
        expected = [1, 2, 5, 8, 9]
        actual = list(arr)
        self.assertEqual(actual, expected)

    def test_qsort_reverse_callback(self):
        """Test qsort with reverse integer comparison callback"""
        # Create array of integers
        IntArray4 = c_int * 4
        arr = IntArray4(3, 1, 4, 2)

        # Define callback function type
        CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

        def compare_reverse(a, b):
            a_val = cast(a, POINTER(c_int)).contents.value
            b_val = cast(b, POINTER(c_int)).contents.value
            return b_val - a_val  # Reverse order

        # Create callback
        cmp_callback = CMPFUNC(compare_reverse)

        # Call qsort
        self.libc.qsort(arr, 4, sizeof(c_int), cmp_callback)

        # Verify reverse sorted order
        expected = [4, 3, 2, 1]
        actual = list(arr)
        self.assertEqual(actual, expected)

    def test_qsort_float_callback(self):
        """Test qsort with float comparison callback"""
        # Create array of floats
        FloatArray3 = c_float * 3
        arr = FloatArray3(3.14, 1.41, 2.71)

        # Define callback function type
        CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

        def compare_float(a, b):
            a_val = cast(a, POINTER(c_float)).contents.value
            b_val = cast(b, POINTER(c_float)).contents.value
            if a_val < b_val:
                return -1
            elif a_val > b_val:
                return 1
            else:
                return 0

        # Create callback
        cmp_callback = CMPFUNC(compare_float)

        # Call qsort
        self.libc.qsort(arr, 3, sizeof(c_float), cmp_callback)

        # Verify sorted order (approximately)
        self.assertAlmostEqual(arr[0], 1.41, places=3)
        self.assertAlmostEqual(arr[1], 2.71, places=3)
        self.assertAlmostEqual(arr[2], 3.14, places=3)

    def test_callback_properties(self):
        """Test callback object has expected properties"""

        def dummy_callback():
            return 42

        # This would be the Python way, but callbacks are created per use
        # In Python, callbacks are created when defining function types
        CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

        def compare(a, b):
            return 0

        callback = CMPFUNC(compare)

        # In Python, callbacks don't have a direct "pointer" property
        # but they can be used directly as function pointers
        self.assertTrue(hasattr(callback, "__call__"))


if __name__ == "__main__":
    unittest.main()
