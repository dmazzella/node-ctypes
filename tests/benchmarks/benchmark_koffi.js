// Benchmark: node-ctypes vs koffi
// Run: node tests/benchmarks/benchmark_koffi.js

import * as ctypes from "node-ctypes";
import pkg from "koffi";
import os from "os";
const { load } = pkg;

const isWindows = os.platform() === "win32";
const platform = os.platform();

// Platform-specific library names
const LIBC = isWindows ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
const SYSTEM_LIB = isWindows ? "kernel32.dll" : null;

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║           FFI Performance Benchmark: node-ctypes vs koffi      ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

const results = [];

const formatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function benchmark(name, ctypesTime, koffiTime, iterations) {
  const ratio = ctypesTime / koffiTime;
  const faster = ratio < 1 ? "node-ctypes" : "koffi";
  const diff = ratio < 1 ? (1 / ratio).toFixed(2) : ratio.toFixed(2);

  results.push({
    name,
    ctypes: ctypesTime,
    koffi: koffiTime,
    ratio,
    winner: faster,
  });

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(`  node-ctypes: ${ctypesTime.toFixed(2)}ms (${formatter.format((iterations / ctypesTime) * 1000)} ops/sec)`);
  console.log(`  koffi:       ${koffiTime.toFixed(2)}ms (${formatter.format((iterations / koffiTime) * 1000)} ops/sec)`);
  console.log(`  Winner: ${faster} (${diff}x faster)\n`);
}

function benchmark_internal(name, time1, time2, label1, label2, iterations) {
  const ratio = time1 / time2;
  const faster = ratio < 1 ? label1 : label2;
  const diff = ratio < 1 ? (1 / ratio).toFixed(2) : ratio.toFixed(2);

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(`  ${label1}: ${time1.toFixed(2)}ms (${formatter.format((iterations / time1) * 1000)} ops/sec)`);
  console.log(`  ${label2}: ${time2.toFixed(2)}ms (${formatter.format((iterations / time2) * 1000)} ops/sec)`);
  console.log(`  Winner: ${faster} (${diff}x faster)\n`);
}

// ============================================================================
// Setup
// ============================================================================

const ctypes_libc = new ctypes.CDLL(LIBC);
const ctypes_system = SYSTEM_LIB ? new ctypes.CDLL(SYSTEM_LIB) : null;

const koffi_libc = load(LIBC);
const koffi_system = SYSTEM_LIB ? load(SYSTEM_LIB) : null;

// ============================================================================
// Benchmark 1: Simple function calls (abs)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 1: Simple int32 function - abs(-42)                   │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_abs = ctypes_libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
  const koffi_abs = koffi_libc.func("int abs(int)");

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 10000; i++) {
    ctypes_abs(-42);
    koffi_abs(-42);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_abs(-42);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_abs(-42);
  }
  const koffi_time = performance.now() - start;

  benchmark("abs(int32)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 2: String functions (strlen)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 2: String parameter - strlen(str)                     │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_strlen = ctypes_libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
  const koffi_strlen = koffi_libc.func("size_t strlen(const char*)");

  const testString = "Hello, World! This is a test string for benchmarking.";
  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_strlen(testString);
    koffi_strlen(testString);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_strlen(testString);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_strlen(testString);
  }
  const koffi_time = performance.now() - start;

  benchmark("strlen(string)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 3: Floating point (sqrt)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 3: Floating point - sqrt(double)                      │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_sqrt = ctypes_libc.func("sqrt", ctypes.c_double, [ctypes.c_double]);
  const koffi_sqrt = koffi_libc.func("double sqrt(double)");

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_sqrt(144.0);
    koffi_sqrt(144.0);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_sqrt(144.0);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_sqrt(144.0);
  }
  const koffi_time = performance.now() - start;

  benchmark("sqrt(double)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 4: No-argument function (GetTickCount/time)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
if (isWindows) {
  console.log("│ Benchmark 4: No arguments - GetTickCount()                      │");
} else {
  console.log("│ Benchmark 4: No arguments - time(NULL)                          │");
}
console.log("└─────────────────────────────────────────────────────────────────┘");

if (isWindows) {
  const ctypes_GetTickCount = ctypes_system.func("GetTickCount", ctypes.c_uint32, []);
  const koffi_GetTickCount = koffi_system.func("unsigned long GetTickCount()");

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_GetTickCount();
    koffi_GetTickCount();
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_GetTickCount();
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_GetTickCount();
  }
  const koffi_time = performance.now() - start;

  benchmark("GetTickCount()", ctypes_time, koffi_time, iterations);
} else {
  const ctypes_time = ctypes_libc.func("time", ctypes.c_int64, [ctypes.c_void_p]);
  const koffi_time = koffi_libc.func("long time(void*)");

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_time(null);
    koffi_time(null);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_time(null);
  }
  const ctypes_elapsed = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_time(null);
  }
  const koffi_elapsed = performance.now() - start;

  benchmark("time(NULL)", ctypes_elapsed, koffi_elapsed, iterations);
}

// ============================================================================
// Benchmark 5: Multiple arguments
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 5: Multiple arguments - memset(ptr, val, size)        │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_memset = ctypes_libc.func("memset", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_size_t]);
  const koffi_memset = koffi_libc.func("void* memset(void*, int, size_t)");

  const ctypes_buf = ctypes.create_string_buffer(1024);
  const koffi_buf = Buffer.alloc(1024);

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_memset(ctypes_buf, 0, 1024);
    koffi_memset(koffi_buf, 0, 1024);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_memset(ctypes_buf, 0x41, 1024);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    koffi_memset(koffi_buf, 0x41, 1024);
  }
  const koffi_time = performance.now() - start;

  benchmark("memset(ptr,int,size)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 6: Variadic function (sprintf)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 6: Variadic function - sprintf(buf, fmt, ...)         │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  // node-ctypes: variadic args auto-detected
  const ctypes_sprintf = ctypes_libc.func("sprintf", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_char_p]);

  // koffi: variadic args must be declared explicitly in signature
  const koffi_sprintf = koffi_libc.func("int sprintf(char *, const char *, ...)");

  const ctypes_buf = ctypes.create_string_buffer(256);
  const koffi_buf = Buffer.alloc(256);

  const iterations = 200_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_sprintf(ctypes_buf, "Number: %d, String: %s", 42, "test");
    koffi_sprintf(koffi_buf, "Number: %d, String: %s", "int", 42, "str", "test");
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Auto-variadic: same function handles different arg counts/types
    ctypes_sprintf(ctypes_buf, "Number: %d, String: %s", i, "test");
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // koffi: must match pre-defined signature exactly
    koffi_sprintf(koffi_buf, "Number: %d, String: %s", "int", i, "str", "test");
  }
  const koffi_time = performance.now() - start;

  benchmark("sprintf(variadic)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 7: Struct operations
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 7: Struct read/write                                  │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  // Define struct in node-ctypes
  const Point_ctypes = ctypes.struct({
    x: ctypes.c_int32,
    y: ctypes.c_int32,
  });

  // Define struct in koffi
  const Point_koffi = pkg.struct("Point", {
    x: "int",
    y: "int",
  });

  const iterations = 500_000;

  // Create instances
  const p_ctypes = Point_ctypes.create({ x: 10, y: 20 });
  const p_koffi = { x: 10, y: 20 };

  // Warmup
  for (let i = 0; i < 1000; i++) {
    p_ctypes.x; // Direct property access (KOFFI-style)
    p_koffi.x;
  }

  // Benchmark ctypes struct read (DIRECT PROPERTY ACCESS)
  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = p_ctypes.x; // Direct access like koffi!
    const y = p_ctypes.y;
  }
  const ctypes_time = performance.now() - start;

  // Benchmark koffi struct read (koffi uses plain objects, very fast)
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = p_koffi.x;
    const y = p_koffi.y;
  }
  const koffi_time = performance.now() - start;

  benchmark("struct read (2 fields)", ctypes_time, koffi_time, iterations);
}

// ============================================================================
// Benchmark 8: Memory allocation
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 8: Buffer allocation (64 bytes)                       │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const iterations = 200_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes.create_string_buffer(64);
    Buffer.alloc(64);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const buf = ctypes.create_string_buffer(64);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const buf = Buffer.alloc(64);
  }
  const native_time = performance.now() - start;

  benchmark_internal("Buffer allocation (64 bytes)", ctypes_time, native_time, "node-ctypes", "Buffer.alloc", iterations);
  console.log(`  Overhead: ${((ctypes_time / native_time - 1) * 100).toFixed(1)}% vs native\n`);
}

// ============================================================================
// Benchmark 9: Raw vs Wrapped call
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 9: Raw Library.func vs CDLL wrapper                   │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const rawLib = new ctypes.Library(LIBC);
  const rawAbs = rawLib.func("abs", ctypes.CType.INT32, [ctypes.CType.INT32]);

  const wrappedLib = new ctypes.CDLL(LIBC);
  const wrappedAbs = wrappedLib.func("abs", ctypes.c_int32, [ctypes.c_int32]);

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    rawAbs.call(-42);
    wrappedAbs(-42);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    rawAbs.call(-42);
  }
  const raw_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    wrappedAbs(-42);
  }
  const wrapped_time = performance.now() - start;

  benchmark_internal("Raw Library.func vs CDLL wrapper", raw_time, wrapped_time, "Raw .call()", "CDLL wrapper", iterations);
  console.log(`  Wrapper overhead: ${((wrapped_time / raw_time - 1) * 100).toFixed(1)}%\n`);

  rawLib.close();
  wrappedLib.close();
}

// ============================================================================
// Summary
// ============================================================================

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║                          SUMMARY                               ║");
console.log("╠════════════════════════════════════════════════════════════════╣");

let ctypesWins = 0;
let koffiWins = 0;

for (const r of results) {
  const status = r.ratio < 1 ? "✓" : "✗";
  const diff = r.ratio < 1 ? (1 / r.ratio).toFixed(2) + "x faster" : r.ratio.toFixed(2) + "x slower";
  console.log(`║ ${status} ${r.name.padEnd(25)} ${diff.padStart(23)} vs koffi   ║`);
  if (r.ratio < 1) ctypesWins++;
  else koffiWins++;
}

console.log("╠════════════════════════════════════════════════════════════════╣");

const avgRatio = results.reduce((sum, r) => sum + r.ratio, 0) / results.length;
console.log(`║ Average ratio: ${avgRatio.toFixed(2)}x ${avgRatio < 1 ? "(node-ctypes faster)" : "(koffi faster)"}`.padEnd(65) + "║");
console.log(`║ Wins: node-ctypes ${ctypesWins}, koffi ${koffiWins}`.padEnd(65) + "║");
console.log("╚════════════════════════════════════════════════════════════════╝");

// Cleanup
ctypes_libc.close();
if (ctypes_system) ctypes_system.close();
