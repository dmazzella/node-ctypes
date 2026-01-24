/**
 * @file callback.js
 * @module core/callback
 * @description Callback wrapper functions for creating C-callable JavaScript functions.
 *
 * This module provides two types of callbacks for different threading scenarios:
 * 1. **callback()**: Fast, main-thread-only callbacks (e.g., qsort, EnumWindows)
 * 2. **threadSafeCallback()**: Thread-safe callbacks for external threads (e.g., CreateThread)
 *
 * **Python ctypes Compatibility**:
 * Equivalent to Python's `ctypes.CFUNCTYPE` and `ctypes.WINFUNCTYPE`.
 *
 * @example Main-thread callback (fast)
 * ```javascript
 * import { callback, c_int } from 'node-ctypes';
 *
 * // Comparison function for qsort
 * const compareInts = callback(
 *   (a, b) => {
 *     const aVal = a.readInt32LE(0);
 *     const bVal = b.readInt32LE(0);
 *     return aVal - bVal;
 *   },
 *   c_int,      // return type
 *   [c_void_p, c_void_p]  // arg types
 * );
 *
 * // Use callback.pointer to pass to C
 * libc.func('qsort', c_void, [c_void_p, c_size_t, c_size_t, c_void_p])
 *     (arrayBuf, count, sizeof(c_int), compareInts.pointer);
 *
 * // CRITICAL: Release when done to prevent memory leak
 * compareInts.release();
 * ```
 *
 * @example Thread-safe callback (for external threads)
 * ```javascript
 * import { threadSafeCallback, c_int, c_void_p } from 'node-ctypes';
 *
 * // Callback that will be called from a C thread pool
 * const threadWorker = threadSafeCallback(
 *   (dataPtr) => {
 *     console.log('Called from C thread!');
 *     return 0;
 *   },
 *   c_int,
 *   [c_void_p]
 * );
 *
 * // Pass to CreateThread or similar
 * kernel32.func('CreateThread', c_void_p, [...])
 *           (null, 0, threadWorker.pointer, null, 0, null);
 *
 * // Release when done
 * threadWorker.release();
 * ```
 */

import { _toNativeType, _toNativeTypes } from "./types.js";

/**
 * Creates a C-callable callback from a JavaScript function (main-thread only).
 *
 * This callback is optimized for performance with minimal overhead, but it **MUST**
 * only be called from Node.js's main thread. Use this for standard C APIs that
 * invoke callbacks synchronously on the same thread (e.g., qsort, bsearch,
 * EnumWindows, etc.).
 *
 * **When to Use**:
 * - Callbacks invoked by C functions on the same thread (qsort, bsearch, etc.)
 * - Synchronous callbacks in event loops (Windows message processing)
 * - Callbacks that don't involve threading
 *
 * **When NOT to Use**:
 * - Callbacks invoked from external threads (CreateThread, pthread_create)
 * - Asynchronous callbacks from thread pools
 * - Any callback that might be called from a non-Node.js thread
 * → Use `threadSafeCallback()` instead
 *
 * **Python ctypes Compatibility**:
 * Equivalent to Python's `ctypes.CFUNCTYPE(restype, *argtypes)`.
 *
 * **Memory Management**:
 * - Callbacks must be manually released by calling `.release()` when done
 * - Failing to release callbacks will leak native memory
 * - Keep a reference to the callback object while it's in use to prevent GC
 *
 * @param {Function} fn - JavaScript function to wrap
 *   The function will receive converted arguments based on argTypes
 * @param {Function|Object} returnType - Return type (SimpleCData class or CType)
 * @param {Array<Function|Object>} argTypes - Argument types array
 * @param {Object} native - Native module reference (internal use)
 * @returns {Object} Callback wrapper with properties:
 *   - `pointer` (BigInt): Function pointer to pass to C
 *   - `release()`: Release native resources (MUST be called)
 *   - `_callback`: Internal callback object
 *
 * @example Basic callback usage
 * ```javascript
 * import { CDLL, callback, c_int, c_char_p } from 'node-ctypes';
 *
 * const libc = new CDLL(null);
 *
 * // Create callback for qsort comparison
 * const compare = callback(
 *   (aPtr, bPtr) => {
 *     const a = aPtr.readInt32LE(0);
 *     const b = bPtr.readInt32LE(0);
 *     return a - b;
 *   },
 *   c_int,
 *   [c_void_p, c_void_p]
 * );
 *
 * // Sort array of integers
 * const arr = Buffer.from([5, 2, 8, 1].flatMap(n => [n, 0, 0, 0]));
 * const qsort = libc.func('qsort', c_void, [c_void_p, c_size_t, c_size_t, c_void_p]);
 * qsort(arr, 4, 4, compare.pointer);
 *
 * console.log([...arr].filter((_, i) => i % 4 === 0)); // [1, 2, 5, 8]
 *
 * // CRITICAL: Release callback
 * compare.release();
 * ```
 *
 * @example Windows API callback
 * ```javascript
 * import { WinDLL, callback, c_bool, c_void_p } from 'node-ctypes';
 *
 * const user32 = new WinDLL('user32.dll');
 *
 * // EnumWindows callback
 * const windowList = [];
 * const enumProc = callback(
 *   (hwnd, lParam) => {
 *     windowList.push(hwnd);
 *     return 1; // Continue enumeration
 *   },
 *   c_bool,
 *   [c_void_p, c_void_p]
 * );
 *
 * user32.func('EnumWindows', c_bool, [c_void_p, c_void_p])
 *       (enumProc.pointer, 0n);
 *
 * console.log(`Found ${windowList.length} windows`);
 * enumProc.release();
 * ```
 *
 * @throws {Error} If callback creation fails or type conversion fails
 * @see {@link threadSafeCallback} for thread-safe callbacks
 */
export function callback(fn, returnType, argTypes = [], native) {
  const cb = new native.Callback(fn, _toNativeType(returnType, native), _toNativeTypes(argTypes, native));

  return {
    get pointer() {
      return cb.pointer;
    },
    release() {
      cb.release();
    },
    _callback: cb,
  };
}

/**
 * Creates a thread-safe C-callable callback from a JavaScript function.
 *
 * This callback can be invoked from **any thread**, including threads created
 * by C code (e.g., CreateThread, pthread_create, thread pools). It uses Node.js's
 * thread-safe function mechanism to safely execute JavaScript on the main thread.
 *
 * **Performance Trade-off**:
 * - Thread-safe callbacks have higher overhead than regular callbacks
 * - They involve cross-thread synchronization and event loop scheduling
 * - Use regular `callback()` if you know the callback is main-thread-only
 *
 * **When to Use**:
 * - Callbacks invoked from C threads (CreateThread, pthread_create)
 * - Asynchronous callbacks from thread pools
 * - Any callback where you're unsure about the calling thread
 *
 * **When NOT to Use**:
 * - Main-thread-only callbacks (qsort, bsearch, etc.)
 * → Use `callback()` instead for better performance
 *
 * **Python ctypes Compatibility**:
 * Python's ctypes doesn't distinguish between thread-safe and regular callbacks.
 * This is a Node.js-specific requirement due to V8's threading model.
 *
 * **Memory Management**:
 * - Must be manually released by calling `.release()` when done
 * - Failing to release will leak native memory
 * - Keep a reference while in use to prevent GC
 *
 * @param {Function} fn - JavaScript function to wrap
 *   The function will be executed on Node.js's main thread regardless of
 *   which thread invokes the callback
 * @param {Function|Object} returnType - Return type (SimpleCData class or CType)
 * @param {Array<Function|Object>} argTypes - Argument types array
 * @param {Object} native - Native module reference (internal use)
 * @returns {Object} Callback wrapper with properties:
 *   - `pointer` (BigInt): Function pointer to pass to C
 *   - `release()`: Release native resources (MUST be called)
 *   - `_callback`: Internal callback object
 *
 * @example Windows thread callback
 * ```javascript
 * import { WinDLL, threadSafeCallback, c_int, c_void_p } from 'node-ctypes';
 *
 * const kernel32 = new WinDLL('kernel32.dll');
 *
 * // Thread function that will run in a C thread
 * const threadFunc = threadSafeCallback(
 *   (param) => {
 *     console.log('Running in C thread, but executed on Node.js main thread');
 *     return 0;
 *   },
 *   c_int,
 *   [c_void_p]
 * );
 *
 * // Create Windows thread
 * const CreateThread = kernel32.func('CreateThread', c_void_p,
 *   [c_void_p, c_size_t, c_void_p, c_void_p, c_uint32, c_void_p]);
 *
 * const threadHandle = CreateThread(null, 0, threadFunc.pointer, null, 0, null);
 *
 * // Wait for thread to finish...
 * // Then release callback
 * threadFunc.release();
 * ```
 *
 * @example POSIX thread callback
 * ```javascript
 * import { CDLL, threadSafeCallback, c_void_p } from 'node-ctypes';
 *
 * const pthread = new CDLL('libpthread.so.0');
 *
 * const threadFunc = threadSafeCallback(
 *   (arg) => {
 *     console.log('POSIX thread callback');
 *     return null;
 *   },
 *   c_void_p,
 *   [c_void_p]
 * );
 *
 * const pthread_create = pthread.func('pthread_create', c_int,
 *   [c_void_p, c_void_p, c_void_p, c_void_p]);
 *
 * const tidBuf = Buffer.alloc(8);
 * pthread_create(tidBuf, null, threadFunc.pointer, null);
 *
 * // Wait for thread...
 * threadFunc.release();
 * ```
 *
 * @throws {Error} If callback creation fails or type conversion fails
 * @see {@link callback} for main-thread-only callbacks
 */
export function threadSafeCallback(fn, returnType, argTypes = [], native) {
  const cb = new native.ThreadSafeCallback(fn, _toNativeType(returnType, native), _toNativeTypes(argTypes, native));

  return {
    get pointer() {
      return cb.pointer;
    },
    release() {
      cb.release();
    },
    _callback: cb,
  };
}
