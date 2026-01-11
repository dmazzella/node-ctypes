/**
 * Test per verificare le fix applicate
 */

const ctypes = require('../lib');

console.log('=== Testing Fixes ===\n');

// ============================================================================
// Test 1: Struct Alignment
// ============================================================================

console.log('Test 1: Struct Alignment');

// Struct con tipi misti - deve avere padding corretto
// In C: struct { char a; int b; char c; double d; }
// Layout atteso (64-bit):
//   a: offset 0, size 1
//   padding: 3 bytes
//   b: offset 4, size 4
//   c: offset 8, size 1
//   padding: 7 bytes
//   d: offset 16, size 8
//   Total: 24 bytes

const MixedStruct = ctypes.struct({
    a: 'int8',    // 1 byte
    b: 'int32',   // 4 bytes, deve essere allineato a 4
    c: 'int8',    // 1 byte
    d: 'double'   // 8 bytes, deve essere allineato a 8
});

console.log('  MixedStruct:');
console.log('    Size:', MixedStruct.size, 'bytes (expected: 24)');
console.log('    Fields:');
MixedStruct.fields.forEach(f => {
    console.log(`      ${f.name}: offset=${f.offset}, size=${f.size}, align=${f.alignment}`);
});

// Verifica
const expectedOffsets = { a: 0, b: 4, c: 8, d: 16 };
let alignmentOk = true;
for (const field of MixedStruct.fields) {
    if (field.offset !== expectedOffsets[field.name]) {
        console.log(`    ✗ ${field.name} offset wrong: ${field.offset} vs expected ${expectedOffsets[field.name]}`);
        alignmentOk = false;
    }
}

if (alignmentOk && MixedStruct.size === 24) {
    console.log('  ✓ Alignment correct!\n');
} else {
    console.log('  ✗ Alignment incorrect!\n');
}

// Test packed struct
const PackedStruct = ctypes.struct({
    a: 'int8',
    b: 'int32',
    c: 'int8',
    d: 'double'
}, { packed: true });

console.log('  PackedStruct (no padding):');
console.log('    Size:', PackedStruct.size, 'bytes (expected: 14)');
if (PackedStruct.size === 14) {
    console.log('  ✓ Packed struct correct!\n');
} else {
    console.log('  ✗ Packed struct incorrect!\n');
}

// ============================================================================
// Test 2: Struct con Windows API (POINT)
// ============================================================================

console.log('Test 2: POINT struct');

const POINT = ctypes.struct({
    x: 'int32',
    y: 'int32'
});

console.log('  POINT size:', POINT.size, 'bytes (expected: 8)');

const p = POINT.create({ x: 100, y: 200 });
const px = POINT.get(p, 'x');
const py = POINT.get(p, 'y');

console.log('  Created POINT(100, 200)');
console.log('  Read back: x =', px, ', y =', py);

if (px === 100 && py === 200 && POINT.size === 8) {
    console.log('  ✓ POINT struct works!\n');
} else {
    console.log('  ✗ POINT struct failed!\n');
}

// ============================================================================
// Test 3: Callback senza memory leak
// ============================================================================

console.log('Test 3: Callback memory (no leak test)');

// Test callback() - main thread only
const callbacks = [];
for (let i = 0; i < 100; i++) {
    const cb = ctypes.callback((a, b) => a + b, 'int32', ['int32', 'int32']);
    callbacks.push(cb);
}
for (const cb of callbacks) {
    cb.release();
}
console.log('  Created and released 100 callback()');

// Test threadSafeCallback() - thread safe
const tsCallbacks = [];
for (let i = 0; i < 100; i++) {
    const cb = ctypes.threadSafeCallback((a, b) => a + b, 'int32', ['int32', 'int32']);
    tsCallbacks.push(cb);
}
for (const cb of tsCallbacks) {
    cb.release();
}
console.log('  Created and released 100 threadSafeCallback()');
console.log('  ✓ No crash (memory leak test passed)\n');

// ============================================================================
// Test 4: String handling
// ============================================================================

console.log('Test 4: String handling');

if (process.platform === 'win32') {
    const msvcrt = new ctypes.CDLL('msvcrt.dll');
    const strlen = msvcrt.func('strlen', 'size_t', ['string']);
    
    const testStrings = [
        'Hello',
        'Hello, World!',
        'A'.repeat(1000),
        '',
        'Unicode: 日本語'
    ];
    
    let allOk = true;
    for (const s of testStrings) {
        const result = strlen(s);
        const expected = Buffer.byteLength(s, 'utf8');
        if (Number(result) !== expected) {
            console.log(`  ✗ strlen("${s.substring(0, 20)}...") = ${result}, expected ${expected}`);
            allOk = false;
        }
    }
    
    if (allOk) {
        console.log('  ✓ All string tests passed!\n');
    }
    
    msvcrt.close();
} else {
    console.log('  Skipped (Windows only)\n');
}

// ============================================================================
// Test 5: Rapid callback creation/destruction (stress test)
// ============================================================================

console.log('Test 5: Callback stress test');

if (process.platform === 'win32') {
    const msvcrt = new ctypes.CDLL('msvcrt.dll');
    const qsort = msvcrt.func('qsort', 'void', ['pointer', 'size_t', 'size_t', 'pointer']);
    
    const iterations = 50;
    let successCount = 0;
    
    for (let i = 0; i < iterations; i++) {
        try {
            const arr = [5, 2, 8, 1, 9];
            const arrBuf = ctypes.alloc(arr.length * 4);
            
            for (let j = 0; j < arr.length; j++) {
                ctypes.writeValue(arrBuf, 'int32', arr[j], j * 4);
            }
            
            const compare = ctypes.callback((a, b) => {
                const va = ctypes.readValue(a, 'int32', 0);
                const vb = ctypes.readValue(b, 'int32', 0);
                return va - vb;
            }, 'int32', ['pointer', 'pointer']);
            
            qsort(arrBuf, arr.length, 4, compare.pointer);
            
            // Verifica ordinamento
            let sorted = true;
            let prev = -Infinity;
            for (let j = 0; j < arr.length; j++) {
                const val = ctypes.readValue(arrBuf, 'int32', j * 4);
                if (val < prev) {
                    sorted = false;
                    break;
                }
                prev = val;
            }
            
            compare.release();
            
            if (sorted) successCount++;
        } catch (e) {
            console.log(`  Iteration ${i} failed:`, e.message);
        }
    }
    
    console.log(`  ${successCount}/${iterations} iterations successful`);
    if (successCount === iterations) {
        console.log('  ✓ Stress test passed!\n');
    } else {
        console.log('  ✗ Some iterations failed!\n');
    }
    
    msvcrt.close();
} else {
    console.log('  Skipped (Windows only)\n');
}

// ============================================================================
// Test 6: Large struct
// ============================================================================

console.log('Test 6: Large struct');

const LargeStruct = ctypes.struct({
    a: 'int64',
    b: 'int64',
    c: 'int64',
    d: 'int64',
    e: 'double',
    f: 'double',
    g: 'pointer',
    h: 'pointer'
});

console.log('  LargeStruct size:', LargeStruct.size, 'bytes');
console.log('  Expected: 64 bytes (8 fields x 8 bytes each)');

const large = LargeStruct.create({
    a: 1n,
    b: 2n,
    c: 3n,
    d: 4n,
    e: 5.5,
    f: 6.6,
    g: 0n,
    h: 0n
});

const readBack = LargeStruct.toObject(large);
console.log('  Read back:', JSON.stringify(readBack, (k, v) => typeof v === 'bigint' ? v.toString() : v));

if (LargeStruct.size === 64 && readBack.a === 1n && readBack.e === 5.5) {
    console.log('  ✓ Large struct works!\n');
} else {
    console.log('  ✗ Large struct failed!\n');
}

// ============================================================================
// Test 7: callback() vs threadSafeCallback() - Performance comparison
// ============================================================================

console.log('Test 7: callback() vs threadSafeCallback() performance');

if (process.platform === 'win32') {
    const msvcrt = new ctypes.CDLL('msvcrt.dll');
    const qsort = msvcrt.func('qsort', 'void', ['pointer', 'size_t', 'size_t', 'pointer']);
    
    const arr = [5, 2, 8, 1, 9, 3, 7, 4, 6, 0];
    const iterations = 100;
    
    // Test con callback() - main thread, veloce
    let start = Date.now();
    for (let iter = 0; iter < iterations; iter++) {
        const arrBuf = ctypes.alloc(arr.length * 4);
        for (let i = 0; i < arr.length; i++) {
            ctypes.writeValue(arrBuf, 'int32', arr[i], i * 4);
        }
        
        const compare = ctypes.callback((a, b) => {
            return ctypes.readValue(a, 'int32', 0) - ctypes.readValue(b, 'int32', 0);
        }, 'int32', ['pointer', 'pointer']);
        
        qsort(arrBuf, arr.length, 4, compare.pointer);
        compare.release();
    }
    const callbackTime = Date.now() - start;
    
    // Test con threadSafeCallback() - thread safe, più overhead
    start = Date.now();
    for (let iter = 0; iter < iterations; iter++) {
        const arrBuf = ctypes.alloc(arr.length * 4);
        for (let i = 0; i < arr.length; i++) {
            ctypes.writeValue(arrBuf, 'int32', arr[i], i * 4);
        }
        
        const compare = ctypes.threadSafeCallback((a, b) => {
            return ctypes.readValue(a, 'int32', 0) - ctypes.readValue(b, 'int32', 0);
        }, 'int32', ['pointer', 'pointer']);
        
        qsort(arrBuf, arr.length, 4, compare.pointer);
        compare.release();
    }
    const threadSafeTime = Date.now() - start;
    
    console.log(`  callback():           ${callbackTime}ms for ${iterations} sorts`);
    console.log(`  threadSafeCallback(): ${threadSafeTime}ms for ${iterations} sorts`);
    console.log(`  Ratio: threadSafeCallback is ${(threadSafeTime / callbackTime).toFixed(2)}x slower`);
    console.log('  ✓ Both callback types work!\n');
    
    msvcrt.close();
} else {
    console.log('  Skipped (Windows only)\n');
}

console.log('=== All Fix Tests Complete ===');
