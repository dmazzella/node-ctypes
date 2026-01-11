/**
 * Test Windows API - Platform Specific
 * Tests Windows-specific functions, types, and calling conventions
 */

const assert = require('assert');
const ctypes = require('../../lib');

describe('Windows API', function() {
    let kernel32;
    let user32;
    
    before(function() {
        if (process.platform !== 'win32') {
            this.skip();
        }
        kernel32 = new ctypes.WinDLL('kernel32.dll');
        user32 = new ctypes.WinDLL('user32.dll');
    });
    
    after(function() {
        if (kernel32) kernel32.close();
        if (user32) user32.close();
    });
    
    describe('GetLastError / SetLastError', function() {
        it('should get and set last error', function() {
            ctypes.SetLastError(0);
            assert.strictEqual(ctypes.GetLastError(), 0);
            
            ctypes.SetLastError(123);
            assert.strictEqual(ctypes.GetLastError(), 123);
            
            ctypes.SetLastError(0xDEADBEEF);
            assert.strictEqual(ctypes.GetLastError(), 0xDEADBEEF);
        });
    });
    
    describe('GetModuleHandleW', function() {
        it('should get module handle for kernel32', function() {
            const GetModuleHandleW = kernel32.func('GetModuleHandleW', 'pointer', ['wstring']);
            
            const handle = GetModuleHandleW('kernel32.dll');
            assert(handle !== 0n, 'Module handle should not be null');
        });
        
        it('should return null for non-existent module', function() {
            const GetModuleHandleW = kernel32.func('GetModuleHandleW', 'pointer', ['wstring']);
            
            const handle = GetModuleHandleW('NonExistentModule12345.dll');
            assert.strictEqual(handle, null, 'Should return null for non-existent module');
        });
    });
    
    describe('GetCurrentProcessId', function() {
        it('should return current process ID', function() {
            const GetCurrentProcessId = kernel32.func('GetCurrentProcessId', 'uint32', []);
            
            const pid = GetCurrentProcessId();
            assert(pid > 0, 'Process ID should be positive');
            assert.strictEqual(pid, process.pid);
        });
    });
    
    describe('GetCurrentThreadId', function() {
        it('should return current thread ID', function() {
            const GetCurrentThreadId = kernel32.func('GetCurrentThreadId', 'uint32', []);
            
            const tid = GetCurrentThreadId();
            assert(tid > 0, 'Thread ID should be positive');
        });
    });
    
    describe('GetTickCount', function() {
        it('should return system uptime in milliseconds', function() {
            const GetTickCount = kernel32.func('GetTickCount', 'uint32', []);
            
            const tick1 = GetTickCount();
            assert(tick1 > 0, 'Tick count should be positive');
            
            // Wait a bit and check it increased
            const start = Date.now();
            while (Date.now() - start < 50) { /* busy wait */ }
            
            const tick2 = GetTickCount();
            assert(tick2 >= tick1, 'Tick count should increase');
        });
    });
    
    describe('SYSTEMTIME Structure', function() {
        it('should get local time using GetLocalTime', function() {
            const SYSTEMTIME = ctypes.struct({
                wYear: 'uint16',
                wMonth: 'uint16',
                wDayOfWeek: 'uint16',
                wDay: 'uint16',
                wHour: 'uint16',
                wMinute: 'uint16',
                wSecond: 'uint16',
                wMilliseconds: 'uint16'
            });
            
            const GetLocalTime = kernel32.func('GetLocalTime', 'void', ['pointer']);
            
            const st = SYSTEMTIME.create();
            GetLocalTime(st);
            
            const time = SYSTEMTIME.toObject(st);
            
            assert(time.wYear >= 2020, 'Year should be reasonable');
            assert(time.wMonth >= 1 && time.wMonth <= 12, 'Month should be 1-12');
            assert(time.wDay >= 1 && time.wDay <= 31, 'Day should be 1-31');
            assert(time.wHour >= 0 && time.wHour < 24, 'Hour should be 0-23');
            assert(time.wMinute >= 0 && time.wMinute < 60, 'Minute should be 0-59');
            assert(time.wSecond >= 0 && time.wSecond < 60, 'Second should be 0-59');
        });
    });
    
    describe('Memory Allocation', function() {
        it('should allocate and free memory with VirtualAlloc/VirtualFree', function() {
            const VirtualAlloc = kernel32.func('VirtualAlloc', 'pointer', 
                ['pointer', 'size_t', 'uint32', 'uint32']);
            const VirtualFree = kernel32.func('VirtualFree', 'int32', 
                ['pointer', 'size_t', 'uint32']);
            
            const MEM_COMMIT = 0x1000;
            const MEM_RESERVE = 0x2000;
            const MEM_RELEASE = 0x8000;
            const PAGE_READWRITE = 0x04;
            
            const ptr = VirtualAlloc(0n, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            assert(ptr !== 0n, 'VirtualAlloc should succeed');
            
            const result = VirtualFree(ptr, 0, MEM_RELEASE);
            assert(result !== 0, 'VirtualFree should succeed');
        });
    });
    
    describe('Wide Strings', function() {
        it('should handle wide string parameters and returns', function() {
            const GetEnvironmentVariableW = kernel32.func('GetEnvironmentVariableW', 
                'uint32', ['wstring', 'pointer', 'uint32']);
            
            const buf = ctypes.create_unicode_buffer(1024);
            const len = GetEnvironmentVariableW('TEMP', buf, 1024);
            
            assert(len > 0, 'Should find TEMP environment variable');
            
            const temp = ctypes.wstring_at(buf);
            assert(temp.length > 0, 'TEMP should not be empty');
            assert(temp.includes('\\'), 'TEMP should contain backslashes');
        });
    });
    
    describe('MessageBoxW', function() {
        it('should define MessageBoxW (without calling it)', function() {
            const MessageBoxW = user32.func('MessageBoxW', 'int32', 
                ['pointer', 'wstring', 'wstring', 'uint32']);
            
            assert(typeof MessageBoxW === 'function');
            assert(MessageBoxW.funcName === 'MessageBoxW');
            
            // Don't actually call it - would show a dialog!
        });
    });
    
    describe('GetComputerNameW', function() {
        it('should get computer name', function() {
            const GetComputerNameW = kernel32.func('GetComputerNameW', 
                'int32', ['pointer', 'pointer']);
            
            const buf = ctypes.create_unicode_buffer(256);
            const sizeBuf = ctypes.alloc(4);
            ctypes.writeValue(sizeBuf, 'uint32', 256);
            
            const result = GetComputerNameW(buf, sizeBuf);
            assert(result !== 0, 'GetComputerNameW should succeed');
            
            const name = ctypes.wstring_at(buf);
            assert(name.length > 0, 'Computer name should not be empty');
        });
    });
    
    describe('errcheck with Windows API', function() {
        it('should use errcheck to validate return values', function() {
            const GetModuleHandleW = kernel32.func('GetModuleHandleW', 'pointer', ['wstring']);
            
            let errcheckCalled = false;
            GetModuleHandleW.errcheck = function(result, func, args) {
                errcheckCalled = true;
                if (result === null) {
                    const errCode = ctypes.GetLastError();
                    throw new Error(`GetModuleHandleW failed with error ${errCode}`);
                }
                return result;
            };
            
            // Test success case
            const handle = GetModuleHandleW('kernel32.dll');
            assert(errcheckCalled, 'errcheck should have been called');
            assert(handle !== 0n, 'Should return valid handle');
            
            // Reset flag
            errcheckCalled = false;
            
            // Test failure case - this should throw
            assert.throws(() => {
                GetModuleHandleW('NonExistentModule99999.dll');
            }, /GetModuleHandleW failed/);
            
            assert(errcheckCalled, 'errcheck should have been called for failure case');
        });
    });
});
