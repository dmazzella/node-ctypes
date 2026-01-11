/**
 * Test per integrazione array con funzioni C
 * 
 * Testa l'uso di array come argomenti e valori di ritorno
 * in funzioni C (Python ctypes compatibility)
 */

const ctypes = require('../lib/index');
const assert = require('assert');

console.log('=== Test Array Integration con Funzioni C ===\n');

const msvcrt = new ctypes.CDLL('msvcrt.dll');

// ============================================================================
// Test 1: memcpy con array
// ============================================================================
console.log('Test 1: memcpy - copia tra array');
{
    const memcpy = msvcrt.func('memcpy', 'pointer', ['pointer', 'pointer', 'size_t']);
    
    const IntArray10 = ctypes.array('int32', 10);
    const src = IntArray10.create([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const dst = IntArray10.create();
    
    // Copia
    memcpy(dst, src, 40);
    
    // Verifica
    for (let i = 0; i < 10; i++) {
        const val = dst.readInt32LE(i * 4);
        console.log(`  dst[${i}] = ${val}`);
        assert.strictEqual(val, i + 1);
    }
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 2: memset con array
// ============================================================================
console.log('Test 2: memset - riempimento array');
{
    const memset = msvcrt.func('memset', 'pointer', ['pointer', 'int32', 'size_t']);
    
    const CharArray20 = ctypes.array('int8', 20);
    const arr = CharArray20.create();
    
    // Riempi con valore 42
    memset(arr, 42, 20);
    
    // Verifica
    for (let i = 0; i < 20; i++) {
        assert.strictEqual(arr.readInt8(i), 42);
    }
    
    console.log('  Array riempito con valore 42');
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 3: strlen con char array
// ============================================================================
console.log('Test 3: strlen con char array');
{
    const strlen = msvcrt.func('strlen', 'size_t', ['pointer']);
    
    const CharArray100 = ctypes.array('int8', 100);
    const str = CharArray100.create('Test string!');
    
    const len = strlen(str);
    console.log('  Length:', len);
    assert.strictEqual(Number(len), 12);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 4: Array di float con operazioni matematiche
// ============================================================================
console.log('Test 4: Array di float - somma elementi');
{
    const FloatArray = ctypes.array('float', 5);
    const arr = FloatArray.create([1.5, 2.5, 3.5, 4.5, 5.5]);
    
    let sum = 0;
    for (let i = 0; i < 5; i++) {
        sum += arr.readFloatLE(i * 4);
    }
    
    console.log('  Somma:', sum);
    assert(Math.abs(sum - 17.5) < 0.001);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 5: Array size checks
// ============================================================================
console.log('Test 5: Array size checks');
{
    const IntArray3 = ctypes.array('int32', 3);
    const CharArray50 = ctypes.array('int8', 50);
    
    console.log('  IntArray3 size:', IntArray3.getSize());
    console.log('  CharArray50 size:', CharArray50.getSize());
    
    assert.strictEqual(IntArray3.getSize(), 12);
    assert.strictEqual(CharArray50.getSize(), 50);
    
    console.log('  ✅ Test OK\n');
}

console.log('✅ TUTTI I TEST INTEGRATION PASSATI!');
