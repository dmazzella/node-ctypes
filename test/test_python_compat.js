/**
 * Test per le nuove feature Python-compatible
 */

const ctypes = require('../lib');

console.log('=== Test Python Compatibility Features ===\n');

// ============================================================================
// Test 1: byref()
// ============================================================================

console.log('Test 1: byref()');

const buf = ctypes.alloc(4);
ctypes.writeValue(buf, 'int32', 42);

// byref restituisce lo stesso buffer
const ref = ctypes.byref(buf);
console.log('  byref(buf) === buf:', ref === buf);
console.log('  Value:', ctypes.readValue(ref, 'int32'));
console.log('  ✓ byref works!\n');

// ============================================================================
// Test 2: cast()
// ============================================================================

console.log('Test 2: cast()');

// Cast buffer a tipo diverso
const intBuf = ctypes.alloc(4);
ctypes.writeValue(intBuf, 'int32', 0x41424344);  // "DCBA" in ASCII

// Cast come uint32
const asUint = ctypes.cast(intBuf, 'uint32');
console.log('  Cast int32 -> uint32:', asUint.toString(16));

// Cast buffer a struct
const Point = ctypes.struct({
    x: 'int16',
    y: 'int16'
});

const pointBuf = ctypes.alloc(4);
ctypes.writeValue(pointBuf, 'int16', 100, 0);
ctypes.writeValue(pointBuf, 'int16', 200, 2);

const casted = ctypes.cast(pointBuf, Point);
console.log('  Cast buffer -> struct:', casted.contents);
console.log('  ✓ cast works!\n');

// ============================================================================
// Test 3: POINTER()
// ============================================================================

console.log('Test 3: POINTER()');

const IntPtr = ctypes.POINTER('int32');
console.log('  POINTER("int32"):', IntPtr.toString());
console.log('  Size:', IntPtr.size, 'bytes');

// Crea puntatore a un buffer
const valueBuf = ctypes.alloc(4);
ctypes.writeValue(valueBuf, 'int32', 12345);

const ptrBuf = IntPtr.fromBuffer(valueBuf);
console.log('  Pointer created');

// Dereferenzia
const addr = IntPtr.deref(ptrBuf);
console.log('  Dereferenced address:', addr ? '0x' + addr.toString(16) : 'null');

console.log('  ✓ POINTER works!\n');

// ============================================================================
// Test 4: union()
// ============================================================================

console.log('Test 4: union()');

const IntOrFloat = ctypes.union({
    i: 'int32',
    f: 'float'
});

console.log('  Union size:', IntOrFloat.size, 'bytes (expected: 4)');
console.log('  isUnion:', IntOrFloat.isUnion);

// Crea e testa
const u = IntOrFloat.create({ i: 0x40490FDB });  // Pi greco come float bits
console.log('  As int32:', IntOrFloat.get(u, 'i').toString(16));
console.log('  As float:', IntOrFloat.get(u, 'f').toFixed(6), '(expected: ~3.141593)');

// Scrivi come float, leggi come int
IntOrFloat.set(u, 'f', 2.5);
console.log('  Set float 2.5, read as int:', IntOrFloat.get(u, 'i').toString(16), '(expected: 40200000)');

console.log('  ✓ union works!\n');

// ============================================================================
// Test 5: get_errno / set_errno
// ============================================================================

console.log('Test 5: get_errno / set_errno');

try {
    // Imposta errno
    ctypes.set_errno(0);
    console.log('  errno after set_errno(0):', ctypes.get_errno());
    
    // Imposta un valore
    ctypes.set_errno(22);  // EINVAL
    console.log('  errno after set_errno(22):', ctypes.get_errno());
    
    // Resetta
    ctypes.set_errno(0);
    console.log('  ✓ get_errno/set_errno work!\n');
} catch (e) {
    console.log('  Error:', e.message);
    console.log('  (errno functions may not be available on this platform)\n');
}

// ============================================================================
// Test 6: GetLastError / SetLastError / FormatError / WinError (Windows only)
// ============================================================================

console.log('Test 6: Windows Error Handling');

if (process.platform === 'win32') {
    try {
        // Resetta errore
        ctypes.SetLastError(0);
        console.log('  GetLastError after SetLastError(0):', ctypes.GetLastError());
        
        // Imposta un errore
        ctypes.SetLastError(5);  // ERROR_ACCESS_DENIED
        console.log('  GetLastError after SetLastError(5):', ctypes.GetLastError());
        
        // Formatta errore
        const msg = ctypes.FormatError(5);
        console.log('  FormatError(5):', msg);
        
        // Crea WinError
        const err = ctypes.WinError(2);  // ERROR_FILE_NOT_FOUND
        console.log('  WinError(2):', err.message);
        console.log('  err.winerror:', err.winerror);
        
        ctypes.SetLastError(0);
        console.log('  ✓ Windows error handling works!\n');
    } catch (e) {
        console.log('  Error:', e.message, '\n');
    }
} else {
    console.log('  Skipped (Windows only)\n');
}

// ============================================================================
// Test 7: ptrToBuffer
// ============================================================================

console.log('Test 7: ptrToBuffer');

const srcBuf = ctypes.alloc(16);
ctypes.writeValue(srcBuf, 'int32', 111, 0);
ctypes.writeValue(srcBuf, 'int32', 222, 4);
ctypes.writeValue(srcBuf, 'int32', 333, 8);
ctypes.writeValue(srcBuf, 'int32', 444, 12);

// Ottieni indirizzo
const addr2 = ctypes.addressOf(srcBuf);
console.log('  Source buffer address:', '0x' + addr2.toString(16));

// Crea buffer all'indirizzo
const viewBuf = ctypes.ptrToBuffer(addr2, 16);
console.log('  ptrToBuffer created');

// Leggi valori attraverso il view
console.log('  Values through view:', 
    ctypes.readValue(viewBuf, 'int32', 0),
    ctypes.readValue(viewBuf, 'int32', 4),
    ctypes.readValue(viewBuf, 'int32', 8),
    ctypes.readValue(viewBuf, 'int32', 12)
);

// Modifica attraverso view
ctypes.writeValue(viewBuf, 'int32', 999, 0);
console.log('  After write through view, srcBuf[0]:', ctypes.readValue(srcBuf, 'int32', 0));

console.log('  ✓ ptrToBuffer works!\n');

// ============================================================================
// Test 8: Uso pratico - GetSystemInfo con byref
// ============================================================================

console.log('Test 8: Practical example - GetSystemInfo with byref');

if (process.platform === 'win32') {
    const SYSTEM_INFO = ctypes.struct({
        wProcessorArchitecture: 'uint16',
        wReserved: 'uint16',
        dwPageSize: 'uint32',
        lpMinimumApplicationAddress: 'pointer',
        lpMaximumApplicationAddress: 'pointer',
        dwActiveProcessorMask: 'size_t',
        dwNumberOfProcessors: 'uint32',
        dwProcessorType: 'uint32',
        dwAllocationGranularity: 'uint32',
        wProcessorLevel: 'uint16',
        wProcessorRevision: 'uint16'
    });
    
    const kernel32 = new ctypes.WinDLL('kernel32.dll');
    const GetSystemInfo = kernel32.func('GetSystemInfo', 'void', ['pointer']);
    
    const sysInfo = SYSTEM_INFO.create();
    GetSystemInfo(ctypes.byref(sysInfo));  // Usa byref!
    
    const info = SYSTEM_INFO.toObject(sysInfo);
    console.log('  Page size:', info.dwPageSize);
    console.log('  Number of processors:', info.dwNumberOfProcessors);
    console.log('  Allocation granularity:', info.dwAllocationGranularity);
    
    kernel32.close();
    console.log('  ✓ Practical example works!\n');
} else {
    console.log('  Skipped (Windows only)\n');
}

console.log('=== All Python Compatibility Tests Complete ===');
