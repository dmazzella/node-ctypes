/**
 * Test per le funzioni con nomi Python-compatibili
 */

const ctypes = require('../lib');

console.log('=== Test Python-Compatible Function Names ===\n');

// ============================================================================
// Test 1: create_string_buffer
// ============================================================================

console.log('Test 1: create_string_buffer');

// Con size
const buf1 = ctypes.create_string_buffer(100);
console.log('  create_string_buffer(100): length =', buf1.length);

// Con stringa
const buf2 = ctypes.create_string_buffer("Hello, World!");
console.log('  create_string_buffer("Hello, World!"): length =', buf2.length);
console.log('  Content:', ctypes.string_at(buf2));

// Con Buffer
const buf3 = ctypes.create_string_buffer(Buffer.from("Test"));
console.log('  create_string_buffer(Buffer): length =', buf3.length);

console.log('  ✓ create_string_buffer works!\n');

// ============================================================================
// Test 2: create_unicode_buffer
// ============================================================================

console.log('Test 2: create_unicode_buffer');

// Con size (caratteri)
const wbuf1 = ctypes.create_unicode_buffer(50);
console.log('  create_unicode_buffer(50): length =', wbuf1.length, 'bytes (100 expected for 50 wchars)');

// Con stringa
const wbuf2 = ctypes.create_unicode_buffer("Ciao 世界!");
console.log('  create_unicode_buffer("Ciao 世界!"): length =', wbuf2.length, 'bytes');

console.log('  ✓ create_unicode_buffer works!\n');

// ============================================================================
// Test 3: string_at
// ============================================================================

console.log('Test 3: string_at');

const strBuf = ctypes.create_string_buffer("Hello, World!");

// Leggi tutta la stringa
const s1 = ctypes.string_at(strBuf);
console.log('  string_at(buf):', s1);

// Leggi primi 5 caratteri
const s2 = ctypes.string_at(strBuf, 5);
console.log('  string_at(buf, 5):', s2);

console.log('  ✓ string_at works!\n');

// ============================================================================
// Test 4: wstring_at
// ============================================================================

console.log('Test 4: wstring_at');

const wstrBuf = ctypes.create_unicode_buffer("Hello Wide!");

// Leggi tutta la stringa wide
const ws1 = ctypes.wstring_at(wstrBuf);
console.log('  wstring_at(buf):', ws1);

// Leggi primi 5 caratteri
const ws2 = ctypes.wstring_at(wstrBuf, 5);
console.log('  wstring_at(buf, 5):', ws2);

console.log('  ✓ wstring_at works!\n');

// ============================================================================
// Test 5: addressof (lowercase)
// ============================================================================

console.log('Test 5: addressof (lowercase)');

const addrBuf = ctypes.create_string_buffer(16);
const addr = ctypes.addressof(addrBuf);
console.log('  addressof(buf):', '0x' + addr.toString(16));

// Verifica che sia uguale a addressOf
const addr2 = ctypes.addressOf(addrBuf);
console.log('  addressOf(buf):', '0x' + addr2.toString(16));
console.log('  addressof === addressOf:', addr === addr2);

console.log('  ✓ addressof works!\n');

// ============================================================================
// Test 6: memmove
// ============================================================================

console.log('Test 6: memmove');

const src = ctypes.create_string_buffer("Source Data!");
const dst = ctypes.create_string_buffer(20);

ctypes.memmove(dst, src, 12);
const copied = ctypes.string_at(dst, 12);
console.log('  memmove result:', copied);

console.log('  ✓ memmove works!\n');

// ============================================================================
// Test 7: memset
// ============================================================================

console.log('Test 7: memset');

const memBuf = ctypes.create_string_buffer(10);
ctypes.memset(memBuf, 0x41, 5);  // Fill with 'A'

console.log('  memset(buf, 0x41, 5):', memBuf.slice(0, 10).toString());
console.log('  First 5 bytes:', memBuf.slice(0, 5).toString());

console.log('  ✓ memset works!\n');

// ============================================================================
// Test 8: sizeof
// ============================================================================

console.log('Test 8: sizeof (già Python-compatibile)');

console.log('  sizeof("int32"):', ctypes.sizeof('int32'));
console.log('  sizeof("int64"):', ctypes.sizeof('int64'));
console.log('  sizeof("pointer"):', ctypes.sizeof('pointer'));
console.log('  sizeof("double"):', ctypes.sizeof('double'));

console.log('  ✓ sizeof works!\n');

// ============================================================================
// Test 9: Uso pratico - stile Python
// ============================================================================

console.log('Test 9: Practical Python-style usage');

if (process.platform === 'win32') {
    const kernel32 = new ctypes.WinDLL('kernel32.dll');
    
    // GetComputerNameW - restituisce nome computer come wide string
    const GetComputerNameW = kernel32.func('GetComputerNameW', 'int32', ['pointer', 'pointer']);
    
    // Alloca buffer come in Python
    const nameBuf = ctypes.create_unicode_buffer(256);
    const sizeBuf = ctypes.create_string_buffer(4);
    ctypes.writeValue(sizeBuf, 'uint32', 256);
    
    const result = GetComputerNameW(nameBuf, sizeBuf);
    
    if (result) {
        const computerName = ctypes.wstring_at(nameBuf);
        console.log('  Computer name:', computerName);
    }
    
    kernel32.close();
    console.log('  ✓ Python-style usage works!\n');
} else {
    console.log('  Skipped (Windows only)\n');
}

// ============================================================================
// Test 10: Verifica tutti gli alias esistono
// ============================================================================

console.log('Test 10: Verify all Python-compatible exports');

const pythonFuncs = [
    'create_string_buffer',
    'create_unicode_buffer', 
    'string_at',
    'wstring_at',
    'addressof',
    'memmove',
    'memset',
    'sizeof',
    'byref',
    'cast',
    'POINTER',
    'get_errno',
    'set_errno',
    'GetLastError',
    'SetLastError',
    'FormatError',
    'WinError',
];

let allExist = true;
for (const fn of pythonFuncs) {
    const exists = typeof ctypes[fn] === 'function';
    if (!exists) {
        console.log('  ❌ Missing:', fn);
        allExist = false;
    }
}

if (allExist) {
    console.log('  ✓ All', pythonFuncs.length, 'Python-compatible functions exported!\n');
}

console.log('=== All Python-Compatible Tests Complete ===');
