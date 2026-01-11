const ctypes = require('../lib');
const assert = require('assert');

describe('errcheck functionality', function() {
    let dll;
    
    before(function() {
        // Usa msvcrt.dll su Windows
        dll = ctypes.CDLL('msvcrt.dll');
    });
    
    after(function() {
        if (dll) dll.close();
    });
    
    it('should call errcheck after function execution', function() {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        let errcheckCalled = false;
        let receivedResult = null;
        let receivedFunc = null;
        let receivedArgs = null;
        
        strlen.errcheck = function(result, func, args) {
            errcheckCalled = true;
            receivedResult = result;
            receivedFunc = func;
            receivedArgs = args;
            return result;
        };
        
        const testStr = ctypes.c_char_p("hello");
        const result = strlen(testStr);
        
        assert.strictEqual(errcheckCalled, true, 'errcheck should be called');
        assert.strictEqual(result, 5);
        assert.strictEqual(receivedResult, 5);
        assert.strictEqual(receivedFunc, strlen);
        assert(Array.isArray(receivedArgs));
        assert.strictEqual(receivedArgs.length, 1);
    });
    
    it('should allow errcheck to modify return value', function() {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        strlen.errcheck = function(result, func, args) {
            // Modifica il risultato: restituisce il doppio
            return result * 2;
        };
        
        const testStr = ctypes.c_char_p("hello");
        const result = strlen(testStr);
        
        // La lunghezza dovrebbe essere 5, ma errcheck la raddoppia
        assert.strictEqual(result, 10);
    });
    
    it('should allow errcheck to throw exceptions', function() {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        strlen.errcheck = function(result, func, args) {
            if (result === 0) {
                throw new Error('String is empty!');
            }
            return result;
        };
        
        // Questa non dovrebbe lanciare eccezione
        const testStr = ctypes.c_char_p("hello");
        const result = strlen(testStr);
        assert.strictEqual(result, 5);
        
        // Questa dovrebbe lanciare eccezione
        const emptyStr = ctypes.c_char_p("");
        assert.throws(() => {
            strlen(emptyStr);
        }, /String is empty!/);
    });
    
    it('should allow clearing errcheck with null', function() {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        let callCount = 0;
        strlen.errcheck = function(result, func, args) {
            callCount++;
            return result;
        };
        
        const testStr = ctypes.c_char_p("hello");
        strlen(testStr);
        assert.strictEqual(callCount, 1);
        
        // Rimuovi errcheck
        strlen.errcheck = null;
        strlen(testStr);
        assert.strictEqual(callCount, 1, 'errcheck should not be called after clearing');
    });
    
    it('should work with pointer return values', function() {
        const malloc = dll.func('malloc', ctypes.c_void_p, [ctypes.c_size_t]);
        const free = dll.func('free', ctypes.c_void, [ctypes.c_void_p]);
        
        malloc.errcheck = function(result, func, args) {
            if (!result || result === 0) {
                throw new Error('malloc failed');
            }
            return result;
        };
        
        const ptr = malloc(100);
        assert(ptr !== 0, 'malloc should return non-null pointer');
        
        free(ptr);
    });
    
    it('should work with different return types', function() {
        // Test con int
        const atoi = dll.func('atoi', ctypes.c_int, [ctypes.c_char_p]);
        
        atoi.errcheck = function(result, func, args) {
            if (result === 0) {
                return -1; // Converti 0 in -1
            }
            return result;
        };
        
        const str1 = ctypes.c_char_p("0");
        const result1 = atoi(str1);
        assert.strictEqual(result1, -1);
        
        const str2 = ctypes.c_char_p("42");
        const result2 = atoi(str2);
        assert.strictEqual(result2, 42);
    });
    
    it('should maintain separate errcheck for different functions', function() {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        const atoi = dll.func('atoi', ctypes.c_int, [ctypes.c_char_p]);
        
        let strlenCalls = 0;
        let atoiCalls = 0;
        
        strlen.errcheck = function(result, func, args) {
            strlenCalls++;
            return result;
        };
        
        atoi.errcheck = function(result, func, args) {
            atoiCalls++;
            return result;
        };
        
        const testStr = ctypes.c_char_p("hello");
        strlen(testStr);
        assert.strictEqual(strlenCalls, 1);
        assert.strictEqual(atoiCalls, 0);
        
        const numStr = ctypes.c_char_p("42");
        atoi(numStr);
        assert.strictEqual(strlenCalls, 1);
        assert.strictEqual(atoiCalls, 1);
    });
});
