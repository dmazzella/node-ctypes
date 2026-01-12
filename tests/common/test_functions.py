"""
Test Functions and Callbacks - Cross Platform
Tests function calls, variadic functions, callbacks, errcheck
"""

import unittest
import sys
from ctypes import (
    CDLL,
    c_int,
    c_size_t,
    c_char_p,
    c_void_p,
    CFUNCTYPE,
    c_int32,
    sizeof,
    byref,
    create_string_buffer,
    cast,
    POINTER,
    c_double,
)


class TestFunctionsAndCallbacks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform == "win32":
            cls.libc = CDLL("msvcrt")
        else:
            cls.libc = CDLL("libc.so.6")

    def test_abs_function(self):
        """Test abs() function"""
        abs_func = self.libc.abs
        abs_func.argtypes = [c_int32]
        abs_func.restype = c_int32

        self.assertEqual(abs_func(-42), 42)
        self.assertEqual(abs_func(42), 42)
        self.assertEqual(abs_func(0), 0)

    def test_strlen_function(self):
        """Test strlen() function"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        self.assertEqual(strlen(b"hello"), 5)
        self.assertEqual(strlen(b"world!"), 6)
        self.assertEqual(strlen(b"Hello, World!"), 13)

    def test_memcpy_function(self):
        """Test memcpy() with multiple arguments"""
        memcpy = self.libc.memcpy
        memcpy.argtypes = [c_void_p, c_void_p, c_size_t]
        memcpy.restype = c_void_p

        src = create_string_buffer(10)
        dst = create_string_buffer(10)

        # Fill source with pattern
        for i in range(10):
            src[i] = i * 10

        # Copy
        memcpy(dst, src, 10)

        # Verify
        for i in range(10):
            self.assertEqual(dst[i], src[i])

    def test_errcheck_called(self):
        """Test errcheck callback is called"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        errcheck_called = []
        received_result = []

        def check(result, func, args):
            errcheck_called.append(True)
            received_result.append(result)
            return result

        strlen.errcheck = check

        result = strlen(b"hello")

        self.assertTrue(errcheck_called)
        self.assertEqual(result, 5)
        self.assertEqual(received_result[0], 5)

    def test_errcheck_modify_return(self):
        """Test errcheck can modify return value"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        def double_result(result, func, args):
            return result * 2

        strlen.errcheck = double_result

        result = strlen(b"hello")
        self.assertEqual(result, 10)  # 5 * 2

    def test_errcheck_throw_exception(self):
        """Test errcheck can throw exceptions"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        def check_empty(result, func, args):
            if result == 0:
                raise ValueError("String is empty!")
            return result

        strlen.errcheck = check_empty

        # Non-empty string should work
        self.assertEqual(strlen(b"hello"), 5)

        # Empty string should throw
        with self.assertRaises(ValueError):
            strlen(b"")

    def test_errcheck_clear(self):
        """Test clearing errcheck with None"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        call_count = []

        def counter(result, func, args):
            call_count.append(1)
            return result

        strlen.errcheck = counter

        strlen(b"hello")
        self.assertEqual(len(call_count), 1)

        # Clear errcheck
        del strlen.errcheck
        strlen(b"hello")
        self.assertEqual(len(call_count), 1)  # Should not increase

    @unittest.skipUnless(sys.platform == "win32", "Windows only")
    def test_callback_with_qsort(self):
        """Test create and use callback with qsort"""
        qsort = self.libc.qsort
        qsort.argtypes = [c_void_p, c_size_t, c_size_t, c_void_p]
        qsort.restype = None

        # Create comparison function
        CMPFUNC = CFUNCTYPE(c_int, c_void_p, c_void_p)

        def compare(a, b):
            val_a = cast(a, POINTER(c_int32)).contents.value
            val_b = cast(b, POINTER(c_int32)).contents.value
            return val_a - val_b

        compare_cb = CMPFUNC(compare)

        # Create array to sort
        IntArray5 = c_int32 * 5
        arr = IntArray5(5, 2, 8, 1, 9)

        # Sort
        qsort(arr, 5, sizeof(c_int32), compare_cb)

        # Verify sorted
        self.assertEqual(list(arr), [1, 2, 5, 8, 9])

    def test_callback_signatures(self):
        """Test callbacks with different signatures"""
        # Callback that takes two ints and returns int
        CB1 = CFUNCTYPE(c_int32, c_int32, c_int32)
        cb1 = CB1(lambda a, b: a + b)
        self.assertIsNotNone(cb1)

        # Callback that takes pointer and returns void
        CB2 = CFUNCTYPE(None, c_void_p)
        cb2 = CB2(lambda ptr: None)
        self.assertIsNotNone(cb2)

    @unittest.skipUnless(
        sys.platform == "win32", "Windows only - different sprintf behavior on Unix"
    )
    def test_variadic_functions(self):
        """Test functions with variable arguments (sprintf)"""
        sprintf = self.libc.sprintf
        sprintf.argtypes = [c_char_p, c_char_p]  # Fixed args only
        sprintf.restype = c_int32

        # Create buffer for output
        buf = create_string_buffer(256)

        # Test variadic calls with different argument patterns
        # Python ctypes auto-detects variadic arguments!
        written = sprintf(buf, b"Hello %s!", b"World")
        self.assertGreater(written, 0)
        self.assertEqual(buf.value, b"Hello World!")

        # Different pattern: int and string
        written = sprintf(buf, b"Number: %d, String: %s", 42, b"test")
        self.assertGreater(written, 0)
        self.assertEqual(buf.value, b"Number: 42, String: test")

        # Multiple numbers
        written = sprintf(buf, b"%d + %d = %d", 10, 20, 30)
        self.assertGreater(written, 0)
        self.assertEqual(buf.value, b"10 + 20 = 30")

        # Float formatting
        written = sprintf(buf, b"Pi is approximately %.2f", c_double(3.14159))
        self.assertGreater(written, 0)
        self.assertEqual(buf.value, b"Pi is approximately 3.14")

    def test_pointer_returns(self):
        """Test functions returning pointers"""
        malloc = self.libc.malloc
        malloc.argtypes = [c_size_t]
        malloc.restype = c_void_p

        free = self.libc.free
        free.argtypes = [c_void_p]
        free.restype = None

        ptr = malloc(1024)
        self.assertNotEqual(ptr, 0, "malloc should return non-null pointer")

        free(ptr)


if __name__ == "__main__":
    unittest.main()
