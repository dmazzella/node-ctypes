/**
 * Original common/test_callbacks.js convenience callback entry points,
 * numeric-pointer extensions, disposal, warnings and thread-safe scheduling.
 * CFUNCTYPE/qsort contracts are mirrored in cpython_parity/calls/test_callbacks.
 */

import assert, { strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
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

      try {
        qsort(ctypes.byref(arr), 5, ctypes.sizeof(ctypes.c_int32), compare);

        // Python: [arr[i] for i in range(5)]
        const sorted = [];
        for (let i = 0; i < 5; i++) {
          sorted.push(arr[i]);
        }

        assert.deepStrictEqual(sorted, [1, 2, 5, 8, 9]);
      } finally {
        compare.release();
      }
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

      const qsort = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
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

      const qsort = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);
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

    it("c_size_t rejects null while explicit zero remains valid", function () {
      const echo = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)((x) => x);
      const call = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_size_t)(echo.pointer);

      assert.throws(() => call(null), ctypes.ArgumentError);
      assert.strictEqual(call(0), 0n);
      assert.strictEqual(call(new ctypes.c_size_t(0)), 0n);

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

  describe("callable CFUNCTYPE runtime interfaces", function () {
    it("preserves pointer, native owner, hook identity and idempotent disposal", function () {
      const callback = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_int32)((value) => value * 2);
      try {
        assert.strictEqual(typeof callback, "function");
        assert.strictEqual(callback.pointer, callback._callback.pointer);
        assert.strictEqual(callback.pointer, callback.address);
        assert.strictEqual(callback._as_parameter_, callback.pointer);
        assert.strictEqual(callback._objects, callback._ffi._objects);
        assert.deepStrictEqual(Object.keys(callback), ["pointer", "release", "_callback"]);
        const input = new ctypes.c_int32(7);
        callback.errcheck = (result, invoked, args) => {
          assert.strictEqual(invoked, callback);
          assert.strictEqual(args[0], input);
          return result + 1;
        };
        assert.strictEqual(callback(input), 15);
        callback.errcheck = null;
        assert.strictEqual(callback(7), 14);
        callback[Symbol.dispose]();
        assert.throws(() => callback(7), /released/);
        assert.throws(() => callback.callAsync(7), /released/);
        assert.throws(() => ctypes.cast(callback, ctypes.c_void_p), /released/);
      } finally {
        callback.release();
      }
    });

    it("refuses release while its callable native trampoline is active", function () {
      let callback;
      let releaseError;
      callback = ctypes.CFUNCTYPE(
        ctypes.c_int32,
        ctypes.c_int32,
      )((value) => {
        try {
          callback.release();
        } catch (error) {
          releaseError = error;
        }
        return value + 1;
      });
      try {
        assert.strictEqual(callback(7), 8);
        assert.match(releaseError?.message ?? "", /calls to it are in progress/);
      } finally {
        callback.release();
      }
    });
  });

  describe("Symbol.dispose (explicit resource management)", function () {
    // Use the top-level wrapper `ctypes.callback()` which exposes a plain
    // object with writable properties — suitable for `using`.
    function makeCb() {
      return ctypes.callback(() => 42, ctypes.c_int32, []);
    }
    function openLibc() {
      if (process.platform === "win32") return new ctypes.CDLL("msvcrt.dll");
      return new ctypes.CDLL(platform === "darwin" ? "libc.dylib" : "libc.so.6");
    }

    it("callback wrapper implements Symbol.dispose", function () {
      const cb = makeCb();
      assert.strictEqual(typeof cb[Symbol.dispose], "function");
      cb[Symbol.dispose](); // idempotent with release()
    });

    it("CDLL implements Symbol.dispose", function () {
      const lib = openLibc();
      assert.strictEqual(typeof lib[Symbol.dispose], "function");
      lib[Symbol.dispose]();
      assert.doesNotThrow(() => lib.close()); // idempotent
    });

    it("`using` releases callback at block exit", function () {
      let released = false;
      {
        const cb = makeCb();
        const orig = cb.release.bind(cb);
        cb.release = () => {
          released = true;
          orig();
        };
        cb[Symbol.dispose] = () => cb.release();
        using _guard = cb;
        assert.strictEqual(released, false);
      }
      assert.strictEqual(released, true, "release should have run on scope exit");
    });

    it("`using` on CDLL closes library at block exit", function () {
      let lib;
      {
        using tmp = openLibc();
        lib = tmp;
      }
      assert.doesNotThrow(() => lib.close());
    });

    it("dispose runs on thrown exception", function () {
      let released = false;
      assert.throws(() => {
        const cb = makeCb();
        const orig = cb.release.bind(cb);
        cb.release = () => {
          released = true;
          orig();
        };
        cb[Symbol.dispose] = () => cb.release();
        using _guard = cb;
        throw new Error("boom");
      }, /boom/);
      assert.strictEqual(released, true, "release runs even when the block throws");
    });
  });

  describe("Exceptions thrown by callbacks", function () {
    it("emit a process warning when no error handler is set", async function () {
      const arr = ctypes.array(ctypes.c_int32, 2).create([2, 1]);
      const compare = libc.callback(
        () => {
          throw new Error("compare exploded");
        },
        ctypes.c_int32,
        [ctypes.c_void_p, ctypes.c_void_p],
      );
      const qsort = libc.func("qsort", ctypes.c_void, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]);

      const warning = new Promise((resolve) => process.once("warning", resolve));
      qsort(ctypes.byref(arr), 2, ctypes.sizeof(ctypes.c_int32), compare.pointer);
      const w = await warning;
      compare.release();

      assert.strictEqual(w.name, "CallbackError");
      assert.match(w.message, /compare exploded/);
    });
  });

  describe("threadSafeCallback ref() / unref()", function () {
    // A child process: does a thread-safe callback keep the event loop alive?
    const runChild = (code, timeout) => spawnSync(process.execPath, ["--input-type=module", "-e", `import { threadSafeCallback, c_int } from "node-ctypes";\n${code}`], { cwd: import.meta.dirname, timeout, encoding: "utf8" });

    it("return the wrapper and throw after release()", function () {
      const cb = ctypes.threadSafeCallback(() => 0, ctypes.c_int, []);
      strictEqual(cb.unref(), cb);
      strictEqual(cb.ref(), cb);
      cb.release();
      throws(() => cb.unref(), /released/);
    });

    it("a referenced callback keeps the process alive, an unreferenced one does not", function () {
      const kept = runChild("threadSafeCallback(() => 0, c_int, []);", 1500);
      strictEqual(kept.signal, "SIGTERM", "the process should still be running");
      const exited = runChild("threadSafeCallback(() => 0, c_int, []).unref(); console.log('exiting');", 10000);
      strictEqual(exited.status, 0, exited.stderr);
      strictEqual(exited.stdout.trim(), "exiting");
    });

    it("delivers calls from a native thread while unreferenced", async function () {
      const received = [];
      let done;
      const finished = new Promise((resolve) => (done = resolve));
      const keepAlive = setTimeout(() => {}, 10000); // the test keeps the event loop alive, not the callback
      const cb = ctypes
        .threadSafeCallback(
          (arg) => {
            received.push(Number(arg));
            done();
            return null;
          },
          ctypes.c_void_p,
          [ctypes.c_void_p],
        )
        .unref();
      try {
        if (process.platform === "win32") {
          const kernel32 = new ctypes.WinDLL("kernel32.dll");
          const CreateThread = kernel32.func("CreateThread", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]);
          const CloseHandle = kernel32.func("CloseHandle", ctypes.c_int, [ctypes.c_void_p]);
          const handle = CreateThread(null, 0, cb.pointer, 42n, 0, null);
          assert.ok(handle, "CreateThread failed");
          await finished;
          CloseHandle(handle);
        } else {
          // glibc < 2.34 (manylinux_2_28) exports pthread_* from libpthread only;
          // newer glibc and musl resolve them from libc through this name too.
          const pthread = platform === "darwin" ? libc : new ctypes.CDLL("libpthread.so.0");
          const pthread_create = pthread.func("pthread_create", ctypes.c_int, [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]);
          const pthread_join = pthread.func("pthread_join", ctypes.c_int, [ctypes.c_void_p, ctypes.c_void_p]);
          const thread = new ctypes.c_void_p();
          strictEqual(pthread_create(ctypes.byref(thread), null, cb.pointer, 42n), 0);
          await finished;
          // The thread returns once the callback has run on the main thread.
          strictEqual(pthread_join(thread.value, null), 0);
        }
        assert.deepStrictEqual(received, [42]);
      } finally {
        clearTimeout(keepAlive);
        cb.release();
      }
    });
  });
});
