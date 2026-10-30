import assert from "node:assert/strict";
import { after, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import { CDLL, CFUNCTYPE, CType, Library, callback, c_int32, c_ssize_t, c_void_p, threadSafeCallback } from "node-ctypes";
import { FIXTURE } from "../cpython_parity/_support.js";

const lib = new CDLL(FIXTURE);
after(() => lib.close());
const call = lib.func("fixture_context_callback", c_int32, [c_void_p, c_int32]);
const current = lib.func("fixture_current_context", c_ssize_t, []);
const nativeContext = {
  suspend: lib.symbol("fixture_suspend_context"),
  resume: lib.symbol("fixture_resume_context"),
  onError: lib.symbol("fixture_set_native_error"),
};

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");
async function collect() {
  for (let i = 0; i < 12; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

it("accepts native function objects and snapshots their addresses", async () => {
  const context = {
    suspend: lib.fixture_suspend_context,
    resume: lib.func("fixture_resume_context", null, [c_void_p]),
    onError: CFUNCTYPE(null, c_void_p)(lib.symbol("fixture_set_native_error")),
    notify: lib.func("fixture_notify_context", null, []),
  };
  context.suspend.restype = c_void_p;
  context.suspend.argtypes = [];
  context.resume.errcheck = () => assert.fail("Native hooks must bypass JavaScript errcheck");
  const notifiedCall = lib.func("fixture_notified_context_callback", c_int32, [c_void_p, c_int32]);
  const nativeCallback = threadSafeCallback(
    (value) => {
      nativeCallback.setNativeError(BigInt(value * 10));
      return 0;
    },
    c_int32,
    [c_int32],
    { nativeContext: context },
  );
  try {
    context.suspend = null;
    context.resume = null;
    assert.equal(call(nativeCallback, 3), -30);
    assert.deepEqual(await Promise.all([4, 5, 6].map((value) => notifiedCall.callAsync(nativeCallback, value))), [-40, -50, -60]);
  } finally {
    nativeCallback.release();
  }
});

it("accepts low-level native function handles mixed with raw addresses", async () => {
  const library = new Library(FIXTURE);
  let nativeCallback;
  try {
    nativeCallback = threadSafeCallback((value) => value * 2, c_int32, [c_int32], {
      nativeContext: {
        ...nativeContext,
        resume: library.func("fixture_resume_context", CType.VOID, [CType.POINTER]),
      },
    });
    assert.equal(await call.callAsync(nativeCallback, 7), 14);
  } finally {
    nativeCallback?.release();
    library.close();
  }
});

it("retains native function owners until release and queued delivery cleanup", async () => {
  const create = () => {
    const hooks = [CFUNCTYPE(c_void_p)(nativeContext.suspend), CFUNCTYPE(null, c_void_p)(nativeContext.resume), CFUNCTYPE(null, c_void_p)(nativeContext.onError), CFUNCTYPE(null)(lib.symbol("fixture_notify_context"))];
    const unused = CFUNCTYPE(c_void_p)(nativeContext.suspend);
    return {
      references: hooks.map((hook) => new WeakRef(hook)),
      unused: new WeakRef(unused),
      nativeCallback: threadSafeCallback((value) => value * 2, c_int32, [c_int32], {
        nativeContext: { suspend: hooks[0], resume: hooks[1], onError: hooks[2], notify: hooks[3] },
      }),
    };
  };
  const retained = create();
  try {
    await collect();
    assert.equal(retained.unused.deref(), undefined);
    assert.ok(retained.references.every((reference) => reference.deref() !== undefined));
    const notifiedCall = lib.func("fixture_notified_context_callback", c_int32, [c_void_p, c_int32]);
    assert.equal(await notifiedCall.callAsync(retained.nativeCallback, 9), 18);
  } finally {
    retained.nativeCallback.release();
  }
  await collect();
  assert.ok(retained.references.every((reference) => reference.deref() === undefined));
});

it("rejects JavaScript-backed hooks and malformed native function targets", () => {
  const ordinary = callback(() => null, c_void_p, []);
  const threaded = threadSafeCallback(() => null, c_void_p, []);
  const callable = CFUNCTYPE(c_void_p)(() => null);
  try {
    for (const hook of [() => null, ordinary, threaded, callable, {}, { address: 0n }, { address: -1n }, { address: 1n << 65n }, { address: 1 }, { _as_parameter_: null }, { _as_parameter_: {} }, Buffer.alloc(8)]) {
      assert.throws(() => threadSafeCallback(() => 0, c_int32, [], { nativeContext: { ...nativeContext, suspend: hook } }), /nativeContext|Native context/);
    }
    const failure = new Error("hook address getter failed");
    const hook = {
      get _as_parameter_() {
        throw failure;
      },
    };
    assert.throws(
      () => threadSafeCallback(() => 0, c_int32, [], { nativeContext: { ...nativeContext, suspend: hook } }),
      (error) => error === failure,
    );
  } finally {
    ordinary.release();
    threaded.release();
    callable.release();
  }
});

it("validates all native context hook addresses before creating a callback", () => {
  for (const invalid of [null, {}, { ...nativeContext, suspend: 0n }, { ...nativeContext, resume: -1n }, { ...nativeContext, onError: 1n << 65n }, { ...nativeContext, onError: 1 }, { ...nativeContext, notify: 0n }, { ...nativeContext, notify: 1 }]) {
    assert.throws(() => threadSafeCallback(() => 0, c_int32, [], { nativeContext: invalid }), /nativeContext|Native context/);
  }
});

it("drains foreign calls exactly once, including reentrant drain and stale TSFN delivery", async () => {
  const notifiedCall = lib.func("fixture_notified_context_callback", c_int32, [c_void_p, c_int32]);
  const values = new Set();
  const callback = threadSafeCallback(
    (value) => {
      assert.equal(values.has(value), false);
      values.add(value);
      assert.throws(() => callback.release(), /calls are active/);
      if (value === 1) callback.drain();
      callback.setNativeError(BigInt(value * 10));
      return 0;
    },
    c_int32,
    [c_int32],
    { nativeContext: { ...nativeContext, notify: lib.symbol("fixture_notify_context") } },
  );
  try {
    assert.equal(callback.drain(), 0);
    const calls = Array.from({ length: 16 }, (_, i) => notifiedCall.callAsync(callback, i + 1));
    const deadline = Date.now() + 5000;
    while (values.size < calls.length && Date.now() < deadline) callback.drain();
    assert.equal(values.size, calls.length);
    assert.equal(callback.drain(), 0);
    assert.deepEqual(
      await Promise.all(calls),
      Array.from({ length: 16 }, (_, i) => -(i + 1) * 10),
    );
    assert.equal(values.size, 16);
  } finally {
    callback.release();
  }
  assert.throws(() => callback.drain(), /released/);
});

it("keeps the host context attached and restores foreign caller contexts", async () => {
  let host = true;
  let calls = 0;
  const callback = threadSafeCallback(
    (value) => {
      assert.equal(current(), host ? BigInt(value) : 0n);
      assert.throws(() => callback.release(), /calls are active/);
      calls++;
      return value * 2;
    },
    c_int32,
    [c_int32],
    { nativeContext },
  );
  try {
    assert.equal(call(callback, 7), 14);
    host = false;
    assert.deepEqual(
      await Promise.all(Array.from({ length: 16 }, (_, i) => call.callAsync(callback, i + 1))),
      Array.from({ length: 16 }, (_, i) => (i + 1) * 2),
    );
    assert.equal(calls, 17);
    assert.throws(() => callback.setNativeError(1n), /active native-context/);
  } finally {
    callback.release();
  }
  assert.throws(() => callback.setNativeError(1n), /released/);
});

it("restores a null saved native state before returning a result or installing an error", async () => {
  for (const fail of [false, true]) {
    const nativeCallback = threadSafeCallback(
      (value) => {
        assert.throws(() => nativeCallback.release(), /calls are active/);
        if (fail) {
          nativeCallback.setNativeError(123n);
          return 0;
        }
        return value + 42;
      },
      c_int32,
      [c_int32],
      { nativeContext },
    );
    try {
      assert.equal(call(nativeCallback, 0), fail ? -123 : 42);
      assert.equal(await call.callAsync(nativeCallback, 0), fail ? -123 : 42);
      assert.equal(await call.callAsync(nativeCallback, 7), fail ? -123 : 49);
    } finally {
      nativeCallback.release();
    }
  }
});

it("transfers distinct errors to their caller and preserves nested invocation state", async () => {
  const callback = threadSafeCallback(
    (value) => {
      assert.throws(() => callback.setNativeError(0n), /nonzero/);
      callback.setNativeError(BigInt(value * 10));
      if (value === 2) assert.equal(call(callback, 1), -10);
      assert.throws(() => callback.setNativeError(999n), /already set/);
      return 0;
    },
    c_int32,
    [c_int32],
    { abi: "cdecl", nativeContext },
  );
  try {
    assert.equal(call(callback, 2), -20);
    assert.deepEqual(
      await Promise.all(Array.from({ length: 16 }, (_, i) => call.callAsync(callback, i + 1))),
      Array.from({ length: 16 }, (_, i) => -(i + 1) * 10),
    );
  } finally {
    callback.release();
  }
});

it("leaves ordinary callbacks unchanged and rejects native error transfer without hooks", async () => {
  const callback = threadSafeCallback((value) => value * 2, c_int32, [c_int32], "cdecl");
  try {
    assert.equal(call(callback, 3), 6);
    assert.equal(await call.callAsync(callback, 4), 8);
    assert.throws(() => callback.setNativeError(1n), /active native-context/);
  } finally {
    callback.release();
  }
});
