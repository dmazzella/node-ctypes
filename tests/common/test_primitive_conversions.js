import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
const integers = [
  ["i8", c.c_int8], ["u8", c.c_uint8], ["i16", c.c_int16], ["u16", c.c_uint16],
  ["i32", c.c_int32], ["u32", c.c_uint32], ["i64", c.c_int64], ["u64", c.c_uint64],
  ["size", c.c_size_t], ["ssize", c.c_ssize_t], ["long", c.c_long], ["ulong", c.c_ulong],
];
const integerValues = [0, 1, -1, -2, -3, -1000, -2049, 255, 256, 65535, 65536, 2 ** 32, -(2 ** 32), 2 ** 53, -(2 ** 53), 2 ** 63, -(2 ** 63), -(2 ** 63) - 2048, 2 ** 64, -(2 ** 64), 1e30, -1e30, Number.MAX_VALUE, -Number.MAX_VALUE, false, true, 0n, -1n, 2n ** 64n + 7n, -(2n ** 128n) - 3n];

function integerResult(T, value) {
  const width = c.sizeof(T) * 8;
  const bits = typeof value === "boolean" ? BigInt(+value) : BigInt(value);
  const signed = T === c.c_ssize_t || T === c.c_long || T._signed === true;
  const result = signed ? BigInt.asIntN(width, bits) : BigInt.asUintN(width, bits);
  return width === 64 || T === c.c_long || T === c.c_ulong ? result : Number(result);
}

describe("primitive conversion contracts", { skip: !existsSync(fixture) && `${fixture} not built` }, function () {
  let lib;
  before(() => { lib = new c.CDLL(fixture); });
  after(() => lib.close());

  for (const [name, T] of integers) {
    it(`${name} constructors and fields mask integers without coercing invalid values`, function () {
      const definition = c.struct({ value: T });
      const field = definition.create();
      const native = new c.ArrayType(T._type, 1);
      for (const value of integerValues) {
        const expected = integerResult(T, value);
        assert.equal(new T(value).value, expected);
        definition.set(field._buffer, "value", value);
        assert.equal(field.value, expected);
        assert.equal(T._reader(native.create([value]), 0), expected);
      }
      assert.equal(new T().value, integerResult(T, 0));
      assert.equal(new T(undefined).value, integerResult(T, 0));
      for (const value of [null, "2", {}, [], () => 2, Symbol("number"), 1.5, NaN, Infinity, -Infinity, new T(2)]) {
        assert.throws(() => new T(value), TypeError);
        const instance = new T();
        assert.throws(() => { instance.value = value; }, TypeError);
        if (!(value instanceof T)) assert.throws(() => { field.value = value; }, TypeError);
      }
      field.value = new T(3);
      assert.equal(field.value, integerResult(T, 3));
      const elements = c.array(T, 1)();
      elements[0] = new T(3);
      assert.equal(elements[0], integerResult(T, 3));
      assert.throws(() => { elements[0] = new c.c_double(2); }, TypeError);
      const bits = c.struct({ value: c.bitfield(T, 3) }).create();
      bits.value = new T(3);
      assert.equal(bits.value, 3);
      for (const value of [null, undefined, "2", {}, new c.c_double(2)]) {
        assert.throws(() => { bits.value = value; }, TypeError);
      }
      bits.value = -1;
      assert.equal(bits.value, T._signed ? -1 : 7);
    });

    for (const mode of ["fast", "generic", "async"]) {
      it(`${name} ${mode} calls agree for raw and matching ctypes values`, async function () {
        const generic = mode === "generic";
        const fn = lib.func(`fixture_scalar_${name}${generic ? "_tail" : ""}`, T, generic ? [T, c.c_char_p] : [T]);
        const invoke = (value) => mode === "async" ? fn.callAsync(value) : generic ? fn(value, "x".repeat(16384)) : fn(value);
        for (const value of integerValues) {
          const expected = integerResult(T, value);
          assert.equal(await invoke(value), expected, `${name}: ${String(value)}`);
          assert.equal(await invoke(new T(value)), expected);
        }
        for (const value of ["2", {}, [], () => 2, Symbol("number"), 1.5, NaN, Infinity, -Infinity, new c.c_double(2)]) {
          if (mode === "async") await assert.rejects(async () => invoke(value), c.ArgumentError);
          else assert.throws(() => invoke(value), c.ArgumentError);
        }
      });
    }
  }

  for (const [name, T] of [["float", c.c_float], ["double", c.c_double]]) {
    it(`${name} rejects implicit string/object/null coercions consistently`, async function () {
      const fn = lib.func(`fixture_scalar_${name}`, T, [T]);
      const generic = lib.func(`fixture_scalar_${name}_tail`, T, [T, c.c_char_p]);
      const field = c.struct({ value: T }).create();
      for (const value of [null, "2", {}, [], () => 2, new T(2), new c.c_int32(2)]) {
        assert.throws(() => new T(value), TypeError);
        if (!(value instanceof T)) {
          assert.throws(() => { field.value = value; }, TypeError);
          assert.throws(() => fn(value), c.ArgumentError);
          assert.throws(() => generic(value, "x".repeat(16384)), c.ArgumentError);
          await assert.rejects(async () => fn.callAsync(value), c.ArgumentError);
        }
      }
      for (const value of [false, true, 1.5, -2.25, 17n, -(2n ** 63n), 2n ** 64n - 1n, NaN, Infinity, -Infinity]) {
        const expected = name === "float" ? Math.fround(Number(value)) : Number(value);
        assert.equal(new T(value).value, expected);
        assert.equal(fn(value), expected);
        assert.equal(generic(value, "x".repeat(16384)), expected);
        assert.equal(await fn.callAsync(value), expected);
      }
      for (const value of [-(2n ** 63n) - 1n, 2n ** 64n]) {
        assert.throws(() => new T(value), RangeError);
        assert.throws(() => fn(value), c.ArgumentError);
        assert.throws(() => generic(value, "x".repeat(16384)), c.ArgumentError);
        await assert.rejects(async () => fn.callAsync(value), c.ArgumentError);
      }
      assert.equal(fn(new T(1.5)), 1.5);
    });
  }

  for (const [name, T, values] of [
    ["char", c.c_char, ["A", "\u00ff", 0, 255, false, true, Buffer.from("Z")]],
    ["bool", c.c_bool, [false, true, 0, 2, null, "", "x", new c.c_bool(false), new c.c_int32(0)]],
  ]) {
    for (const mode of ["fast", "generic", "async"]) {
      it(`${name} ${mode} calls preserve scalar conversion`, async function () {
        const generic = mode === "generic";
        const fn = lib.func(`fixture_scalar_${name}${generic ? "_tail" : ""}`, T, generic ? [T, c.c_char_p] : [T]);
        const invoke = (value) => mode === "async" ? fn.callAsync(value) : generic ? fn(value, "x".repeat(16384)) : fn(value);
        for (const value of values) {
          const expected = new T(value).value;
          assert.equal(await invoke(value), expected);
          assert.equal(await invoke(new T(value)), expected);
        }
      });
    }
  }

  it("a variadic wide-string argument leaves the simple path before marshalling it", function () {
    const fn = lib.func("fixture_variadic_wchar", c.c_uint32, [c.c_int32]);
    assert.equal(fn(0, new c.c_wchar_p("\u4e2d")), 0x4e2d);
  });

  for (const mode of ["fast", "generic", "async"]) {
    it(`wchar ${mode} accepts exactly one valid character or a code point`, async function () {
      const generic = mode === "generic";
      const fn = lib.func(`fixture_scalar_wchar${generic ? "_tail" : ""}`, c.c_wchar, generic ? [c.c_wchar, c.c_char_p] : [c.c_wchar]);
      const invoke = (value) => mode === "async" ? fn.callAsync(value) : generic ? fn(value, "x".repeat(16384)) : fn(value);
      const characters = ["A", "\u4e2d", "\ud800", "\0", ...(c.WCHAR_SIZE === 4 ? ["\ud83d\ude00"] : [])];
      for (const value of characters) {
        assert.equal(await invoke(value), value);
        assert.equal(await invoke(new c.c_wchar(value)), value);
        assert.equal(await invoke(value.codePointAt(0)), value);
      }
      for (const value of ["", "ab", null, undefined, false, -1, 1.5, NaN, Infinity, 0x110000, Buffer.from("A"), ...(c.WCHAR_SIZE === 2 ? ["\ud83d\ude00", 0x10000] : [])]) {
        if (mode === "async") await assert.rejects(async () => invoke(value), c.ArgumentError);
        else assert.throws(() => invoke(value), c.ArgumentError);
        if (value !== undefined) assert.throws(() => new c.c_wchar(value), TypeError);
      }
    });
  }

  it("documented 64-bit numeric pointer/null extensions remain argument-only", async function () {
    const source = Buffer.alloc(8);
    for (const [name, T] of integers.filter(([name]) => ["i64", "u64", "size", "ssize"].includes(name))) {
      const fn = lib.func(`fixture_scalar_${name}`, T, [T]);
      for (const value of [null, undefined, source, source.buffer]) {
        const expected = integerResult(T, value == null ? 0 : c.addressof(value instanceof ArrayBuffer ? Buffer.from(value) : value));
        assert.equal(fn(value), expected);
        assert.equal(await fn.callAsync(value), expected);
      }
    }
  });

  it("bool bitfields normalize before masking and preserve adjacent fields as C does", function () {
    class Flags extends c.Structure {
      static _fields_ = [["first", c.c_bool, 1], ["second", c.c_bool, 1]];
    }
    const oracle = lib.func("fixture_bool_bits", c.c_uint8, [c.c_int32, c.c_int32]);
    for (const first of [0, 1, 2, false, true, new c.c_bool(false), new c.c_bool(true)]) {
      for (const second of [0, 1, 2, false, true]) {
        const flags = new Flags();
        flags.first = first;
        flags.second = second;
        const expectedFirst = first instanceof c.c_bool ? first.value : !!first;
        assert.equal(flags.first, expectedFirst);
        assert.equal(flags.second, !!second);
        assert.equal(flags._buffer[0], oracle(+expectedFirst, +!!second));
      }
    }
  });

  it("VARIANT_BOOL uses the value of false/true instances in every context", async function () {
    const T = c.wintypes.VARIANT_BOOL;
    const echo = lib.func("fixture_scalar_i16", T, [T]);
    const field = c.struct({ value: T }).create();
    for (const value of [false, true, 0, 2, new T(false), new T(true), new c.c_bool(false), new c.c_int32(0)]) {
      const expected = value?._isSimpleCDataInstance ? !!value.value : !!value;
      assert.equal(new T(value).value, expected);
      assert.equal(echo(value), expected);
      assert.equal(await echo.callAsync(value), expected);
      if (!(value?._isSimpleCDataInstance) || value instanceof T) {
        field.value = value;
        assert.equal(field.value, expected);
        assert.equal(field._buffer.readInt16LE(), expected ? -1 : 0);
      }
    }
    const invoke = lib.func("fixture_variant_callback", c.c_int16, [c.c_void_p, c.c_int16]);
    for (const answer of [false, true, new T(false), new T(true)]) {
      const callback = c.callback((value) => {
        assert.equal(typeof value, "boolean");
        assert.equal(value, false);
        return answer;
      }, T, [T]);
      try {
        assert.equal(invoke(callback, 0), (answer instanceof T ? answer.value : answer) ? -1 : 0);
      } finally { callback.release(); }
    }
  });
});
