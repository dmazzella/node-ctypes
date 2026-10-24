import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "..", "..", "build", "fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");
async function collect() {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
}

describe("errcheck ownership and per-call snapshots", { skip: !existsSync(fixture) && "native fixture not built" }, function () {
  let lib;
  before(() => {
    lib = new c.CDLL(fixture);
  });
  after(() => lib.close());

  function bind(library, kind, restype = c.c_int32, argtypes = [c.c_char_p, c.c_void_p], symbol = "fixture_first_char_after") {
    if (kind === "raw")
      return library._lib.func(
        symbol,
        restype._type,
        argtypes.map((type) => type._type),
      );
    if (kind === "prototype") return c.CFUNCTYPE(restype, ...argtypes)([symbol, library]);
    if (kind === "attribute") {
      const fn = library[symbol];
      fn.argtypes = argtypes;
      fn.restype = restype;
      return fn;
    }
    return library.func(symbol, restype, argtypes);
  }
  const setCheck = (fn, kind, check) => (kind === "raw" ? fn.setErrcheck(check) : (fn.errcheck = check));
  const invoke = (fn, kind, ...args) => (kind === "raw" ? fn.call(...args) : fn(...args));

  for (const kind of ["func", "attribute", "prototype", "raw"]) {
    it(`${kind}: an abandoned self-referencing hook does not retain the function or library`, async function () {
      function abandon() {
        const library = new c.CDLL(fixture);
        const fn = bind(library, kind);
        const check = (result) => {
          assert.ok(fn);
          assert.ok(library);
          return result;
        };
        setCheck(fn, kind, check);
        assert.equal(invoke(fn, kind, "A", null), 65);
        return [new WeakRef(fn), new WeakRef(fn._ffi ?? fn), new WeakRef(library._lib), new WeakRef(check)];
      }
      const references = abandon();
      await collect();
      assert.ok(references.every((reference) => reference.deref() === undefined));
    });

    it(`${kind}: errcheck receives the invoked function and replacement affects only the next call`, function () {
      const fn = bind(lib, kind);
      const next = (result, func) => {
        assert.equal(func, fn);
        return 202;
      };
      const old = (result, func) => {
        assert.equal(func, fn);
        return 101;
      };
      let nested;
      const cb = c.callback(
        () => {
          setCheck(fn, kind, next);
          nested = invoke(fn, kind, "B", null);
        },
        null,
        [],
      );
      try {
        for (const text of ["A", "A".repeat(2048)]) {
          setCheck(fn, kind, old);
          assert.equal(invoke(fn, kind, text, cb.pointer), 101);
          assert.equal(nested, 202);
          assert.equal(invoke(fn, kind, "A", null), 202);
        }
      } finally {
        setCheck(fn, kind, null);
        cb.release();
      }
    });

    it(`${kind}: async calls own their original hook, including clearing and adding hooks`, async function () {
      const fn = bind(lib, kind);
      const first = (result, func) => {
        assert.equal(func, fn);
        return 101;
      };
      setCheck(fn, kind, first);
      const pending = fn.callAsync("A", null);
      setCheck(fn, kind, () => 202);
      assert.equal(await pending, 101);
      const clearing = fn.callAsync("A", null);
      setCheck(fn, kind, null);
      assert.equal(await clearing, 202);
      const unchecked = fn.callAsync("A", null);
      setCheck(fn, kind, () => 303);
      assert.equal(await unchecked, 65);
      setCheck(fn, kind, () => {
        throw new Error("original async hook");
      });
      const rejected = fn.callAsync("A", null);
      setCheck(fn, kind, null);
      await assert.rejects(rejected, /original async hook/);
    });

    if (kind !== "raw") {
      it(`${kind}: snapshots precede from_param and errcheck receives the original argument`, function () {
        let fn;
        const next = () => 202;
        class Adapted extends c.c_char_p {
          static from_param(value) {
            fn.errcheck = next;
            return value.value;
          }
        }
        fn = bind(lib, kind, c.c_int32, [Adapted, c.c_void_p]);
        const input = { value: "A" };
        fn.errcheck = (result, func, args) => {
          assert.equal(func, fn);
          assert.equal(args[0], input);
          return 101;
        };
        try {
          assert.equal(fn(input, null), 101);
          assert.equal(fn(input, null), 202);
          fn.errcheck = null;
          assert.equal(fn(input, null), 65, "an adapter cannot add an errcheck to the call already in progress");
        } finally {
          fn.errcheck = null;
        }
      });
    }
  }

  it("raw hooks are kept alive by their handle and by a running call after removal", async function () {
    const fn = bind(lib, "raw");
    function install() {
      const check = () => 101;
      fn.setErrcheck(check);
      return new WeakRef(check);
    }
    const check = install();
    await collect();
    assert.ok(check.deref());
    await new Promise((resolve) => setImmediate(resolve));
    const cb = c.callback(
      () => {
        fn.setErrcheck(null);
        for (let i = 0; i < 8; i++) gc();
        assert.ok(check.deref(), "the active native call must keep its snapshot");
      },
      null,
      [],
    );
    try {
      assert.equal(fn.call("A", cb.pointer), 101);
    } finally {
      cb.release();
      fn.setErrcheck(null);
    }
    await collect();
    assert.equal(check.deref(), undefined);
  });

  for (const kind of ["func", "raw"]) {
    it(`${kind}: an async snapshot stays alive through native callbacks and is released on completion`, async function () {
      const fn = bind(lib, kind);
      function install() {
        const check = () => 101;
        setCheck(fn, kind, check);
        return new WeakRef(check);
      }
      const reference = install();
      const cb = c.threadSafeCallback(
        () => {
          setCheck(fn, kind, null);
          for (let i = 0; i < 8; i++) gc();
          assert.ok(reference.deref(), "the async worker must own the removed hook");
        },
        null,
        [],
      );
      try {
        assert.equal(await fn.callAsync("A", cb.pointer), 101);
      } finally {
        cb.release();
        setCheck(fn, kind, null);
      }
      await collect();
      assert.equal(reference.deref(), undefined, "the completed worker retained its snapshot");
    });
  }

  it("a raw detached call passes its native handle to errcheck", function () {
    const fn = bind(lib, "raw");
    fn.setErrcheck((result, func) => {
      assert.equal(func, fn);
      return result;
    });
    try {
      const call = fn.call;
      assert.equal(call("A", null), 65);
    } finally {
      fn.setErrcheck(null);
    }
  });

  it("raw hooks remain mutable when the native handle is frozen", function () {
    const fn = bind(lib, "raw");
    Object.freeze(fn);
    fn.setErrcheck(() => 101);
    try {
      assert.equal(fn.call("A", null), 101);
      fn.setErrcheck(() => 202);
      assert.equal(fn.call("A", null), 202);
    } finally {
      fn.setErrcheck(null);
    }
    assert.equal(fn.call("A", null), 65);
  });

  it("a raw slow-path fallback uses the entry snapshot even when an inferred value changes it", function () {
    const fn = lib._lib.func("fixture_first_char_after", c.CType.INT32, []);
    class Text extends c.c_char_p {
      get value() {
        fn.setErrcheck(() => 202);
        return "A".repeat(2048);
      }
    }
    fn.setErrcheck(() => 101);
    try {
      assert.equal(fn.call(new Text(), null), 101);
    } finally {
      fn.setErrcheck(null);
    }
  });

  for (const kind of ["func", "prototype"]) {
    it(`${kind}: converted pointer results keep the async hook snapshot`, async function () {
      const fn = bind(lib, kind, c.POINTER(c.c_int32), [c.c_void_p], "fixture_address");
      const input = new c.c_int32(7);
      fn.errcheck = (result, func, args) => {
        assert.equal(func, fn);
        assert.equal(args[0], input);
        assert.equal(result.address, c.addressof(input));
        return 101;
      };
      const pending = fn.callAsync(input);
      fn.errcheck = () => 202;
      try {
        assert.equal(await pending, 101);
      } finally {
        fn.errcheck = null;
      }
    });
  }

  it("a result constructor cannot replace the hook of its own call", function () {
    let fn;
    class Bits extends c.Union {
      static _fields_ = [
        ["integer", c.c_int32],
        ["real", c.c_float],
      ];
    }
    class Tagged extends c.Structure {
      static _fields_ = [
        ["tag", c.c_int32],
        ["value", Bits],
      ];
      constructor(...args) {
        super(...args);
        fn.errcheck = () => 202;
      }
    }
    fn = lib.func("fixture_tagged_make", Tagged, [c.c_int32, c.c_int32]);
    fn.errcheck = (result, func) => {
      assert.equal(func, fn);
      assert.ok(result instanceof Tagged);
      return 101;
    };
    try {
      assert.equal(fn(0, 7), 101);
    } finally {
      fn.errcheck = null;
    }
  });

  it("invalid hook assignments do not replace a valid hook", function () {
    for (const kind of ["func", "attribute", "prototype", "raw"]) {
      const fn = bind(lib, kind);
      setCheck(fn, kind, () => 101);
      try {
        assert.throws(() => setCheck(fn, kind, {}), /errcheck must be a function or null/);
        assert.equal(invoke(fn, kind, "A", null), 101);
      } finally {
        setCheck(fn, kind, null);
      }
    }
  });

  it("public hooks work with frozen native handles and preserve explicitly configured raw hooks", function () {
    const fn = bind(lib, "func");
    Object.freeze(fn._ffi);
    fn._ffi.setErrcheck(() => 303);
    fn.errcheck = () => 101;
    try {
      assert.equal(fn("A", null), 101);
      assert.equal(fn._ffi.call("A", null), 303);
      fn.errcheck = null;
      assert.equal(fn._ffi.call("A", null), 303);
    } finally {
      fn.errcheck = null;
      fn._ffi.setErrcheck(null);
    }
  });

  it("checked variadic calls preserve all arguments beyond the inline callback capacity", async function () {
    const fn = lib.func("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32]);
    const values = [null, 8, 1, 2, 3, 4, 5, 6, 7, 8];
    fn.errcheck = (result, func, args) => {
      assert.equal(func, fn);
      assert.deepEqual(args, values);
      return result;
    };
    try {
      assert.equal(fn(...values), 36);
      assert.equal(await fn.callAsync(...values), 36);
    } finally {
      fn.errcheck = null;
    }
  });

  it("public errcheck still runs while its native library call is active", function () {
    const library = new c.CDLL(fixture);
    const fn = bind(library, "func");
    fn.errcheck = (result) => {
      assert.throws(() => library.close(), /calls to its functions are in progress/);
      return result;
    };
    try {
      assert.equal(fn("A", null), 65);
    } finally {
      fn.errcheck = null;
      library.close();
    }
  });

  it("paramflags use their own binding and snapshot the hook before named getters", function () {
    const argtypes = [c.c_int32, c.c_int32, c.POINTER(c.c_int32)];
    const shared = lib.func("fixture_divmod", c.c_int32, argtypes);
    shared.errcheck = () => 303;
    const fn = c.CFUNCTYPE(c.c_int32, ...argtypes).bind(lib, "fixture_divmod", [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ]);
    fn.errcheck = (result, func, args) => {
      assert.equal(result, 3);
      assert.equal(func, fn);
      return args;
    };
    try {
      assert.equal(
        fn({
          get a() {
            fn.errcheck = () => 202;
            return 17;
          },
          b: 5,
        }),
        2,
      );
      assert.equal(fn(17, 5), 202);
      assert.equal(shared(17, 5, new c.c_int32()), 303);
    } finally {
      shared.errcheck = null;
      fn.errcheck = null;
    }
  });

  it("paramflags async calls preserve output instances, hook identity and snapshots", async function () {
    const fn = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32, c.POINTER(c.c_int32)).bind(lib, "fixture_divmod", [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ]);
    fn.errcheck = (result, func, args) => {
      assert.equal(func, fn);
      assert.ok(args[2] instanceof c.c_int32);
      return args;
    };
    const pending = fn.callAsync(17, 5);
    fn.errcheck = () => 202;
    assert.equal(await pending, 2);
    assert.equal(await fn.callAsync(17, 5), 202);
    fn.errcheck = () => {
      throw new Error("output hook failed");
    };
    await assert.rejects(fn.callAsync(17, 5), /output hook failed/);
    fn.errcheck = null;
  });

  for (const async of [false, true]) {
    it(`paramflags retain adapter temporaries through ${async ? "async" : "sync"} errcheck`, async function () {
      let owner = Buffer.alloc(4096);
      const reference = new WeakRef(owner);
      await new Promise((resolve) => setImmediate(resolve));
      class Temporary extends c.c_void_p {
        static from_param() {
          const buffer = owner;
          owner = null;
          return c.cast(new c.c_void_p(buffer), c.POINTER(c.c_uint8));
        }
      }
      const fn = c.CFUNCTYPE(c.c_void_p, Temporary).bind(lib, "fixture_address", [[1, "value"]]);
      fn.errcheck = (result, func) => {
        assert.equal(func, fn);
        for (let i = 0; i < 8; i++) gc();
        assert.ok(reference.deref(), "output processing released argument temporaries too soon");
        return result;
      };
      try {
        const result = async ? await fn.callAsync(0) : fn(0);
        assert.equal(typeof result, "bigint");
      } finally {
        fn.errcheck = null;
      }
      await collect();
      assert.equal(reference.deref(), undefined);
    });
  }

  it("HRESULT validation remains before errcheck for synchronous and async output bindings", async function () {
    const ole = new c.OleDLL(fixture);
    const fn = c.WINFUNCTYPE(c.HRESULT, c.c_int32, c.c_int32, c.POINTER(c.c_int32)).bind(ole, "fixture_divmod", [
      [1, "a"],
      [1, "b"],
      [2, "remainder"],
    ]);
    let checks = 0;
    fn.errcheck = (_result, _func, args) => {
      checks++;
      return args;
    };
    try {
      assert.throws(() => fn(-7, 2), /HRESULT/);
      assert.equal(checks, 0);
      await assert.rejects(fn.callAsync(-7, 2), /HRESULT/);
      assert.equal(checks, 0);
      assert.equal(await fn.callAsync(17, 5), 2);
      assert.equal(checks, 1);
    } finally {
      fn.errcheck = null;
      ole.close();
    }
  });
});
