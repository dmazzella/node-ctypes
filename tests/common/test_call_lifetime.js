/**
 * Call state and lifetimes:
 * - concurrent calls of a thread-safe callback from native threads each get
 *   their own result;
 * - a function keeps its library loaded; close() is rejected while calls are
 *   in progress and calls after close() throw;
 * - a function called again from a callback during its own call (reentrancy)
 *   does not overwrite the arguments of the outer call.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import * as ctypes from "node-ctypes";

const { CDLL, WinDLL, CFUNCTYPE, addressof, byref, callback, threadSafeCallback, readValue, c_int32, c_uint8, c_uint32, c_size_t, c_void_p, c_char_p } = ctypes;

const platform = process.platform;
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

async function collectGarbage() {
  for (let i = 0; i < 10; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Starts one native thread per value; each thread calls `cb` once with its
// value and its exit code is the result of the callback.
function nativeThreadRunner() {
  if (platform === "win32") {
    const kernel32 = new WinDLL("kernel32.dll");
    const CreateThread = kernel32.func("CreateThread", c_void_p, [c_void_p, c_size_t, c_void_p, c_void_p, c_uint32, c_void_p]);
    const WaitForSingleObject = kernel32.func("WaitForSingleObject", c_uint32, [c_void_p, c_uint32]);
    const GetExitCodeThread = kernel32.func("GetExitCodeThread", c_int32, [c_void_p, c_void_p]);
    const CloseHandle = kernel32.func("CloseHandle", c_int32, [c_void_p]);
    return {
      makeCallback: (fn) => threadSafeCallback((arg) => fn(Number(arg)), c_uint32, [c_void_p]),
      async run(cb, values) {
        const handles = values.map((value) => CreateThread(null, 0, cb, BigInt(value), 0, null));
        return Promise.all(
          handles.map(async (handle) => {
            await WaitForSingleObject.callAsync(handle, 0xffffffff);
            const code = new c_uint32();
            GetExitCodeThread(handle, byref(code));
            CloseHandle(handle);
            return code.value;
          }),
        );
      },
      close: () => kernel32.close(),
    };
  }
  // glibc < 2.34 exports pthread_* from libpthread only (see test_callbacks.js).
  const pthread = new CDLL(platform === "darwin" ? LIBC : "libpthread.so.0");
  const pthread_create = pthread.func("pthread_create", c_int32, [c_void_p, c_void_p, c_void_p, c_void_p]);
  const pthread_join = pthread.func("pthread_join", c_int32, [c_void_p, c_void_p]);
  return {
    makeCallback: (fn) => threadSafeCallback((arg) => BigInt(fn(Number(arg))), c_void_p, [c_void_p]),
    async run(cb, values) {
      const threads = values.map((value) => {
        const thread = new c_void_p();
        assert.strictEqual(pthread_create(byref(thread), null, cb, BigInt(value)), 0);
        return thread;
      });
      // Joined on worker threads: the main thread must stay free to run the callbacks.
      return Promise.all(
        threads.map(async (thread) => {
          const result = new c_void_p();
          assert.strictEqual(await pthread_join.callAsync(thread.value, byref(result)), 0);
          return Number(result.value ?? 0n);
        }),
      );
    },
    close: () => pthread.close(),
  };
}

describe("threadSafeCallback called concurrently by native threads", function () {
  it("each call gets the result of its own invocation", async function () {
    const runner = nativeThreadRunner();
    const cb = runner.makeCallback((value) => value * 10);
    try {
      const values = [1, 2, 3, 4, 5, 6, 7, 8];
      // The threads all wait at the same time: the callbacks run only when
      // this function yields to the event loop.
      assert.deepStrictEqual(
        await runner.run(cb, values),
        values.map((value) => value * 10),
      );
    } finally {
      cb.release();
      runner.close();
    }
  });

  it("a call whose callback throws returns 0, not the result of another call", async function () {
    const runner = nativeThreadRunner();
    const cb = runner.makeCallback((value) => {
      if (value === 3) throw new Error("expected callback error");
      return value * 10;
    });
    const errors = [];
    cb._callback.setErrorHandler((message) => errors.push(message));
    try {
      assert.deepStrictEqual(await runner.run(cb, [1, 2, 3, 4]), [10, 20, 0, 40]);
      assert.deepStrictEqual(errors, ["expected callback error"]);
    } finally {
      cb.release();
      runner.close();
    }
  });
});

describe("library lifetime", function () {
  it("a function keeps its library loaded", async function () {
    let lib = new CDLL(LIBC);
    const library = new WeakRef(lib._lib);
    const abs = lib.func("abs", c_int32, [c_int32]);
    let unused = new CDLL(LIBC);
    const unusedLibrary = new WeakRef(unused._lib);
    lib = null;
    unused = null;
    await collectGarbage();
    assert.strictEqual(unusedLibrary.deref(), undefined, "a library without functions is collected");
    assert.ok(library.deref(), "the library of a live function is not collected");
    assert.strictEqual(abs(-3), 3);
  });

  it("CFUNCTYPE([name, library]) keeps the library loaded", async function () {
    let lib = new CDLL(LIBC);
    const library = new WeakRef(lib._lib);
    const abs = CFUNCTYPE(c_int32, c_int32)(["abs", lib]);
    lib = null;
    await collectGarbage();
    assert.ok(library.deref());
    assert.strictEqual(abs(-4), 4);
  });

  it("calls after close() throw", async function () {
    const lib = new CDLL(LIBC);
    const abs = lib.func("abs", c_int32, [c_int32]);
    const absPtr = CFUNCTYPE(c_int32, c_int32)(["abs", lib]);
    assert.strictEqual(abs(-1), 1);
    lib.close();
    assert.throws(() => abs(-1), /Library is closed/);
    assert.throws(() => absPtr(-1), /Library is closed/);
    assert.throws(() => abs.callAsync(-1), /Library is closed/);
  });

  it("close() is rejected while a call to one of its functions is running", function () {
    const lib = new CDLL(LIBC);
    const qsort = lib.func("qsort", null, [c_void_p, c_size_t, c_size_t, c_void_p]);
    const values = ctypes.array(c_int32, 2)(2, 1);
    let closeError;
    const compare = callback(
      (a, b) => {
        try {
          lib.close();
        } catch (e) {
          closeError = e;
        }
        return readValue(a, c_int32) - readValue(b, c_int32);
      },
      c_int32,
      [c_void_p, c_void_p],
    );
    try {
      qsort(values, 2, 4, compare);
      assert.match(closeError?.message ?? "", /calls to its functions are in progress/);
      assert.deepStrictEqual([...values], [1, 2]);
      lib.close();
      assert.throws(() => qsort(values, 2, 4, compare), /Library is closed/);
    } finally {
      compare.release();
    }
  });

  it("close() is rejected until callAsync() has completed", async function () {
    const lib = platform === "win32" ? new WinDLL("kernel32.dll") : new CDLL(LIBC);
    const sleep = platform === "win32" ? lib.func("Sleep", null, [c_uint32]) : lib.func("usleep", c_int32, [c_uint32]);
    const pending = sleep.callAsync(platform === "win32" ? 20 : 20000);
    assert.throws(() => lib.close(), /calls to its functions are in progress/);
    await pending;
    lib.close();
    assert.strictEqual(lib.loaded, false);
  });
});

describe("reentrant calls", function () {
  it("a call from a callback does not overwrite the string arguments of the outer call", function () {
    const libc = new CDLL(LIBC);
    const bsearch = libc.func("bsearch", c_void_p, [c_char_p, c_void_p, c_size_t, c_size_t, c_void_p]);
    const base = Buffer.from("abc");
    let nested = false;
    const inner = [];
    const compare = callback(
      (key, element) => {
        if (!nested) {
          nested = true;
          try {
            inner.push(bsearch("z", base, base.length, 1, compare));
          } finally {
            nested = false;
          }
        }
        return readValue(key, c_uint8) - readValue(element, c_uint8);
      },
      c_int32,
      [c_void_p, c_void_p],
    );
    try {
      const found = bsearch("b", base, base.length, 1, compare);
      assert.ok(inner.length > 0, "the callback called bsearch again");
      assert.ok(inner.every((result) => result === null));
      assert.strictEqual(found - addressof(base), 1n);
    } finally {
      compare.release();
      libc.close();
    }
  });
});

describe("threadSafeCallback collected without release()", function () {
  it("releases its thread-safe function, so the process can exit", function () {
    const script = `
      import { threadSafeCallback, c_int32 } from "node-ctypes";
      let cb = threadSafeCallback(() => 0, c_int32, []);
      cb = null;
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(() => { globalThis.gc(); resolve(); }, 10));
    `;
    const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
      cwd: import.meta.dirname,
      timeout: 10000,
      encoding: "utf8",
    });
    assert.strictEqual(child.error, undefined, "the process did not exit (the thread-safe function kept it alive)");
    assert.strictEqual(child.status, 0, child.stderr);
  });
});
