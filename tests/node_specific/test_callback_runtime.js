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
import { FIXTURE } from "../cpython_parity/_support.js";

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

  describe("Owned callback argument snapshots", function () {
    it("retains independent snapshots across pool rotation, reentry and release", async function () {
      using fixture = new ctypes.CDLL(FIXTURE);
      const Point = ctypes.struct({ x: ctypes.c_int32, y: ctypes.c_int32 });
      const invoke = fixture.func("fixture_point_callback", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32]);
      for (const create of [ctypes.callback, ctypes.threadSafeCallback]) {
        const saved = [];
        let callback;
        let nested = false;
        callback = create(
          (value) => {
            saved.push(value);
            assert.ok(Buffer.isBuffer(value._buffer));
            strictEqual(value._buffer.length, 8);
            const result = value.x + value.y;
            if (!nested && value.x === -1) {
              nested = true;
              strictEqual(invoke(callback.pointer, 3, 7), 10);
              nested = false;
              strictEqual(value.x, -1);
            }
            return result;
          },
          ctypes.c_int32,
          [Point],
        );
        try {
          for (let i = 0; i < 1100; i++) strictEqual(invoke(callback.pointer, i, 7), i + 7);
          if (create === ctypes.threadSafeCallback) strictEqual(await invoke.callAsync(callback.pointer, 1100, 7), 1107);
          strictEqual(invoke(callback.pointer, -1, 7), 6);
        } finally {
          callback.release();
        }
        for (let i = 0; i < 1100; i++) {
          strictEqual(saved[i].x, i);
          strictEqual(saved[i].y, 7);
        }
        saved[0].x = 99;
        strictEqual(saved[1].x, 1);
        assert.notStrictEqual(saved[0]._buffer, saved[1]._buffer);
      }
    });

    for (const [name, create] of [
      ["ordinary", ctypes.callback],
      ["thread-safe", ctypes.threadSafeCallback],
    ]) {
      it(`preserves fresh retained array views and direct invocation in ${name} callbacks`, async function () {
        using fixture = new ctypes.CDLL(FIXTURE);
        const Bytes = ctypes.struct({ values: ctypes.array(ctypes.c_uint8, 33) });
        const saved = [];
        const handler = function (value) {
          strictEqual(this, undefined);
          strictEqual(arguments.length, 1);
          const first = value.values;
          const second = value.values;
          assert.notStrictEqual(first, second);
          strictEqual(first.length, 33);
          strictEqual(first[0], 1);
          strictEqual(second[32], 33);
          first[0] = 90;
          strictEqual(second[0], 90);
          saved.push([value, first, second]);
          return BigInt(second[0] + second[32]);
        };
        const unexpected = () => {
          throw new Error("callback call/apply properties must not be consulted");
        };
        Object.defineProperties(handler, { call: { get: unexpected }, apply: { get: unexpected } });
        using callback = create(handler, ctypes.c_int64, [Bytes]);
        const invoke = fixture.func("fixture_bytes_33_callback", ctypes.c_int64, [ctypes.c_void_p]);
        strictEqual(invoke(callback.pointer), 123n);
        if (create === ctypes.threadSafeCallback) strictEqual(await invoke.callAsync(callback.pointer), 123n);
        callback.release();
        const [value, first, second] = saved[0];
        const third = value.values;
        assert.notStrictEqual(first, third);
        second[32] = 5;
        strictEqual(third[32], 5);
        first[0] = 13;
        strictEqual(second[0], 13);
        strictEqual(value.values[0], 13);
        if (saved.length > 1) strictEqual(saved[1][1][0], 90);
      });
    }

    it("preserves definition getter overrides before and after the first callback", function () {
      using fixture = new ctypes.CDLL(FIXTURE);
      const invoke = fixture.func("fixture_hfa_f64_4_callback", ctypes.c_double, [ctypes.c_void_p]);
      for (const create of [ctypes.callback, ctypes.threadSafeCallback]) {
        const HFA = ctypes.struct({ values: ctypes.array(ctypes.c_double, 4) });
        const get = HFA.get;
        let reads = 0;
        HFA.get = function (buffer, field) {
          strictEqual(this, HFA);
          reads++;
          return get.call(this, buffer, field);
        };
        using callback = create((value) => value.values[0] + value.values[3], ctypes.c_double, [HFA]);
        strictEqual(invoke(callback), 3.75);
        strictEqual(reads, 2);
        HFA.get = get;
        strictEqual(invoke(callback), 3.75);
        strictEqual(reads, 2);
        HFA.get = function (buffer, field) {
          strictEqual(this, HFA);
          reads++;
          return get.call(this, buffer, field);
        };
        strictEqual(invoke(callback), 3.75);
        strictEqual(reads, 4);
      }
    });

    it("uses captured allocation intrinsics without consulting later Buffer/ArrayBuffer patches", function () {
      using fixture = new ctypes.CDLL(FIXTURE);
      const Point = ctypes.struct({ x: ctypes.c_int32, y: ctypes.c_int32 });
      using callback = ctypes.callback((value) => value.x + value.y, ctypes.c_int32, [Point]);
      const pointer = callback.pointer;
      const invoke = fixture.func("fixture_point_callback", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32]);
      const from = Buffer.from;
      const alloc = Buffer.alloc;
      const arrayBuffer = globalThis.ArrayBuffer;
      const patched = () => {
        throw new Error("patched buffer allocation must not run");
      };
      try {
        Buffer.from = patched;
        Buffer.alloc = patched;
        globalThis.ArrayBuffer = patched;
        for (let i = 0; i < 1100; i++) strictEqual(invoke(pointer, i, 7), i + 7);
      } finally {
        Buffer.from = from;
        Buffer.alloc = alloc;
        globalThis.ArrayBuffer = arrayBuffer;
      }
    });

    it("validates internal allocator metadata and rejects invalid snapshots without invoking the handler", async function () {
      using fixture = new ctypes.CDLL(FIXTURE);
      const Point = new ctypes.StructType();
      Point.addField("x", ctypes.CType.INT32);
      Point.addField("y", ctypes.CType.INT32);
      const invoke = fixture.func("fixture_point_callback", ctypes.c_int32, [ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32]);
      for (const Constructor of [ctypes.Callback, ctypes.ThreadSafeCallback]) {
        throws(() => new Constructor(() => 0, ctypes.CType.INT32, [Point], "default", [false], undefined, 7), /allocator must be a function/);
        for (const [allocator, message] of [
          [() => ({}), /must return a Buffer/],
          [() => Buffer.alloc(7), /wrong size/],
          [
            () => {
              throw new Error("snapshot allocation failed");
            },
            /snapshot allocation failed/,
          ],
        ]) {
          let calls = 0;
          const callback = new Constructor(
            () => {
              calls++;
              return 10;
            },
            ctypes.CType.INT32,
            [Point],
            "default",
            [false],
            undefined,
            allocator,
          );
          try {
            strictEqual(Constructor === ctypes.ThreadSafeCallback ? await invoke.callAsync(callback.pointer, 3, 7) : invoke(callback.pointer, 3, 7), 0);
            strictEqual(calls, 0);
            assert.match(callback.getLastError(), message);
          } finally {
            callback.release();
          }
        }
      }
    });

    it("keeps over-aligned aggregate snapshots on the native allocator", function () {
      using fixture = new ctypes.CDLL(FIXTURE);
      const Aligned = new ctypes.StructType({ alignment: 16 });
      Aligned.addField("a", ctypes.CType.UINT8);
      Aligned.addField("b", ctypes.CType.UINT32);
      const invoke = fixture.func("fixture_aligned_callback", ctypes.c_uint32, [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_uint32]);
      const callback = new ctypes.Callback(
        (value) => {
          assert.ok(Buffer.isBuffer(value));
          strictEqual(ctypes.addressof(value) % 16n, 0n);
          return value[0] * 1000 + value.readUInt32LE(4);
        },
        ctypes.CType.UINT32,
        [Aligned],
        "default",
        [false],
        undefined,
        () => {
          throw new Error("8-byte pool must not serve over-aligned snapshots");
        },
      );
      try {
        strictEqual(invoke(callback.pointer, 3, 7), 3007);
        strictEqual(callback.getLastError(), null);
      } finally {
        callback.release();
      }
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
