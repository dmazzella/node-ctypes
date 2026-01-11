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

// Cleanup
ctypes_msvcrt.close();
ctypes_kernel32.close();

// ============================================================================
// Benchmark 5: Raw vs Wrapped call overhead
// ============================================================================

console.log("Benchmark 5: Raw FFI call vs JS wrapper overhead");

const rawLib = new ctypes.Library("msvcrt.dll");
const rawAbs = rawLib.func("abs", "int32", ["int32"]);
const wrappedAbs = new ctypes.CDLL("msvcrt.dll").func("abs", "int32", ["int32"]);

const rawIterations = 1000000;

// Warmup
for (let i = 0; i < 1000; i++) {
  rawAbs.call(-42);
  wrappedAbs(-42);
}

// Benchmark raw
start = performance.now();
for (let i = 0; i < rawIterations; i++) {
  rawAbs.call(-42);
}
let raw_time = performance.now() - start;

// Benchmark wrapped
start = performance.now();
for (let i = 0; i < rawIterations; i++) {
  wrappedAbs(-42);
}
let wrapped_time = performance.now() - start;

console.log(`  Iterations: ${rawIterations.toLocaleString()}`);
console.log(`  raw .call():     ${raw_time.toFixed(2)}ms (${(rawIterations / raw_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  wrapped():       ${wrapped_time.toFixed(2)}ms (${(rawIterations / wrapped_time * 1000).toFixed(0)} calls/sec)`);
console.log(`  Wrapper overhead: ${((wrapped_time / raw_time - 1) * 100).toFixed(1)}%\n`);

rawLib.close();
