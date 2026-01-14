#!/usr/bin/env python3
"""
Benchmark: Python ctypes performance
Run: python tests/benchmarks/benchmark_python.py
"""

import ctypes
import time
import platform
import os

# Platform detection
is_windows = platform.system() == "Windows"
platform_name = platform.system().lower()

# Platform-specific library names
LIBC = (
    "msvcrt.dll"
    if is_windows
    else ("libc.dylib" if platform_name == "darwin" else "libc.so.6")
)
SYSTEM_LIB = "kernel32.dll" if is_windows else None

print("╔═══════════════════════════════════════════════════════════════╗")
print("║              Python ctypes Performance Benchmark               ║")
print("╚═══════════════════════════════════════════════════════════════╝\n")


def benchmark(name, func, iterations):
    """Benchmark a function and return execution time"""
    # Warmup
    for i in range(min(10000, iterations // 10)):
        func()

    start_time = time.perf_counter()
    for i in range(iterations):
        func()
    end_time = time.perf_counter()

    execution_time = (end_time - start_time) * 1000  # Convert to milliseconds
    ops_per_sec = iterations / (end_time - start_time)

    print(f"  Iterations: {iterations:,}")
    print(f"  Time: {execution_time:.2f}ms ({ops_per_sec:,.0f} ops/sec)")
    print()

    return execution_time


# ============================================================================
# Setup
# ============================================================================

try:
    libc = ctypes.CDLL(LIBC)
    system_lib = ctypes.CDLL(SYSTEM_LIB) if SYSTEM_LIB else None
except OSError as e:
    print(f"Error loading libraries: {e}")
    exit(1)

# ============================================================================
# Benchmark 1: Simple function calls (abs)
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark 1: Simple int32 function - abs(-42)              │")
print("└─────────────────────────────────────────────────────────────┘")

libc.abs.argtypes = [ctypes.c_int32]
libc.abs.restype = ctypes.c_int32


def test_abs():
    return libc.abs(-42)


benchmark("Simple function call (abs)", test_abs, 1_000_000)

# ============================================================================
# Benchmark 2: Function with struct
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark 2: Struct operations                              │")
print("└─────────────────────────────────────────────────────────────┘")


class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]


# Mock function that takes a struct (using memcpy as example)
libc.memcpy.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
libc.memcpy.restype = ctypes.c_void_p


def test_struct():
    p1 = Point(10, 20)
    p2 = Point(0, 0)
    libc.memcpy(ctypes.byref(p2), ctypes.byref(p1), ctypes.sizeof(Point))
    return p2.x + p2.y


benchmark("Struct memcpy operation", test_struct, 500_000)

# ============================================================================
# Benchmark 3: Callback function (qsort)
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark 3: Callback function - qsort                     │")
print("└─────────────────────────────────────────────────────────────┘")

if hasattr(libc, "qsort"):
    # Define callback type
    CMPFUNC = ctypes.CFUNCTYPE(
        ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)
    )

    # Comparison function for ascending order
    @CMPFUNC
    def compare_asc(a, b):
        return a.contents.value - b.contents.value

    # Setup qsort
    libc.qsort.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, CMPFUNC]
    libc.qsort.restype = None

    def test_callback():
        # Create array to sort
        arr = (ctypes.c_int * 100)(*range(99, -1, -1))  # Reverse sorted array
        libc.qsort(arr, len(arr), ctypes.sizeof(ctypes.c_int), compare_asc)
        return arr[0]  # Should be 0

    benchmark("Callback with qsort (100 elements)", test_callback, 50_000)
else:
    print("  qsort not available on this platform, skipping callback benchmark\n")

# ============================================================================
# Benchmark 4: Array operations
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark 4: Array operations                               │")
print("└─────────────────────────────────────────────────────────────┘")


def test_array():
    # Create and manipulate array
    arr = (ctypes.c_double * 1000)()
    for i in range(len(arr)):
        arr[i] = i * 3.14159

    # Sum all elements
    total = sum(arr)
    return int(total)


benchmark("Array creation and summation (1000 doubles)", test_array, 10_000)

# ============================================================================
# Benchmark 5: String operations
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark 5: String operations                              │")
print("└─────────────────────────────────────────────────────────────┘")

# Try different names for strlen function
strlen_func = None
for name in ["strlen", "_strlen"]:
    if hasattr(libc, name):
        strlen_func = getattr(libc, name)
        strlen_func.argtypes = [ctypes.c_char_p]
        strlen_func.restype = ctypes.c_size_t
        break

if strlen_func:

    def test_string():
        test_str = (
            b"Hello, World! This is a test string for benchmarking purposes." * 10
        )
        return strlen_func(test_str)

    benchmark("String length calculation", test_string, 100_000)
else:
    print("  strlen not available, skipping string benchmark\n")

# ============================================================================
# Summary
# ============================================================================

print("┌─────────────────────────────────────────────────────────────┐")
print("│ Benchmark Complete                                          │")
print("└─────────────────────────────────────────────────────────────┘")
print("Python ctypes performance test completed successfully!")
