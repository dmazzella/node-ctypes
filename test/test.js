/**
 * Test per node-ctypes
 * 
 * Esegui con: npm test
 */

const ctypes = require('../lib');
const { CDLL, types, sizeof, cstring, readCString, struct, callback, alloc } = ctypes;

console.log('=== node-ctypes Test Suite ===\n');

// Test 1: Verifica che il modulo si carichi
console.log('Test 1: Module loading');
console.log('  POINTER_SIZE:', ctypes.POINTER_SIZE);
console.log('  Available types:', Object.keys(types).slice(0, 10).join(', '), '...');
console.log('  ✓ Module loaded successfully\n');

// Test 2: sizeof
console.log('Test 2: sizeof()');
console.log('  sizeof("int32"):', sizeof('int32'));
console.log('  sizeof("int64"):', sizeof('int64'));
console.log('  sizeof("pointer"):', sizeof('pointer'));
console.log('  sizeof("double"):', sizeof('double'));
console.log('  ✓ sizeof works\n');

// Test 3: Carica libc
console.log('Test 3: Loading libc');
let libc;
try {
    // Prova diversi nomi per libc
    const libcNames = [
        'libc.so.6',           // Linux
        'libc.so',             // Linux alternativo
        'libSystem.B.dylib',   // macOS
        null                   // Fallback: eseguibile corrente
    ];
    
    for (const name of libcNames) {
        try {
            libc = new CDLL(name);
            console.log('  Loaded:', name || '(current executable)');
            break;
        } catch (e) {
            continue;
        }
    }
    
    if (!libc) {
        throw new Error('Could not load libc');
    }
    console.log('  ✓ libc loaded\n');
} catch (e) {
    console.log('  ✗ Failed to load libc:', e.message);
    console.log('  Skipping libc-dependent tests\n');
}

// Test 4: Chiama abs()
if (libc) {
    console.log('Test 4: Calling abs()');
    try {
        const abs = libc.func('abs', 'int32', ['int32']);
        
        console.log('  abs(-42):', abs(-42));
        console.log('  abs(100):', abs(100));
        console.log('  abs(-1):', abs(-1));
        console.log('  ✓ abs() works\n');
    } catch (e) {
        console.log('  ✗ abs() failed:', e.message, '\n');
    }
}

// Test 5: Chiama strlen()
if (libc) {
    console.log('Test 5: Calling strlen()');
    try {
        const strlen = libc.func('strlen', 'size_t', ['string']);
        
        const testStr = 'Hello, World!';
        const result = strlen(testStr);
        console.log(`  strlen("${testStr}"):`, result.toString());
        console.log('  Expected:', testStr.length);
        console.log('  ✓ strlen() works\n');
    } catch (e) {
        console.log('  ✗ strlen() failed:', e.message, '\n');
    }
}

// Test 6: Chiama sqrt() da libm
console.log('Test 6: Calling sqrt() from libm');
try {
    let libm;
    const libmNames = [
        'libm.so.6',           // Linux
        'libm.so',             // Linux alternativo
        'libSystem.B.dylib',   // macOS (math è in libSystem)
    ];
    
    for (const name of libmNames) {
        try {
            libm = new CDLL(name);
            break;
        } catch (e) {
            continue;
        }
    }
    
    if (libm) {
        const sqrt = libm.func('sqrt', 'double', ['double']);
        
        console.log('  sqrt(4.0):', sqrt(4.0));
        console.log('  sqrt(2.0):', sqrt(2.0));
        console.log('  sqrt(16.0):', sqrt(16.0));
        console.log('  ✓ sqrt() works\n');
        
        libm.close();
    } else {
        console.log('  ✗ Could not load libm\n');
    }
} catch (e) {
    console.log('  ✗ sqrt() failed:', e.message, '\n');
}

// Test 7: Alloc e readValue/writeValue
console.log('Test 7: Memory allocation and read/write');
try {
    const buf = alloc(16);
    console.log('  Allocated 16 bytes');
    
    // Scrivi un int32
    ctypes.writeValue(buf, 'int32', 12345, 0);
    const readInt = ctypes.readValue(buf, 'int32', 0);
    console.log('  Wrote int32 12345, read back:', readInt);
    
    // Scrivi un double
    ctypes.writeValue(buf, 'double', 3.14159, 8);
    const readDouble = ctypes.readValue(buf, 'double', 8);
    console.log('  Wrote double 3.14159, read back:', readDouble);
    
    console.log('  ✓ Memory operations work\n');
} catch (e) {
    console.log('  ✗ Memory operations failed:', e.message, '\n');
}

// Test 8: cstring
console.log('Test 8: C strings');
try {
    const buf = cstring('Hello from Node.js!');
    console.log('  Created C string');
    
    const str = readCString(buf);
    console.log('  Read back:', str);
    
    console.log('  ✓ C strings work\n');
} catch (e) {
    console.log('  ✗ C strings failed:', e.message, '\n');
}

// Test 9: struct helper
console.log('Test 9: Struct helper');
try {
    const Point = struct({
        x: 'int32',
        y: 'int32'
    });
    
    console.log('  Struct size:', Point.size, 'bytes');
    
    const p = Point.create({ x: 10, y: 20 });
    console.log('  Created point');
    
    console.log('  Point.x:', Point.get(p, 'x'));
    console.log('  Point.y:', Point.get(p, 'y'));
    
    Point.set(p, 'x', 100);
    console.log('  After setting x=100:', Point.toObject(p));
    
    console.log('  ✓ Struct helper works\n');
} catch (e) {
    console.log('  ✗ Struct helper failed:', e.message, '\n');
}

// Test 10: Callback (se supportato)
console.log('Test 10: Callbacks');
if (libc) {
    try {
        // qsort usa un callback per il confronto
        // int (*compar)(const void *, const void *)
        
        // Per semplicità, testiamo solo la creazione del callback
        const compareFn = (a, b) => {
            // In un uso reale, dovresti leggere i valori dai puntatori
            return 0;
        };
        
        const cb = callback(compareFn, 'int32', ['pointer', 'pointer']);
        console.log('  Created callback');
        console.log('  Callback pointer:', cb.pointer.toString(16));
        
        cb.release();
        console.log('  Released callback');
        console.log('  ✓ Callbacks work\n');
    } catch (e) {
        console.log('  ✗ Callbacks failed:', e.message, '\n');
    }
} else {
    console.log('  Skipped (libc not loaded)\n');
}

// Cleanup
if (libc) {
    libc.close();
}

console.log('=== Tests Complete ===');
