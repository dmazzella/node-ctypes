// Benchmark: node-ctypes vs @napi-ffi/ffi-napi
// Run: node tests/benchmarks/benchmark_ffi-napi.js

import * as ctypes from "../../lib/index.js";
import ffi from "@napi-ffi/ffi-napi";
import os from "os";

const isWindows = os.platform() === "win32";
const platform = os.platform();

// Platform-specific library names
const LIBC = isWindows
  ? "msvcrt.dll"
  : platform === "darwin"
  ? "libc.dylib"
  : "libc.so.6";
const SYSTEM_LIB = isWindows ? "kernel32.dll" : null;

console.log(
  "╔════════════════════════════════════════════════════════════════╗"
);
console.log(
  "║        FFI Performance Benchmark: node-ctypes vs ffi-napi      ║"
);
console.log(
  "╚════════════════════════════════════════════════════════════════╝\n"
);

const results = [];

function benchmark(name, ctypesTime, ffiTime, iterations) {
  const ratio = ctypesTime / ffiTime;
  const faster = ratio < 1 ? "node-ctypes" : "ffi-napi";
  const diff = ratio < 1 ? (1 / ratio).toFixed(2) : ratio.toFixed(2);

  results.push({
    name,
    ctypes: ctypesTime,
    ffi: ffiTime,
    ratio,
    winner: faster,
  });

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(
    `  node-ctypes: ${ctypesTime.toFixed(2)}ms (${(
      (iterations / ctypesTime) *
      1000
    ).toFixed(0)} ops/sec)`
  );
  console.log(
    `  ffi-napi:    ${ffiTime.toFixed(2)}ms (${(
      (iterations / ffiTime) *
      1000
    ).toFixed(0)} ops/sec)`
  );
  console.log(`  Winner: ${faster} (${diff}x faster)\n`);
}

// ============================================================================
// Setup
// ============================================================================

const ctypes_libc = new ctypes.CDLL(LIBC);
const ctypes_system = SYSTEM_LIB ? new ctypes.CDLL(SYSTEM_LIB) : null;

const ffi_libc = ffi.Library(LIBC, {
  abs: ["int", ["int"]],
  strlen: ["size_t", ["string"]],
  sqrt: ["double", ["double"]],
  memset: ["pointer", ["pointer", "int", "size_t"]],
  time: ["int64", ["pointer"]],
});

const ffi_system = SYSTEM_LIB
  ? ffi.Library(SYSTEM_LIB, {
      GetTickCount: ["uint32", []],
    })
  : null;

// ============================================================================
// Benchmark 1: Simple function calls (abs)
// ============================================================================

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 1: Simple int32 function - abs(-42)                  │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  const ctypes_abs = ctypes_libc.func("abs", "int32", ["int32"]);
  const ffi_abs = ffi_libc.abs;

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

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 2: String parameter - strlen(str)                    │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  const ctypes_strlen = ctypes_libc.func("strlen", "size_t", ["string"]);
  const ffi_strlen = ffi_libc.strlen;

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

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 3: Floating point - sqrt(double)                     │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  const ctypes_sqrt = ctypes_libc.func("sqrt", "double", ["double"]);
  const ffi_sqrt = ffi_libc.sqrt;

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

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
if (isWindows) {
  console.log(
    "│ Benchmark 4: No arguments - GetTickCount()                     │"
  );
} else {
  console.log(
    "│ Benchmark 4: No arguments - time(NULL)                         │"
  );
}
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

if (isWindows) {
  const ctypes_GetTickCount = ctypes_system.func("GetTickCount", "uint32", []);
  const ffi_GetTickCount = ffi_system.GetTickCount;

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
  const ctypes_time_func = ctypes_libc.func("time", "int64", ["pointer"]);
  const ffi_time_func = ffi_libc.time;

  const iterations = 1_000_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_time_func(null);
    ffi_time_func(null);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_time_func(null);
  }
  const ctypes_elapsed = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_time_func(null);
  }
  const ffi_elapsed = performance.now() - start;

  benchmark("time(NULL)", ctypes_elapsed, ffi_elapsed, iterations);
}

// ============================================================================
// Benchmark 5: Multiple arguments
// ============================================================================

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 5: Multiple arguments - memset(ptr, val, size)       │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  const ctypes_memset = ctypes_libc.func("memset", "pointer", [
    "pointer",
    "int32",
    "size_t",
  ]);
  const ffi_memset = ffi_libc.memset;

  const ctypes_buf = ctypes.create_string_buffer(1024);
  const ffi_buf = Buffer.alloc(1024);

  const iterations = 500_000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    ctypes_memset(ctypes_buf, 0, 1024);
    ffi_memset(ffi_buf, 0, 1024);
  }

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ctypes_memset(ctypes_buf, 0x41, 1024);
  }
  const ctypes_time = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ffi_memset(ffi_buf, 0x41, 1024);
  }
  const ffi_time = performance.now() - start;

  benchmark("memset(ptr,int,size)", ctypes_time, ffi_time, iterations);
}

// ============================================================================
// Benchmark 6: Struct operations
// ============================================================================

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 6: Struct read/write                                 │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  // Define struct in node-ctypes
  const Point_ctypes = ctypes.struct({
    x: "int32",
    y: "int32",
  });

  // Define struct in ffi-napi (using ref-struct)
  // ffi-napi doesn't have built-in struct support like koffi,
  // but we can compare plain Buffer access
  const Point_ffi = Buffer.alloc(8); // 2 * int32

  const iterations = 500_000;

  // Create instances
  const p_ctypes = Point_ctypes.create({ x: 10, y: 20 });

  // Warmup
  for (let i = 0; i < 1000; i++) {
    p_ctypes.x; // Using native property accessors
    Point_ffi.readInt32LE(0);
  }

  // Benchmark ctypes struct read (using native property accessors)
  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = p_ctypes.x;
    const y = p_ctypes.y;
  }
  const ctypes_time = performance.now() - start;

  // Benchmark ffi/Buffer struct read
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = Point_ffi.readInt32LE(0);
    const y = Point_ffi.readInt32LE(4);
  }
  const ffi_time = performance.now() - start;

  benchmark("struct read (2 fields)", ctypes_time, ffi_time, iterations);
}

// ============================================================================
// Benchmark 7: Memory allocation
// ============================================================================

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 7: Buffer allocation (64 bytes)                      │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

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

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(
    `  node-ctypes:  ${ctypes_time.toFixed(2)}ms (${(
      (iterations / ctypes_time) *
      1000
    ).toFixed(0)} allocs/sec)`
  );
  console.log(
    `  Buffer.alloc: ${native_time.toFixed(2)}ms (${(
      (iterations / native_time) *
      1000
    ).toFixed(0)} allocs/sec)`
  );
  console.log(
    `  Overhead: ${((ctypes_time / native_time - 1) * 100).toFixed(
      1
    )}% vs native\n`
  );
}

// ============================================================================
// Benchmark 8: Raw vs Wrapped call
// ============================================================================

console.log(
  "┌─────────────────────────────────────────────────────────────────┐"
);
console.log(
  "│ Benchmark 8: Raw Library.func vs CDLL wrapper                  │"
);
console.log(
  "└─────────────────────────────────────────────────────────────────┘"
);

{
  const rawLib = new ctypes.Library(LIBC);
  const rawAbs = rawLib.func("abs", "int32", ["int32"]);

  const wrappedLib = new ctypes.CDLL(LIBC);
  const wrappedAbs = wrappedLib.func("abs", "int32", ["int32"]);

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

  console.log(`  Iterations: ${iterations.toLocaleString()}`);
  console.log(
    `  Raw .call():  ${raw_time.toFixed(2)}ms (${(
      (iterations / raw_time) *
      1000
    ).toFixed(0)} ops/sec)`
  );
  console.log(
    `  CDLL wrapper: ${wrapped_time.toFixed(2)}ms (${(
      (iterations / wrapped_time) *
      1000
    ).toFixed(0)} ops/sec)`
  );
  console.log(
    `  Wrapper overhead: ${((wrapped_time / raw_time - 1) * 100).toFixed(1)}%\n`
  );

  rawLib.close();
  wrappedLib.close();
}

// ============================================================================
// Summary
// ============================================================================

console.log(
  "╔════════════════════════════════════════════════════════════════╗"
);
console.log(
  "║                          SUMMARY                               ║"
);
console.log(
  "╠════════════════════════════════════════════════════════════════╣"
);

let ctypesWins = 0;
let ffiWins = 0;

for (const r of results) {
  const status = r.ratio < 1 ? "✓" : "✗";
  const diff =
    r.ratio < 1
      ? (1 / r.ratio).toFixed(2) + "x faster"
      : r.ratio.toFixed(2) + "x slower";
  console.log(
    `║ ${status} ${r.name.padEnd(25)} ${diff.padStart(15)} vs ffi-napi ║`
  );
  if (r.ratio < 1) ctypesWins++;
  else ffiWins++;
}

console.log(
  "╠════════════════════════════════════════════════════════════════╣"
);

// Calcola media geometrica per i ratio (più significativa di media aritmetica)
const geometricMean = Math.pow(
  results.reduce((product, r) => product * r.ratio, 1),
  1 / results.length
);

if (geometricMean < 1) {
  console.log(
    `║ Geometric mean: ${(1 / geometricMean).toFixed(
      2
    )}x faster (node-ctypes)`.padEnd(65) + "║"
  );
} else {
  console.log(
    `║ Geometric mean: ${geometricMean.toFixed(
      2
    )}x slower (vs ffi-napi)`.padEnd(65) + "║"
  );
}

console.log(
  `║ Wins: node-ctypes ${ctypesWins}, ffi-napi ${ffiWins}`.padEnd(65) + "║"
);
console.log(
  "╚════════════════════════════════════════════════════════════════╝"
);

// Cleanup
ctypes_libc.close();
if (ctypes_system) ctypes_system.close();

// Force process exit (ffi-napi may keep event loop alive)
process.exit(0);
