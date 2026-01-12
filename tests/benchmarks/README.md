# node-ctypes Benchmarks

Benchmarks to compare node-ctypes performance against koffi and identify optimization opportunities.

## Running Benchmarks

```bash
# Main koffi comparison
node tests/benchmarks/benchmark_koffi.js

# Buffer pool benchmark
node tests/benchmarks/buffer_pool.js
```

## Current Optimizations

node-ctypes already implements several performance optimizations:

| Optimization | Description | Status |
|-------------|-------------|--------|
| Function cache | CDLL caches function wrappers to avoid re-creation | ✅ Implemented |
| Lazy errno init | errno functions loaded only when first used | ✅ Implemented |
| Type map (C++) | O(1) string-to-type lookup using unordered_map | ✅ Implemented |
| Minimal wrapper | CDLL.func returns bound function, not wrapper object | ✅ Implemented |
| Native Buffer | Uses Node.js Buffer for automatic GC | ✅ Implemented |

## Potential Future Optimizations

### 1. Buffer Pool (High Impact)

For applications making many small allocations, a buffer pool can significantly reduce GC pressure:

```javascript
import { BufferPool } from './buffer_pool.js';

const pool = new BufferPool();

// Instead of: const buf = ctypes.create_string_buffer(64);
const buf = pool.alloc(64);

// When done:
pool.release(buf);
```

Expected speedup: 2-5x for allocation-heavy workloads.

### 2. Type ID Caching (Medium Impact)

Pass pre-resolved CType objects instead of strings:

```javascript
// Slower - string lookup every call
func("strlen", "size_t", ["string"]);

// Faster - pre-resolved types
func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
```

### 3. Struct Field Indexing (Medium Impact)

For frequently accessed struct fields, cache field offsets:

```javascript
// Current implementation does field lookup by name
const x = Point.get(buf, "x");

// Could optimize with numeric offset
const x = Point.getByOffset(buf, 0); // Direct offset access
```

### 4. JIT-compiled Wrappers (Low Priority)

For extremely hot paths, generate optimized wrapper functions at runtime:

```javascript
// Instead of generic wrapper
const fastAbs = ctypes.compileFunc(lib, "abs", "int32", ["int32"]);
// Returns: (x) => ffi_call_int32_int32(ptr, x)
```

## Benchmark Results Template

Run benchmarks on your machine and record results:

```
Date: YYYY-MM-DD
Node.js: vX.X.X
OS: Windows 11 / Linux / macOS
CPU: Intel Core i7-XXXX / AMD Ryzen X XXXX

| Test              | node-ctypes | koffi    | Ratio |
|-------------------|-------------|----------|-------|
| abs(int32)        | XXX ms      | XXX ms   | X.XX  |
| strlen(string)    | XXX ms      | XXX ms   | X.XX  |
| sqrt(double)      | XXX ms      | XXX ms   | X.XX  |
| GetTickCount()    | XXX ms      | XXX ms   | X.XX  |
| memset(3 args)    | XXX ms      | XXX ms   | X.XX  |
| struct read       | XXX ms      | XXX ms   | X.XX  |
```

## Architecture Notes

### koffi vs node-ctypes

**koffi:**
- Uses custom JIT code generation for maximum performance
- Generates native machine code for each function signature
- Trade-off: Higher complexity, larger binary

**node-ctypes:**
- Uses libffi for portability
- Focus on Python ctypes API compatibility
- Trade-off: Slightly slower but more compatible

### When Performance Matters

For most applications, the FFI call overhead is negligible compared to the actual C function execution. Focus on optimization when:

1. Making millions of FFI calls per second
2. FFI calls are in a tight loop
3. Profiling shows FFI as a bottleneck

For typical use cases (Win32 API, libc functions, plugin systems), both libraries perform well.
