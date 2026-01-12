/**
 * Test errcheck - Python ctypes compatible error handling
 */

import assert from "node:assert";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

describe("errcheck (Python ctypes compatible)", function () {
  let libc;

  before(function () {
    if (process.platform === "win32") {
      libc = new ctypes.CDLL("msvcrt.dll");
    } else {
      libc = new ctypes.CDLL("libc.so.6");
    }
  });

  after(function () {
    if (libc) libc.close();
  });

  describe("Basic errcheck", function () {
    it("should call errcheck after function execution", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      let errcheckCalled = false;
      let receivedResult = null;
      let receivedArgs = null;

      strlen.errcheck = function (result, func, args) {
        errcheckCalled = true;
        receivedResult = result;
        receivedArgs = args;
        return result;
      };

      const result = strlen("hello");

      assert.strictEqual(errcheckCalled, true, "errcheck should be called");
      assert.strictEqual(result, 5n);
      assert.strictEqual(receivedResult, 5n);
      assert(Array.isArray(receivedArgs));
      assert.strictEqual(receivedArgs.length, 1);
    });

    it("should allow errcheck to modify return value", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      strlen.errcheck = function (result, func, args) {
        // Raddoppia il risultato
        return result * 2n;
      };

      const result = strlen("hello");
      assert.strictEqual(result, 10n); // 5 * 2
    });

    it("should allow errcheck to throw exceptions", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      strlen.errcheck = function (result, func, args) {
        if (result > 10n) {
          throw new Error("String too long!");
        }
        return result;
      };

      // Questa dovrebbe passare
      assert.strictEqual(strlen("hello"), 5n);

      // Questa dovrebbe lanciare
      assert.throws(() => {
        strlen("this is a very long string");
      }, /String too long!/);
    });

    it("should allow clearing errcheck with null", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      strlen.errcheck = function (result) {
        return result * 2n;
      };

      assert.strictEqual(strlen("hi"), 4n); // 2 * 2

      // Rimuovi errcheck
      strlen.errcheck = null;

      assert.strictEqual(strlen("hi"), 2n); // Valore originale
    });
  });

  describe("errcheck with errno (POSIX pattern)", function () {
    it("should check errno and throw on -1", function () {
      if (process.platform === "win32") {
        this.skip(); // Test Unix-specific
        return;
      }

      const open = libc.func("open", "int32", ["string", "int32"]);

      // Pattern standard: controlla -1 e lancia con errno
      open.errcheck = function (result, func, args) {
        if (result === -1) {
          const errno = ctypes.get_errno();
          const err = new Error(
            `open("${args[0]}") failed with errno ${errno}`
          );
          err.errno = errno;
          throw err;
        }
        return result;
      };

      // File che non esiste dovrebbe lanciare
      assert.throws(
        () => {
          open("/path/that/does/not/exist/test.txt", 0);
        },
        (err) => {
          return (
            err instanceof Error &&
            err.errno !== undefined &&
            err.message.includes("errno")
          );
        }
      );
    });
  });

  describe("errcheck with WinError (Windows pattern)", function () {
    it("should check GetLastError and throw on failure", function () {
      if (process.platform !== "win32") {
        this.skip();
      }

      const kernel32 = new ctypes.CDLL("kernel32.dll");
      const DeleteFileW = kernel32.func("DeleteFileW", "bool", ["wstring"]);

      // Pattern Windows: controlla FALSE e usa GetLastError
      DeleteFileW.errcheck = function (result, func, args) {
        if (!result) {
          const winerror = ctypes.GetLastError();
          if (winerror !== 0) {
            throw ctypes.WinError(winerror);
          }
        }
        return result;
      };

      // File che non esiste dovrebbe lanciare
      assert.throws(
        () => {
          DeleteFileW("Z:\\file_that_does_not_exist.txt");
        },
        (err) => {
          return err instanceof Error && err.winerror !== undefined;
        }
      );

      kernel32.close();
    });
  });

  describe("errcheck with pointer returns", function () {
    it("should validate pointer returns", function () {
      const malloc = libc.func("malloc", "pointer", ["size_t"]);

      // Valida che malloc non ritorni NULL
      malloc.errcheck = function (result, func, args) {
        if (result === 0n) {
          throw new Error(`malloc(${args[0]}) returned NULL - out of memory`);
        }
        return result;
      };

      // Allocazione normale dovrebbe funzionare
      const ptr = malloc(100);
      assert.notStrictEqual(ptr, 0n);

      // Cleanup
      const free = libc.func("free", "void", ["pointer"]);
      free(ptr);
    });
  });

  describe("errcheck parameters", function () {
    it("should receive correct parameters", function () {
      const abs = libc.func("abs", "int32", ["int32"]);

      let capturedResult = null;
      let capturedFunc = null;
      let capturedArgs = null;

      abs.errcheck = function (result, func, args) {
        capturedResult = result;
        capturedFunc = func;
        capturedArgs = args;
        return result;
      };

      const actualResult = abs(-42);

      assert.strictEqual(actualResult, 42);
      assert.strictEqual(capturedResult, 42);
      assert.strictEqual(typeof capturedFunc, "object"); // È l'oggetto wrapper
      assert(Array.isArray(capturedArgs));
      assert.strictEqual(capturedArgs.length, 1);
      assert.strictEqual(capturedArgs[0], -42);
    });

    it("should work with multiple arguments", function () {
      const memcpy = libc.func("memcpy", "pointer", [
        "pointer",
        "pointer",
        "size_t",
      ]);

      let argCount = 0;

      memcpy.errcheck = function (result, func, args) {
        argCount = args.length;
        return result;
      };

      const src = ctypes.create_string_buffer(10);
      const dst = ctypes.create_string_buffer(10);
      memcpy(dst, src, 10);

      assert.strictEqual(argCount, 3);
    });
  });

  describe("errcheck chaining", function () {
    it("should allow changing errcheck multiple times", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);

      // Prima errcheck
      strlen.errcheck = function (result) {
        return result + 1n;
      };
      assert.strictEqual(strlen("hi"), 3n); // 2 + 1

      // Cambia errcheck
      strlen.errcheck = function (result) {
        return result * 3n;
      };
      assert.strictEqual(strlen("hi"), 6n); // 2 * 3

      // Rimuovi
      strlen.errcheck = null;
      assert.strictEqual(strlen("hi"), 2n); // Originale
    });
  });

  describe("errcheck with variadic functions", function () {
    it("should work with variadic functions", function () {
      if (process.platform === "win32") {
        this.skip(); // sprintf ha comportamento diverso su Windows
        return;
      }

      const sprintf = libc.func("sprintf", "int32", [
        "pointer",
        "string",
        "...",
      ]);

      let callCount = 0;

      sprintf.errcheck = function (result, func, args) {
        callCount++;
        // sprintf ritorna il numero di caratteri scritti
        if (result < 0) {
          throw new Error("sprintf failed");
        }
        return result;
      };

      const buf = ctypes.create_string_buffer(100);
      sprintf(buf, "Number: %d", "int32", 42);

      assert.strictEqual(callCount, 1);
    });
  });

  describe("Python ctypes compatibility", function () {
    it("should match Python ctypes errcheck behavior", function () {
      // In Python ctypes:
      // def errcheck(result, func, args):
      //     if result == -1:
      //         raise OSError(errno)
      //     return result
      //
      // func.errcheck = errcheck

      const testFunc = libc.func("abs", "int32", ["int32"]);

      // Stesso pattern in JavaScript
      testFunc.errcheck = function (result, func, args) {
        if (result === 0) {
          const err = new Error("Test error");
          err.errno = 42;
          throw err;
        }
        return result;
      };

      // Non dovrebbe lanciare
      assert.strictEqual(testFunc(-5), 5);

      // Dovrebbe lanciare
      assert.throws(
        () => {
          testFunc(0);
        },
        (err) => {
          return err.errno === 42;
        }
      );
    });
  });
});
