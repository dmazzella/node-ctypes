/**
 * Test Functions and Callbacks - Cross Platform
 * Tests function calls, variadic functions, callbacks, errcheck
 */

import assert, { strictEqual, throws } from "node:assert";
import os from "node:os";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

const platform = os.platform();

describe("Functions and Callbacks", function () {
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

  describe("Basic Function Calls", function () {
    it("should call abs() function", function () {
      const abs = libc.func("abs", "int32", ["int32"]);

      assert.strictEqual(abs(-42), 42);
      assert.strictEqual(abs(42), 42);
      assert.strictEqual(abs(0), 0);
    });

    it("should call strlen() function", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      assert.strictEqual(strlen("hello"), 5n);
      assert.strictEqual(strlen(""), 0n);
      assert.strictEqual(strlen("Hello, World!"), 13n);
    });
  });

  describe("Functions with Multiple Arguments", function () {
    it("should call memcpy()", function () {
      const memcpy = libc.func("memcpy", "pointer", [
        "pointer",
        "pointer",
        "size_t",
      ]);

      const src = ctypes.create_string_buffer(10);
      const dst = ctypes.create_string_buffer(10);

      // Fill source with pattern
      for (let i = 0; i < 10; i++) {
        ctypes.writeValue(src, "uint8", i * 10, i);
      }

      // Copy
      memcpy(dst, src, 10);

      // Verify
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(
          ctypes.readValue(dst, "uint8", i),
          ctypes.readValue(src, "uint8", i)
        );
      }
    });
  });

  describe("errcheck Callback", function () {
    it("should call errcheck after function execution", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      let errcheckCalled = false;
      let receivedResult = null;

      strlen.errcheck = function (result, func, args) {
        errcheckCalled = true;
        receivedResult = result;
        return result;
      };

      const result = strlen("hello");

      assert.strictEqual(errcheckCalled, true);
      assert.strictEqual(result, 5n);
      assert.strictEqual(receivedResult, 5n);
    });

    it("should allow errcheck to modify return value", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      strlen.errcheck = function (result, func, args) {
        return result * 2n; // Double the result
      };

      const result = strlen("hello");
      assert.strictEqual(result, 10n); // 5 * 2
    });

    it("should allow errcheck to throw exceptions", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      strlen.errcheck = function (result, func, args) {
        if (result === 0n) {
          throw new Error("String is empty!");
        }
        return result;
      };

      // Non-empty string should work
      assert.strictEqual(strlen("hello"), 5n);

      // Empty string should throw
      assert.throws(() => {
        strlen("");
      }, /String is empty!/);
    });

    it("should allow clearing errcheck with null", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      let callCount = 0;
      strlen.errcheck = function (result, func, args) {
        callCount++;
        return result;
      };

      strlen("hello");
      assert.strictEqual(callCount, 1);

      // Clear errcheck
      strlen.errcheck = null;
      strlen("hello");
      assert.strictEqual(callCount, 1); // Should not increase
    });
  });

  describe("Callbacks", function () {
    it("should create and use callback with qsort", function () {
      if (process.platform !== "win32") {
        this.skip(); // qsort signature differs on Unix
      }

      const qsort = libc.func("qsort", "void", [
        "pointer",
        "size_t",
        "size_t",
        "pointer",
      ]);

      // Create comparison function
      const compare = ctypes.callback(
        (a, b) => {
          const valA = ctypes.readValue(a, "int32");
          const valB = ctypes.readValue(b, "int32");
          return valA - valB;
        },
        "int32",
        ["pointer", "pointer"]
      );

      // Create array to sort
      const arr = ctypes.create_string_buffer(5 * 4);
      const values = [5, 2, 8, 1, 9];
      values.forEach((v, i) => ctypes.writeValue(arr, "int32", v, i * 4));

      // Sort
      qsort(arr, 5, 4, compare.pointer);

      // Verify sorted
      const sorted = [];
      for (let i = 0; i < 5; i++) {
        sorted.push(ctypes.readValue(arr, "int32", i * 4));
      }
      assert.deepStrictEqual(sorted, [1, 2, 5, 8, 9]);

      compare.release();
    });

    it("should handle callback with different signatures", function () {
      // Callback that takes two ints and returns int
      const cb1 = ctypes.callback((a, b) => a + b, "int32", ["int32", "int32"]);
      assert(cb1.pointer !== 0n);
      cb1.release();

      // Callback that takes pointer and returns void
      const cb2 = ctypes.callback((ptr) => {}, "void", ["pointer"]);
      assert(cb2.pointer !== 0n);
      cb2.release();
    });
  });

  describe("Variadic Functions", function () {
    it("should handle functions with variable arguments", function () {
      if (process.platform !== "win32") {
        this.skip(); // Different sprintf behavior on Unix
      }

      // Define sprintf with only fixed parameters
      // node-ctypes auto-detects variadic arguments!
      const sprintf = libc.func("sprintf", "int32", ["pointer", "string"]);

      const buf = ctypes.create_string_buffer(256);

      // Test 1: String formatting
      let written = sprintf(buf, "Hello %s!", "World");
      assert(written > 0, "sprintf should return positive byte count");
      const str1 = buf.toString("utf8", 0, buf.indexOf(0));
      assert.strictEqual(str1, "Hello World!");

      // Test 2: Mixed int and string
      written = sprintf(buf, "Number: %d, String: %s", 42, "test");
      assert(written > 0);
      const str2 = buf.toString("utf8", 0, buf.indexOf(0));
      assert.strictEqual(str2, "Number: 42, String: test");

      // Test 3: Multiple numbers
      written = sprintf(buf, "%d + %d = %d", 10, 20, 30);
      assert(written > 0);
      const str3 = buf.toString("utf8", 0, buf.indexOf(0));
      assert.strictEqual(str3, "10 + 20 = 30");

      // Test 4: Float formatting
      written = sprintf(buf, "Pi is approximately %.2f", 3.14159);
      assert(written > 0);
      const str4 = buf.toString("utf8", 0, buf.indexOf(0));
      assert.strictEqual(str4, "Pi is approximately 3.14");
    });
  });

  describe("Pointer Returns", function () {
    it("should handle functions returning pointers", function () {
      const malloc = libc.func("malloc", ctypes.c_void_p, [ctypes.c_size_t]);
      const free = libc.func("free", "void", [ctypes.c_void_p]);

      const ptr = malloc(1024);
      assert(ptr !== 0n, "malloc should return non-null pointer");

      free(ptr);
    });
  });

  describe("Function Address", function () {
    it("should expose function address", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      assert(typeof strlen.address === "bigint");
      assert(strlen.address !== 0n);
    });
  });
});
