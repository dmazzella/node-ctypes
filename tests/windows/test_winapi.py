"""
Test Windows API - Platform Specific
Tests Windows-specific functions, types, and calling conventions
"""

import unittest
import sys
from ctypes import (
    WinDLL, Structure, c_uint16, sizeof, byref, create_unicode_buffer,
    get_last_error, set_last_error, WinError, POINTER, c_void_p, c_size_t, c_int32
)
from ctypes.wintypes import DWORD, WORD, LPCWSTR, LPWSTR, HMODULE, HANDLE, BOOL

@unittest.skipUnless(sys.platform == 'win32', "Windows only")
class TestWindowsAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kernel32 = WinDLL('kernel32')
        cls.user32 = WinDLL('user32')
    
    def test_get_set_last_error(self):
        """Test GetLastError / SetLastError"""
        set_last_error(0)
        self.assertEqual(get_last_error(), 0)
        
        set_last_error(123)
        self.assertEqual(get_last_error(), 123)
        
        set_last_error(5)  # ERROR_ACCESS_DENIED
        self.assertEqual(get_last_error(), 5)
    
    def test_get_module_handle(self):
        """Test GetModuleHandleW"""
        GetModuleHandleW = self.kernel32.GetModuleHandleW
        GetModuleHandleW.argtypes = [LPCWSTR]
        GetModuleHandleW.restype = HMODULE
        
        handle = GetModuleHandleW('kernel32.dll')
        self.assertNotEqual(handle, 0, 'Module handle should not be null')
    
    def test_get_module_handle_nonexistent(self):
        """Test GetModuleHandleW for non-existent module"""
        GetModuleHandleW = self.kernel32.GetModuleHandleW
        GetModuleHandleW.argtypes = [LPCWSTR]
        GetModuleHandleW.restype = HMODULE
        # Clear any errcheck from global scope
        if hasattr(GetModuleHandleW, 'errcheck'):
            del GetModuleHandleW.errcheck
        
        handle = GetModuleHandleW('NonExistentModule99999.dll')
        self.assertIsNone(handle, 'Should return None for non-existent module')
    
    def test_get_current_process_id(self):
        """Test GetCurrentProcessId"""
        GetCurrentProcessId = self.kernel32.GetCurrentProcessId
        GetCurrentProcessId.argtypes = []
        GetCurrentProcessId.restype = DWORD
        
        pid = GetCurrentProcessId()
        self.assertGreater(pid, 0, 'Process ID should be positive')
    
    def test_get_current_thread_id(self):
        """Test GetCurrentThreadId"""
        GetCurrentThreadId = self.kernel32.GetCurrentThreadId
        GetCurrentThreadId.argtypes = []
        GetCurrentThreadId.restype = DWORD
        
        tid = GetCurrentThreadId()
        self.assertGreater(tid, 0, 'Thread ID should be positive')
    
    def test_get_tick_count(self):
        """Test GetTickCount"""
        GetTickCount = self.kernel32.GetTickCount
        GetTickCount.argtypes = []
        GetTickCount.restype = DWORD
        
        tick1 = GetTickCount()
        self.assertGreater(tick1, 0, 'Tick count should be positive')
        
        # Wait a bit
        import time
        time.sleep(0.05)
        
        tick2 = GetTickCount()
        self.assertGreaterEqual(tick2, tick1, 'Tick count should increase')
    
    def test_systemtime_structure(self):
        """Test SYSTEMTIME structure with GetLocalTime"""
        class SYSTEMTIME(Structure):
            _fields_ = [
                ("wYear", WORD),
                ("wMonth", WORD),
                ("wDayOfWeek", WORD),
                ("wDay", WORD),
                ("wHour", WORD),
                ("wMinute", WORD),
                ("wSecond", WORD),
                ("wMilliseconds", WORD)
            ]
        
        GetLocalTime = self.kernel32.GetLocalTime
        GetLocalTime.argtypes = [POINTER(SYSTEMTIME)]
        GetLocalTime.restype = None
        
        st = SYSTEMTIME()
        GetLocalTime(byref(st))
        
        self.assertGreaterEqual(st.wYear, 2020, 'Year should be reasonable')
        self.assertGreaterEqual(st.wMonth, 1)
        self.assertLessEqual(st.wMonth, 12, 'Month should be 1-12')
        self.assertGreaterEqual(st.wDay, 1)
        self.assertLessEqual(st.wDay, 31, 'Day should be 1-31')
        self.assertGreaterEqual(st.wHour, 0)
        self.assertLess(st.wHour, 24, 'Hour should be 0-23')
        self.assertGreaterEqual(st.wMinute, 0)
        self.assertLess(st.wMinute, 60, 'Minute should be 0-59')
        self.assertGreaterEqual(st.wSecond, 0)
        self.assertLess(st.wSecond, 60, 'Second should be 0-59')
    
    def test_virtual_alloc_free(self):
        """Test VirtualAlloc/VirtualFree"""
        VirtualAlloc = self.kernel32.VirtualAlloc
        VirtualAlloc.argtypes = [c_void_p, c_size_t, DWORD, DWORD]
        VirtualAlloc.restype = c_void_p
        
        VirtualFree = self.kernel32.VirtualFree
        VirtualFree.argtypes = [c_void_p, c_size_t, DWORD]
        VirtualFree.restype = c_int32
        
        MEM_COMMIT = 0x1000
        MEM_RESERVE = 0x2000
        MEM_RELEASE = 0x8000
        PAGE_READWRITE = 0x04
        
        ptr = VirtualAlloc(None, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE)
        self.assertNotEqual(ptr, 0, 'VirtualAlloc should succeed')
        
        result = VirtualFree(ptr, 0, MEM_RELEASE)
        self.assertNotEqual(result, 0, 'VirtualFree should succeed')
    
    def test_wide_strings(self):
        """Test wide string parameters"""
        GetEnvironmentVariableW = self.kernel32.GetEnvironmentVariableW
        GetEnvironmentVariableW.argtypes = [LPCWSTR, LPWSTR, DWORD]
        GetEnvironmentVariableW.restype = DWORD
        
        buf = create_unicode_buffer(1024)
        length = GetEnvironmentVariableW('TEMP', buf, 1024)
        
        self.assertGreater(length, 0, 'Should find TEMP environment variable')
        self.assertGreater(len(buf.value), 0, 'TEMP should not be empty')
        self.assertIn('\\', buf.value, 'TEMP should contain backslashes')
    
    def test_get_computer_name(self):
        """Test GetComputerNameW"""
        GetComputerNameW = self.kernel32.GetComputerNameW
        GetComputerNameW.argtypes = [LPWSTR, POINTER(DWORD)]
        GetComputerNameW.restype = BOOL
        
        buf = create_unicode_buffer(256)
        size = DWORD(256)
        
        result = GetComputerNameW(buf, byref(size))
        self.assertNotEqual(result, 0, 'GetComputerNameW should succeed')
        self.assertGreater(len(buf.value), 0, 'Computer name should not be empty')
    
    def test_errcheck_with_windows_api(self):
        """Test errcheck with Windows API"""
        GetModuleHandleW = self.kernel32.GetModuleHandleW
        GetModuleHandleW.argtypes = [LPCWSTR]
        GetModuleHandleW.restype = HMODULE
        
        errcheck_called = []
        
        def check_handle(result, func, args):
            errcheck_called.append(True)
            if result is None or result == 0:
                raise WinError(get_last_error())
            return result
        
        GetModuleHandleW.errcheck = check_handle
        
        handle = GetModuleHandleW('kernel32.dll')
        self.assertTrue(errcheck_called, 'errcheck should have been called')
        self.assertNotEqual(handle, 0, 'Should return valid handle')
        
        # This should raise WinError
        with self.assertRaises(OSError):
            GetModuleHandleW('NonExistent.dll')

if __name__ == '__main__':
    unittest.main()
