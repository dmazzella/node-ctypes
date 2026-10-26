"""
Test Basic Types - Cross Platform
Tests all basic C types supported by ctypes
"""

import ctypes
import ctypes.util
import platform
import struct
import unittest
from .._support import LIBC
from ctypes import (
    c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32,
    c_int64, c_uint64, c_float, c_double, c_bool, c_void_p, c_size_t,
    c_long, c_ulong, c_byte, c_ubyte, c_short, c_ushort, c_int, c_uint,
    c_longlong, c_ulonglong, sizeof, create_string_buffer, byref, memmove,
    c_char_p, c_wchar_p, c_ssize_t, alignment, Structure
)

class TestBasicTypes(unittest.TestCase):

    def test_char_p_c_char_p(self):
        """Test char_p / c_char_p"""
        val = c_char_p(b"Hello, World!")
        self.assertEqual(val.value, b"Hello, World!")
        
        val = c_char_p(b"")
        self.assertEqual(val.value, b"")

        val = c_char_p(None)
        self.assertIsNone(val.value)

        val = c_char_p(b"Test String")
        self.assertEqual(val.value, b"Test String")
        val.value = b"New String"
        self.assertEqual(val.value, b"New String")
        val = c_char_p(b"Initial Value")
        val.value = b"Modified Value"
        self.assertEqual(val.value, b"Modified Value")

    def test_wchar_p_c_wchar_p(self):
        """Test wchar_p / c_wchar_p"""
        val = c_wchar_p("Hello, Wide World!")
        self.assertEqual(val.value, "Hello, Wide World!")
        
        val = c_wchar_p("")
        self.assertEqual(val.value, "")

        val = c_wchar_p(None)
        self.assertIsNone(val.value)

        val = c_wchar_p("Test Wide String")
        self.assertEqual(val.value, "Test Wide String")
        val.value = "New Wide String"
        self.assertEqual(val.value, "New Wide String")
        val = c_wchar_p("Initial Wide Value")
        val.value = "Modified Wide Value"
        self.assertEqual(val.value, "Modified Wide Value")

    def test_int8_c_int8(self):
        """Test int8 / c_int8"""
        buf = create_string_buffer(1)
        val = c_int8(-128)
        memmove(buf, byref(val), 1)
        result = c_int8.from_buffer(buf)
        self.assertEqual(result.value, -128)
        val.value = 127
        self.assertEqual(val.value, 127)
        val = c_int8(127)
        memmove(buf, byref(val), 1)
        result = c_int8.from_buffer(buf)
        self.assertEqual(result.value, 127)
        val.value = -128
        self.assertEqual(val.value, -128)
    
    def test_uint8_c_uint8_c_ubyte(self):
        """Test uint8 / c_uint8 / c_ubyte"""
        val = c_uint8(0)
        self.assertEqual(val.value, 0)
        
        val = c_uint8(255)
        self.assertEqual(val.value, 255)
    
    def test_int16_c_int16_c_short(self):
        """Test int16 / c_int16 / c_short"""
        val = c_int16(-32768)
        self.assertEqual(val.value, -32768)
        val.value = 32767
        self.assertEqual(val.value, 32767)
        val = c_int16(32767)
        self.assertEqual(val.value, 32767)
        val.value = -32768
        self.assertEqual(val.value, -32768)
    
    def test_uint16_c_uint16_c_ushort(self):
        """Test uint16 / c_uint16 / c_ushort"""
        val = c_uint16(0)
        self.assertEqual(val.value, 0)
        
        val = c_uint16(65535)
        self.assertEqual(val.value, 65535)
    
    def test_int32_c_int32_c_int(self):
        """Test int32 / c_int32 / c_int"""
        val = c_int32(-2147483648)
        self.assertEqual(val.value, -2147483648)
        val.value = 2147483647
        self.assertEqual(val.value, 2147483647)
        val = c_int32(2147483647)
        self.assertEqual(val.value, 2147483647)
        val.value = -2147483648
        self.assertEqual(val.value, -2147483648)
    
    def test_uint32_c_uint32_c_uint(self):
        """Test uint32 / c_uint32 / c_uint"""
        val = c_uint32(0)
        self.assertEqual(val.value, 0)
        
        val = c_uint32(4294967295)
        self.assertEqual(val.value, 4294967295)
    
    def test_int64_c_int64_c_longlong(self):
        """Test int64 / c_int64 / c_longlong"""
        val = c_int64(-9223372036854775808)
        self.assertEqual(val.value, -9223372036854775808)
        val.value = 9223372036854775807
        self.assertEqual(val.value, 9223372036854775807)
        val = c_int64(9223372036854775807)
        self.assertEqual(val.value, 9223372036854775807)
        val.value = -9223372036854775808
        self.assertEqual(val.value, -9223372036854775808)
    
    def test_uint64_c_uint64_c_ulonglong(self):
        """Test uint64 / c_uint64 / c_ulonglong"""
        val = c_uint64(0)
        self.assertEqual(val.value, 0)
        
        val = c_uint64(18446744073709551615)
        self.assertEqual(val.value, 18446744073709551615)
    
    def test_float_c_float(self):
        """Test float / c_float"""
        val = c_float(3.14159)
        self.assertAlmostEqual(val.value, 3.14159, places=5)
    
    def test_double_c_double(self):
        """Test double / c_double"""
        val = c_double(3.141592653589793)
        self.assertAlmostEqual(val.value, 3.141592653589793, places=12)
    
    def test_bool_c_bool(self):
        """Test bool / c_bool"""
        val = c_bool(True)
        self.assertEqual(val.value, True)
        val.value = False
        self.assertEqual(val.value, False)
        val = c_bool(False)
        self.assertEqual(val.value, False)
    
    def test_pointer_c_void_p(self):
        """Test pointer / c_void_p"""
        val = c_void_p(0x12345678)
        self.assertEqual(val.value, 0x12345678)
    
    def test_size_t_c_size_t(self):
        """Test size_t / c_size_t"""
        val = c_size_t(1024)
        self.assertEqual(val.value, 1024)
    
    def test_c_long_platform_dependent(self):
        """Test c_long (platform-dependent)"""
        size = sizeof(c_long)
        self.assertIn(size, [4, 8], 'c_long should be 4 or 8 bytes')
        
        if size == 4:
            val = c_long(2147483647)
            self.assertEqual(val.value, 2147483647)
            self.assertEqual(c_long(-1).value, -1)
        else:
            val = c_long(9223372036854775807)
            self.assertEqual(val.value, 9223372036854775807)
    
    def test_c_ulong_platform_dependent(self):
        """Test c_ulong (platform-dependent)"""
        size = sizeof(c_ulong)
        self.assertIn(size, [4, 8], 'c_ulong should be 4 or 8 bytes')
        
        if size == 4:
            val = c_ulong(4294967295)
            self.assertEqual(val.value, 4294967295)
            self.assertEqual(c_ulong(4294967296 + 5).value, 5)
        else:
            val = c_ulong(18446744073709551615)
            self.assertEqual(val.value, 18446744073709551615)
    
    def test_sizeof(self):
        """Test sizeof() for all types"""
        self.assertEqual(sizeof(c_int8), 1)
        self.assertEqual(sizeof(c_uint8), 1)
        self.assertEqual(sizeof(c_int16), 2)
        self.assertEqual(sizeof(c_uint16), 2)
        self.assertEqual(sizeof(c_int32), 4)
        self.assertEqual(sizeof(c_uint32), 4)
        self.assertEqual(sizeof(c_int64), 8)
        self.assertEqual(sizeof(c_uint64), 8)
        self.assertEqual(sizeof(c_float), 4)
        self.assertEqual(sizeof(c_double), 8)
        self.assertEqual(sizeof(c_bool), 1)
        self.assertEqual(sizeof(c_void_p), sizeof(c_size_t))

    def test_sizeof_instance(self):
        self.assertEqual(sizeof(c_uint64(42)), 8)

    def test_byref_scalar_and_structure(self):
        self.assertIsNotNone(byref(c_uint32(42)))
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        self.assertIsNotNone(byref(Point(10, 20)))

    def test_from_buffer_view(self):
        buf = create_string_buffer(4)
        c_uint32.from_buffer(buf).value = 0xdeadbeef
        val = c_uint32.from_buffer(buf)
        self.assertEqual(val.value, 0xdeadbeef)
        val.value = 0x12345678
        self.assertEqual(c_uint32.from_buffer(buf).value, 0x12345678)

    def test_from_buffer_offset(self):
        buf = create_string_buffer(8)
        c_uint32.from_buffer(buf, 0).value = 0xaabbccdd
        c_uint32.from_buffer(buf, 4).value = 0x11223344
        self.assertEqual(c_uint32.from_buffer(buf, 0).value, 0xaabbccdd)
        self.assertEqual(c_uint32.from_buffer(buf, 4).value, 0x11223344)

    def test_from_buffer_copy(self):
        buf = create_string_buffer(4)
        c_uint32.from_buffer(buf).value = 0xdeadbeef
        val = c_uint32.from_buffer_copy(buf)
        self.assertEqual(val.value, 0xdeadbeef)
        val.value = 0x12345678
        self.assertEqual(c_uint32.from_buffer(buf).value, 0xdeadbeef)

    def test_aliases(self):
        for kind, value in [(c_byte, -128), (c_ubyte, 255), (c_short, -32768),
                            (c_ushort, 65535), (c_longlong, 9223372036854775807),
                            (c_ulonglong, 18446744073709551615)]:
            self.assertEqual(kind(value).value, value)
        self.assertEqual(sizeof(c_byte), 1)

    def test_default_values(self):
        for kind in [c_uint64, c_int32, c_double]:
            self.assertEqual(kind().value, 0)
        self.assertIs(c_bool().value, False)

    def test_void_pointer_field(self):
        class Record(Structure):
            _fields_ = [("p", c_void_p)]
        source = create_string_buffer(b"hi")
        address = ctypes.addressof(source)
        record = Record()
        for value in [address, c_void_p(address)]:
            record.p = value
            self.assertEqual(record.p, address)
        with self.assertRaises(TypeError):
            record.p = {}


# ─── c_ssize_t ───

class TestCSsizeT(unittest.TestCase):
    """Test c_ssize_t type"""

    def test_stores_positive_values(self):
        v = c_ssize_t(42)
        self.assertEqual(v.value, 42)

    def test_stores_negative_values(self):
        v = c_ssize_t(-42)
        self.assertEqual(v.value, -42)

    def test_same_size_as_c_size_t(self):
        self.assertEqual(sizeof(c_ssize_t), sizeof(c_size_t))

    def test_same_size_as_pointer(self):
        self.assertEqual(sizeof(c_ssize_t), sizeof(c_void_p))

    def test_large_positive_value(self):
        v = c_ssize_t(2**31 - 1)
        self.assertEqual(v.value, 2**31 - 1)

    def test_large_negative_value(self):
        v = c_ssize_t(-(2**31))
        self.assertEqual(v.value, -(2**31))

    def test_in_struct_field(self):
        """c_ssize_t works as a struct field"""
        class S(Structure):
            _fields_ = [("len", c_ssize_t)]
        s = S(-100)
        self.assertEqual(s.len, -100)


# ─── alignment() ───

class TestAlignment(unittest.TestCase):
    """Test alignment() function"""

    def test_primitive_types(self):
        self.assertEqual(alignment(c_uint8), 1)
        self.assertEqual(alignment(c_int32), 4)
        self.assertEqual(alignment(c_double), 8)

    def test_pointer_type(self):
        expected = 8 if struct.calcsize("P") == 8 else 4
        self.assertEqual(alignment(c_void_p), expected)

    def test_structure(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        self.assertEqual(alignment(Point), 4)

    def test_structure_mixed_types(self):
        class Mixed(Structure):
            _fields_ = [("a", c_uint8), ("b", c_double)]
        self.assertEqual(alignment(Mixed), 8)

    def test_array_type(self):
        self.assertEqual(alignment(c_int32 * 4), 4)

    def test_alignment_of_instance(self):
        """alignment() works on instances too"""
        v = c_int32(42)
        self.assertEqual(alignment(v), 4)

    def test_alignment_of_struct_instance(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        p = Point(1, 2)
        self.assertEqual(alignment(p), 4)

    def test_throws_for_invalid(self):
        with self.assertRaises(TypeError):
            alignment(42)
        with self.assertRaises(TypeError):
            alignment("string")
        with self.assertRaises(TypeError):
            alignment(None)


class TestPointers(unittest.TestCase):
    def test_pointer_to_int(self):
        value = c_int32(42)
        pointer = ctypes.pointer(value)
        self.assertTrue(pointer)
        self.assertEqual(pointer[0], 42)
        self.assertEqual(pointer.contents.value, 42)

    def test_pointer_write_through(self):
        value = c_int32(42)
        pointer = ctypes.pointer(value)
        pointer[0] = 100
        self.assertEqual(value.value, 100)

    def test_pointer_contents_repoints(self):
        first, second = c_int32(42), c_int32(99)
        pointer = ctypes.pointer(first)
        pointer.contents = second
        self.assertEqual(pointer[0], 99)
        self.assertEqual(first.value, 42)
        pointer[0] = 7
        self.assertEqual(second.value, 7)

    def test_pointer_to_structure(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        point = Point(10, 20)
        pointer = ctypes.pointer(point)
        self.assertEqual([pointer.contents.x, pointer.contents.y], [10, 20])

    def test_pointer_to_double(self):
        value = c_double(3.14159)
        pointer = ctypes.pointer(value)
        self.assertAlmostEqual(pointer[0], 3.14159, places=5)

    def test_addressof_scalar(self):
        address = ctypes.addressof(c_int32(42))
        self.assertIsInstance(address, int)
        self.assertGreater(address, 0)

    def test_addressof_matches_contents(self):
        value = c_int32(42)
        pointer = ctypes.pointer(value)
        self.assertEqual(ctypes.addressof(value), ctypes.addressof(pointer.contents))

    def test_addressof_structure(self):
        class Point(Structure):
            _fields_ = [("x", c_int32), ("y", c_int32)]
        point = Point(10, 20)
        address = ctypes.addressof(point)
        self.assertIsInstance(address, int)
        self.assertGreater(address, 0)

    def test_addressof_cast_roundtrip(self):
        value = c_int32(42)
        address = ctypes.addressof(value)
        pointer = ctypes.cast(c_void_p(address), ctypes.POINTER(c_int32))
        self.assertEqual(pointer[0], 42)

    def test_cast_array(self):
        array = (c_int32 * 3)(100, 200, 300)
        pointer = ctypes.cast(array, ctypes.POINTER(c_int32))
        self.assertEqual([pointer[i] for i in range(3)], [100, 200, 300])

    def test_cast_void_pointer(self):
        value = c_int32(12345)
        pointer = ctypes.cast(c_void_p(ctypes.addressof(value)), ctypes.POINTER(c_int32))
        self.assertEqual(pointer[0], 12345)

    def test_cast_preserves_type(self):
        value = c_double(3.14)
        pointer = ctypes.cast(ctypes.pointer(value), ctypes.POINTER(c_double))
        self.assertAlmostEqual(pointer[0], 3.14, places=2)

    def test_cast_reinterprets_float(self):
        value = c_float(1.0)
        pointer = ctypes.cast(ctypes.pointer(value), ctypes.POINTER(c_uint32))
        self.assertEqual(pointer[0], 0x3f800000)

    def test_cast_write_through(self):
        array = (c_int32 * 2)(0, 0)
        pointer = ctypes.cast(array, ctypes.POINTER(c_int32))
        pointer[0], pointer[1] = 111, 222
        self.assertEqual(list(array), [111, 222])

    def test_cast_integer_address(self):
        pointer = ctypes.cast(0x12345678, ctypes.POINTER(c_int32))
        self.assertEqual(ctypes.cast(pointer, c_void_p).value, 0x12345678)

    def test_pointer_array_indexing(self):
        array = (c_int32 * 5)(10, 20, 30, 40, 50)
        pointer = ctypes.cast(array, ctypes.POINTER(c_int32))
        for index in range(5):
            self.assertEqual(pointer[index], (index + 1) * 10)

    def test_pointer_array_write(self):
        array = (c_int32 * 3)(0, 0, 0)
        pointer = ctypes.cast(array, ctypes.POINTER(c_int32))
        pointer[0], pointer[1], pointer[2] = 11, 22, 33
        self.assertEqual(list(array), [11, 22, 33])

    def test_pointer_double_array(self):
        array = (c_double * 3)(1.1, 2.2, 3.3)
        pointer = ctypes.cast(array, ctypes.POINTER(c_double))
        for index, expected in enumerate([1.1, 2.2, 3.3]):
            self.assertAlmostEqual(pointer[index], expected, places=2)

    def test_null_pointer(self):
        pointer = ctypes.cast(None, ctypes.POINTER(c_int32))
        self.assertFalse(pointer)

    def test_null_pointer_dereference(self):
        pointer = ctypes.cast(None, ctypes.POINTER(c_int32))
        with self.assertRaisesRegex(ValueError, "NULL pointer"):
            pointer.contents
        with self.assertRaisesRegex(ValueError, "NULL pointer"):
            pointer[0]


class TestInDll(unittest.TestCase):
    @unittest.skipUnless(platform.system() == "Windows", "Windows exported _timezone")
    def test_global(self):
        library = ctypes.CDLL(LIBC)
        value = c_int32.in_dll(library, "_timezone")
        self.assertIsInstance(value.value, int)

    def test_missing_symbol(self):
        library = ctypes.CDLL(LIBC)
        with self.assertRaises(ValueError):
            c_int32.in_dll(library, "symbol_that_definitely_does_not_exist_12345")

    @unittest.skipUnless(platform.system() == "Windows", "Original Windows-only inherited factory check")
    def test_structure_factory(self):
        class Dummy(Structure):
            _fields_ = [("x", c_int32)]
        self.assertTrue(callable(Dummy.in_dll))


class TestAsParameterFromParam(unittest.TestCase):
    """Python ctypes protocols for custom value conversion on calls.
    `_as_parameter_` is unwrapped automatically by ctypes at call time;
    `from_param(cls, value)` is a classmethod that can convert before the
    call. Cross-platform: test shapes only, not call behavior."""

    def test_as_parameter_attribute(self):
        class Wrapper:
            def __init__(self, v):
                self._as_parameter_ = v
        w = Wrapper(42)
        self.assertEqual(w._as_parameter_, 42)

    def test_from_param_classmethod(self):
        class StrLen(c_int32):
            @classmethod
            def from_param(cls, value):
                if isinstance(value, str):
                    return len(value)
                return value
        self.assertEqual(StrLen.from_param("hello"), 5)
        self.assertEqual(StrLen.from_param(42), 42)

    def test_as_parameter_native_call(self):
        class Handle:
            def __init__(self, value):
                self._as_parameter_ = value
        library = ctypes.CDLL(LIBC)
        abs_ = library.abs
        abs_.argtypes = [c_int32]
        abs_.restype = c_int32
        self.assertEqual(abs_(Handle(-42)), 42)

    def test_from_param_native_call(self):
        class StrLen(c_int32):
            @classmethod
            def from_param(cls, value):
                return len(value) if isinstance(value, str) else value
        library = ctypes.CDLL(LIBC)
        abs_ = library.abs
        abs_.argtypes = [StrLen]
        abs_.restype = c_int32
        self.assertEqual(abs_("hello"), 5)
        self.assertEqual(abs_(-7), 7)

    def test_from_param_receives_argument_as_passed(self):
        libc = ctypes.CDLL(LIBC)
        seen = []

        class Strict(c_int32):
            @classmethod
            def from_param(cls, value):
                seen.append(type(value).__name__)
                if isinstance(value, str):
                    raise ValueError("no strings")
                return value

        class Wrapped:
            def __init__(self, v):
                self._as_parameter_ = v

        abs_ = libc.abs
        abs_.restype = c_int32
        abs_.argtypes = [Strict]
        self.assertEqual(abs_(Wrapped(-3)), 3)
        self.assertEqual(abs_(-4), 4)
        self.assertEqual(seen, ["Wrapped", "int"])
        proto = ctypes.CFUNCTYPE(c_int32, Strict)(("abs", libc))
        self.assertEqual(proto(Wrapped(-9)), 9)
        for f in (abs_, proto):
            with self.assertRaises(ctypes.ArgumentError) as cm:
                f("x")
            self.assertEqual(str(cm.exception), "argument 1: ValueError: no strings")


if __name__ == '__main__':
    unittest.main()
