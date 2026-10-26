"""Error checks migrated from common/test_errcheck, without worker scheduling."""

import ctypes as c
import errno
import sys
import unittest

from .._support import LIBC


class TestErrcheck(unittest.TestCase):
    def setUp(self):
        self.libc = c.CDLL(LIBC)

    def test_basic_errcheck(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        received = []

        def check(result, function, arguments):
            received.append((result, function is strlen, arguments))
            return result

        strlen.errcheck = check
        self.assertEqual(strlen(b"hello"), 5)
        self.assertEqual(received, [(5, True, (b"hello",))])
        self.assertIsInstance(received[0][2], tuple)

    def test_modify_return_value(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        strlen.errcheck = lambda result, function, arguments: result * 2
        self.assertEqual(strlen(b"hello"), 10)

    def test_errcheck_throws(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t

        def check(result, function, arguments):
            if result > 10:
                raise ValueError("String too long!")
            return result

        strlen.errcheck = check
        self.assertEqual(strlen(b"hello"), 5)
        with self.assertRaisesRegex(ValueError, "String too long!"):
            strlen(b"this is a very long string")

    def test_clear_errcheck(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        strlen.errcheck = lambda result, function, arguments: result * 2
        self.assertEqual(strlen(b"hi"), 4)
        del strlen.errcheck
        self.assertEqual(strlen(b"hi"), 2)

    @unittest.skipIf(sys.platform == "win32", "Unix-specific test")
    def test_errno_pattern(self):
        libc = c.CDLL(LIBC, use_errno=True)
        open_file = libc.open
        open_file.argtypes = [c.c_char_p, c.c_int]
        open_file.restype = c.c_int

        def check(result, function, arguments):
            if result == -1:
                raise OSError(c.get_errno(), "open failed with errno")
            return result

        open_file.errcheck = check
        with self.assertRaises(OSError) as raised:
            open_file(b"/path/that/does/not/exist/test.txt", 0)
        self.assertEqual(raised.exception.errno, errno.ENOENT)

    @unittest.skipUnless(sys.platform == "win32", "Windows-specific test")
    def test_winerror_pattern(self):
        kernel32 = c.WinDLL("kernel32.dll", use_last_error=True)
        delete_file = kernel32.DeleteFileW
        delete_file.argtypes = [c.c_wchar_p]
        delete_file.restype = c.c_bool
        c.set_last_error(0)

        def check(result, function, arguments):
            if not result:
                error = c.get_last_error()
                if error:
                    raise c.WinError(error)
            return result

        delete_file.errcheck = check
        with self.assertRaises(OSError) as raised:
            delete_file("Z:\\file_that_does_not_exist_xyz123.txt")
        self.assertIsInstance(raised.exception.winerror, int)
        self.assertNotEqual(raised.exception.winerror, 0)

    def test_pointer_validation(self):
        malloc = self.libc.malloc
        malloc.argtypes = [c.c_size_t]
        malloc.restype = c.c_void_p

        def check(result, function, arguments):
            if not result:
                raise MemoryError("malloc returned NULL")
            return result

        malloc.errcheck = check
        address = malloc(100)
        self.assertTrue(address)
        free = self.libc.free
        free.argtypes = [c.c_void_p]
        free.restype = None
        free(address)

    def test_errcheck_parameters(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int]
        absolute.restype = c.c_int
        captured = []

        def check(result, function, arguments):
            captured.append((result, function is absolute, arguments))
            return result

        absolute.errcheck = check
        self.assertEqual(absolute(-42), 42)
        self.assertEqual(captured, [(42, True, (-42,))])
        self.assertIsInstance(captured[0][2], tuple)

    def test_multiple_arguments(self):
        memcpy = self.libc.memcpy
        memcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t]
        memcpy.restype = c.c_void_p
        src = c.create_string_buffer(10)
        dst = c.create_string_buffer(10)
        captured = []

        def check(result, function, arguments):
            captured.append(arguments)
            return result

        memcpy.errcheck = check
        self.assertEqual(memcpy(dst, src, 10), c.addressof(dst))
        self.assertEqual(len(captured), 1)
        self.assertEqual(len(captured[0]), 3)
        self.assertIs(captured[0][0], dst)
        self.assertIs(captured[0][1], src)
        self.assertEqual(captured[0][2], 10)

    def test_errcheck_chaining(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        strlen.errcheck = lambda result, function, arguments: result + 1
        self.assertEqual(strlen(b"hi"), 3)
        strlen.errcheck = lambda result, function, arguments: result * 3
        self.assertEqual(strlen(b"hi"), 6)
        del strlen.errcheck
        self.assertEqual(strlen(b"hi"), 2)

    def test_errcheck_kept_on_type_change(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int]
        absolute.restype = c.c_int

        def twice(result, function, arguments):
            return result * 2

        absolute.errcheck = twice
        self.assertEqual(absolute(-3), 6)
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        self.assertIs(absolute.errcheck, twice)
        self.assertEqual(absolute(-4), 8)
        del absolute.errcheck
        self.assertEqual(absolute(-4), 4)

    def test_python_ctypes_compatibility(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int]
        absolute.restype = c.c_int

        def check(result, function, arguments):
            if result == 0:
                raise OSError(42, "Test error")
            return result

        absolute.errcheck = check
        self.assertEqual(absolute(-5), 5)
        with self.assertRaises(OSError) as raised:
            absolute(0)
        self.assertEqual(raised.exception.errno, 42)

    def test_independent_binding_errcheck(self):
        attribute = self.libc.abs
        attribute.argtypes = [c.c_int]
        attribute.restype = c.c_int
        independent = c.CFUNCTYPE(c.c_int, c.c_int)(("abs", self.libc))
        attribute.errcheck = lambda result, function, arguments: -result
        self.assertEqual(attribute(-3), -3)
        self.assertEqual(independent(-3), 3)
        self.assertIsNot(independent.errcheck, attribute.errcheck)

    @unittest.skipIf(sys.platform == "win32", "Unix-specific test")
    def test_variadic_errcheck_unix(self):
        sprintf = self.libc.sprintf
        sprintf.argtypes = [c.c_void_p, c.c_char_p]
        sprintf.restype = c.c_int32
        calls = []

        def check(result, function, arguments):
            calls.append((result, function is sprintf, arguments[1:]))
            if result < 0:
                raise ValueError("sprintf failed")
            return result

        sprintf.errcheck = check
        buffer = c.create_string_buffer(100)
        self.assertEqual(sprintf(buffer, b"Number: %d", 42), 10)
        self.assertEqual(buffer.value, b"Number: 42")
        self.assertEqual(calls, [(10, True, (b"Number: %d", 42))])

    @unittest.skipUnless(sys.platform == "win32", "Windows-specific test")
    def test_variadic_errcheck_windows(self):
        snprintf = self.libc._snprintf
        snprintf.argtypes = [c.c_void_p, c.c_size_t, c.c_char_p]
        snprintf.restype = c.c_int32
        calls = []

        def check(result, function, arguments):
            calls.append((result, function is snprintf, arguments[1:]))
            if result < 0:
                raise ValueError("_snprintf failed")
            return result

        snprintf.errcheck = check
        buffer = c.create_string_buffer(100)
        self.assertEqual(snprintf(buffer, 100, b"Number: %d", 42), 10)
        self.assertEqual(buffer.value, b"Number: 42")
        self.assertEqual(calls, [(10, True, (100, b"Number: %d", 42))])


@unittest.skipUnless(sys.platform == "win32", "Windows only")
class TestOleDLL(unittest.TestCase):
    def test_failing_hresult(self):
        ole32 = c.OleDLL("ole32.dll")
        parse = ole32.CLSIDFromString
        parse.argtypes = [c.c_wchar_p, c.c_void_p]
        parse.restype = c.HRESULT
        with self.assertRaises(OSError) as raised:
            parse("NOT A GUID", c.create_string_buffer(16))
        self.assertIsInstance(raised.exception.winerror, int)

    def test_successful_hresult(self):
        ole32 = c.OleDLL("ole32.dll")
        parse = ole32.CLSIDFromString
        parse.argtypes = [c.c_wchar_p, c.c_void_p]
        parse.restype = c.HRESULT
        self.assertEqual(parse("{00000000-0000-0000-0000-000000000000}", c.create_string_buffer(16)), 0)

    def test_non_hresult_restype(self):
        ole32 = c.OleDLL("ole32.dll")
        current = ole32.CoGetCurrentProcess
        current.argtypes = []
        current.restype = c.c_int32
        self.assertGreater(current(), 0)


@unittest.skipUnless(sys.platform == "win32", "Windows only")
class TestUseLastError(unittest.TestCase):
    def test_failure_snapshot(self):
        kernel32 = c.WinDLL("kernel32.dll", use_last_error=True)
        load = kernel32.LoadLibraryW
        load.argtypes = [c.c_wchar_p]
        load.restype = c.c_void_p
        c.set_last_error(0)
        self.assertIsNone(load("C:/NoSuchFile_ABCXYZ_test.dll"))
        self.assertIn(c.get_last_error(), (126, 3))
