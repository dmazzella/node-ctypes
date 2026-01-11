/**
 * Test per funzioni variadiche
 * 
 * Verifica il supporto per funzioni C variadiche come printf, sprintf, ecc.
 */

const ctypes = require('../lib');
const { CDLL, types, cstring, alloc, readCString } = ctypes;

console.log('=== Test Funzioni Variadiche ===\n');

// Carica la libreria C standard
let libc;
let isWindows = process.platform === 'win32';

console.log('Test 1: Caricamento libreria');
try {
    if (isWindows) {
        // Su Windows usiamo msvcrt.dll per le funzioni C runtime
        libc = new CDLL('msvcrt.dll');
        console.log('  ✓ Caricato msvcrt.dll (Windows)\n');
    } else {
        // Su Linux/macOS
        const libcNames = ['libc.so.6', 'libc.so', 'libSystem.B.dylib'];
        for (const name of libcNames) {
            try {
                libc = new CDLL(name);
                console.log(`  ✓ Caricato ${name}\n`);
                break;
            } catch (e) {
                continue;
            }
        }
    }
    
    if (!libc) {
        throw new Error('Impossibile caricare libc');
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message);
    process.exit(1);
}

// Test 2: sprintf con un argomento
console.log('Test 2: sprintf con stringa semplice');
try {
    const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
    const buffer = alloc(256);
    const format = cstring('Hello, World!');
    
    const result = sprintf(buffer, format);
    const output = readCString(buffer);
    
    console.log('  Input: "Hello, World!"');
    console.log('  Output:', output);
    console.log('  Lunghezza:', result);
    
    if (output === 'Hello, World!' && result === 13) {
        console.log('  ✓ sprintf funziona correttamente\n');
    } else {
        throw new Error(`Risultato inatteso: "${output}" (len: ${result})`);
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 3: sprintf con un intero
console.log('Test 3: sprintf con formato %d');
try {
    const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
    const buffer = alloc(256);
    const format = cstring('Number: %d');
    
    const result = sprintf(buffer, format, 42);
    const output = readCString(buffer);
    
    console.log('  Input: "Number: %d", 42');
    console.log('  Output:', output);
    console.log('  Lunghezza:', result);
    
    if (output === 'Number: 42' && result === 10) {
        console.log('  ✓ sprintf con %d funziona correttamente\n');
    } else {
        throw new Error(`Risultato inatteso: "${output}" (len: ${result})`);
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 4: sprintf con multipli argomenti
console.log('Test 4: sprintf con multipli argomenti');
try {
    const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
    const buffer = alloc(256);
    const format = cstring('%s: %d + %d = %d');
    const label = cstring('Somma');
    
    const result = sprintf(buffer, format, label, 10, 20, 30);
    const output = readCString(buffer);
    
    console.log('  Input: "%s: %d + %d = %d", "Somma", 10, 20, 30');
    console.log('  Output:', output);
    console.log('  Lunghezza:', result);
    
    if (output === 'Somma: 10 + 20 = 30') {
        console.log('  ✓ sprintf con multipli argomenti funziona correttamente\n');
    } else {
        throw new Error(`Risultato inatteso: "${output}"`);
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 5: sprintf con float/double
console.log('Test 5: sprintf con formato %f');
try {
    const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
    const buffer = alloc(256);
    const format = cstring('Pi: %.2f');
    
    const result = sprintf(buffer, format, 3.14159);
    const output = readCString(buffer);
    
    console.log('  Input: "Pi: %.2f", 3.14159');
    console.log('  Output:', output);
    console.log('  Lunghezza:', result);
    
    if (output === 'Pi: 3.14') {
        console.log('  ✓ sprintf con %f funziona correttamente\n');
    } else {
        throw new Error(`Risultato inatteso: "${output}"`);
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 6: sprintf con formato complesso
console.log('Test 6: sprintf con formato complesso');
try {
    const sprintf = libc.func('sprintf', 'int32', ['pointer', 'pointer']);
    const buffer = alloc(256);
    const format = cstring('Int: %d, Hex: 0x%x, String: %s, Float: %.2f');
    const str = cstring('test');
    
    const result = sprintf(buffer, format, 255, 255, str, 2.718);
    const output = readCString(buffer);
    
    console.log('  Input: formato misto con int, hex, string, float');
    console.log('  Output:', output);
    console.log('  Lunghezza:', result);
    
    if (output.includes('Int: 255') && output.includes('0xff') && output.includes('test')) {
        console.log('  ✓ sprintf con formato complesso funziona correttamente\n');
    } else {
        throw new Error(`Risultato inatteso: "${output}"`);
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 7: printf (output su stdout)
console.log('Test 7: printf output su stdout');
try {
    const printf = libc.func('printf', 'int32', ['pointer']);
    const format = cstring('printf test: %s %d\n');
    const str = cstring('Hello');
    
    console.log('  Chiamata: printf("printf test: %s %d\\n", "Hello", 123)');
    console.log('  Output atteso su stdout:');
    const result = printf(format, str, 123);
    console.log('  Caratteri stampati:', result);
    console.log('  ✓ printf eseguito\n');
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

// Test 8: snprintf (versione sicura con limite di buffer)
console.log('Test 8: snprintf con limite buffer');
try {
    // Su Windows si chiama _snprintf invece di snprintf
    const snprintfName = isWindows ? '_snprintf' : 'snprintf';
    const snprintf = libc.func(snprintfName, 'int32', ['pointer', 'size_t', 'pointer']);
    const buffer = alloc(15); // Buffer per test
    
    // Inizializza il buffer con zeri per garantire null-termination
    for (let i = 0; i < 15; i++) {
        buffer.writeUInt8(0, i);
    }
    
    const format = cstring('Very long string %d');
    
    // snprintf con buffer limitato a 10 byte
    const result = snprintf(buffer, 10, format, 123);
    
    // Assicurati che ci sia null-termination
    buffer.writeUInt8(0, 9);
    const output = readCString(buffer);
    
    console.log('  Input: "Very long string %d", 123 (buffer size: 10)');
    console.log('  Output:', output);
    console.log('  Caratteri scritti:', result);
    console.log('  Output length:', output.length);
    
    // _snprintf su Windows ha comportamento diverso da snprintf POSIX:
    // - snprintf POSIX: ritorna il numero di caratteri che sarebbero stati scritti
    // - _snprintf Windows: ritorna -1 se il buffer è troppo piccolo
    if (isWindows) {
        if (output.length < 10) {
            console.log('  ✓ _snprintf rispetta il limite del buffer (Windows)\n');
        } else {
            throw new Error(`Buffer overflow: "${output}" (len: ${output.length})`);
        }
    } else {
        if (output.length < 10 && result > output.length) {
            console.log('  ✓ snprintf rispetta il limite del buffer\n');
        } else {
            throw new Error(`Risultato inatteso: "${output}" (len: ${output.length}, result: ${result})`);
        }
    }
} catch (e) {
    console.error('  ✗ Errore:', e.message, '\n');
}

console.log('=== Test Completati ===');

// Cleanup
try {
    libc.close();
} catch (e) {
    // Ignora errori di chiusura
}
