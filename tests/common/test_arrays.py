"""
Test Arrays - Cross Platform
Tests array creation, indexing, iteration, in structs, in functions
"""

import unittest
from ctypes import c_int32, c_uint8, c_double, c_float, c_char, sizeof, Structure

class TestArrays(unittest.TestCase):
    def test_array_creation(self):
        """Test create fixed-size arrays"""
        IntArray5 = c_int32 * 5
        
        self.assertEqual(sizeof(IntArray5), 20)  # 5 * 4 bytes
    
    def test_array_initialization(self):
        """Test initialize arrays with values"""
        IntArray5 = c_int32 * 5
        arr = IntArray5(1, 2, 3, 4, 5)
        
        self.assertEqual(arr[0], 1)
        self.assertEqual(arr[4], 5)
    
    def test_partial_initialization(self):
        """Test partial initialization"""
        IntArray5 = c_int32 * 5
        arr = IntArray5(1, 2, 3)  # Rest filled with 0
        
        self.assertEqual(arr[0], 1)
        self.assertEqual(arr[2], 3)
        self.assertEqual(arr[3], 0)
        self.assertEqual(arr[4], 0)
    
    def test_array_indexing_read(self):
        """Test array indexing for reading"""
        IntArray5 = c_int32 * 5
        arr = IntArray5(10, 20, 30, 40, 50)
        
        self.assertEqual(arr[0], 10)
        self.assertEqual(arr[1], 20)
        self.assertEqual(arr[2], 30)
        self.assertEqual(arr[3], 40)
        self.assertEqual(arr[4], 50)
    
    def test_array_indexing_write(self):
        """Test array indexing for writing"""
        IntArray5 = c_int32 * 5
        arr = IntArray5(1, 2, 3, 4, 5)
        
        arr[0] = 100
        arr[4] = 500
        
        self.assertEqual(arr[0], 100)
        self.assertEqual(arr[4], 500)
    
    def test_float_arrays(self):
        """Test float arrays"""
        FloatArray3 = c_float * 3
        arr = FloatArray3(1.5, 2.5, 3.5)
        
        self.assertAlmostEqual(arr[0], 1.5, places=4)
        self.assertAlmostEqual(arr[1], 2.5, places=4)
        self.assertAlmostEqual(arr[2], 3.5, places=4)
        
        arr[1] = 99.9
        self.assertAlmostEqual(arr[1], 99.9, places=4)
    
    def test_array_iteration(self):
        """Test array iteration"""
        IntArray5 = c_int32 * 5
        arr = IntArray5(1, 2, 3, 4, 5)
        
        values = list(arr)
        self.assertEqual(values, [1, 2, 3, 4, 5])
    
    def test_arrays_in_structs(self):
        """Test array fields in structs"""
        class Data(Structure):
            _fields_ = [
                ("count", c_int32),
                ("values", c_int32 * 10)
            ]
        
        data = Data()
        data.count = 5
        for i in range(10):
            data.values[i] = i + 1
        
        self.assertEqual(data.count, 5)
        self.assertEqual(data.values[0], 1)
        self.assertEqual(data.values[9], 10)
    
    def test_modify_array_in_struct(self):
        """Test modifying array elements in structs"""
        class Data(Structure):
            _fields_ = [
                ("values", c_int32 * 5)
            ]
        
        data = Data()
        data.values[0] = 1
        data.values[1] = 2
        data.values[2] = 3
        data.values[3] = 4
        data.values[4] = 5
        
        data.values[2] = 999
        
        self.assertEqual(data.values[2], 999)
    
    def test_uint8_arrays(self):
        """Test uint8 arrays"""
        ByteArray = c_uint8 * 4
        arr = ByteArray(0xFF, 0xAB, 0xCD, 0xEF)
        
        self.assertEqual(arr[0], 0xFF)
        self.assertEqual(arr[1], 0xAB)
        self.assertEqual(arr[2], 0xCD)
        self.assertEqual(arr[3], 0xEF)
    
    def test_double_arrays(self):
        """Test double arrays"""
        DoubleArray = c_double * 3
        arr = DoubleArray(3.14159, 2.71828, 1.61803)
        
        self.assertAlmostEqual(arr[0], 3.14159, places=5)
        self.assertAlmostEqual(arr[1], 2.71828, places=5)
        self.assertAlmostEqual(arr[2], 1.61803, places=5)
    
    def test_empty_array_creation(self):
        """Test empty array creation"""
        IntArray5 = c_int32 * 5
        arr = IntArray5()  # All zeros
        
        self.assertEqual(arr[0], 0)
        self.assertEqual(arr[4], 0)
    
    def test_string_as_byte_array(self):
        """Test create arrays from strings"""
        CharArray = c_char * 100
        arr = CharArray()
        s = b'Hello, World!'
        for i, c in enumerate(s):
            arr[i] = c
        
        # Should contain ASCII values
        self.assertEqual(arr[0], b'H')
        self.assertEqual(arr[1], b'e')
        self.assertEqual(arr[7], b'W')

if __name__ == '__main__':
    unittest.main()
