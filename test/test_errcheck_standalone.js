const ctypes = require('../lib');
const assert = require('assert');

console.log('\n=== Testing errcheck functionality ===\n');

let dll;

try {
    // Carica msvcrt.dll su Windows
    dll = new ctypes.CDLL('msvcrt.dll');
    console.log('✓ Loaded msvcrt.dll');
    
    // Test 1: errcheck viene chiamato
    console.log('\nTest 1: errcheck is called after function execution');
    {
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
        
        const result = strlen("hello");
        
        assert.strictEqual(errcheckCalled, true);
        assert.strictEqual(result, 5n); // BigInt
        assert.strictEqual(receivedResult, 5n); // BigInt
        // receivedFunc è l'oggetto FFI nativo, non il wrapper
        assert(receivedFunc !== null);
        assert(Array.isArray(receivedArgs));
        assert.strictEqual(receivedArgs.length, 1);
        
        console.log('  ✓ errcheck was called');
        console.log('  ✓ result:', result);
        console.log('  ✓ received result:', receivedResult);
        console.log('  ✓ received func:', receivedFunc === strlen);
        console.log('  ✓ received args:', receivedArgs.length, 'arguments');
    }
    
    // Test 2: errcheck modifica il valore di ritorno
    console.log('\nTest 2: errcheck can modify return value');
    {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        strlen.errcheck = function(result, func, args) {
            return result * 2n; // Raddoppia il risultato (usa BigInt)
        };
        
        const result = strlen("hello");
        
        assert.strictEqual(result, 10n); // 5n * 2n
        console.log('  ✓ Modified result:', result, '(original was 5)');
    }
    
    // Test 3: errcheck lancia eccezioni
    console.log('\nTest 3: errcheck can throw exceptions');
    {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        strlen.errcheck = function(result, func, args) {
            if (result === 0n) { // Usa BigInt per confronto
                throw new Error('String is empty!');
            }
            return result;
        };
        
        // Non-empty string: non dovrebbe lanciare
        const result = strlen("hello");
        assert.strictEqual(result, 5n);
        console.log('  ✓ Non-empty string works:', result);
        
        // Empty string: dovrebbe lanciare
        let exceptionThrown = false;
        try {
            strlen("");
        } catch (e) {
            exceptionThrown = true;
            assert(e.message.includes('String is empty!'));
            console.log('  ✓ Exception thrown for empty string:', e.message);
        }
        assert(exceptionThrown);
    }
    
    // Test 4: rimozione di errcheck
    console.log('\nTest 4: clearing errcheck with null');
    {
        const strlen = dll.func('strlen', ctypes.c_size_t, [ctypes.c_char_p]);
        
        let callCount = 0;
        strlen.errcheck = function(result, func, args) {
            callCount++;
            return result;
        };
        
        strlen("hello");
        assert.strictEqual(callCount, 1);
        console.log('  ✓ errcheck called:', callCount, 'time');
        
        // Rimuovi errcheck
        strlen.errcheck = null;
        strlen("hello");
        assert.strictEqual(callCount, 1); // Non dovrebbe aumentare
        console.log('  ✓ After clearing, errcheck not called');
    }
    
    // Test 5: puntatori
    console.log('\nTest 5: errcheck with pointer return values');
    {
        const malloc = dll.func('malloc', ctypes.c_void_p, [ctypes.c_size_t]);
        const free = dll.func('free', 'void', [ctypes.c_void_p]);
        
        malloc.errcheck = function(result, func, args) {
            if (!result || result === 0) {
                throw new Error('malloc failed');
            }
            return result;
        };
        
        const ptr = malloc(100);
        assert(ptr !== 0);
        console.log('  ✓ malloc returned non-null pointer:', ptr.toString(16));
        
        free(ptr);
        console.log('  ✓ Memory freed');
    }
    
    // Test 6: tipi diversi
    console.log('\nTest 6: errcheck with different return types');
    {
        const atoi = dll.func('atoi', ctypes.c_int, [ctypes.c_char_p]);
        
        atoi.errcheck = function(result, func, args) {
            if (result === 0) {
                return -1; // Converti 0 in -1
            }
            return result;
        };
        
        const result1 = atoi("0");
        assert.strictEqual(result1, -1);
        console.log('  ✓ "0" converted to:', result1);
        
        const result2 = atoi("42");
        assert.strictEqual(result2, 42);
        console.log('  ✓ "42" converted to:', result2);
    }
    
    // Test 7: funzioni separate
    console.log('\nTest 7: separate errcheck for different functions');
    {
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
        
        strlen("hello");
        assert.strictEqual(strlenCalls, 1);
        assert.strictEqual(atoiCalls, 0);
        console.log('  ✓ strlen.errcheck called:', strlenCalls);
        
        atoi("42");
        assert.strictEqual(strlenCalls, 1);
        assert.strictEqual(atoiCalls, 1);
        console.log('  ✓ atoi.errcheck called:', atoiCalls);
        console.log('  ✓ Each function has independent errcheck');
    }
    
    console.log('\n=== All errcheck tests passed! ===\n');
    
} catch (e) {
    console.error('\n✗ Test failed:', e.message);
    console.error(e.stack);
    process.exit(1);
} finally {
    if (dll) dll.close();
}
