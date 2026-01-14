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
      // Create array of integers using create_string_buffer like the working test
      const arr = ctypes.create_string_buffer(5 * 4);
      const values = [5, 2, 8, 1, 9];
      values.forEach((v, i) => ctypes.writeValue(arr, "int32", v, i * 4));

      // Create comparison callback
      const compare = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, "int32");
          const bVal = ctypes.readValue(b, "int32");
          return aVal - bVal;
        },
        "int32",
        ["pointer", "pointer"]
      );

      // Get qsort function
      let qsort = libc.func("qsort", "void", [
        "pointer",
        "size_t",
        "size_t",
        "pointer",
      ]);
      if (!qsort || qsort.pointer === 0n) {
        qsort = libc.func("_qsort", "void", [
          "pointer",
          "size_t",
          "size_t",
          "pointer",
        ]);
      }

      // Sort the array
      qsort(arr, 5, 4, compare.pointer);

      // Verify sorted order
      const sorted = [];
      for (let i = 0; i < 5; i++) {
        sorted.push(ctypes.readValue(arr, "int32", i * 4));
      }

      assert.deepStrictEqual(sorted, [1, 2, 5, 8, 9]);
    });

    it("should sort array in reverse order", function () {
      // Create array of integers using create_string_buffer
      const arr = ctypes.create_string_buffer(4 * 4);
      const values = [3, 1, 4, 2];
      values.forEach((v, i) => ctypes.writeValue(arr, "int32", v, i * 4));

      // Create reverse comparison callback
      const compareReverse = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, "int32");
          const bVal = ctypes.readValue(b, "int32");
          return bVal - aVal; // Reverse order
        },
        "int32",
        ["pointer", "pointer"]
      );

      // Get qsort function
      const qsort = libc.func("qsort", "void", [
        "pointer",
        "size_t",
        "size_t",
        "pointer",
      ]);

      // Sort the array in reverse
      qsort(arr, 4, 4, compareReverse.pointer);

      // Verify reverse sorted order
      const sorted = [];
      for (let i = 0; i < 4; i++) {
        sorted.push(ctypes.readValue(arr, "int32", i * 4));
      }

      assert.deepStrictEqual(sorted, [4, 3, 2, 1]);
    });

    it("should handle callback with different types", function () {
      // Test callback with float comparison
      const arr = ctypes.create_string_buffer(3 * 4);
      const values = [3.14, 1.41, 2.71];
      values.forEach((v, i) => ctypes.writeValue(arr, "float", v, i * 4));

      const compareFloat = libc.callback(
        (a, b) => {
          const aVal = ctypes.readValue(a, "float");
          const bVal = ctypes.readValue(b, "float");
          if (aVal < bVal) return -1;
          if (aVal > bVal) return 1;
          return 0;
        },
        "int32",
        ["pointer", "pointer"]
      );

      const qsort = libc.func("qsort", "void", [
        "pointer",
        "size_t",
        "size_t",
        "pointer",
      ]);
      qsort(arr, 3, 4, compareFloat.pointer);

      const sorted = [];
      for (let i = 0; i < 3; i++) {
        sorted.push(ctypes.readValue(arr, "float", i * 4));
      }

      // Should be sorted: [1.41, 2.71, 3.14]
      assert(Math.abs(sorted[0] - 1.41) < 0.001);
      assert(Math.abs(sorted[1] - 2.71) < 0.001);
      assert(Math.abs(sorted[2] - 3.14) < 0.001);
    });
  });

  describe("Callback Properties", function () {
    it("should have pointer property", function () {
      const callback = libc.callback(() => 42, "int32", []);

      assert(typeof callback.pointer === "bigint");
      assert(callback.pointer > 0n);
    });

    it("should have release method", function () {
      const callback = libc.callback(() => 42, "int32", []);

      assert(typeof callback.release === "function");

      // Should not throw
      callback.release();
    });
  });
});
