"""Public function calls migrated from common/test_functions."""

import ctypes as c
from ctypes.util import find_library
from pathlib import PureWindowsPath
import platform
import sys
import unittest

from .._support import LIBC


class TestFunctionsAndCallbacks(unittest.TestCase):
    def setUp(self):
        self.libc = c.CDLL(LIBC)

    def test_abs_function(self):
        absolute = self.libc.abs
        absolute.argtypes = [c.c_int32]
        absolute.restype = c.c_int32
        self.assertIs(self.libc.abs, absolute)
        for value, expected in [(-42, 42), (42, 42), (0, 0)]:
            self.assertEqual(absolute(value), expected)

    def test_strlen_function(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        for value, expected in [(b"hello", 5), (b"world!", 6), (b"", 0), (b"Hello, World!", 13)]:
            self.assertEqual(strlen(value), expected)

    def test_memcpy_function(self):
        memcpy = self.libc.memcpy
        memcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t]
        memcpy.restype = c.c_void_p
        src = c.create_string_buffer(10)
        dst = c.create_string_buffer(10)
        for index in range(10):
            src[index] = index * 10
        self.assertEqual(memcpy(dst, src, 10), c.addressof(dst))
        self.assertEqual(dst.raw, src.raw)

    def test_errcheck_called(self):
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

    def test_errcheck_modify_return(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        strlen.errcheck = lambda result, function, arguments: result * 2
        self.assertEqual(strlen(b"hello"), 10)

    def test_errcheck_throw_exception(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t

        def check(result, function, arguments):
            if result == 0:
                raise ValueError("String is empty!")
            return result

        strlen.errcheck = check
        self.assertEqual(strlen(b"hello"), 5)
        with self.assertRaisesRegex(ValueError, "String is empty!"):
            strlen(b"")

    def test_errcheck_clear(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        calls = []

        def check(result, function, arguments):
            calls.append(arguments)
            return result

        strlen.errcheck = check
        self.assertEqual(strlen(b"hello"), 5)
        del strlen.errcheck
        self.assertEqual(strlen(b"hello"), 5)
        self.assertEqual(calls, [(b"hello",)])

    @unittest.skipUnless(sys.platform == "win32", "Windows only")
    def test_callback_with_qsort(self):
        qsort = self.libc.qsort
        qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p]
        qsort.restype = None
        compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p)
        compare = compare_type(
            lambda first, second: c.cast(first, c.POINTER(c.c_int32)).contents.value
            - c.cast(second, c.POINTER(c.c_int32)).contents.value
        )
        values = (c.c_int32 * 5)(5, 2, 8, 1, 9)
        qsort(values, 5, c.sizeof(c.c_int32), compare)
        self.assertEqual(list(values), [1, 2, 5, 8, 9])

    def test_callback_signatures(self):
        addition = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32)(lambda first, second: first + second)
        nothing = c.CFUNCTYPE(None, c.c_void_p)(lambda value: None)
        self.assertEqual(addition(3, 4), 7)
        self.assertIsNone(nothing(None))
        self.assertNotEqual(c.cast(addition, c.c_void_p).value, 0)
        self.assertNotEqual(c.cast(nothing, c.c_void_p).value, 0)

    @unittest.skipUnless(sys.platform == "win32", "Windows only - different sprintf behavior on Unix")
    @unittest.skipIf(
        sys.platform == "win32" and platform.machine().lower() in ("arm64", "aarch64"),
        "CPython on Windows does not use ffi_prep_cif_var: variadic doubles go in the wrong registers on ARM64",
    )
    def test_variadic_functions(self):
        sprintf = self.libc.sprintf
        sprintf.argtypes = [c.c_char_p, c.c_char_p]
        sprintf.restype = c.c_int32
        buffer = c.create_string_buffer(256)
        for format_string, values, expected in [
            (b"Hello %s!", [b"World"], b"Hello World!"),
            (b"Number: %d, String: %s", [42, b"test"], b"Number: 42, String: test"),
            (b"%d + %d = %d", [10, 20, 30], b"10 + 20 = 30"),
            (b"Pi is approximately %.2f", [c.c_double(3.14159)], b"Pi is approximately 3.14"),
        ]:
            self.assertEqual(sprintf(buffer, format_string, *values), len(expected))
            self.assertEqual(buffer.value, expected)

    def test_pointer_returns(self):
        malloc = self.libc.malloc
        malloc.argtypes = [c.c_size_t]
        malloc.restype = c.c_void_p
        free = self.libc.free
        free.argtypes = [c.c_void_p]
        free.restype = None
        address = malloc(1024)
        self.assertTrue(address)
        free(address)

    def test_function_address(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        self.assertTrue(c.cast(strlen, c.c_void_p).value)

    def test_cfunctype_from_address(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        address = c.cast(strlen, c.c_void_p).value
        independent = c.CFUNCTYPE(c.c_size_t, c.c_char_p)(address)
        self.assertEqual(independent(b"Hello, World!"), 13)

    def test_cast_callback_to_prototype(self):
        prototype = c.CFUNCTYPE(c.c_int32, c.c_int32)

        def bind():
            callback = prototype(lambda value: value + 1)
            return c.cast(callback, prototype)

        function = bind()
        self.assertEqual(function(7), 8)
        self.assertTrue(c.cast(function, c.c_void_p).value)

    def test_int_address_requires_c_void_p(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_char_p]
        strlen.restype = c.c_size_t
        buffer = c.create_string_buffer(b"Hello")
        with self.assertRaises(c.ArgumentError):
            strlen(c.addressof(buffer))
        strlen.argtypes = [c.c_void_p]
        self.assertEqual(strlen(c.addressof(buffer)), 5)

    def test_int_address_via_c_void_p(self):
        strlen = self.libc.strlen
        strlen.argtypes = [c.c_void_p]
        strlen.restype = c.c_size_t
        buffer = c.create_string_buffer(b"Hello")
        self.assertEqual(strlen(c.addressof(buffer)), 5)
        self.assertEqual(strlen(buffer), 5)

    def test_explicit_string_pointer_addresses(self):
        attribute = self.libc.strlen
        attribute.argtypes = [c.c_char_p]
        attribute.restype = c.c_size_t
        independent = c.CFUNCTYPE(c.c_size_t, c.c_char_p)(("strlen", self.libc))
        buffer = c.create_string_buffer(b"Hello")
        address = c.addressof(buffer)
        for strlen in [attribute, independent]:
            with self.assertRaises(c.ArgumentError):
                strlen(address)
            with self.assertRaises(c.ArgumentError):
                strlen(c.c_void_p(address))
            self.assertEqual(strlen(c.c_char_p(address)), 5)
            self.assertEqual(strlen(c.cast(address, c.c_char_p)), 5)
            self.assertEqual(strlen(buffer), 5)
        strchr = self.libc.strchr
        strchr.argtypes = [c.c_char_p, c.c_int]
        strchr.restype = c.c_void_p
        self.assertEqual(strchr(c.c_char_p(address), ord("H")), address)

    def test_explicit_wide_pointer_addresses(self):
        try:
            attribute = self.libc.wcslen
        except AttributeError:
            self.skipTest("wcslen not exported by this libc")
        attribute.argtypes = [c.c_wchar_p]
        attribute.restype = c.c_size_t
        independent = c.CFUNCTYPE(c.c_size_t, c.c_wchar_p)(("wcslen", self.libc))
        buffer = c.create_unicode_buffer("Hello")
        address = c.addressof(buffer)
        for wcslen in [attribute, independent]:
            with self.assertRaises(c.ArgumentError):
                wcslen(address)
            with self.assertRaises(c.ArgumentError):
                wcslen(c.c_void_p(address))
            self.assertEqual(wcslen(c.c_wchar_p(address)), 5)
            self.assertEqual(wcslen(c.cast(address, c.c_wchar_p)), 5)
            self.assertEqual(wcslen(buffer), 5)

    def test_int_address_to_wcslen_via_c_void_p(self):
        try:
            wcslen = self.libc.wcslen
        except AttributeError:
            self.skipTest("wcslen not exported by this libc")
        wcslen.argtypes = [c.c_void_p]
        wcslen.restype = c.c_size_t
        buffer = c.create_unicode_buffer("Hello")
        self.assertEqual(wcslen(c.addressof(buffer)), 5)


class TestLibraryLoader(unittest.TestCase):
    def test_probes(self):
        self.assertIn("LibraryLoader", str(c.cdll))
        with self.assertRaises(AttributeError):
            getattr(c.cdll, "_private")

    def test_lazy_library_cached(self):
        library = getattr(c.cdll, LIBC)
        self.assertIs(getattr(c.cdll, LIBC), library)

    def test_find_library_opens_libc(self):
        name = find_library("msvcrt" if sys.platform == "win32" else "c")
        self.assertIsInstance(name, str)
        self.assertTrue(name)
        library = c.CDLL(name)
        self.assertIsInstance(library, c.CDLL)
        absolute = library.abs
        absolute.argtypes = [c.c_int]
        absolute.restype = c.c_int
        self.assertEqual(absolute(-3), 3)


@unittest.skipUnless(sys.platform == "darwin", "macOS only")
class TestFindLibraryDarwin(unittest.TestCase):
    def test_dyld_shared_cache(self):
        self.assertEqual(find_library("c"), "/usr/lib/libc.dylib")
        self.assertEqual(
            find_library("CoreFoundation"),
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
        )
        self.assertTrue(hasattr(c.CDLL(find_library("CoreFoundation")), "CFStringGetLength"))


@unittest.skipUnless(sys.platform == "linux", "Linux only")
class TestFindLibraryLinux(unittest.TestCase):
    def test_sonames(self):
        for name, pattern, symbol, kind, value, expected in [
            ("c", r"(^|/)libc\.so(\.\d+)*$", "abs", c.c_int, -3, 3),
            ("m", r"(^|/)lib[cm]\.so(\.\d+)*$", "fabs", c.c_double, -1.5, 1.5),
        ]:
            with self.subTest(name=name):
                resolved = find_library(name)
                self.assertIsInstance(resolved, str)
                self.assertRegex(resolved, pattern)
                library = c.CDLL(resolved)
                function = getattr(library, symbol)
                function.argtypes = [kind]
                function.restype = kind
                self.assertEqual(function(value), expected)


@unittest.skipUnless(sys.platform == "win32", "Windows only")
class TestFindLibraryWindows(unittest.TestCase):
    def test_kernel32(self):
        name = find_library("kernel32")
        self.assertIsInstance(name, str)
        self.assertEqual(PureWindowsPath(name).name.lower(), "kernel32.dll")
        library = c.WinDLL(name)
        get_process_id = library.GetCurrentProcessId
        get_process_id.argtypes = []
        get_process_id.restype = c.c_uint32
        self.assertGreater(get_process_id(), 0)

    def test_c_runtime(self):
        name = find_library("msvcrt")
        self.assertIsInstance(name, str)
        self.assertEqual(PureWindowsPath(name).name.lower(), "msvcrt.dll")
        library = c.CDLL(name)
        absolute = library.abs
        absolute.argtypes = [c.c_int]
        absolute.restype = c.c_int
        self.assertEqual(absolute(-7), 7)

    def test_windll_namespace(self):
        get_tick_count = c.windll.kernel32.GetTickCount
        get_tick_count.argtypes = []
        get_tick_count.restype = c.c_uint32
        self.assertGreater(get_tick_count(), 0)


@unittest.skipUnless(sys.platform == "win32", "Windows only")
class TestWindowsParamflags(unittest.TestCase):
    def setUp(self):
        self.user32 = c.WinDLL("user32.dll")

    def test_single_output(self):
        desktop = self.user32.GetDesktopWindow
        desktop.argtypes = []
        desktop.restype = c.c_void_p
        prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32))
        function = prototype(
            ("GetWindowThreadProcessId", self.user32), ((1, "hWnd"), (2, "pid"))
        )
        self.assertGreater(function(desktop()), 0)

    def test_named_input(self):
        desktop = self.user32.GetDesktopWindow
        desktop.argtypes = []
        desktop.restype = c.c_void_p
        prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32))
        function = prototype(
            ("GetWindowThreadProcessId", self.user32), ((1, "hWnd"), (2, "pid"))
        )
        self.assertGreater(function(hWnd=desktop()), 0)

    def test_default_input(self):
        prototype = c.WINFUNCTYPE(c.c_int32, c.c_void_p)
        function = prototype(("IsWindow", self.user32), ((1, "hWnd", None),))
        self.assertEqual(function(), 0)
        self.assertEqual(function(None), 0)

    def test_missing_input(self):
        prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32))
        function = prototype(
            ("GetWindowThreadProcessId", self.user32), ((1, "hWnd"), (2, "pid"))
        )
        with self.assertRaises(TypeError):
            function()

    def test_nonpointer_output_rejected(self):
        prototype = c.WINFUNCTYPE(c.c_int32, c.c_uint32)
        with self.assertRaises(TypeError):
            prototype(("IsWindow", self.user32), ((2, "value"),))
