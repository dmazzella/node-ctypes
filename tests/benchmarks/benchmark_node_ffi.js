// Benchmark: node-ctypes vs node:ffi (Node.js >= 26 built-in FFI)
// Run: node --experimental-ffi tests/benchmarks/benchmark_node_ffi.js
//
// node:ffi is experimental and gated behind the --experimental-ffi flag.
// Docs: https://nodejs.org/api/ffi.html

import * as ctypes from "node-ctypes";
import os from "node:os";

const isWindows = os.platform() === "win32";
const platform = os.platform();

// node:ffi is loaded dynamically so we can print a friendly error when the
// --experimental-ffi flag is missing or the runtime predates Node 26.
let ffiMod;
try {
  ffiMod = await import("node:ffi");
} catch (err) {
  console.error("╔════════════════════════════════════════════════════════════════╗");
  console.error("║  node:ffi non disponibile.                                     ║");
  console.error("╚════════════════════════════════════════════════════════════════╝");
  console.error(`\n  ${err.message}\n`);
  console.error("  Richiede Node.js >= 26 ed esecuzione con il flag:");
  console.error("    node --experimental-ffi tests/benchmarks/benchmark_node_ffi.js\n");
  process.exit(1);
}
// Core modules expose named exports on the namespace; fall back to default.
const ffi = ffiMod.DynamicLibrary ? ffiMod : ffiMod.default;

// Platform-specific library names
const LIBC = isWindows ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
const SYSTEM_LIB = isWindows ? "kernel32.dll" : null;

// size_t / pointer-sized integer type for node:ffi (64-bit -> u64, else u32).
const is64bit = ["arm64", "x64", "ppc64", "s390x", "loong64", "riscv64"].includes(process.arch);
const FFI_SIZE_T = is64bit ? "u64" : "u32";
const sizeArg = (n) => (is64bit ? BigInt(n) : n);

// Calling a variadic function through a fixed signature is only ABI-safe where
// variadic and named arguments share the same calling convention. It is NOT
// safe on arm64 macOS (variadic args are passed on the stack), so we skip it
// there to avoid corrupting memory or crashing the process.
const ffiVariadicSafe = !(platform === "darwin" && process.arch === "arm64");

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║         FFI Performance Benchmark: node-ctypes vs node:ffi     ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

const results = [];

const formatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function benchmark(name, ctypesTime, ffiTime, iterations) {
  if (ffiTime == null) {
    results.push({ name, skipped: true });
    console.log(`  Iterations: ${iterations.toLocaleString()}`);
    console.log(`  node-ctypes: ${ctypesTime.toFixed(2)}ms (${formatter.format((iterations / ctypesTime) * 1000)} ops/sec)`);
    console.log(`  node:ffi:    N/A (non supportato)\n`);
    return;
  }

  const ratio = ctypesTime / ffiTime;
  const faster = ratio < 1 ? "node-ctypes" : "node:ffi";
  const diff = ratio < 1 ? (1 / ratio).toFixed(2) : ratio.toFixed(2);

  results.push({
    name,
    ctypes: ctypesTime,
    ffi: ffiTime,
    ratio,
    winner: faster,
  });

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(`  node-ctypes: ${ctypesTime.toFixed(2)}ms (${formatter.format((iterations / ctypesTime) * 1000)} ops/sec)`);
  console.log(`  node:ffi:    ${ffiTime.toFixed(2)}ms (${formatter.format((iterations / ffiTime) * 1000)} ops/sec)`);
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

const ffi_libc = new ffi.DynamicLibrary(LIBC);
const ffi_system = SYSTEM_LIB ? new ffi.DynamicLibrary(SYSTEM_LIB) : null;

// ============================================================================
// Benchmark 1: Simple function calls (abs)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 1: Simple int32 function - abs(-42)                   │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_abs = ctypes_libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);
  const ffi_abs = ffi_libc.getFunction("abs", { return: "i32", arguments: ["i32"] });

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 10000; i++) {
    ctypes_abs(-42);
    ffi_abs(-42);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_abs(-42);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_abs(-42);
  }
  const ffi_time = performance.now() - start;

  benchmark("abs(int32)", ctypes_time, ffi_time, iterations);
}

// ============================================================================
// Benchmark 2: String functions (strlen)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 2: String parameter - strlen(str)                     │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_strlen = ctypes_libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
  const ffi_strlen = ffi_libc.getFunction("strlen", { return: FFI_SIZE_T, arguments: ["string"] });

  const testString = "Hello, World! This is a test string for benchmarking.";
  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_strlen(testString);
    ffi_strlen(testString);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_strlen(testString);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_strlen(testString);
  }
  const ffi_time = performance.now() - start;

  benchmark("strlen(string)", ctypes_time, ffi_time, iterations);
}

// ============================================================================
// Benchmark 3: Floating point (sqrt)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 3: Floating point - sqrt(double)                      │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_sqrt = ctypes_libc.func("sqrt", ctypes.c_double, [ctypes.c_double]);
  const ffi_sqrt = ffi_libc.getFunction("sqrt", { return: "f64", arguments: ["f64"] });

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_sqrt(144.0);
    ffi_sqrt(144.0);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_sqrt(144.0);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_sqrt(144.0);
  }
  const ffi_time = performance.now() - start;

  benchmark("sqrt(double)", ctypes_time, ffi_time, iterations);
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
  const ffi_GetTickCount = ffi_system.getFunction("GetTickCount", { return: "u32", arguments: [] });

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_GetTickCount();
    ffi_GetTickCount();
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_GetTickCount();
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_GetTickCount();
  }
  const ffi_time = performance.now() - start;

  benchmark("GetTickCount()", ctypes_time, ffi_time, iterations);
} else {
  const ctypes_time_fn = ctypes_libc.func("time", ctypes.c_int64, [ctypes.c_void_p]);
  const ffi_time_fn = ffi_libc.getFunction("time", { return: "i64", arguments: ["pointer"] });

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_time_fn(null);
    ffi_time_fn(null);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_time_fn(null);
  }
  const ctypes_elapsed = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_time_fn(null);
  }
  const ffi_elapsed = performance.now() - start;

  benchmark("time(NULL)", ctypes_elapsed, ffi_elapsed, iterations);
}

// ============================================================================
// Benchmark 5: Multiple arguments
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 5: Multiple arguments - memset(ptr, val, size)        │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  const ctypes_memset = ctypes_libc.func("memset", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_size_t]);
  const ffi_memset = ffi_libc.getFunction("memset", { return: "pointer", arguments: ["buffer", "i32", FFI_SIZE_T] });

  const ctypes_buf = ctypes.create_string_buffer(1024);
  const ffi_buf = Buffer.alloc(1024);
  const size = sizeArg(1024);

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_memset(ctypes_buf, 0, 1024);
    ffi_memset(ffi_buf, 0, size);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_memset(ctypes_buf, 0x41, 1024);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_memset(ffi_buf, 0x41, size);
  }
  const ffi_time = performance.now() - start;

  benchmark("memset(ptr,int,size)", ctypes_time, ffi_time, iterations);
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

  const ctypes_buf = ctypes.create_string_buffer(256);
  const iterations = 200_000;

  // Warmup (node-ctypes)
  for (let i = 0; i < 1000; i++) {
    ctypes_sprintf(ctypes_buf, "Number: %d, String: %s", 42, "test");
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    // Auto-variadic: same function handles different arg counts/types
    ctypes_sprintf(ctypes_buf, "Number: %d, String: %s", i, "test");
  }
  const ctypes_time = performance.now() - start;

  // node:ffi has no variadic support: emulate with a fixed signature where the
  // ABI allows it, and verify correctness before timing.
  let ffi_time = null;
  if (ffiVariadicSafe) {
    try {
      const ffi_sprintf = ffi_libc.getFunction("sprintf", {
        return: "i32",
        arguments: ["buffer", "string", "i32", "string"],
      });

      const ffi_buf = Buffer.alloc(256);
      ffi_sprintf(ffi_buf, "Number: %d, String: %s", 42, "test");
      const produced = ffi_buf.toString("utf8", 0, ffi_buf.indexOf(0));
      if (produced !== "Number: 42, String: test") {
        throw new Error(`risultato variadico errato: "${produced}"`);
      }

      // Warmup
      for (let i = 0; i < 1000; i++) {
        ffi_sprintf(ffi_buf, "Number: %d, String: %s", i, "test");
      }

      start = performance.now();
      for (let i = 0; i < iterations; i++) {
        ffi_sprintf(ffi_buf, "Number: %d, String: %s", i, "test");
      }
      ffi_time = performance.now() - start;
    } catch {
      ffi_time = null; // variadic not supported on this ABI
    }
  }

  benchmark("sprintf(variadic)", ctypes_time, ffi_time, iterations);
}

// ============================================================================
// Benchmark 7: Raw memory read (int32 fields)
// ============================================================================

console.log("┌─────────────────────────────────────────────────────────────────┐");
console.log("│ Benchmark 7: Raw memory read - 2x int32                         │");
console.log("└─────────────────────────────────────────────────────────────────┘");

{
  // node:ffi has no struct type; the equivalent low-level operation is reading
  // primitive values from native memory via its getInt32 helper.
  const buf = Buffer.alloc(8);
  buf.writeInt32LE(10, 0);
  buf.writeInt32LE(20, 4);

  const ptr = ffi.getRawPointer(buf);
  const ffi_getInt32 = ffi.getInt32;
  const readValue = ctypes.readValue;
  const c_int32 = ctypes.c_int32;

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    readValue(buf, c_int32, 0);
    ffi_getInt32(ptr, 0);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = readValue(buf, c_int32, 0);
    const y = readValue(buf, c_int32, 4);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = ffi_getInt32(ptr, 0);
    const y = ffi_getInt32(ptr, 4);
  }
  const ffi_time = performance.now() - start;

  benchmark("memory read (2x int32)", ctypes_time, ffi_time, iterations);

  // Keep buf referenced so its backing store stays valid for `ptr`.
  void buf;
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
let ffiWins = 0;

for (const r of results) {
  if (r.skipped) {
    console.log(`║ - ${r.name.padEnd(25)} ${"N/A (non supportato)".padStart(23)}           ║`);
    continue;
  }
  const status = r.ratio < 1 ? "✓" : "✗";
  const diff = r.ratio < 1 ? (1 / r.ratio).toFixed(2) + "x faster" : r.ratio.toFixed(2) + "x slower";
  console.log(`║ ${status} ${r.name.padEnd(25)} ${diff.padStart(23)} vs ffi    ║`);
  if (r.ratio < 1) ctypesWins++;
  else ffiWins++;
}

console.log("╠════════════════════════════════════════════════════════════════╣");

const compared = results.filter((r) => !r.skipped);
const avgRatio = compared.reduce((sum, r) => sum + r.ratio, 0) / (compared.length || 1);
console.log(`║ Average ratio: ${avgRatio.toFixed(2)}x ${avgRatio < 1 ? "(node-ctypes faster)" : "(node:ffi faster)"}`.padEnd(65) + "║");
console.log(`║ Wins: node-ctypes ${ctypesWins}, node:ffi ${ffiWins}`.padEnd(65) + "║");
console.log("╚════════════════════════════════════════════════════════════════╝");

// Cleanup
ctypes_libc.close();
if (ctypes_system) ctypes_system.close();
ffi_libc.close();
if (ffi_system) ffi_system.close();
