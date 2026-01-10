// Benchmark: node-ctypes vs koffi
const ctypes = require("../lib");
const koffi = require("koffi");

console.log("=== FFI Performance Benchmark ===");
console.log("Comparing: node-ctypes vs koffi\n");

// ============================================================================
// Setup
// ============================================================================

// node-ctypes
const ctypes_msvcrt = new ctypes.CDLL("msvcrt.dll");
const ctypes_kernel32 = new ctypes.CDLL("kernel32.dll");

// koffi
const koffi_msvcrt = koffi.load("msvcrt.dll");
const koffi_kernel32 = koffi.load("kernel32.dll");

// ============================================================================
// Benchmark 1: Simple function calls (abs)
// ============================================================================

console.log("Benchmark 1: Simple function calls - abs(-42)");

// Setup
const ctypes_abs = ctypes_msvcrt.func("abs", "int32", ["int32"]);
const koffi_abs = koffi_msvcrt.func("int abs(int)");

const iterations = 1000000;

// Warmup
for (let i = 0; i < 1000; i++) {
  ctypes_abs(-42);
  koffi_abs(-42);
}

// Benchmark ctypes
let start = performance.now();
for (let i = 0; i < iterations; i++) {
  ctypes_abs(-42);
}
let ctypes_time = performance.now() - start;

// Benchmark koffi
start = performance.now();
for (let i = 0; i < iterations; i++) {
  koffi_abs(-42);
}
let koffi_time = performance.now() - start;

console.log(`  Iterations: ${iterations.toLocaleString()}`);
console.log(`  node-ctypes: ${ctypes_time.toFixed(2)}ms (${(iterations / ctypes_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  koffi:       ${koffi_time.toFixed(2)}ms (${(iterations / koffi_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  Ratio: ${(ctypes_time / koffi_time).toFixed(2)}x ${koffi_time < ctypes_time ? 'slower' : 'faster'}\n`);

// ============================================================================
// Benchmark 2: String functions (strlen)
// ============================================================================

console.log("Benchmark 2: String functions - strlen");

const ctypes_strlen = ctypes_msvcrt.func("strlen", "size_t", ["string"]);
const koffi_strlen = koffi_msvcrt.func("size_t strlen(const char*)");

const testString = "Hello, World! This is a test string.";
const strIterations = 100000;

// Warmup
for (let i = 0; i < 100; i++) {
  ctypes_strlen(testString);
  koffi_strlen(testString);
}

// Benchmark ctypes
start = performance.now();
for (let i = 0; i < strIterations; i++) {
  ctypes_strlen(testString);
}
ctypes_time = performance.now() - start;

// Benchmark koffi
start = performance.now();
for (let i = 0; i < strIterations; i++) {
  koffi_strlen(testString);
}
koffi_time = performance.now() - start;

console.log(`  Iterations: ${strIterations.toLocaleString()}`);
console.log(`  node-ctypes: ${ctypes_time.toFixed(2)}ms (${(strIterations / ctypes_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  koffi:       ${koffi_time.toFixed(2)}ms (${(strIterations / koffi_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  Ratio: ${(ctypes_time / koffi_time).toFixed(2)}x ${koffi_time < ctypes_time ? 'slower' : 'faster'}\n`);

// ============================================================================
// Benchmark 3: Floating point (sqrt)
// ============================================================================

console.log("Benchmark 3: Floating point - sqrt");

const ctypes_sqrt = ctypes_msvcrt.func("sqrt", "double", ["double"]);
const koffi_sqrt = koffi_msvcrt.func("double sqrt(double)");

const fpIterations = 500000;

// Warmup
for (let i = 0; i < 100; i++) {
  ctypes_sqrt(144.0);
  koffi_sqrt(144.0);
}

// Benchmark ctypes
start = performance.now();
for (let i = 0; i < fpIterations; i++) {
  ctypes_sqrt(144.0);
}
ctypes_time = performance.now() - start;

// Benchmark koffi
start = performance.now();
for (let i = 0; i < fpIterations; i++) {
  koffi_sqrt(144.0);
}
koffi_time = performance.now() - start;

console.log(`  Iterations: ${fpIterations.toLocaleString()}`);
console.log(`  node-ctypes: ${ctypes_time.toFixed(2)}ms (${(fpIterations / ctypes_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  koffi:       ${koffi_time.toFixed(2)}ms (${(fpIterations / koffi_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  Ratio: ${(ctypes_time / koffi_time).toFixed(2)}x ${koffi_time < ctypes_time ? 'slower' : 'faster'}\n`);

// ============================================================================
// Benchmark 4: Windows API (GetTickCount)
// ============================================================================

console.log("Benchmark 4: Windows API - GetTickCount");

const ctypes_GetTickCount = ctypes_kernel32.func("GetTickCount", "uint32", []);
const koffi_GetTickCount = koffi_kernel32.func("unsigned long GetTickCount()");

const apiIterations = 500000;

// Warmup
for (let i = 0; i < 100; i++) {
  ctypes_GetTickCount();
  koffi_GetTickCount();
}

// Benchmark ctypes
start = performance.now();
for (let i = 0; i < apiIterations; i++) {
  ctypes_GetTickCount();
}
ctypes_time = performance.now() - start;

// Benchmark koffi
start = performance.now();
for (let i = 0; i < apiIterations; i++) {
  koffi_GetTickCount();
}
koffi_time = performance.now() - start;

console.log(`  Iterations: ${apiIterations.toLocaleString()}`);
console.log(`  node-ctypes: ${ctypes_time.toFixed(2)}ms (${(apiIterations / ctypes_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  koffi:       ${koffi_time.toFixed(2)}ms (${(apiIterations / koffi_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  Ratio: ${(ctypes_time / koffi_time).toFixed(2)}x ${koffi_time < ctypes_time ? 'slower' : 'faster'}\n`);

// ============================================================================
// Summary
// ============================================================================

console.log("=== Summary ===");
console.log("node-ctypes è un'implementazione FFI completa per Node.js");
console.log("che supporta:");
console.log("  - Chiamate a funzioni C (cdecl/stdcall)");
console.log("  - Callback JavaScript chiamabili da C");
console.log("  - Callback multi-thread (main + external threads)");
console.log("  - Struct complesse");
console.log("  - Gestione memoria manuale");
console.log("");
console.log("koffi è ottimizzato per performance estreme e usa:");
console.log("  - Generazione codice assembly dinamico");
console.log("  - Zero-copy per Buffer");
console.log("  - Ottimizzazioni aggressive");
console.log("");
console.log("Performance: koffi è ~2-4x più veloce per chiamate semplici");
console.log("grazie all'uso di codegen assembly. node-ctypes privilegia");
console.log("compatibilità e semplicità d'uso tramite libffi.");

// Cleanup
ctypes_msvcrt.close();
ctypes_kernel32.close();
