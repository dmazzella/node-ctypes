"""
Test errcheck - Python ctypes error handling reference
"""

import unittest
import platform
import ctypes
from ctypes import c_size_t, c_char_p, c_int, c_void_p, POINTER


class TestErrcheck(unittest.TestCase):
    """Test errcheck functionality (Python ctypes compatible)"""

    @classmethod
    def setUpClass(cls):
        """Load libraries once for all tests"""
        if platform.system() == "Windows":
            cls.libc = ctypes.CDLL("msvcrt.dll")
            cls.kernel32 = ctypes.WinDLL("kernel32.dll")
        else:
            cls.libc = ctypes.CDLL("libc.so.6")
            cls.kernel32 = None

    def test_basic_errcheck(self):
        """Test basic errcheck functionality"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        errcheck_called = [False]
        received_result = [None]
        received_args = [None]

        def my_errcheck(result, func, args):
            errcheck_called[0] = True
            received_result[0] = result
            received_args[0] = args
            return result

        strlen.errcheck = my_errcheck

        result = strlen(b"hello")

        self.assertTrue(errcheck_called[0], "errcheck should be called")
        self.assertEqual(result, 5)
        self.assertEqual(received_result[0], 5)
        self.assertIsInstance(received_args[0], tuple)
        self.assertEqual(len(received_args[0]), 1)

        # Cleanup
        del strlen.errcheck

    def test_modify_return_value(self):
        """Test errcheck modifying return value"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        def double_errcheck(result, func, args):
            return result * 2

        strlen.errcheck = double_errcheck

        result = strlen(b"hello")
        self.assertEqual(result, 10)  # 5 * 2

        # Cleanup
        del strlen.errcheck

    def test_errcheck_throws(self):
        """Test errcheck throwing exceptions"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        def validate_errcheck(result, func, args):
            if result > 10:
                raise ValueError("String too long!")
            return result

        strlen.errcheck = validate_errcheck

        # Should pass
        self.assertEqual(strlen(b"hello"), 5)

        # Should throw
        with self.assertRaises(ValueError) as ctx:
            strlen(b"this is a very long string")
        self.assertIn("String too long!", str(ctx.exception))

        # Cleanup
        del strlen.errcheck

    def test_clear_errcheck(self):
        """Test clearing errcheck"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        strlen.errcheck = lambda r, f, a: r * 2
        self.assertEqual(strlen(b"hi"), 4)  # 2 * 2

        # Clear errcheck by deleting attribute
        del strlen.errcheck
        self.assertEqual(strlen(b"hi"), 2)  # Original value

    @unittest.skipIf(platform.system() == "Windows", "Unix-specific test")
    def test_errno_pattern(self):
        """Test errno pattern (POSIX)"""
        open_func = self.libc.open
        open_func.argtypes = [c_char_p, c_int]
        open_func.restype = c_int

        def check_errno(result, func, args):
            if result == -1:
                errno = ctypes.get_errno()
                raise OSError(errno, f"open({args[0]}) failed with errno {errno}")
            return result

        open_func.errcheck = check_errno

        # Non-existent file should throw
        with self.assertRaises(OSError) as ctx:
            open_func(b"/path/that/does/not/exist/test.txt", 0)
        self.assertIsNotNone(ctx.exception.errno)

        # Cleanup
        del open_func.errcheck

    @unittest.skipIf(platform.system() != "Windows", "Windows-specific test")
    def test_winerror_pattern(self):
        """Test WinError pattern (Windows)"""
        DeleteFileW = self.kernel32.DeleteFileW
        DeleteFileW.argtypes = [ctypes.c_wchar_p]
        DeleteFileW.restype = ctypes.c_bool

        # Set last error before calling
        self.kernel32.SetLastError(0)

        def check_winerror(result, func, args):
            if not result:
                winerror = self.kernel32.GetLastError()
                if winerror != 0:
                    raise ctypes.WinError(winerror)
            return result

        DeleteFileW.errcheck = check_winerror

        # Non-existent file should throw
        with self.assertRaises(OSError) as ctx:
            DeleteFileW("Z:\\file_that_does_not_exist_xyz123.txt")
        # WinError throws OSError with winerror attribute
        self.assertTrue(
            hasattr(ctx.exception, "winerror") or ctx.exception.errno is not None
        )

        # Cleanup
        del DeleteFileW.errcheck

    def test_pointer_validation(self):
        """Test pointer validation with errcheck"""
        malloc = self.libc.malloc
        malloc.argtypes = [c_size_t]
        malloc.restype = c_void_p

        def check_null(result, func, args):
            if result is None or result == 0:
                raise MemoryError(f"malloc({args[0]}) returned NULL")
            return result

        malloc.errcheck = check_null

        # Normal allocation should work
        ptr = malloc(100)
        self.assertNotEqual(ptr, 0)

        # Cleanup
        free = self.libc.free
        free.argtypes = [c_void_p]
        free(ptr)
        del malloc.errcheck

    def test_errcheck_parameters(self):
        """Test errcheck receives correct parameters"""
        abs_func = self.libc.abs
        abs_func.argtypes = [c_int]
        abs_func.restype = c_int

        captured = {}

        def capture_errcheck(result, func, args):
            captured["result"] = result
            captured["func"] = func
            captured["args"] = args
            return result

        abs_func.errcheck = capture_errcheck

        result = abs_func(-42)

        self.assertEqual(result, 42)
        self.assertEqual(captured["result"], 42)
        self.assertIsNotNone(captured["func"])
        self.assertIsInstance(captured["args"], tuple)
        self.assertEqual(len(captured["args"]), 1)
        self.assertEqual(captured["args"][0], -42)

        # Cleanup
        del abs_func.errcheck

    def test_multiple_arguments(self):
        """Test errcheck with multiple arguments"""
        memcpy = self.libc.memcpy
        memcpy.argtypes = [c_void_p, c_void_p, c_size_t]
        memcpy.restype = c_void_p

        arg_count = [0]

        def count_args_errcheck(result, func, args):
            arg_count[0] = len(args)
            return result

        memcpy.errcheck = count_args_errcheck

        src = ctypes.create_string_buffer(10)
        dst = ctypes.create_string_buffer(10)
        memcpy(dst, src, 10)

        self.assertEqual(arg_count[0], 3)

        # Cleanup
        del memcpy.errcheck

    def test_errcheck_chaining(self):
        """Test changing errcheck multiple times"""
        strlen = self.libc.strlen
        strlen.argtypes = [c_char_p]
        strlen.restype = c_size_t

        # First errcheck
        strlen.errcheck = lambda r, f, a: r + 1
        self.assertEqual(strlen(b"hi"), 3)  # 2 + 1

        # Change errcheck
        strlen.errcheck = lambda r, f, a: r * 3
        self.assertEqual(strlen(b"hi"), 6)  # 2 * 3

        # Remove by deleting
        del strlen.errcheck
        self.assertEqual(strlen(b"hi"), 2)  # Original

    def test_python_ctypes_compatibility(self):
        """Test that behavior matches Python ctypes exactly"""
        abs_func = self.libc.abs
        abs_func.argtypes = [c_int]
        abs_func.restype = c_int

        # Standard Python ctypes pattern
        def errcheck(result, func, args):
            if result == 0:
                err = OSError(42, "Test error")
                raise err
            return result

        abs_func.errcheck = errcheck

        # Should not throw
        self.assertEqual(abs_func(-5), 5)

        # Should throw
        with self.assertRaises(OSError) as ctx:
            abs_func(0)
        self.assertEqual(ctx.exception.errno, 42)

        # Cleanup
        del abs_func.errcheck


if __name__ == "__main__":
    unittest.main()
