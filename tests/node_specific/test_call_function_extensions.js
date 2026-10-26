/**
 * Original common/test_functions.js entry-point regressions: CDLL.func(),
 * callback(), symbol(), callAsync(), string-address extensions and JS probes.
 * Shared ctypes contracts live in cpython_parity/calls/test_functions.{py,js}.
 */

import assert from "node:assert";
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
      const abs = libc.func("abs", ctypes.c_int32, [ctypes.c_int32]);

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
      const memcpy = libc.func("memcpy", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]);

      const src = ctypes.create_string_buffer(10);
      const dst = ctypes.create_string_buffer(10);

      // Fill source with pattern
      for (let i = 0; i < 10; i++) {
        ctypes.writeValue(src, ctypes.c_uint8, i * 10, i);
      }

      // Copy
      memcpy(dst, src, 10);

      // Verify
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(ctypes.readValue(dst, ctypes.c_uint8, i), ctypes.readValue(src, ctypes.c_uint8, i));
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

  describe("Callbacks", { skip: process.platform !== "win32" }, function () {
    it("should create and use callback with qsort", function () {
      const qsort = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);

      // Python: CMPFUNC = CFUNCTYPE(c_int, POINTER(c_int), POINTER(c_int))
      const compare = ctypes.callback(
        (a, b) => {
          const valA = ctypes.readValue(a, ctypes.c_int32);
          const valB = ctypes.readValue(b, ctypes.c_int32);
          return valA - valB;
        },
        ctypes.c_int32,
        [ctypes.c_void_p, ctypes.c_void_p],
      );

      // Python: arr = (c_int * 5)(5, 2, 8, 1, 9)
      const arr = ctypes.array(ctypes.c_int32, 5).create([5, 2, 8, 1, 9]);

      // Python: libc.qsort(arr, len(arr), sizeof(c_int), compare)
      qsort(ctypes.byref(arr), 5, ctypes.sizeof(ctypes.c_int32), compare.pointer);

      // Python: [arr[i] for i in range(5)]
      const sorted = [];
      for (let i = 0; i < 5; i++) {
        sorted.push(arr[i]);
      }
      assert.deepStrictEqual(sorted, [1, 2, 5, 8, 9]);

      compare.release();
    });

    it("should handle callback with different signatures", function () {
      // Callback that takes two ints and returns int
      const cb1 = ctypes.callback((a, b) => a + b, ctypes.c_int32, [ctypes.c_int32, ctypes.c_int32]);
      assert(cb1.pointer !== 0n);
      cb1.release();

      // Callback that takes pointer and returns void
      const cb2 = ctypes.callback((ptr) => {}, ctypes.c_void, [ctypes.c_void_p]);
      assert(cb2.pointer !== 0n);
      cb2.release();
    });
  });

  describe("Variadic Functions", { skip: process.platform !== "win32" }, function () {
    it("should handle functions with variable arguments", function () {
      // Define sprintf with only fixed parameters
      // node-ctypes auto-detects variadic arguments!
      const sprintf = libc.func("sprintf", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_char_p]);

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
      const free = libc.func("free", ctypes.c_void, [ctypes.c_void_p]);

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

  describe("Function async", function () {
    it("should call function asynchronously", async function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      const result = await strlen.callAsync("hello");
      assert.strictEqual(result, 5n);
    });
  });

  describe("CFUNCTYPE", function () {
    it("should create callable function pointer with CFUNCTYPE", function () {
      const addr = libc.symbol("strlen");
      assert(typeof addr === "bigint" && addr !== 0n, "strlen address obtained");

      const StrlenProto = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_char_p);
      const myStrlen = StrlenProto(addr);
      const len = myStrlen("Hello, World!");
      assert.strictEqual(len, 13n, `strlen("Hello, World!") = ${len}`);
    });
  });

  // Retain the original raw-address regression with CPython's explicit
  // string-pointer cast/constructor rather than the old implicit extension.
  describe("Raw pointer address to c_char_p / c_wchar_p argtype (regression)", function () {
    it("c_char_p rejects numeric addresses and accepts explicit string pointers", function () {
      const buf = Buffer.from("Hello\0", "utf8");
      const addr = ctypes.addressof(buf);
      assert.strictEqual(typeof addr, "bigint");

      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_char_p]);
      for (const address of [addr, Number(addr)]) assert.throws(() => strlen(address), ctypes.ArgumentError);
      assert.throws(() => strlen(new ctypes.c_void_p(addr)), ctypes.ArgumentError);
      assert.strictEqual(strlen(new ctypes.c_char_p(addr)), 5n);
      assert.strictEqual(strlen(ctypes.cast(addr, ctypes.c_char_p)), 5n);

      // Same via CFUNCTYPE-from-address path
      const StrlenProto = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_char_p);
      const fn = StrlenProto(libc.symbol("strlen"));
      for (const address of [addr, Number(addr)]) assert.throws(() => fn(address), ctypes.ArgumentError);
      assert.strictEqual(fn(new ctypes.c_char_p(addr)), 5n);
      assert.strictEqual(fn(ctypes.cast(addr, ctypes.c_char_p)), 5n);
    });

    it("c_wchar_p rejects numeric addresses and accepts explicit wide-string pointers", function () {
      let wcslen;
      try {
        wcslen = libc.func("wcslen", ctypes.c_size_t, [ctypes.c_wchar_p]);
      } catch {
        // wcslen may not be exported on every platform's libc; skip.
        return;
      }

      const wbuf = ctypes.create_unicode_buffer("Hello");
      const addr = ctypes.addressof(wbuf);
      assert.strictEqual(typeof addr, "bigint");
      for (const address of [addr, Number(addr)]) assert.throws(() => wcslen(address), ctypes.ArgumentError);
      assert.throws(() => wcslen(new ctypes.c_void_p(addr)), ctypes.ArgumentError);
      assert.strictEqual(wcslen(new ctypes.c_wchar_p(addr)), 5n);
      assert.strictEqual(wcslen(ctypes.cast(addr, ctypes.c_wchar_p)), 5n);
    });

    it("c_wchar_p / c_char_p struct writers handle null", function () {
      const out = Buffer.alloc(8);
      ctypes.c_wchar_p._writer(out, 0, null);
      assert.strictEqual(out.readBigUInt64LE(0), 0n);
      ctypes.c_char_p._writer(out, 0, null);
      assert.strictEqual(out.readBigUInt64LE(0), 0n);
    });

    // Python-idiomatic pattern: declare argtype as c_void_p when the caller
    // may pass a raw int address. node-ctypes supports this exactly like
    // Python ctypes, so the same code ports cleanly in either direction.
    it("c_void_p argtype accepts raw BigInt address (Python-idiomatic)", function () {
      const strlen = libc.func("strlen", ctypes.c_size_t, [ctypes.c_void_p]);
      const buf = Buffer.from("Hello\0", "utf8");
      assert.strictEqual(strlen(ctypes.addressof(buf)), 5n);
      // Buffer directly also works under c_void_p (same as Python: ctypes
      // auto-extracts the address of a create_string_buffer).
      assert.strictEqual(strlen(buf), 5n);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Library resolution & lazy loaders (Python: ctypes.util.find_library,
// ctypes.cdll / ctypes.windll).
// ────────────────────────────────────────────────────────────────────

describe("find_library", function () {
  const { find_library, CDLL } = ctypes;

  it("returns null for null/empty input", function () {
    assert.strictEqual(find_library(null), null);
    assert.strictEqual(find_library(""), null);
  });

  it("CDLL(find_library('c')) supports explicit close", function () {
    const lib = new CDLL(find_library("c"));
    assert.ok(lib);
    lib.close();
    assert.strictEqual(lib.loaded, false);
  });
});

describe("cdll / windll lazy loaders", function () {
  const { cdll, windll, c_uint32 } = ctypes;

  it("String(cdll), JSON and probes do not load libraries (Python: names with _ are not libraries)", function () {
    assert.match(String(cdll), /LibraryLoader/);
    assert.strictEqual(JSON.stringify({ cdll }), '{"cdll":{}}');
    assert.strictEqual(cdll.constructor, undefined);
    assert.strictEqual(cdll._private, undefined);
    assert.strictEqual("_private" in cdll, false);
  });

  if (process.platform === "win32") {
    it("windll.kernel32.GetTickCount via namespace", function () {
      const gtc = windll.kernel32.func("GetTickCount", c_uint32, []);
      const t = gtc();
      assert.ok(t > 0);
    });
  }
});

describe("paramflags (in/out/default)", { skip: process.platform !== "win32" }, function () {
  // Python: set paramflags at proto binding time → out-params become the
  // function return value (tuple if multiple, single value if one).
  const { WinDLL, WINFUNCTYPE, POINTER, c_uint32, c_void_p, c_int32 } = ctypes;

  it("collects out params into the return tuple", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    const hwnd = user32.func("GetDesktopWindow", c_void_p, [])();
    // Python ctypes parity: single out param → scalar (not array).
    const pid = fn(hwnd);
    assert.ok(pid > 0);
  });

  it("supports named-call form", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    const hwnd = user32.func("GetDesktopWindow", c_void_p, [])();
    const pid = fn({ hWnd: hwnd });
    assert.ok(pid > 0);
  });

  it("uses default values for missing in params", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_int32, c_void_p);
    const show = proto.bind(user32, "IsWindow", [{ dir: "in", name: "hWnd", default: null }]);
    assert.strictEqual(show(), 0);
    assert.strictEqual(show(null), 0);
  });

  it("throws on missing required in param", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    assert.throws(() => fn(), /missing required arg.*hWnd/);
  });

  it("rejects 'out' on non-POINTER argtype", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_uint32);
    assert.throws(() => proto.bind(user32, "IsWindow", [{ dir: "out", name: "x" }]), /not a POINTER/);
  });
});
