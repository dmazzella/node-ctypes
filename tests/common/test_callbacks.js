/**
 * Test Callbacks - Cross Platform
 * Tests callback functionality with qsort example
 */

import assert, { strictEqual, throws } from "node:assert";
import os from "node:os";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const platform = os.platform();

describe("Callbacks", function () {
  let libc;

  before(function () {
    if (process.platform === "win32") {
      libc = new ctypes.CDLL("msvcrt.dll");
    } else {
      const LIBC = platform === "darwin" ? "libc.dylib" : "libc.so.6";
      libc = new ctypes.CDLL(LIBC);
    }
  });

  after(function () {
    if (libc) libc.close();
  });

  describe("Callback with qsort", function () {
    it("should sort array using callback", function () {
      // Python: arr = (c_int32 * 5)(5, 2, 8, 1, 9)
      const arr = ctypes.array(ctypes.c_int32, 5).create([5, 2, 8, 1, 9]);

      // Python: CMPFUNC = CFUNCTYPE(c_int, POINTER(c_int), POINTER(c_int))
      const compare = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, ctypes.c_int32);
          const bVal = ctypes.readValue(b, ctypes.c_int32);
          return aVal - bVal;
        },
        ctypes.c_int32,
        [ctypes.c_void_p, ctypes.c_void_p],
      );

      // Python: libc.qsort(arr, len(arr), sizeof(c_int), compare)
      let qsort = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
      if (!qsort || qsort.pointer === 0n) {
        qsort = libc.func("_qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
      }

      qsort(ctypes.byref(arr), 5, ctypes.sizeof(ctypes.c_int32), compare.pointer);

      // Python: [arr[i] for i in range(5)]
      const sorted = [];
      for (let i = 0; i < 5; i++) {
        sorted.push(arr[i]);
      }

      assert.deepStrictEqual(sorted, [1, 2, 5, 8, 9]);
    });

    it("should sort array in reverse order", function () {
      // Python: arr = (c_int32 * 4)(3, 1, 4, 2)
      const arr = ctypes.array(ctypes.c_int32, 4).create([3, 1, 4, 2]);

      const compareReverse = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, ctypes.c_int32);
          const bVal = ctypes.readValue(b, ctypes.c_int32);
          return bVal - aVal; // Reverse order
        },
        ctypes.c_int32,
        [ctypes.c_void_p, ctypes.c_void_p],
      );

      const qsort = libc.func("qsort", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
      qsort(ctypes.byref(arr), 4, ctypes.sizeof(ctypes.c_int32), compareReverse.pointer);

      // Python: [arr[i] for i in range(4)]
      const sorted = [];
      for (let i = 0; i < 4; i++) {
        sorted.push(arr[i]);
      }

      assert.deepStrictEqual(sorted, [4, 3, 2, 1]);
    });

    it("should handle callback with different types", function () {
      // Python: arr = (c_float * 3)(3.14, 1.41, 2.71)
      const arr = ctypes.array(ctypes.c_float, 3).create([3.14, 1.41, 2.71]);

      const compareFloat = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, ctypes.c_float);
          const bVal = ctypes.readValue(b, ctypes.c_float);
          if (aVal < bVal) return -1;
          if (aVal > bVal) return 1;
          return 0;
        },
        ctypes.c_int32,
        [ctypes.c_void_p, ctypes.c_void_p],
      );

      const qsort = libc.func("qsort", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
      qsort(ctypes.byref(arr), 3, ctypes.sizeof(ctypes.c_float), compareFloat.pointer);

      // Python: [arr[i] for i in range(3)] → [1.41, 2.71, 3.14]
      assert(Math.abs(arr[0] - 1.41) < 0.001);
      assert(Math.abs(arr[1] - 2.71) < 0.001);
      assert(Math.abs(arr[2] - 3.14) < 0.001);
    });
  });

  describe("Regression: Buffer → c_size_t / c_ssize_t argtype", function () {
    // Regression for a bug where FFIFunction::Call's MarshalPrimitive fast path
    // for CTYPES_SIZE_T / CTYPES_SSIZE_T handled only BigInt/Number, leaving the
    // arg slot uninitialized when a Buffer was passed (e.g. SendMessageW's LPARAM).
    // That leaked stack garbage into the 8-byte slot and crashed Win32 APIs.
    it("c_size_t argtype should accept Buffer (treat as pointer address)", function () {
      const echo = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)((x) => x);
      const call = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)(echo.pointer);

      const buf = Buffer.alloc(16);
      const r1 = call(buf);
      const r2 = call(buf);

      assert.strictEqual(typeof r1, "bigint");
      assert.notStrictEqual(r1, 0n, "Buffer address must be non-zero");
      assert.strictEqual(r1, r2, "Same Buffer must yield same address on repeated calls");

      echo.release();
    });

    it("c_ssize_t argtype should accept Buffer", function () {
      const echo = ctypes.CFUNCTYPE(ctypes.c_ssize_t, ctypes.c_ssize_t)((x) => x);
      const call = ctypes.CFUNCTYPE(ctypes.c_ssize_t, ctypes.c_ssize_t)(echo.pointer);

      const buf = Buffer.alloc(16);
      const r1 = call(buf);
      const r2 = call(buf);

      assert.strictEqual(typeof r1, "bigint");
      assert.notStrictEqual(r1, 0n);
      assert.strictEqual(r1, r2);

      echo.release();
    });

    it("c_size_t argtype should accept null (=> 0)", function () {
      const echo = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)((x) => x);
      const call = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)(echo.pointer);

      assert.strictEqual(call(null), 0n);

      echo.release();
    });
  });

  describe("Callback Properties", function () {
    it("should have pointer property", function () {
      const callback = libc.callback(() => 42, ctypes.c_int32, []);

      assert(typeof callback.pointer === "bigint");
      assert(callback.pointer > 0n);
    });

    it("should have release method", function () {
      const callback = libc.callback(() => 42, ctypes.c_int32, []);

      assert(typeof callback.release === "function");

      // Should not throw
      callback.release();
    });
  });
});
