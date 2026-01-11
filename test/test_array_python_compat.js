/**
 * Test compatibilità array con Python ctypes
 * 
 * Confronto diretto con sintassi e comportamento Python
 */

const ctypes = require('../lib/index');
const assert = require('assert');

console.log('=== Test Python ctypes Array Compatibility ===\n');

/*
Python equivalent:

from ctypes import *

# Array creation
IntArray5 = c_int * 5
arr = IntArray5(1, 2, 3, 4, 5)

# Access
print(arr[0])  # 1
arr[0] = 42

# Size
print(sizeof(arr))  # 20

# In functions
memcpy(dst, src, sizeof(src))
*/

// ============================================================================
// Test 1: Array creation (c_int * 5)
// ============================================================================
console.log('Test 1: Array creation (c_int * 5)');
{
    // Python: IntArray5 = c_int * 5
    const IntArray5 = ctypes.array('int32', 5);
    
    // Python: arr = IntArray5(1, 2, 3, 4, 5)
    const arr = IntArray5.create([1, 2, 3, 4, 5]);
    
    // Python: sizeof(arr)
    console.log('  Size:', IntArray5.getSize());
    console.log('  Length:', IntArray5.getLength());
    assert.strictEqual(IntArray5.getSize(), 20); // 5 * 4
    assert.strictEqual(IntArray5.getLength(), 5);
    
    console.log('  ✅ Compatible con Python\n');
}

// ============================================================================
// Test 2: Char array (string buffer) - c_char * 100
// ============================================================================
console.log('Test 2: Char array (string buffer) - c_char * 100');
{
    // Python: CharArray100 = c_char * 100
    const CharArray100 = ctypes.array('int8', 100);
    
    // Python: buf = CharArray100()
    const buf = CharArray100.create();
    
    // Python: sizeof(buf)
    console.log('  Size:', CharArray100.getSize());
    assert.strictEqual(CharArray100.getSize(), 100);
    
    // Python: buf2 = CharArray100(b"Hello")
    const buf2 = CharArray100.create('Hello');
    console.log('  String:', buf2.toString('utf8', 0, buf2.indexOf(0)));
    assert.strictEqual(buf2.toString('utf8', 0, buf2.indexOf(0)), 'Hello');
    
    console.log('  ✅ Compatible con Python\n');
}

// ============================================================================
// Test 3: Float array - c_float * 3
// ============================================================================
console.log('Test 3: Float array - c_float * 3');
{
    // Python: FloatArray3 = c_float * 3
    const FloatArray3 = ctypes.array('float', 3);
    
    // Python: arr = FloatArray3(1.5, 2.5, 3.5)
    const arr = FloatArray3.create([1.5, 2.5, 3.5]);
    
    console.log('  Size:', FloatArray3.getSize());
    assert.strictEqual(FloatArray3.getSize(), 12); // 3 * 4
    
    // Verify values
    assert(Math.abs(arr.readFloatLE(0) - 1.5) < 0.001);
    assert(Math.abs(arr.readFloatLE(4) - 2.5) < 0.001);
    assert(Math.abs(arr.readFloatLE(8) - 3.5) < 0.001);
    
    console.log('  ✅ Compatible con Python\n');
}

// ============================================================================
// Test 4: Array as function argument
// ============================================================================
console.log('Test 4: Array as function argument (memcpy)');
{
    const msvcrt = new ctypes.CDLL('msvcrt.dll');
    const memcpy = msvcrt.func('memcpy', 'pointer', ['pointer', 'pointer', 'size_t']);
    
    // Python:
    // IntArray10 = c_int * 10
    // src = IntArray10(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    // dst = IntArray10()
    // memcpy(dst, src, sizeof(src))
    
    const IntArray10 = ctypes.array('int32', 10);
    const src = IntArray10.create([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const dst = IntArray10.create();
    
    memcpy(dst, src, IntArray10.getSize());
    
    // Verify copy
    for (let i = 0; i < 10; i++) {
        assert.strictEqual(dst.readInt32LE(i * 4), i + 1);
    }
    
    console.log('  ✅ Compatible con Python\n');
}

// ============================================================================
// Test 5: Partial initialization
// ============================================================================
console.log('Test 5: Partial initialization');
{
    // Python: arr = (c_int * 10)(1, 2, 3)  # resto è 0
    const IntArray10 = ctypes.array('int32', 10);
    const arr = IntArray10.create([1, 2, 3]);
    
    // First 3 elements
    assert.strictEqual(arr.readInt32LE(0), 1);
    assert.strictEqual(arr.readInt32LE(4), 2);
    assert.strictEqual(arr.readInt32LE(8), 3);
    
    // Rest is 0
    assert.strictEqual(arr.readInt32LE(12), 0);
    assert.strictEqual(arr.readInt32LE(36), 0);
    
    console.log('  ✅ Compatible con Python\n');
}

// ============================================================================
// Test 6: Double array - c_double * 4
// ============================================================================
console.log('Test 6: Double array - c_double * 4');
{
    // Python: DoubleArray4 = c_double * 4
    const DoubleArray4 = ctypes.array('double', 4);
    
    // Python: arr = DoubleArray4(1.1, 2.2, 3.3, 4.4)
    const arr = DoubleArray4.create([1.1, 2.2, 3.3, 4.4]);
    
    console.log('  Size:', DoubleArray4.getSize());
    assert.strictEqual(DoubleArray4.getSize(), 32); // 4 * 8
    
    console.log('  ✅ Compatible con Python\n');
}

console.log('=== Riepilogo Compatibilità ===');
console.log('✅ Sintassi: array(type, count) equivalente a (c_type * count)');
console.log('✅ Creazione: .create([values]) equivalente a Type(values)');
console.log('✅ Dimensione: .getSize() equivalente a sizeof()');
console.log('✅ Lunghezza: .getLength() per ottenere numero elementi');
console.log('✅ Funzioni C: passaggio come pointer, funziona con memcpy/memset');
console.log('✅ Inizializzazione parziale: resto riempito con zeri');
console.log('✅ Char array: string support per buffer di testo\n');

console.log('📝 Differenze:');
console.log('  - Python: arr[index] per accesso elementi');
console.log('  - Node: arr.readInt32LE(offset) per accesso (Buffer API)');
console.log('  - TODO: Aggiungere indexing operator per compatibilità completa\n');

console.log('✅ TUTTI I TEST COMPATIBILITÀ PASSATI!');
