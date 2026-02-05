"""
Test suite for POINTER and pointer() functions
Tests Python ctypes pointer API (reference for node-ctypes compatibility)
"""

import unittest
from ctypes import (
    POINTER,
    pointer,
    c_int32,
    c_double,
    c_char,
    Structure,
    cast,
    sizeof,
    addressof,
)


class TestPOINTERTypeCreation(unittest.TestCase):
    """Test POINTER type creation"""

    def test_pointer_creates_pointer_type_factory(self):
        """POINTER creates a pointer type factory"""
        IntPtr = POINTER(c_int32)
        self.assertIsNotNone(IntPtr)
        # Check that it's a pointer type
        self.assertTrue(hasattr(IntPtr, '_type_'))
        self.assertEqual(IntPtr._type_, c_int32)

    def test_pointer_type_repr(self):
        """POINTER type has meaningful repr"""
        IntPtr = POINTER(c_int32)
        repr_str = repr(IntPtr)
        # c_int32 may be c_long on some platforms
        self.assertIn('LP_c_', repr_str)


class TestPOINTERInstanceCreation(unittest.TestCase):
    """Test POINTER instance creation"""

    def test_create_null_pointer(self):
        """Creating pointer without args creates NULL pointer"""
        IntPtr = POINTER(c_int32)
        p = IntPtr()
        # NULL pointer - accessing contents would raise ValueError
        self.assertFalse(bool(p))

    def test_create_pointer_from_value(self):
        """Create pointer from existing c_int32"""
        x = c_int32(42)
        p = pointer(x)
        self.assertTrue(bool(p))
        self.assertEqual(p.contents.value, 42)


class TestPOINTERContentsProperty(unittest.TestCase):
    """Test POINTER .contents property"""

    def test_contents_reads_value(self):
        """.contents reads value at pointer address"""
        x = c_int32(42)
        p = pointer(x)
        self.assertEqual(p.contents.value, 42)

    def test_contents_writes_value(self):
        """.contents can be assigned to change pointed value"""
        x = c_int32(42)
        p = pointer(x)
        # Assign new c_int32 instance
        p.contents = c_int32(100)
        # Note: in Python, assigning to p.contents replaces the pointed object
        self.assertEqual(p.contents.value, 100)

    def test_contents_throws_on_null_pointer(self):
        """.contents throws on NULL pointer"""
        IntPtr = POINTER(c_int32)
        p = IntPtr()
        with self.assertRaises(ValueError):
            _ = p.contents


class TestPOINTERIndexing(unittest.TestCase):
    """Test POINTER indexing"""

    def test_index_0_reads_value(self):
        """[0] reads value at pointer address"""
        x = c_int32(42)
        p = pointer(x)
        self.assertEqual(p[0], 42)

    def test_index_array(self):
        """[n] reads values with offset (pointer arithmetic)"""
        # Create array of 3 int32s
        arr = (c_int32 * 3)(10, 20, 30)
        p = cast(arr, POINTER(c_int32))
        self.assertEqual(p[0], 10)
        self.assertEqual(p[1], 20)
        self.assertEqual(p[2], 30)

    def test_index_write(self):
        """[n] = value writes with offset"""
        arr = (c_int32 * 3)(0, 0, 0)
        p = cast(arr, POINTER(c_int32))
        p[0] = 100
        p[1] = 200
        p[2] = 300
        self.assertEqual(arr[0], 100)
        self.assertEqual(arr[1], 200)
        self.assertEqual(arr[2], 300)


class TestPointerFunction(unittest.TestCase):
    """Test pointer() function"""

    def test_pointer_creates_pointer_to_instance(self):
        """pointer(SimpleCData) creates pointer to instance"""
        x = c_int32(42)
        p = pointer(x)
        self.assertIsNotNone(p)
        self.assertTrue(bool(p))
        self.assertEqual(p[0], 42)

    def test_pointer_modifying_changes_original(self):
        """pointer() modifying [0] modifies original"""
        x = c_int32(42)
        p = pointer(x)
        p[0] = 100
        self.assertEqual(x.value, 100)

    def test_pointer_to_structure(self):
        """pointer(Structure) creates pointer to struct"""
        class Point(Structure):
            _fields_ = [
                ("x", c_int32),
                ("y", c_int32),
            ]

        pt = Point(10, 20)
        p = pointer(pt)
        self.assertIsNotNone(p)
        self.assertTrue(bool(p))
        self.assertEqual(p.contents.x, 10)
        self.assertEqual(p.contents.y, 20)


class TestPOINTERDifferentTypes(unittest.TestCase):
    """Test POINTER with different types"""

    def test_pointer_to_double(self):
        """POINTER(c_double)"""
        x = c_double(3.14159)
        p = pointer(x)
        self.assertAlmostEqual(p[0], 3.14159, places=5)

    def test_pointer_to_char(self):
        """POINTER(c_char)"""
        arr = (c_char * 3)(b'A', b'B', b'C')
        p = cast(arr, POINTER(c_char))
        self.assertEqual(p[0], b'A')
        self.assertEqual(p[1], b'B')
        self.assertEqual(p[2], b'C')


class TestPOINTERAddressOf(unittest.TestCase):
    """Test addressof with pointers"""

    def test_addressof_returns_address(self):
        """addressof() returns memory address"""
        x = c_int32(42)
        addr = addressof(x)
        self.assertIsInstance(addr, int)
        self.assertGreater(addr, 0)

    def test_pointer_and_addressof(self):
        """pointer address matches addressof"""
        x = c_int32(42)
        p = pointer(x)
        # The pointer points to x
        self.assertEqual(addressof(x), addressof(p.contents))


class TestPOINTERInFunctionDefinitions(unittest.TestCase):
    """Test POINTER types in function definitions"""

    @classmethod
    def setUpClass(cls):
        """Load the C library in a cross-platform way"""
        from ctypes import CDLL
        import sys
        
        if sys.platform == "win32":
            cls.libc = CDLL("msvcrt")
        elif sys.platform == "darwin":
            cls.libc = CDLL("libSystem.B.dylib")
        else:
            # Linux
            try:
                cls.libc = CDLL("libc.so.6")
            except OSError:
                cls.libc = CDLL(None)

    def test_pointer_as_argument_type(self):
        """POINTER type can be used as function argument type"""
        from ctypes import c_void_p, c_size_t
        
        IntPtr = POINTER(c_int32)
        
        # Define memset with pointer argument
        memset = self.libc.memset
        memset.argtypes = [IntPtr, c_int32, c_size_t]
        memset.restype = c_void_p
        
        # Create buffer and call memset
        buf = (c_char * 10)()
        memset(cast(buf, IntPtr), 0x42, 10)
        
        # Verify buffer was filled
        self.assertEqual(buf[0], b'\x42')
        self.assertEqual(buf[9], b'\x42')

    def test_pointer_as_return_type(self):
        """POINTER type can be used as return type"""
        from ctypes import c_void_p, c_size_t
        
        CharPtr = POINTER(c_char)
        
        # memchr returns a pointer
        memchr = self.libc.memchr
        memchr.argtypes = [c_void_p, c_int32, c_size_t]
        memchr.restype = CharPtr
        
        buf = b"Hello World"
        result = memchr(buf, ord('W'), len(buf))
        
        # memchr should return a pointer (non-null since 'W' exists)
        self.assertTrue(bool(result))
        self.assertEqual(result[0], b'W')


if __name__ == '__main__':
    unittest.main()
