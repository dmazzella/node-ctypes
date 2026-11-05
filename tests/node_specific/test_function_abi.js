import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.resolve(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
const indirectStackBug = process.platform === "darwin" && process.arch === "arm64";
const largeSizes = [17, 19, 24, 31, 32, 33, 65, 257, 4097];

describe("Native function ABI", { skip: !existsSync(fixture) && "native fixture not built" }, () => {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(fixture);
  });
  afterEach(() => lib.close());

  it("spills signed and unsigned integer arguments without losing high bits", async () => {
    const signed = lib.func("fixture_abi_i32_stack", c.c_int64, Array(10).fill(c.c_int32));
    const values = Array.from({ length: 10 }, (_, i) => (i % 2 ? -2147483648 : 2147483647));
    const expected = values.reduce((sum, value, i) => sum + BigInt(value) * BigInt(i + 1), 0n);
    assert.equal(signed(...values), expected);
    assert.equal(await signed.callAsync(...values), expected);
    const unsigned = lib.func("fixture_abi_u64_stack", c.c_uint64, Array(10).fill(c.c_uint64));
    for (let i = 0; i < 10; i++) {
      const args = Array(10).fill(0n);
      args[i] = 0xffffffffffffffffn;
      assert.equal(unsigned(...args), BigInt.asUintN(64, args[i] << BigInt(i)));
    }
  });

  it("packs narrow scalars after exhausting GP and FP register banks", async () => {
    for (const [symbol, types, values, result] of [
      ["fixture_abi_narrow_stack", Array.from({ length: 4 }, () => [c.c_int8, c.c_uint8, c.c_int16, c.c_uint16]).flat(), [-128, 255, -32768, 65535, 127, 128, 32767, 32768, -128, 255, -32768, 65535, 127, 128, 32767, 32768], c.c_int64],
      [
        "fixture_abi_narrow_mixed_stack",
        [...Array(8).fill(c.c_int32), ...Array(8).fill(c.c_double), c.c_int8, c.c_uint8, c.c_int16, c.c_uint16, c.c_int8, c.c_uint8, c.c_int16, c.c_uint16, c.c_float, c.c_double],
        [...Array.from({ length: 8 }, (_, i) => i - 4), ...Array.from({ length: 8 }, (_, i) => i + 0.25), -128, 255, -32768, 65535, 127, 128, 32767, 32768, -1.5, 2.25],
        c.c_double,
      ],
    ]) {
      const fn = lib.func(symbol, result, types);
      const expected = result === c.c_int64 ? values.reduce((sum, value, i) => sum + BigInt(value) * BigInt(i + 1), 0n) : values.reduce((sum, value, i) => sum + value * (i + 1), 0);
      assert.equal(fn(...values), expected);
      assert.equal(await fn.callAsync(...values), expected);
      for (let i = 0; i < types.length; i++) {
        const basis = Array(types.length).fill(0);
        basis[i] = 1;
        assert.equal(fn(...basis), result === c.c_int64 ? BigInt(i + 1) : i + 1);
      }
    }
  });

  it("keeps interleaved integer, float and double argument banks independent", async () => {
    const types = Array.from({ length: 9 }, () => [c.c_int32, c.c_float, c.c_double]).flat();
    const values = Array.from({ length: 9 }, (_, i) => [i - 4, i + 0.5, -i - 0.25]).flat();
    const fn = lib.func("fixture_abi_mixed_stack", c.c_double, types);
    const expected = values.reduce((sum, value, i) => sum + value * (1 + Math.floor(i / 3)), 0);
    assert.equal(fn(...values), expected);
    assert.equal(await fn.callAsync(...values), expected);
  });

  it("preserves Structure result identity and previously returned values", async () => {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    const make = lib.func("fixture_point_make", Point, [c.c_int32, c.c_int32]);
    const sum = lib.func("fixture_point_sum", c.c_int32, [Point]);
    const value = make(3, 7);
    assert.ok(value instanceof Point);
    assert.equal(sum(value), 10);
    assert.equal(sum(await make.callAsync(-100, 19)), -81);
    assert.deepEqual(value.toObject(), { x: 3, y: 7 });
    sum.errcheck = (result) => result + 1;
    assert.equal(sum(value), 11);
  });

  for (let size = 1; size <= 16; size++) {
    it(`passes ${size}-byte GP aggregates in whole register groups and stack slots`, async () => {
      const Record = c.struct({ values: c.array(c.c_uint8, size) });
      assert.equal(c.sizeof(Record), size);
      assert.equal(c.alignment(Record), 1);
      const echo = lib.func(`fixture_bytes_${size}_echo`, Record, [Record]);
      const values = Array.from({ length: size }, (_, i) => (17 * i + 129) & 255);
      const record = Record.create({ values });
      assert.deepEqual([...echo(record).values], values);
      assert.deepEqual([...(await echo.callAsync(record)).values], values);
      const prefix = [1n, -2n, 3n, -4n, 5n, -6n, 7n];
      const checksum = BigInt(values.reduce((sum, value, i) => sum + value * (i + 1), 0) - 17 * 128 + 19 * 65535);
      const expected = prefix.reduce((sum, value, i) => sum + value * BigInt(i + 1), checksum);
      for (const [suffix, types, args, result] of [
        ["stack", [...Array(7).fill(c.c_int64), Record, c.c_int8, c.c_uint16], [...prefix, record, -128, 65535], expected],
        ["stack_full", [...Array(8).fill(c.c_int64), Record, c.c_int8, c.c_uint16], [...prefix, -11n, record, -128, 65535], expected - 88n],
        ["stack_leading", [...Array(8).fill(c.c_int64), c.c_int8, Record, c.c_int8, c.c_uint16], [...prefix, -11n, -31, record, -128, 65535], expected - 801n],
      ]) {
        const fn = lib.func(`fixture_bytes_${size}_${suffix}`, c.c_int64, types);
        assert.equal(fn(...args), result);
        assert.equal(await fn.callAsync(...args), result);
      }
      const stack = lib.func(`fixture_bytes_${size}_stack`, c.c_int64, [...Array(7).fill(c.c_int64), Record, c.c_int8, c.c_uint16]);
      for (let i = 0; i < size; i++) {
        const basis = Array(size).fill(0);
        basis[i] = 1;
        assert.equal(stack(...Array(7).fill(0n), { values: basis }, 0, 0), BigInt(i + 1));
      }
      assert.deepEqual([...record.values], values);
    });
  }

  for (const [name, type] of [
    ["f32", c.c_float],
    ["f64", c.c_double],
  ]) {
    for (let count = 1; count <= 5; count++) {
      it(`passes and returns homogeneous ${name}[${count}] aggregates`, async () => {
        const Record = c.struct({ values: c.array(type, count) });
        const symbol = `fixture_hfa_${name}_${count}`;
        const echo = lib.func(`${symbol}_echo`, Record, [Record]);
        const make = lib.func(`${symbol}_make`, Record, [type]);
        const sum = lib.func(`${symbol}_sum`, c.c_double, [Record]);
        const values = Array.from({ length: count }, (_, i) => i + 0.25);
        const checksum = values.reduce((total, value, i) => total + value * (i + 1), 0);
        const created = Array.from({ length: count }, (_, i) => -1.5 + i / 4);
        assert.deepEqual([...echo({ values }).values], values);
        assert.deepEqual([...make(-1.5).values], created);
        assert.equal(sum({ values }), checksum);
        const results = await Promise.all([echo.callAsync({ values }), make.callAsync(-1.5), sum.callAsync({ values })]);
        assert.deepEqual([...results[0].values], values);
        assert.deepEqual([...results[1].values], created);
        assert.equal(results[2], checksum);
        for (const value of [-0, NaN, Infinity, -Infinity]) {
          const special = Array(count).fill(value);
          assert.deepEqual([...echo({ values: special }).values], special);
        }
        const prefix = Array.from({ length: 7 }, (_, i) => i - 3.5);
        const expected = prefix.reduce((total, value, i) => total + value * (i + 1), checksum) - 17 * 2.5 + 19 * 17;
        const stack = lib.func(`${symbol}_stack`, c.c_double, [...Array(7).fill(c.c_double), Record, c.c_float, c.c_int32]);
        assert.equal(stack(...prefix, { values }, -2.5, 17), expected);
        const full = lib.func(`${symbol}_stack_full`, c.c_double, [...Array(8).fill(c.c_double), c.c_float, Record, c.c_float, c.c_int32]);
        assert.equal(full(...prefix, 2.25, -1.5, { values }, -2.5, 17), expected + 18 - 34.5);
        for (let i = 0; i < count; i++) {
          const basis = Array(count).fill(0);
          basis[i] = 1;
          assert.equal(stack(...Array(7).fill(0), { values: basis }, 0, 0), i + 1);
        }
      });
    }
  }

  it("classifies nested homogeneous aggregates without confusing equal-sized mixed layouts", () => {
    const Pair = c.struct({ first: c.c_double, second: c.c_double });
    const Nested = c.struct({ pairs: c.array(Pair, 2) });
    const input = {
      pairs: [
        { first: -1.5, second: 2.25 },
        { first: -3.5, second: 4.25 },
      ],
    };
    const echo = lib.func("fixture_nested_hfa_echo", Nested, [Nested]);
    const pairs = [...echo(input).pairs].map((pair) => [pair.first, pair.second]);
    assert.deepEqual(pairs, [
      [-1.5, 2.25],
      [-3.5, 4.25],
    ]);
    assert.equal(lib.func("fixture_nested_hfa_sum", c.c_double, [Nested])(input), 9.5);
    const Mixed = c.struct({ first: c.c_float, second: c.c_int32, third: c.c_double });
    const value = { first: -1.5, second: -2147483648, third: 2.25 };
    assert.deepEqual(lib.func("fixture_mixed_aggregate_echo", Mixed, [Mixed])(value), value);
  });

  it("packs GP aggregates and narrow scalars independently of spilled homogeneous FP aggregates", async () => {
    const Bytes = c.struct({ values: c.array(c.c_uint8, 15) });
    const HFA = c.struct({ values: c.array(c.c_float, 4) });
    const types = [...Array(7).fill(c.c_int64), ...Array(7).fill(c.c_double), Bytes, c.c_int8, HFA, c.c_uint16, c.c_float];
    const fn = lib.func("fixture_abi_aggregate_stack", c.c_double, types);
    const values = [...Array.from({ length: 7 }, (_, i) => BigInt(i - 3)), ...Array.from({ length: 7 }, (_, i) => i - 3.5), { values: Array.from({ length: 15 }, (_, i) => 129 + i) }, -128, { values: [-1.5, 2.25, -3.5, 4.25] }, 65535, -2.5];
    const expected =
      values.slice(0, 14).reduce((sum, value, i) => sum + Number(value) * (i + 1), 0) +
      values[14].values.reduce((sum, value, i) => sum + value * (i + 1), 0) +
      values[16].values.reduce((sum, value, i) => sum + value * (i + 1), 0) +
      17 * values[15] +
      19 * values[17] +
      23 * values[18];
    assert.equal(fn(...values), expected);
    assert.equal(await fn.callAsync(...values), expected);
  });

  for (const size of largeSizes) {
    it(`passes ${size}-byte aggregates by value with independent argument and result buffers`, async () => {
      const Record = c.struct({ values: c.array(c.c_uint8, size) });
      assert.equal(c.sizeof(Record), size);
      const echo = lib.func(`fixture_bytes_${size}_echo`, Record, [Record]);
      const values = Array.from({ length: size }, (_, i) => (17 * i + 129) & 255);
      const input = Buffer.from(values);
      assert.deepEqual([...echo(input).values], values);
      assert.deepEqual([...(await echo.callAsync(input)).values], values);
      const layouts = [
        ["stack", [...Array(7).fill(c.c_int64), Record, c.c_int8, c.c_uint16], [...Array(7).fill(0n), input, -128, 65535], 0n],
        ["stack_full", [...Array(8).fill(c.c_int64), Record, c.c_int8, c.c_uint16], [...Array(8).fill(0n), input, -128, 65535], 0n],
      ];
      if (!indirectStackBug) layouts.push(["stack_leading", [...Array(8).fill(c.c_int64), c.c_int8, Record, c.c_int8, c.c_uint16], [...Array(8).fill(0n), -31, input, -128, 65535], -713n]);
      for (const [suffix, types, args, extra] of layouts) {
        const fn = lib.func(`fixture_bytes_${size}_${suffix}`, c.c_int64, types);
        const expected = BigInt(values.reduce((sum, value, i) => sum + value * (i + 1), 0) - 17 * 128 + 19 * 65535) + extra;
        assert.equal(fn(...args), expected);
        assert.equal(await fn.callAsync(...args), expected);
      }
      assert.deepEqual(input, Buffer.from(values));
    });
  }

  it("aligns indirect aggregate pointer slots after a narrow stack argument", { todo: indirectStackBug && "libffi upstream still uses the aggregate's alignment for its indirect pointer on Darwin ARM64" }, async () => {
    const Record = c.struct({ values: c.array(c.c_uint8, 17) });
    const fn = lib.func("fixture_indirect_stack_tags", c.c_uint32, [...Array(8).fill(c.c_int64), c.c_int8, Record, c.c_int8, c.c_uint16]);
    const input = Buffer.alloc(17, 0x41);
    const results = [];
    const expected = [];
    for (const [leading, tail, last] of [
      [-31, -128, 65535],
      [127, -1, 0xa5a5],
      [-128, 1, 1],
    ]) {
      const args = [...Array(8).fill(0n), leading, input, tail, last];
      const value = ((leading & 255) | ((tail & 255) << 8) | (last << 16)) >>> 0;
      results.push([fn(...args), await fn.callAsync(...args)]);
      expected.push([value, value]);
    }
    assert.deepEqual(results, expected);
  });

  it("keeps large value arguments private when a C callee modifies or aliases its copies", async () => {
    const Record = c.struct({ values: c.array(c.c_uint8, 33) });
    const mutate = lib.func("fixture_large_mutate", Record, [Record, c.c_uint8]);
    const alias = lib.func("fixture_large_alias", Record, [Record, Record, c.c_uint8]);
    const values = Array.from({ length: 33 }, (_, i) => 129 + i);
    const input = Buffer.from(values);
    const record = Record.create({ values });
    const expected = values.map((value) => value ^ 0xa5);
    assert.deepEqual([...mutate(input, 0xa5).values], expected);
    assert.deepEqual([...mutate(record, 0xa5).values], expected);
    for (const result of await Promise.all(Array.from({ length: 8 }, () => mutate.callAsync(input, 0xa5)))) assert.deepEqual([...result.values], expected);
    assert.deepEqual([...alias(input, input, 0xa5).values], values);
    assert.deepEqual(input, Buffer.from(values));
    assert.deepEqual([...record.values], values);
  });

  it("keeps inferred signatures and each variadic named-prefix boundary distinct", async () => {
    for (const [symbol, args] of [
      ["fixture_variadic_one", [c.c_int32]],
      ["fixture_variadic_two", [c.c_int32, c.c_double]],
      ["fixture_inferred_mixed", []],
    ]) {
      const fn = lib.func(symbol, c.c_double, args);
      assert.equal(fn(7, 1.5, 3), 322);
      assert.equal(await fn.callAsync(-7, 2.5, 4), 418);
    }
  });

  it("marshals variadic integer suffixes across inline argument and type-storage boundaries", async () => {
    const fn = lib.func("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32]);
    for (const count of [6, 7, 8, 14, 15, 16, 17]) {
      const values = Array.from({ length: count }, (_, i) => (i % 2 ? -i : i + 1));
      const expected = values.reduce((sum, value) => sum + value, 0);
      assert.equal(fn(null, count, ...values), expected);
      assert.equal(await fn.callAsync(null, count, ...values), expected);
      const typed = values.map((value) => new c.c_int8(value));
      assert.equal(fn(null, count, ...typed), expected);
      assert.equal(await fn.callAsync(null, count, ...typed), expected);
    }
  });

  it("promotes variadic floating suffixes across inline argument and type-storage boundaries", async () => {
    const fn = lib.func("fixture_variadic_double_sum", c.c_double, [c.c_int32]);
    for (const count of [7, 8, 15, 16, 17]) {
      const values = Array.from({ length: count }, (_, i) => i + 0.25);
      const expected = values.reduce((sum, value) => sum + value, 0);
      assert.equal(fn(count, ...values), expected);
      assert.equal(await fn.callAsync(count, ...values), expected);
      const typed = values.map((value) => new c.c_float(value));
      assert.equal(fn(count, ...typed), expected);
      assert.equal(await fn.callAsync(count, ...typed), expected);
    }
  });

  it("keeps numeric prefixes and scalar snapshots independent of later adapters", async () => {
    const fn = lib.func("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32]);
    const checked = [];
    fn.errcheck = (result, _func, args) => {
      checked.push(args);
      return result;
    };
    for (const async of [false, true]) {
      const first = new c.c_int32(-31);
      Object.defineProperty(first, "value", {
        get() {
          throw new Error("overridden scalar getter must not run");
        },
      });
      let conversions = 0;
      const next = {
        get _as_parameter_() {
          conversions++;
          first._buffer.writeInt32LE(99);
          return 7;
        },
      };
      const values = [1, 2, first, next, ...Array(10).fill(3)];
      assert.equal(async ? await fn.callAsync(null, values.length, ...values) : fn(null, values.length, ...values), 9);
      assert.equal(conversions, 1);
      assert.equal(checked.at(-1).length, values.length + 2);
      assert.equal(checked.at(-1)[4], first);
      assert.equal(first._buffer.readInt32LE(), 99);
    }
  });

  it("retains marshalled numeric arguments while a callback reenters and evicts other signatures", () => {
    const fn = lib.func("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32]);
    const inner = [];
    const callback = c.callback(
      () => {
        for (let count = 1; count <= 20; count++) inner.push(fn(null, count, ...Array(count).fill(count)));
      },
      c.c_void,
      [],
    );
    try {
      assert.equal(fn(callback, 14, ...Array(14).fill(3)), 42);
      assert.deepEqual(
        inner,
        Array.from({ length: 20 }, (_, i) => (i + 1) ** 2),
      );
    } finally {
      callback.release();
    }
  });

  it("keeps inferred wide numeric stack arguments exact after fused marshalling", async () => {
    const fn = lib.func("fixture_abi_u64_stack", c.c_uint64, []);
    const values = [2 ** 53, -(2 ** 53), -(2 ** 31) - 1, ...Array.from({ length: 7 }, (_, i) => 2 ** (32 + i * 2) + i)];
    const expected = BigInt.asUintN(
      64,
      values.reduce((sum, value, i) => sum ^ (BigInt(value) << BigInt(i)), 0n),
    );
    assert.equal(fn(...values), expected);
    assert.equal(await fn.callAsync(...values), expected);
  });

  it("keeps non-finite variadic doubles out of integer casts in the generic path", async () => {
    const fn = lib.func("fixture_variadic_double_sum", c.c_double, [c.c_int32]);
    for (const value of [NaN, Infinity, -Infinity]) {
      const values = [...Array(14).fill(0.25), value];
      assert.equal(fn(values.length, ...values), value);
      assert.equal(await fn.callAsync(values.length, ...values), value);
    }
  });

  it("preserves scalar backing-byte snapshots and conversion order for inferred arguments", async () => {
    const fn = lib.func("fixture_inferred_mixed", c.c_double, []);
    for (const async of [false, true]) {
      const first = new c.c_int32(7);
      Object.defineProperty(first, "value", {
        get() {
          throw new Error("overridden scalar getter must not run");
        },
      });
      const order = [];
      const second = {
        get _as_parameter_() {
          order.push("second");
          first._buffer.writeInt32LE(99);
          return new c.c_double(1.5);
        },
      };
      assert.equal(async ? await fn.callAsync(first, second, 3) : fn(first, second, 3), 322);
      assert.deepEqual(order, ["second"]);
      assert.equal(first._buffer.readInt32LE(), 99);
    }
  });

  it("promotes variadic scalar aliases and preserves wide bits, pointers and strings", async () => {
    const fn = lib.func("fixture_variadic_types", c.c_uint64, [c.c_int32]);
    const wide = (1n << 63n) + 0x12345n;
    const buffer = Buffer.alloc(1);
    const args = [7, new c.c_int8(-128), new c.c_char("\xff"), new c.c_wchar("\u6c34"), new c.c_bool(true), new c.c_float(1.5), new c.c_uint64(wide), "hello", new c.c_wchar_p("\u6c34ABC"), buffer];
    const expected = wide ^ BigInt(7 - 3 * 128 + 5 * 255 + 7 * 0x6c34 + 11 + 16 * 1.5 + 17 * 5 + 19 * 4 + 23);
    assert.equal(fn(...args), expected);
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => fn.callAsync(...args))), Array(8).fill(expected));
  });

  it("places anonymous variadic values after narrow named stack arguments", async () => {
    const fn = lib.func("fixture_variadic_stack", c.c_double, [...Array(8).fill(c.c_int32), c.c_int8, c.c_double]);
    const args = [1, 2, 3, 4, 5, 6, 7, 8, -31, 1.5, -127, 2.25, -5000000000n];
    const expected = 204 - 341 + 19.5 - 2159 + 42.75 - 115000000000;
    assert.equal(lib.func("fixture_variadic_stack_reference", c.c_double, [])(), expected);
    assert.equal(fn(...args), expected);
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => fn.callAsync(...args))), Array(8).fill(expected));
  });

  it("keeps named homogeneous arguments and aggregate results separate from anonymous FP arguments", async () => {
    const Record = c.struct({ values: c.array(c.c_double, 4) });
    const fn = lib.func("fixture_variadic_hfa", Record, [Record, c.c_int32]);
    const input = { values: [0.25, 1.25, 2.25, 3.25] };
    const args = [input, 2, 1.5, 2.25];
    const expected = [4, 8.75, 13.5, 18.25];
    assert.deepEqual([...fn(...args).values], expected);
    for (const result of await Promise.all(Array.from({ length: 8 }, () => fn.callAsync(...args)))) assert.deepEqual([...result.values], expected);
    assert.deepEqual(input.values, [0.25, 1.25, 2.25, 3.25]);
  });
});
