"""
Test Basic Types - Cross Platform
Tests all basic C types supported by ctypes
"""

import unittest
from ctypes import (
    c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32,
    c_int64, c_uint64, c_float, c_double, c_bool, c_void_p, c_size_t,
    c_long, c_ulong, c_byte, c_ubyte, c_short, c_ushort, c_int, c_uint,
    c_longlong, c_ulonglong, sizeof, create_string_buffer, byref, memmove,
    c_char_p, c_wchar_p
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

    def test_int8_c_int8(self):
        """Test int8 / c_int8"""
        buf = create_string_buffer(1)
        val = c_int8(-128)
        memmove(buf, byref(val), 1)
        result = c_int8.from_buffer(buf)
        self.assertEqual(result.value, -128)
        
        val = c_int8(127)
        memmove(buf, byref(val), 1)
        result = c_int8.from_buffer(buf)
        self.assertEqual(result.value, 127)
    
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
        
        val = c_int16(32767)
        self.assertEqual(val.value, 32767)
    
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
        
        val = c_int32(2147483647)
        self.assertEqual(val.value, 2147483647)
    
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
        
        val = c_int64(9223372036854775807)
        self.assertEqual(val.value, 9223372036854775807)
    
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

if __name__ == '__main__':
    unittest.main()
