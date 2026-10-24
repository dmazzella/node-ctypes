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
import { before, after, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import * as ctypes from "node-ctypes";

const { CDLL, WinDLL, CFUNCTYPE, addressof, byref, callback, threadSafeCallback, readValue, c_int32, c_uint8, c_uint32, c_size_t, c_void_p, c_char_p } = ctypes;

const platform = process.platform;
const LIBC = platform === "win32" ? "msvcrt.dll" : platform === "darwin" ? "libc.dylib" : "libc.so.6";
const FIXTURE = path.join(import.meta.dirname, "..", "..", "build", "fixture", `ctypes_test_fixture${platform === "win32" ? ".dll" : platform === "darwin" ? ".dylib" : ".so"}`);

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

describe("converted argument ownership", { skip: !existsSync(FIXTURE) && "native fixture not built" }, function () {
      let lib;
      before(() => { lib = new CDLL(FIXTURE); });
      after(() => lib.close());

      for (const binding of ["func", "attribute", "prototype"]) {
        it(`${binding} retains conversion temporaries before native entry and releases them afterwards`, async function () {
          let owner = Buffer.alloc(4096, 65);
          const weak = new WeakRef(owner);
          await new Promise((resolve) => setImmediate(resolve));
          class Temporary extends c_void_p {
            static from_param() {
              const buffer = owner;
              owner = null;
              return ctypes.cast(new c_void_p(buffer), ctypes.POINTER(c_uint8));
            }
          }
          class Collect extends c_void_p {
            static from_param() {
              const nested = lib.func("fixture_address", c_size_t, [c_void_p]);
              nested(new c_void_p(Buffer.alloc(32)));
              for (let i = 0; i < 10; i++) gc();
              // Failure stops conversion before C could read the pointer.
              assert.ok(weak.deref(), "the first converted argument lost its owner");
              return null;
            }
          }
          let fn;
          if (binding === "func") fn = lib.func("fixture_first_char_after", c_int32, [Temporary, Collect]);
          else if (binding === "prototype") fn = CFUNCTYPE(c_int32, Temporary, Collect)(["fixture_first_char_after", lib]);
          else {
            fn = lib.fixture_first_char_after;
            fn.argtypes = [Temporary, Collect];
            fn.restype = c_int32;
          }
          assert.strictEqual(fn(0, null), 65);
          await collectGarbage();
          assert.strictEqual(weak.deref(), undefined, "completed conversions must not leak their owners");
        });
      }

      it("releases conversion temporaries when a later converter throws", async function () {
        let weak;
        class Temporary extends c_void_p {
          static from_param() {
            const owner = Buffer.alloc(4096);
            weak = new WeakRef(owner);
            return ctypes.cast(new c_void_p(owner), ctypes.POINTER(c_uint8));
          }
        }
        class Fail extends c_void_p {
          static from_param() { throw new RangeError("conversion stopped"); }
        }
        const fn = lib.func("fixture_first_char_after", c_int32, [Temporary, Fail]);
        assert.throws(() => fn(0, null), /conversion stopped/);
        await collectGarbage();
        assert.strictEqual(weak.deref(), undefined);
      });

      it("prevents close() while native getters materialize async arguments", async function () {
        const isolated = new CDLL(FIXTURE);
        const type = new ctypes.StructType();
        type.addField("value", ctypes.CType.POINTER);
        const fn = isolated._lib.func("fixture_pointer_value", ctypes.CType.SIZE_T, [type]);
        const owner = Buffer.alloc(32);
        try {
          const result = await fn.callAsync({ get value() {
            assert.throws(() => isolated.close(), /calls to its functions are in progress/);
            return owner;
          } });
          assert.strictEqual(result, addressof(owner));
        } finally {
          isolated.close();
        }
      });

      it("keeps owners until a converted result has passed errcheck", async function () {
        let owner = Buffer.alloc(4096);
        const weak = new WeakRef(owner);
        await new Promise((resolve) => setImmediate(resolve));
        class Temporary extends c_void_p {
          static from_param() {
            const buffer = owner; owner = null;
            return ctypes.cast(new c_void_p(buffer), ctypes.POINTER(c_uint8));
          }
        }
        const fn = lib.func("fixture_address", ctypes.POINTER(c_uint8), [Temporary]);
        fn.errcheck = (result) => {
          for (let i = 0; i < 10; i++) gc();
          assert.ok(weak.deref(), "owner was released before JS errcheck");
          return result.address;
        };
        try { assert.strictEqual(typeof fn(0), "bigint"); }
        finally { fn.errcheck = null; }
        await collectGarbage();
        assert.strictEqual(weak.deref(), undefined);
      });

      it("retains queued async arguments, including native by-value and numeric-pointer extensions", { timeout: 12000 }, function () {
        const script = `
          import assert from "node:assert/strict";
          import * as c from "node-ctypes";
          const lib = new c.CDLL(${JSON.stringify(FIXTURE)});
          const system = process.platform === "win32" ? new c.WinDLL("kernel32.dll") : new c.CDLL(${JSON.stringify(LIBC)});
          const sleep = process.platform === "win32"
            ? system.func("Sleep", null, [c.c_uint32])
            : system.func("usleep", c.c_int32, [c.c_uint32]);
          let gateDone = false;
          const gate = sleep.callAsync(process.platform === "win32" ? 2000 : 2000000).then(() => { gateDone = true; });
          const Ptr = c.POINTER(c.c_uint8);
          const address = lib.func("fixture_address", c.c_size_t, [Ptr]);
          const proto = c.CFUNCTYPE(c.c_size_t, Ptr)(["fixture_address", lib]);
          const cases = [];
          function queue(name, fn) {
            const owner = Buffer.alloc(4096);
            const pointer = c.cast(new c.c_void_p(owner), Ptr);
            cases.push({ name, weak: new WeakRef(owner), promise: fn(pointer) });
          }
          queue("CDLL pointer", pointer => address.callAsync(pointer));
          queue("prototype pointer", pointer => proto.callAsync(pointer));
          let convertedWeak;
          class Converted extends c.c_void_p {
            static from_param() {
              const owner = Buffer.alloc(4096);
              convertedWeak = new WeakRef(owner);
              return c.cast(new c.c_void_p(owner), Ptr);
            }
          }
          const converted = lib.func("fixture_address", c.c_size_t, [Converted]);
          const convertedPromise = converted.callAsync(0);
          cases.push({ name: "from_param result", weak: convertedWeak, promise: convertedPromise });
          const numeric = lib._lib.func("fixture_echo_size_t", c.CType.SIZE_T, [c.CType.SIZE_T]);
          function queueNumeric(kind) {
            const owner = kind === "Buffer" ? Buffer.alloc(4096) : new ArrayBuffer(4096);
            cases.push({ name: kind + " as integer address", weak: new WeakRef(owner), promise: numeric.callAsync(owner) });
          }
          queueNumeric("Buffer");
          queueNumeric("ArrayBuffer");
          const inferred = lib._lib.func("fixture_echo_size_t", c.CType.SIZE_T, []);
          function queueInferred() {
            const owner = Buffer.alloc(4096);
            const value = new c.c_size_t(c.addressof(owner));
            value.owner = owner;
            cases.push({ name: "inferred scalar owner", weak: new WeakRef(owner), promise: inferred.callAsync(value) });
          }
          queueInferred();
          const PointerValue = new c.StructType();
          PointerValue.addField("value", c.CType.POINTER);
          const byValue = lib._lib.func("fixture_pointer_value", c.CType.SIZE_T, [PointerValue]);
          function queueStruct() {
            const owner = Buffer.alloc(4096);
            cases.push({ name: "native object by value", weak: new WeakRef(owner), promise: byValue.callAsync({ value: owner }) });
          }
          queueStruct();
          let fieldWeak;
          const fieldPromise = byValue.callAsync({ get value() {
            const owner = Buffer.alloc(4096); fieldWeak = new WeakRef(owner); return owner;
          } });
          cases.push({ name: "materialized field", weak: fieldWeak, promise: fieldPromise });
          let bufferWeak;
          const bufferPromise = byValue.callAsync({ get _buffer() {
            const owner = Buffer.alloc(4096); bufferWeak = new WeakRef(owner);
            return new c.c_void_p(owner)._buffer;
          } });
          cases.push({ name: "materialized struct buffer", weak: bufferWeak, promise: bufferPromise });
          const PointerArray = new c.StructType();
          PointerArray.addField("values", new c.ArrayType(c.CType.POINTER, 1));
          const arrayValue = lib._lib.func("fixture_pointer_array_value", c.CType.SIZE_T, [PointerArray]);
          let elementWeak;
          const elements = [];
          Object.defineProperty(elements, "0", { get() {
            const owner = Buffer.alloc(4096); elementWeak = new WeakRef(owner); return owner;
          } });
          const elementPromise = arrayValue.callAsync({ values: elements });
          cases.push({ name: "materialized array element", weak: elementWeak, promise: elementPromise });
          const checked = lib.func("fixture_address", Ptr, [Converted]);
          checked.errcheck = () => {
            for (let i = 0; i < 10; i++) globalThis.gc();
            assert.ok(convertedWeak.deref(), "owner was released before async JS errcheck");
            throw new Error("expected result check failure");
          };
          const rejected = checked.callAsync(0).then(
            () => assert.fail("errcheck must reject"),
            error => assert.match(error.message, /expected result check failure/),
          );
          cases.push({ name: "async result check failure", weak: convertedWeak, promise: rejected });
          for (let i = 0; i < 8; i++) { await new Promise(setImmediate); globalThis.gc(); }
          assert.equal(gateDone, false, "the worker gate must still be pending");
          for (const item of cases) assert.ok(item.weak.deref(), item.name + " was collected while queued");
          await Promise.all([gate, ...cases.map(item => item.promise)]);
          checked.errcheck = null;
          for (let i = 0; i < 10; i++) { await new Promise(setImmediate); globalThis.gc(); }
          for (const item of cases) assert.equal(item.weak.deref(), undefined, item.name + " leaked after completion");
          lib.close(); system.close();
        `;
        const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
          cwd: import.meta.dirname,
          env: { ...process.env, UV_THREADPOOL_SIZE: "1" },
          timeout: 10000,
          encoding: "utf8",
        });
        assert.strictEqual(child.error, undefined);
        assert.strictEqual(child.status, 0, child.stderr);
      });
    });

describe("owners of pointer views", function () {
  const Ptr = ctypes.POINTER(c_int32);
  class Record extends ctypes.Structure { static _fields_ = [["p", Ptr]]; }
  class Value extends ctypes.Union { static _fields_ = [["p", Ptr]]; }
  const Functional = ctypes.struct({ p: Ptr });

  it("a derived pointer snapshots a mutable c_void_p owner's memory", async function () {
    function create() {
      const target = new c_int32(48);
      const owner = new c_void_p(target._buffer);
      const p = ctypes.cast(owner, Ptr);
      const derived = Ptr.fromAddress(p.address, p);
      owner.value = null;
      return { derived, weak: new WeakRef(target._buffer) };
    }
    let { derived, weak } = create();
    await collectGarbage();
    assert.ok(weak.deref(), "reassigning the owner must not free an existing derived pointer's memory");
    assert.strictEqual(derived[0], 48);
    derived = null;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
  });

  it("overwriting union pointer storage releases the old owner", async function () {
    class Overlay extends ctypes.Union {
      static _fields_ = [["p", Ptr], ["bits", ctypes.c_uint64]];
    }
    function create() {
      const target = new c_int32(42);
      const overlay = new Overlay();
      overlay.p = ctypes.pointer(target);
      return { overlay, weak: new WeakRef(target._buffer) };
    }
    const { overlay, weak } = create();
    await collectGarbage();
    assert.ok(weak.deref());
    overlay.bits = 0n;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
  });

  it("assignments through address-backed aliases update the owner's references", async function () {
    function assign() {
      const holder = new Record();
      const alias = ctypes.cast(new c_void_p(holder._buffer), ctypes.POINTER(Record));
      const target = new c_int32(61);
      alias.contents.p = ctypes.pointer(target);
      return { holder, weak: new WeakRef(target._buffer) };
    }
    const { holder, weak } = assign();
    await collectGarbage();
    assert.ok(weak.deref(), "the alias's references must live with the original memory");
    assert.strictEqual(holder.p[0], 61);
    holder.p = null;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
  });

  it("address-backed pointer slots keep assigned objects until overwritten", async function () {
    function assign() {
      const slots = ctypes.array(Ptr, 1)();
      const p = ctypes.cast(new c_void_p(slots._buffer), ctypes.POINTER(Ptr));
      const target = new c_int32(73);
      p[0] = ctypes.pointer(target);
      return { slots, weak: new WeakRef(target._buffer) };
    }
    const { slots, weak } = assign();
    await collectGarbage();
    assert.ok(weak.deref(), "the temporary pointer must not own the only reference");
    assert.strictEqual(slots[0][0], 73);
    slots[0] = null;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
  });

  it("assigning a pointer snapshots its current pointee", async function () {
    function escape() {
      const target = new c_int32(42);
      const p = ctypes.pointer(target);
      const holder = new Record();
      holder.p = p;
      p.contents = new c_int32(7);
      return { holder, weak: new WeakRef(target._buffer) };
    }
    let { holder, weak } = escape();
    await collectGarbage();
    assert.ok(weak.deref(), "repointing the source must not free memory stored in the field");
    assert.strictEqual(holder.p[0], 42);
    holder.p = null;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
    holder = null;
  });

  const escapedPointer = (kind) => {
    const target = new c_int32(42);
    const weak = new WeakRef(target._buffer);
    const p = ctypes.pointer(target);
    let holder, result;
    if (kind === "array") {
      holder = ctypes.array(Ptr, 1)(p);
      result = holder[0];
      holder[0] = null;
    } else if (kind === "double pointer") {
      holder = ctypes.POINTER(Ptr).fromBuffer(byref(p));
      result = holder[0];
    } else {
      holder = kind === "union" ? new Value() : kind === "functional" ? Functional.create() : new Record();
      holder.p = p;
      result = holder.p;
      holder.p = null;
    }
    return { result, weak };
  };

  for (const kind of ["structure", "union", "functional", "array", "double pointer"]) {
    it(`${kind} keeps the owner snapshot when the source field changes or disappears`, async function () {
      let { result, weak } = escapedPointer(kind);
      await collectGarbage();
      assert.ok(weak.deref(), "the pointer's known owner was collected");
      assert.strictEqual(result[0], 42);
      result = null;
      await collectGarbage();
      assert.strictEqual(weak.deref(), undefined, "the escaped pointer retained its owner after collection");
    });
  }

  for (const kind of ["contents", "element", "buffer", "typed array"]) {
    it(`an address-backed ${kind} keeps its pointer's owner`, async function () {
      function escape() {
        const target = new c_int32(37);
        const weak = new WeakRef(target._buffer);
        const p = ctypes.cast(new c_void_p(target._buffer), Ptr);
        const instance = kind === "element" ? ctypes.POINTER(ctypes.array(c_int32, 1)).fromAddress(p.address, p)[0] : p.contents;
        const result = kind === "buffer" ? instance._buffer.subarray(0) : kind === "typed array" ? new Uint8Array(instance._buffer.buffer) : instance;
        return { result, weak };
      }
      let { result, weak } = escape();
      await collectGarbage();
      assert.ok(weak.deref(), "the borrowed view lost its owner");
      result = null;
      await collectGarbage();
      assert.strictEqual(weak.deref(), undefined);
    });
  }

  it("copying a pointer slot keeps its pointee after the pointer wrapper is collected", async function () {
    function escape() {
      const target = new c_int32(19);
      const p = ctypes.pointer(target);
      return { slot: p.toBuffer(), weak: new WeakRef(target._buffer) };
    }
    let { slot, weak } = escape();
    await collectGarbage();
    assert.ok(weak.deref(), "a pointer-slot buffer must keep the pointee alive");
    slot = null;
    await collectGarbage();
    assert.strictEqual(weak.deref(), undefined);
  });
});
