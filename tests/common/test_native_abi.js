import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("native exact-call and closure ABI", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  it("mixed and homogeneous exact signatures agree with asynchronous libffi calls", async function () {
    const mixed = lib.func("fixture_exact_mixed", c.c_double, [c.c_int32, c.c_double, c.c_float, c.c_int32]);
    assert.equal(mixed(-7, 1.5, 2.25, 8), 10.75);
    assert.equal(await mixed.callAsync(-7, 1.5, 2.25, 8), 10.75);
    const wide = lib.func("fixture_exact_u64_four", c.c_uint64, [c.c_uint64, c.c_uint64, c.c_uint64, c.c_uint64]);
    const values = [0xffffffffffffffffn, 0x123456789abcdef0n, 0x8765432101234567n, 1n];
    const expected = values.reduce((a, b) => a ^ b);
    assert.equal(wide(...values), expected);
    assert.equal(await wide.callAsync(...values), expected);
  });

  it("non-whitelisted mixed integer signatures use the safe libffi path", async function () {
    const fn = lib.func("fixture_exact_fallback", c.c_int32, [c.c_int16, c.c_int32, c.c_uint64]);
    assert.equal(fn(-7, 8, 9n), 10);
    assert.equal(await fn.callAsync(-7, 8, 9n), 10);
  });

  const types = [
    ["i8", c.c_int8, [-128, -1, 0, 127]],
    ["u8", c.c_uint8, [0, 1, 255]],
    ["i16", c.c_int16, [-32768, -1, 0, 32767]],
    ["u16", c.c_uint16, [0, 1, 65535]],
    ["i32", c.c_int32, [-2147483648, -1, 0, 2147483647]],
    ["u32", c.c_uint32, [0, 1, 4294967295]],
    ["i64", c.c_int64, [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]],
    ["u64", c.c_uint64, [0n, 1n, (1n << 64n) - 1n]],
    ["long", c.c_long, [-7n, 0n, 7n]],
    ["ulong", c.c_ulong, [0n, 1n, 7n]],
    ["size", c.c_size_t, [0n, 1n, 7n]],
    ["ssize", c.c_ssize_t, [-7n, 0n, 7n]],
    ["char", c.c_char, ["\0", "A", "\u00ff"]],
    ["wchar", c.c_wchar, ["\0", "\u4e2d"]],
    ["bool", c.c_bool, [false, true]],
    ["float", c.c_float, [-1.5, 0, 2.25]],
    ["double", c.c_double, [-1.5, 0, 2.25]],
  ];
  for (const [name, T, values] of types) {
    for (const mode of ["ordinary", "thread-safe", "worker"]) {
      it(`${name} ${mode} callback preserves the native scalar return value`, async function () {
        const make = mode === "ordinary" ? c.callback : c.threadSafeCallback;
        const callback = make((value) => value, T, [T]);
        const fn = lib.func(`fixture_callback_${name}`, T, [c.c_void_p, T]);
        try {
          for (const value of values) {
            const expected = new T(value).value;
            assert.equal(mode === "worker" ? await fn.callAsync(callback, value) : fn(callback, value), expected);
          }
        } finally {
          callback.release();
        }
      });
    }
  }

  for (const mode of ["ordinary", "thread-safe", "worker", "wrong-thread"]) {
    it(`${mode} callback failures return zero and retain diagnostics`, async function () {
      const make = mode === "ordinary" || mode === "wrong-thread" ? c.callback : c.threadSafeCallback;
      const callback = make(
        () => {
          throw new Error("expected callback failure");
        },
        c.c_int8,
        [c.c_int8],
      );
      const fn = lib.func("fixture_callback_i8", c.c_int8, [c.c_void_p, c.c_int8]);
      callback._callback.setErrorHandler(() => {});
      try {
        assert.equal(mode === "worker" || mode === "wrong-thread" ? await fn.callAsync(callback, 7) : fn(callback, 7), 0);
        assert.match(callback._callback.getLastError(), /expected callback failure|other than the one/);
      } finally {
        callback.release();
      }
    });
  }

  for (const mode of ["ordinary", "thread-safe", "worker"]) {
    it(`${mode} callbacks preserve arity, receiver and C-data result conversion`, async function () {
      for (const values of [[], [3], [3, 4], [3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
        const types = values.map(() => c.c_int32);
        const make = mode === "ordinary" ? c.callback : c.threadSafeCallback;
        const handler = function (...args) {
          assert.equal(this, undefined);
          assert.deepEqual(args, values);
          return new c.c_int32(args.reduce((sum, value) => sum + value, 0));
        };
        handler.call = () => 99;
        handler.apply = function (receiver, args) {
          assert.equal(this, handler);
          assert.ok(Array.isArray(args));
          return Reflect.apply(handler, receiver, args);
        };
        const callback = make(handler, c.c_int32, types);
        const fn = c.CFUNCTYPE(c.c_int32, ...types)(callback.pointer);
        try {
          assert.equal(
            mode === "worker" ? await fn.callAsync(...values) : fn(...values),
            values.reduce((sum, value) => sum + value, 0),
          );
        } finally {
          callback.release();
        }
      }
    });

    it(`${mode} callbacks retain fallback diagnostics for errors without a message`, async function () {
      const make = mode === "ordinary" ? c.callback : c.threadSafeCallback;
      const callback = make(
        () => {
          throw new Error();
        },
        c.c_int8,
        [c.c_int8],
      );
      const fn = lib.func("fixture_callback_i8", c.c_int8, [c.c_void_p, c.c_int8]);
      const errors = [];
      callback._callback.setErrorHandler((message) => errors.push(message));
      const expected = mode === "ordinary" ? "Unknown error in callback" : mode === "worker" ? "Unknown error in thread-safe callback (external thread)" : "Unknown error in thread-safe callback";
      try {
        assert.equal(mode === "worker" ? await fn.callAsync(callback, 7) : fn(callback, 7), 0);
        assert.equal(callback._callback.getLastError(), expected);
        assert.deepEqual(errors, [expected]);
      } finally {
        callback.release();
      }
    });

    it(`${mode} callback return conversion failures zero the result and retain diagnostics`, async function () {
      const make = mode === "ordinary" ? c.callback : c.threadSafeCallback;
      const callback = make(() => function invalidCallbackResult() {}, c.c_uint16, [c.c_uint16]);
      const fn = lib.func("fixture_callback_u16", c.c_uint16, [c.c_void_p, c.c_uint16]);
      callback._callback.setErrorHandler(() => {});
      try {
        assert.equal(mode === "worker" ? await fn.callAsync(callback, 65535) : fn(callback, 65535), 0);
        assert.match(callback._callback.getLastError(), /function.*cannot be interpreted/);
      } finally {
        callback.release();
      }
    });
  }

  it("invalid callback CIFs fail before closure allocation and tolerate partial cleanup", function () {
    for (const Callback of [c.Callback, c.ThreadSafeCallback]) {
      assert.throws(() => new Callback(() => 1, c.CType.INT32, [new c.StructType()]), /Failed to prepare callback CIF/);
    }
  });

  it("repeated release remains idempotent for both callback resource owners", function () {
    for (const make of [c.callback, c.threadSafeCallback]) {
      for (let i = 0; i < 32; i++) {
        const callback = make((value) => value, c.c_int32, [c.c_int32]);
        assert.equal(callback._callback.getPointer(), callback.pointer);
        callback.release();
        callback.release();
        assert.throws(() => callback._callback.getPointer(), /has been released/);
      }
    }
  });
});
