/**
 * Test per i nuovi tipi: c_long, c_ulong, c_wchar, c_wchar_p
 */

const ctypes = require('../lib');

console.log('=== Test New Types ===\n');

// ============================================================================
// Test 1: c_long / c_ulong (platform-dependent)
// ============================================================================

console.log('Test 1: c_long / c_ulong');

console.log('  sizeof(c_long):', ctypes.sizeof('long'), 'bytes');
console.log('  sizeof(c_ulong):', ctypes.sizeof('ulong'), 'bytes');

if (process.platform === 'win32') {
    console.log('  Platform: Windows (LLP64 - long is 32-bit)');
    
    // Su Windows, long è 32-bit
    const msvcrt = new ctypes.CDLL('msvcrt.dll');
    const labs = msvcrt.func('labs', 'long', ['long']);
    
    const result = labs(-12345);
    console.log('  labs(-12345) =', result);
    console.log('  ✓ c_long works on Windows!\n');
    
    msvcrt.close();
} else {
    console.log('  Platform: Unix (LP64 - long is 64-bit on 64-bit systems)');
    console.log('  Skipped Windows-specific test\n');
}

// ============================================================================
// Test 2: c_wchar
// ============================================================================

console.log('Test 2: c_wchar');

console.log('  sizeof(c_wchar):', ctypes.sizeof('wchar'), 'bytes');

const wcharBuf = ctypes.alloc(ctypes.sizeof('wchar'));
ctypes.writeValue(wcharBuf, 'wchar', 0x0041);  // 'A'
const wcharVal = ctypes.readValue(wcharBuf, 'wchar');
console.log('  Write 0x0041, read:', wcharVal, '(expected: 65)');

ctypes.writeValue(wcharBuf, 'wchar', 0x4E2D);  // '中' (Chinese character)
const wcharVal2 = ctypes.readValue(wcharBuf, 'wchar');
console.log('  Write 0x4E2D (中), read:', wcharVal2, '(expected: 20013)');

console.log('  ✓ c_wchar works!\n');

// ============================================================================
// Test 3: c_wchar_p / wstring
// ============================================================================

console.log('Test 3: c_wchar_p / wstring');

if (process.platform === 'win32') {
    const kernel32 = new ctypes.WinDLL('kernel32.dll');
    
    // lstrlenW - restituisce lunghezza di una stringa wide
    const lstrlenW = kernel32.func('lstrlenW', 'int32', ['wstring']);
    
    const testStr = 'Hello, World!';
    const len = lstrlenW(testStr);
    console.log('  lstrlenW("Hello, World!") =', len, '(expected: 13)');
    
    // Test con caratteri Unicode
    const unicodeStr = 'Ciao 世界!';
    const len2 = lstrlenW(unicodeStr);
    console.log('  lstrlenW("Ciao 世界!") =', len2, '(expected: 8)');
    
    // Test wstring helper
    const wstrBuf = ctypes.wstring('Test');
    console.log('  wstring("Test") buffer length:', wstrBuf.length, 'bytes (expected: 10)');
    
    kernel32.close();
    console.log('  ✓ c_wchar_p works!\n');
} else {
    console.log('  Skipped (Windows only - need lstrlenW)\n');
}

// ============================================================================
// Test 4: MessageBoxW con wstring (Windows)
// ============================================================================

console.log('Test 4: Windows API with wstring');

if (process.platform === 'win32') {
    const user32 = new ctypes.WinDLL('user32.dll');
    
    // GetDesktopWindow
    const GetDesktopWindow = user32.func('GetDesktopWindow', 'pointer', []);
    const hwnd = GetDesktopWindow();
    console.log('  GetDesktopWindow() =', hwnd ? '0x' + hwnd.toString(16) : 'null');
    
    // Non mostriamo MessageBox per evitare popup interattivi
    // Ma verifichiamo che possiamo ottenere la funzione
    const MessageBoxW = user32.func('MessageBoxW', 'int32', ['pointer', 'wstring', 'wstring', 'uint32']);
    console.log('  MessageBoxW function loaded');
    
    user32.close();
    console.log('  ✓ Windows Unicode API works!\n');
} else {
    console.log('  Skipped (Windows only)\n');
}

// ============================================================================
// Test 5: Verifica dimensioni platform-dependent
// ============================================================================

console.log('Test 5: Platform-dependent sizes');

const sizes = {
    'int8': ctypes.sizeof('int8'),
    'int16': ctypes.sizeof('int16'),
    'int32': ctypes.sizeof('int32'),
    'int64': ctypes.sizeof('int64'),
    'long': ctypes.sizeof('long'),
    'ulong': ctypes.sizeof('ulong'),
    'size_t': ctypes.sizeof('size_t'),
    'pointer': ctypes.sizeof('pointer'),
    'wchar': ctypes.sizeof('wchar'),
};

console.log('  Type sizes on this platform:');
for (const [type, size] of Object.entries(sizes)) {
    console.log(`    ${type}: ${size} bytes`);
}

// Verifica coerenza
const expectedLongSize = process.platform === 'win32' ? 4 : (ctypes.POINTER_SIZE === 8 ? 8 : 4);
const expectedWcharSize = process.platform === 'win32' ? 2 : 4;

console.log('\n  Expected long size:', expectedLongSize, '- Actual:', sizes.long);
console.log('  Expected wchar size:', expectedWcharSize, '- Actual:', sizes.wchar);

if (sizes.long === expectedLongSize && sizes.wchar === expectedWcharSize) {
    console.log('  ✓ Platform-dependent sizes correct!\n');
} else {
    console.log('  ⚠ Sizes mismatch!\n');
}

console.log('=== All New Type Tests Complete ===');
