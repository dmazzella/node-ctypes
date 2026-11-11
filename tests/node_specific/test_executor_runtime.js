/**
 * Executor: a native thread owned by node-ctypes with a FIFO queue.
 * fn.callOn(executor, ...args) is fn.callAsync(...args) on that thread:
 * - calls run one at a time, in arrival order, off the JavaScript thread and
 *   off the libuv pool, and each promise settles exactly once;
 * - conversions, out parameters, structures, variadic arguments and errcheck
 *   are those of callAsync;
 * - queued calls can be cancelled with an AbortSignal;
 * - close() drains the accepted calls, then stops the thread; later calls reject;
 * - an idle executor does not keep the process alive, a busy one does, and
 *   process.exit() / worker termination during a call do not hang.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Worker } from "node:worker_threads";
import * as ctypes from "node-ctypes";

const { CDLL, WinDLL, CFUNCTYPE, Executor, Structure, POINTER, byref, c_char_p, c_int32, c_size_t, c_uint32, c_void_p } = ctypes;

const platform = process.platform;
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
const FIXTURE = path.join(import.meta.dirname, "..", "..", "build", "fixture", `ctypes_test_fixture${platform === "win32" ? ".dll" : platform === "darwin" ? ".dylib" : ".so"}`);

// Current thread identity and a blocking sleep in milliseconds.
function threadApi() {
  if (platform === "win32") {
    const kernel32 = new WinDLL("kernel32.dll");
    const sleep = kernel32.func("Sleep", null, [c_uint32]);
    return { threadId: kernel32.func("GetCurrentThreadId", c_uint32, []), sleep, ms: (value) => value };
  }
  const libc = new CDLL(LIBC);
  return { threadId: libc.func("pthread_self", c_void_p, []), sleep: libc.func("usleep", c_int32, [c_uint32]), ms: (value) => value * 1000 };
}

class FixturePoint extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
  ];
}

const childOptions = { cwd: import.meta.dirname, timeout: 20000, encoding: "utf8" };
const SLEEP_SOURCE = `
  const platform = process.platform;
  const lib = platform === "win32" ? new ctypes.WinDLL("kernel32.dll") : new ctypes.CDLL(platform === "darwin" ? "libc.dylib" : "libc.so.6");
  const sleep = platform === "win32" ? lib.func("Sleep", null, [ctypes.c_uint32]) : lib.func("usleep", ctypes.c_int32, [ctypes.c_uint32]);
  const ms = (value) => (platform === "win32" ? value : value * 1000);
`;

describe("Executor calls", function () {
  it("run on one thread, not the JavaScript thread, in order, each settled once", async function () {
    const { threadId } = threadApi();
    const executor = new Executor();
    try {
      const main = threadId();
      const settled = [];
      const calls = Array.from({ length: 500 }, (_, index) => threadId.callOn(executor).then((id) => (settled.push(index), id)));
      // Calls completed inline (spin) are already counted as completed.
      assert.strictEqual(executor.pending + executor.completed, 500);
      const ids = new Set(await Promise.all(calls));
      assert.strictEqual(ids.size, 1, "a single executor thread");
      assert.notStrictEqual([...ids][0], main, "not the JavaScript thread");
      assert.deepStrictEqual(
        settled,
        calls.map((_, index) => index),
      );
      assert.strictEqual(executor.pending, 0);
      assert.strictEqual(executor.completed, 500);
    } finally {
      await executor.close();
    }
  });

  it("keep the event loop free during a long call", async function () {
    const { sleep, ms } = threadApi();
    const executor = new Executor();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      await sleep.callOn(executor, ms(200));
    } finally {
      clearInterval(timer);
      await executor.close();
    }
    assert.ok(ticks >= 5, `timers ran during the call (${ticks} ticks)`);
  });

  it("do not wait for the libuv pool", async function () {
    const { threadId, sleep, ms } = threadApi();
    const executor = new Executor();
    try {
      // Every pool worker is busy: a callAsync would wait, callOn does not.
      const workers = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
      let poolDone = false;
      const pool = Promise.all(Array.from({ length: workers }, () => sleep.callAsync(ms(800)))).then(() => (poolDone = true));
      await threadId.callOn(executor);
      assert.strictEqual(poolDone, false, "the executor answered while the pool was busy");
      await pool;
    } finally {
      await executor.close();
    }
  });

  it("use the conversions, out parameters and errcheck of callAsync", async function () {
    const lib = new CDLL(FIXTURE);
    const libc = new CDLL(LIBC);
    const executor = new Executor();
    try {
      const make = lib.func("fixture_point_make", FixturePoint, [c_int32, c_int32]);
      const sum = lib.func("fixture_point_sum", c_int32, [FixturePoint]);
      const extra = lib.func("fixture_point_sum_extra", c_int32, [FixturePoint, c_int32]);
      const strlen = libc.func("strlen", c_size_t, [c_char_p]);

      const point = await make.callOn(executor, 3, 4);
      assert.ok(point instanceof FixturePoint);
      assert.deepStrictEqual([point.x, point.y], [3, 4]);
      assert.strictEqual(await sum.callOn(executor, FixturePoint.create({ x: 5, y: 6 })), await sum.callAsync(FixturePoint.create({ x: 5, y: 6 })));
      assert.strictEqual(await extra.callOn(executor, point, 2, new c_int32(10), new c_int32(20)), await extra.callAsync(point, 2, new c_int32(10), new c_int32(20)));
      assert.strictEqual(Number(await strlen.callOn(executor, "hello")), 5);

      // errcheck runs on the JavaScript thread with the call arguments.
      strlen.errcheck = (result, func, args) => `${args[0]}:${result}`;
      assert.strictEqual(await strlen.callOn(executor, "abc"), "abc:3");
      strlen.errcheck = null;

      // Out parameter through memory passed by reference.
      const divmod = lib.func("fixture_divmod", c_int32, [c_int32, c_int32, POINTER(c_int32)]);
      const remainder = new c_int32();
      assert.strictEqual(await divmod.callOn(executor, 17, 5, byref(remainder)), 3);
      assert.strictEqual(remainder.value, 2);

      // paramflags wrapper, CFUNCTYPE pointer and lazy library attribute.
      const paramflags = CFUNCTYPE(c_int32, c_int32, c_int32, POINTER(c_int32)).bind(lib, "fixture_divmod", [
        [1, "a"],
        [1, "b"],
        [2, "remainder"],
      ]);
      assert.strictEqual(await paramflags.callOn(executor, 17, 5), 2);
      const pointer = CFUNCTYPE(c_size_t, c_char_p)(strlen.address);
      assert.strictEqual(Number(await pointer.callOn(executor, "abcd")), 4);
      libc.strlen.restype = c_size_t;
      libc.strlen.argtypes = [c_char_p];
      assert.strictEqual(Number(await libc.strlen.callOn(executor, "abcdef")), 6);
      assert.strictEqual(executor.completed, 9);
    } finally {
      await executor.close();
      lib.close();
    }
  });

  it("reject an invalid target without running", async function () {
    const { threadId } = threadApi();
    await assert.rejects(threadId.callOn({}), /requires an Executor/);
    await assert.rejects(threadId.callOn(null), /requires an Executor/);
    await assert.rejects(threadId.callOn({ executor: new Executor(), signal: {} }), /AbortSignal/);
  });

  it("keep the library loaded until they complete", async function () {
    const lib = platform === "win32" ? new WinDLL("kernel32.dll") : new CDLL(LIBC);
    const sleep = platform === "win32" ? lib.func("Sleep", null, [c_uint32]) : lib.func("usleep", c_int32, [c_uint32]);
    const executor = new Executor();
    try {
      const pending = sleep.callOn(executor, platform === "win32" ? 50 : 50000);
      assert.throws(() => lib.close(), /calls to its functions are in progress/);
      await pending;
      lib.close();
    } finally {
      await executor.close();
    }
  });
});

describe("Executor spin", function () {
  it("validates the spin option", function () {
    assert.throws(() => new Executor({ spin: "50" }), TypeError);
    assert.throws(() => new Executor({ spin: -1 }), RangeError);
    assert.throws(() => new Executor({ spin: 20000 }), RangeError);
    assert.throws(() => new Executor({ spin: NaN }), RangeError);
    for (const spin of [0, 1, 50, 10000]) new Executor({ spin }).close();
  });

  for (const spin of [0, 50]) {
    it(`settles awaited calls in order on the executor thread (spin ${spin})`, async function () {
      const { threadId } = threadApi();
      const executor = new Executor({ spin });
      try {
        const main = threadId();
        const ids = new Set();
        for (let index = 0; index < 300; index++) ids.add(await threadId.callOn(executor));
        // Awaited calls interleaved with a burst.
        const burst = Array.from({ length: 100 }, () => threadId.callOn(executor));
        ids.add(await threadId.callOn(executor));
        for (const id of await Promise.all(burst)) ids.add(id);
        assert.strictEqual(ids.size, 1);
        assert.notStrictEqual([...ids][0], main);
        assert.strictEqual(executor.completed, 401);
        assert.strictEqual(executor.pending, 0);
      } finally {
        await executor.close();
      }
    });
  }

  it("lets errcheck call the same executor while an awaited call completes", async function () {
    const { threadId } = threadApi();
    const inner = platform === "win32" ? new WinDLL("kernel32.dll").func("GetCurrentThreadId", c_uint32, []) : new CDLL(LIBC).func("pthread_self", c_void_p, []);
    const executor = new Executor();
    try {
      let order = [];
      threadId.errcheck = (result) => {
        order.push("errcheck");
        return inner.callOn(executor).then((again) => [result, again]);
      };
      for (let index = 0; index < 50; index++) {
        order = [];
        const pending = threadId.callOn(executor);
        order.push("returned");
        const [first, second] = await pending;
        assert.strictEqual(first, second, "both on the executor thread");
        assert.strictEqual(order.length, 2);
      }
    } finally {
      threadId.errcheck = null;
      await executor.close();
    }
  });

  it("validates the spinLimit option", function () {
    assert.throws(() => new Executor({ spinLimit: "500" }), TypeError);
    assert.throws(() => new Executor({ spinLimit: -1 }), RangeError);
    assert.throws(() => new Executor({ spinLimit: 20000 }), RangeError);
    for (const spinLimit of [0, 100, 500, 10000]) new Executor({ spinLimit }).close();
  });

  // The inline wait per function (_inlineBudget, in microseconds) follows the
  // durations measured on the executor thread: these tests do not depend on how
  // fast the machine is (whether a wait succeeds does).

  it("waits longer than spin for a function that needs it, up to spinLimit", async function () {
    const lib = new CDLL(FIXTURE);
    const busy = lib.func("fixture_busy_wait_us", c_uint32, [c_uint32]);
    // A wide spinLimit: under load (other tests in parallel) the measured durations grow.
    const executor = new Executor({ spinLimit: 2000 });
    const limited = new Executor({ spinLimit: 0 });
    try {
      assert.equal(executor._inlineBudget(busy.address), 50, "spin for a function not called yet");
      // 100 us: more than spin (50 us), within spinLimit.
      for (let index = 0; index < 10; index++) await busy.callOn(executor, 100);
      const budget = executor._inlineBudget(busy.address);
      assert.ok(budget > 50 && budget <= 2000, `budget ${budget.toFixed(0)} us`);
      // spinLimit 0: never more than spin, so no wait for a function slower than spin.
      for (let index = 0; index < 10; index++) await busy.callOn(limited, 100);
      assert.equal(limited._inlineBudget(busy.address), 0);
    } finally {
      await executor.close();
      await limited.close();
      lib.close();
    }
  });

  it("does not wait for a slow function, without penalizing the others", async function () {
    const lib = new CDLL(FIXTURE);
    const busy = lib.func("fixture_busy_wait_us", c_uint32, [c_uint32]);
    const fast = lib.func("fixture_benchmark_zero", c_int32, []);
    const executor = new Executor();
    try {
      for (let index = 0; index < 5; index++) {
        // 3 ms, beyond spinLimit, alternated with a fast function.
        await busy.callOn(executor, 3000);
        await fast.callOn(executor);
      }
      assert.equal(executor._inlineBudget(busy.address), 0, "no wait for the slow function");
      assert.ok(executor._inlineBudget(fast.address) >= 50, "the fast one keeps its wait");
    } finally {
      await executor.close();
      lib.close();
    }
  });

  it("waits again for a function that becomes fast", async function () {
    const lib = new CDLL(FIXTURE);
    const busy = lib.func("fixture_busy_wait_us", c_uint32, [c_uint32]);
    const executor = new Executor();
    try {
      for (let index = 0; index < 5; index++) await busy.callOn(executor, 3000);
      assert.equal(executor._inlineBudget(busy.address), 0);
      // Shorter durations weigh 1/2: a few calls bring the typical duration back within spinLimit.
      for (let index = 0; index < 30; index++) await busy.callOn(executor, 5);
      assert.ok(executor._inlineBudget(busy.address) >= 50);
    } finally {
      await executor.close();
      lib.close();
    }
  });

  it("lets the event loop turn during awaited calls and bursts", async function () {
    const { threadId } = threadApi();
    const executor = new Executor();
    try {
      // Awaited calls in sequence: immediates and timers still run between them.
      let immediates = 0;
      let ticks = 0;
      const timer = setInterval(() => ticks++, 1);
      const started = performance.now();
      let calls = 0;
      while (performance.now() - started < 200) {
        setImmediate(() => immediates++);
        await threadId.callOn(executor);
        calls++;
      }
      clearInterval(timer);
      assert.ok(immediates > calls / 20, `immediates ran (${immediates} for ${calls} calls)`);
      // Windows timers fire about every 15.6 ms, and less often on a loaded machine.
      assert.ok(ticks >= 3, `timers ran (${ticks})`);
      // A burst submitted in one go blocks the JavaScript thread for about one slice at most.
      const before = performance.now();
      const burst = Array.from({ length: 20000 }, () => threadId.callOn(executor));
      const submitting = performance.now() - before;
      assert.ok(executor.pending > 0, "the burst is still queued");
      await Promise.all(burst);
      assert.ok(submitting < 1000, `submitted in ${submitting.toFixed(1)} ms`);
    } finally {
      await executor.close();
    }
  });

  it("falls back to the notification for slow calls and recovers for fast ones", { timeout: 30000 }, async function () {
    const { threadId, sleep, ms } = threadApi();
    const executor = new Executor({ spin: 50 });
    try {
      let ticks = 0;
      const timer = setInterval(() => ticks++, 1);
      for (let index = 0; index < 10; index++) await sleep.callOn(executor, ms(5));
      clearInterval(timer);
      assert.ok(ticks >= 5, `timers ran between slow calls (${ticks})`);
      // After 10 slow calls the backoff skips at most a few tens of inline waits.
      for (let index = 0; index < 300; index++) await threadId.callOn(executor);
      assert.strictEqual(executor.completed, 310);
    } finally {
      await executor.close();
    }
  });

  it("serves thread-safe callbacks from the executor thread while waiting", async function () {
    const lib = new CDLL(FIXTURE);
    const executor = new Executor({ spin: 10000 });
    const Point = ctypes.struct({ x: c_int32, y: c_int32 });
    const callback = ctypes.threadSafeCallback((point) => point.x + point.y, c_int32, [Point]);
    try {
      const invoke = lib.func("fixture_point_callback", c_int32, [c_void_p, c_int32, c_int32]);
      for (let index = 0; index < 100; index++) assert.strictEqual(await invoke.callOn(executor, callback.pointer, index, 7), index + 7);
    } finally {
      callback.release();
      await executor.close();
      lib.close();
    }
  });
});

describe("Executor cancellation", function () {
  it("rejects a queued call with the abort reason and runs the others", async function () {
    const { sleep, threadId, ms } = threadApi();
    const executor = new Executor();
    try {
      const controller = new AbortController();
      const running = sleep.callOn(executor, ms(100));
      const queued = threadId.callOn({ executor, signal: controller.signal });
      const after = threadId.callOn(executor);
      const reason = new Error("stop");
      controller.abort(reason);
      await assert.rejects(queued, (error) => error === reason);
      await running;
      await after;
      assert.strictEqual(executor.pending, 0);
      assert.strictEqual(executor.completed, 2);
    } finally {
      await executor.close();
    }
  });

  it("lets a started call complete", async function () {
    const { sleep, ms } = threadApi();
    const executor = new Executor();
    try {
      const controller = new AbortController();
      const running = sleep.callOn({ executor, signal: controller.signal }, ms(300));
      // Long enough for the executor thread to start the call, also on a loaded machine.
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort();
      await running;
    } finally {
      await executor.close();
    }
  });

  it("rejects at once with an aborted signal", async function () {
    const { threadId } = threadApi();
    const executor = new Executor();
    try {
      const reason = new Error("already");
      await assert.rejects(threadId.callOn({ executor, signal: AbortSignal.abort(reason) }), (error) => error === reason);
      assert.strictEqual(executor.completed, 0);
      assert.strictEqual(executor.running, false, "no thread started");
    } finally {
      await executor.close();
    }
  });
});

describe("Executor close", function () {
  it("drains accepted calls, then stops the thread; later calls reject", async function () {
    const { sleep, threadId, ms } = threadApi();
    const executor = new Executor();
    const accepted = Array.from({ length: 5 }, () => sleep.callOn(executor, ms(20)));
    assert.strictEqual(executor.running, true);
    const closing = executor.close();
    assert.strictEqual(executor.close(), closing, "the same promise");
    assert.strictEqual(executor.closed, true);
    await assert.rejects(threadId.callOn(executor), /Executor is closed/);
    let settled = 0;
    for (const call of accepted) call.then(() => settled++);
    await closing;
    assert.strictEqual(settled, 5, "accepted calls settled before close()");
    assert.strictEqual(executor.running, false);
    assert.strictEqual(executor.completed, 5);
  });

  it("closes an executor that never ran", async function () {
    const executor = new Executor();
    await executor.close();
    assert.strictEqual(executor.running, false);
  });
});

describe("Executor and the process lifetime", function () {
  it("an idle executor does not keep the process alive", function () {
    const script = `
      import * as ctypes from "node-ctypes";
      ${SLEEP_SOURCE}
      const executor = new ctypes.Executor();
      await sleep.callOn(executor, ms(10));
      console.log("idle");
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], childOptions);
    assert.strictEqual(child.error, undefined, "the process did not exit");
    assert.strictEqual(child.status, 0, child.stderr);
    assert.match(child.stdout, /idle/);
  });

  it("an idle executor without references is collected and its thread stopped", function () {
    const script = `
      import * as ctypes from "node-ctypes";
      ${SLEEP_SOURCE}
      let executor = new ctypes.Executor();
      await sleep.callOn(executor, ms(5));
      // An errcheck that queues another call while the executor settles.
      let inner;
      sleep.errcheck = (result) => {
        sleep.errcheck = null;
        inner = sleep.callOn(executor, ms(5));
        return result;
      };
      await sleep.callOn(executor, ms(5));
      await inner;
      if (executor.pending !== 0 || executor.completed !== 3) throw new Error("unbalanced");
      const weak = new WeakRef(executor);
      executor = null;
      for (let i = 0; i < 10 && weak.deref() !== undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        globalThis.gc();
      }
      console.log(weak.deref() === undefined ? "collected" : "alive");
    `;
    const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], childOptions);
    assert.strictEqual(child.status, 0, child.stderr);
    assert.match(child.stdout, /collected/);
  });

  it("a pending call keeps the process alive until it completes", function () {
    const script = `
      import * as ctypes from "node-ctypes";
      ${SLEEP_SOURCE}
      const executor = new ctypes.Executor();
      sleep.callOn(executor, ms(200)).then(() => console.log("completed"));
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], childOptions);
    assert.strictEqual(child.status, 0, child.stderr);
    assert.match(child.stdout, /completed/);
  });

  it("process.exit() during a call does not hang", function () {
    const script = `
      import * as ctypes from "node-ctypes";
      ${SLEEP_SOURCE}
      const executor = new ctypes.Executor();
      sleep.callOn(executor, ms(5000));
      sleep.callOn(executor, ms(5000));
      setTimeout(() => process.exit(0), 100);
    `;
    const started = performance.now();
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], childOptions);
    assert.strictEqual(child.status, 0, child.stderr);
    assert.ok(performance.now() - started < 4000, "exit did not wait for the running call");
  });

  it("works in a worker thread, which can terminate during a call", async function () {
    // A data: module resolves only absolute specifiers.
    const source = `
      import { parentPort } from "node:worker_threads";
      import * as ctypes from "${import.meta.resolve("node-ctypes")}";
      ${SLEEP_SOURCE}
      const executor = new ctypes.Executor();
      await sleep.callOn(executor, ms(10));
      parentPort.postMessage("ready");
      sleep.callOn(executor, ms(5000));
    `;
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { execArgv: [] });
    const message = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    assert.strictEqual(message, "ready");
    const started = performance.now();
    await worker.terminate();
    assert.ok(performance.now() - started < 4000, "terminate() did not wait for the running call");
  });

  // Worker startup dominates: the suite-wide --test-timeout is too short under load.
  it("a worker can terminate at any point of its calls, with calls queued", { timeout: 60000 }, async function () {
    // Termination can land while a call (sync, callAsync or callOn) is being
    // prepared, queued, running or completing: none of these may crash the
    // process, also when Node-API can no longer throw a JavaScript exception.
    const source = `
      import { parentPort } from "node:worker_threads";
      import * as ctypes from "${import.meta.resolve("node-ctypes")}";
      ${SLEEP_SOURCE}
      const executor = new ctypes.Executor();
      parentPort.postMessage("ready");
      for (;;) {
        sleep(0);
        sleep.callAsync(ms(1));
        sleep.callOn(executor, ms(1));
        sleep.callOn(executor, ms(2));
        await sleep.callOn(executor, ms(1));
      }
    `;
    for (let round = 0; round < 16; round++) {
      const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { execArgv: [] });
      await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, round % 8));
      await worker.terminate();
    }
  });
});
