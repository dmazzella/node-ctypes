/**
 * Test per array a dimensione fissa (Python ctypes compatibility)
 * 
 * In Python ctypes:
 *   from ctypes import c_int
 *   IntArray5 = c_int * 5
 *   arr = IntArray5(1, 2, 3, 4, 5)
 */

const ctypes = require('../lib/index');
const assert = require('assert');

console.log('=== Test Array Types (Python ctypes compatible) ===\n');

// ============================================================================
// Test 1: Array di interi
// ============================================================================
console.log('Test 1: Array di interi (c_int * 5)');
{
    const IntArray5 = ctypes.array('int32', 5);
    
    // Verifica dimensioni
    console.log('  Size:', IntArray5.getSize());
    console.log('  Length:', IntArray5.getLength());
    console.log('  Alignment:', IntArray5.getAlignment());
    
    assert.strictEqual(IntArray5.getLength(), 5);
    assert.strictEqual(IntArray5.getSize(), 20); // 5 * 4 bytes
    
    // Crea array con valori
    const arr = IntArray5.create([1, 2, 3, 4, 5]);
    console.log('  Array buffer length:', arr.length);
    assert.strictEqual(arr.length, 20);
    
    // Verifica contenuto
    assert.strictEqual(arr.readInt32LE(0), 1);
    assert.strictEqual(arr.readInt32LE(4), 2);
    assert.strictEqual(arr.readInt32LE(8), 3);
    assert.strictEqual(arr.readInt32LE(12), 4);
    assert.strictEqual(arr.readInt32LE(16), 5);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 2: Array di float
// ============================================================================
console.log('Test 2: Array di float (c_float * 3)');
{
    const FloatArray3 = ctypes.array('float', 3);
    
    assert.strictEqual(FloatArray3.getLength(), 3);
    assert.strictEqual(FloatArray3.getSize(), 12); // 3 * 4 bytes
    
    const arr = FloatArray3.create([1.5, 2.5, 3.5]);
    
    assert(Math.abs(arr.readFloatLE(0) - 1.5) < 0.001);
    assert(Math.abs(arr.readFloatLE(4) - 2.5) < 0.001);
    assert(Math.abs(arr.readFloatLE(8) - 3.5) < 0.001);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 3: Array di char (string)
// ============================================================================
console.log('Test 3: Array di char (stringa C)');
{
    const CharArray100 = ctypes.array('int8', 100);
    
    assert.strictEqual(CharArray100.getLength(), 100);
    assert.strictEqual(CharArray100.getSize(), 100);
    
    // Crea array da stringa
    const arr = CharArray100.create('Hello, World!');
    
    // Leggi come stringa
    const str = arr.toString('utf8', 0, arr.indexOf(0));
    console.log('  String:', str);
    assert.strictEqual(str, 'Hello, World!');
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 4: Array parzialmente inizializzato
// ============================================================================
console.log('Test 4: Array parzialmente inizializzato');
{
    const IntArray10 = ctypes.array('int32', 10);
    
    // Inizializza solo 3 elementi
    const arr = IntArray10.create([42, 43, 44]);
    
    // Primi 3 elementi dovrebbero essere 42, 43, 44
    assert.strictEqual(arr.readInt32LE(0), 42);
    assert.strictEqual(arr.readInt32LE(4), 43);
    assert.strictEqual(arr.readInt32LE(8), 44);
    
    // Resto dovrebbe essere 0
    assert.strictEqual(arr.readInt32LE(12), 0);
    assert.strictEqual(arr.readInt32LE(36), 0);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 5: Array vuoto (zero-initialized)
// ============================================================================
console.log('Test 5: Array vuoto (zero-initialized)');
{
    const IntArray5 = ctypes.array('int32', 5);
    const arr = IntArray5.create();
    
    // Tutti gli elementi dovrebbero essere 0
    for (let i = 0; i < 5; i++) {
        assert.strictEqual(arr.readInt32LE(i * 4), 0);
    }
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 6: Array di double (8 bytes)
// ============================================================================
console.log('Test 6: Array di double (c_double * 4)');
{
    const DoubleArray4 = ctypes.array('double', 4);
    
    assert.strictEqual(DoubleArray4.getSize(), 32); // 4 * 8 bytes
    
    const arr = DoubleArray4.create([1.1, 2.2, 3.3, 4.4]);
    
    assert(Math.abs(arr.readDoubleLE(0) - 1.1) < 0.001);
    assert(Math.abs(arr.readDoubleLE(8) - 2.2) < 0.001);
    assert(Math.abs(arr.readDoubleLE(16) - 3.3) < 0.001);
    assert(Math.abs(arr.readDoubleLE(24) - 4.4) < 0.001);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 7: Array da Buffer esistente
// ============================================================================
console.log('Test 7: Array da Buffer esistente');
{
    const IntArray5 = ctypes.array('int32', 5);
    
    // Crea buffer manualmente
    const buf = Buffer.alloc(20);
    buf.writeInt32LE(100, 0);
    buf.writeInt32LE(200, 4);
    buf.writeInt32LE(300, 8);
    buf.writeInt32LE(400, 12);
    buf.writeInt32LE(500, 16);
    
    // Crea array da buffer
    const arr = IntArray5.create(buf);
    
    assert.strictEqual(arr.readInt32LE(0), 100);
    assert.strictEqual(arr.readInt32LE(4), 200);
    assert.strictEqual(arr.readInt32LE(8), 300);
    assert.strictEqual(arr.readInt32LE(12), 400);
    assert.strictEqual(arr.readInt32LE(16), 500);
    
    console.log('  ✅ Test OK\n');
}

// ============================================================================
// Test 8: Array con TypeInfo object (invece di string)
// ============================================================================
console.log('Test 8: Array con TypeInfo object');
{
    const IntArray3 = new ctypes.ArrayType(ctypes.types.int32, 3);
    
    assert.strictEqual(IntArray3.getLength(), 3);
    assert.strictEqual(IntArray3.getSize(), 12);
    
    const arr = IntArray3.create([10, 20, 30]);
    
    assert.strictEqual(arr.readInt32LE(0), 10);
    assert.strictEqual(arr.readInt32LE(4), 20);
    assert.strictEqual(arr.readInt32LE(8), 30);
    
    console.log('  ✅ Test OK\n');
}

console.log('✅ TUTTI I TEST ARRAY PASSATI!');
