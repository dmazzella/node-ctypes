import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";

const fixture = path.resolve(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);
const size64 = c.sizeof(c.c_size_t) === 8;
const scalars = [
  ["i8", c.c_int8, [-128, -1, 0, 127]],
  ["u8", c.c_uint8, [0, 1, 128, 255]],
  ["i16", c.c_int16, [-32768, -1, 0, 32767]],
  ["u16", c.c_uint16, [0, 1, 32768, 65535]],
  ["i32", c.c_int32, [-2147483648, -1, 0, 2147483647]],
  ["u32", c.c_uint32, [0, 1, 2147483648, 4294967295]],
  ["i64", c.c_int64, [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]],
  ["u64", c.c_uint64, [0n, 1n << 63n, (1n << 64n) - 1n]],
  ["size", c.c_size_t, size64 ? [0n, (1n << 64n) - 1n] : [0, 4294967295]],
  ["ssize", c.c_ssize_t, size64 ? [-(1n << 63n), (1n << 63n) - 1n] : [-2147483648, 2147483647]],
  ["long", c.c_long, [c.sizeof(c.c_long) === 8 ? -(1n << 63n) : -2147483648]],
  ["ulong", c.c_ulong, [c.sizeof(c.c_ulong) === 8 ? (1n << 64n) - 1n : 4294967295]],
  ["float", c.c_float, [-0, 1.5, Math.PI, NaN, Infinity, -Infinity]],
  ["double", c.c_double, [-0, Math.PI, NaN, Infinity, -Infinity]],
  ["char", c.c_char, ["\0", "A", "\x7f", "\x80", "\xff"]],
  ["wchar", c.c_wchar, ["\0", "A", "\u00e9", "\u6c34"]],
  ["bool", c.c_bool, [false, true]],
];

describe("Native callback ABI", { skip: !existsSync(fixture) && "native fixture not built" }, () => {
  let lib;
  const callbacks = [];
  beforeEach(() => {
    lib = new c.CDLL(fixture);
  });
  afterEach(() => {
    for (const callback of callbacks.splice(0)) callback.release();
    lib.close();
  });
  function caller(symbol, result, args = []) {
    return lib.func(symbol, result, [c.c_void_p, ...args]);
  }

  for (const safe of [false, true]) {
    describe(safe ? "Thread-safe delivery" : "Creation-thread delivery", () => {
      function make(fn, result, args) {
        const callback = (safe ? c.threadSafeCallback : c.callback)(fn, result, args);
        callbacks.push(callback);
        return callback;
      }

      for (const [name, type, values] of scalars) {
        it(`receives and returns ${name} through an independent C caller`, async () => {
          const received = [];
          const callback = make(
            (value) => {
              received.push(value);
              return value;
            },
            type,
            [type],
          );
          const call = caller(`fixture_callback_${name}`, type, [type]);
          for (const value of values) {
            const expected = name === "float" ? Math.fround(value) : value;
            assert.equal(call(callback, value), expected);
            assert.equal(received.at(-1), expected);
            if (safe) {
              assert.equal(await call.callAsync(callback, value), expected);
              assert.equal(received.at(-1), expected);
            }
          }
        });
      }

      it("supports zero-argument and void callbacks", async () => {
        let calls = 0;
        const empty = make(() => 42, c.c_int32, []);
        const nothing = make(
          () => {
            calls++;
          },
          c.c_void,
          [],
        );
        const callEmpty = caller("fixture_callback_zero", c.c_int32);
        const callVoid = caller("fixture_callback_void", c.c_int32);
        assert.equal(safe ? await callEmpty.callAsync(empty) : callEmpty(empty), 42);
        assert.equal(safe ? await callVoid.callAsync(nothing) : callVoid(nothing), 73);
        assert.equal(calls, 1);
      });

      it("preserves null, raw/typed pointers, strings and wide strings", async () => {
        const buffer = Buffer.alloc(8);
        buffer.writeInt32LE(7);
        const pointer = make((value) => value, c.c_void_p, [c.c_void_p]);
        const callPointer = caller("fixture_callback_pointer", c.c_void_p, [c.c_void_p]);
        assert.equal(safe ? await callPointer.callAsync(pointer, null) : callPointer(pointer, null), null);
        assert.equal(safe ? await callPointer.callAsync(pointer, buffer) : callPointer(pointer, buffer), c.addressof(buffer));
        const typed = make(
          (value) => {
            value.contents.value++;
            return value;
          },
          c.POINTER(c.c_int32),
          [c.POINTER(c.c_int32)],
        );
        assert.equal(safe ? await callPointer.callAsync(typed, buffer) : callPointer(typed, buffer), c.addressof(buffer));
        assert.equal(buffer.readInt32LE(), 8);
        for (const [symbol, type] of [
          ["fixture_callback_string", c.c_char_p],
          ["fixture_callback_wstring", c.c_wchar_p],
        ]) {
          const callback = make((value) => (value === null ? null : `${value}!`), type, [type]);
          const call = caller(symbol, type, [type]);
          assert.equal(safe ? await call.callAsync(callback, null) : call(callback, null), null);
          assert.equal(safe ? await call.callAsync(callback, "hello") : call(callback, "hello"), "hello!");
        }
      });

      it("keeps identical callback signatures in independent contexts", async () => {
        const first = make((value) => value + 1, c.c_int32, [c.c_int32]);
        const second = make((value) => value + 2, c.c_int32, [c.c_int32]);
        const call = caller("fixture_callback_i32", c.c_int32, [c.c_int32]);
        assert.notEqual(first.pointer, second.pointer);
        assert.equal(safe ? await call.callAsync(first, 7) : call(first, 7), 8);
        assert.equal(safe ? await call.callAsync(second, 7) : call(second, 7), 9);
        first.release();
        assert.equal(safe ? await call.callAsync(second, 7) : call(second, 7), 9);
      });

      it("receives narrow scalars and independently spilled GP/FP arguments", async () => {
        for (const [symbol, types, values, resultType] of [
          ["fixture_callback_narrow_stack", Array.from({ length: 4 }, () => [c.c_int8, c.c_uint8, c.c_int16, c.c_uint16]).flat(), [-128, 255, -32768, 65535, -1, 128, -2, 32768, -127, 254, -32767, 65534, -3, 129, -4, 32769], c.c_int64],
          ["fixture_callback_mixed_stack", Array.from({ length: 9 }, () => [c.c_int32, c.c_float, c.c_double]).flat(), Array.from({ length: 9 }, (_, i) => [-i - 1, i + 0.25, i + 0.5]).flat(), c.c_double],
          [
            "fixture_callback_narrow_mixed_stack",
            [...Array(8).fill(c.c_int32), ...Array(8).fill(c.c_double), c.c_int8, c.c_uint8, c.c_int16, c.c_uint16, c.c_int8, c.c_uint8, c.c_int16, c.c_uint16, c.c_float, c.c_double],
            [-1, -2, -3, -4, -5, -6, -7, -8, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, -128, 255, -32768, 65535, -127, 254, -32767, 65534, 8.25, 9.5],
            c.c_double,
          ],
        ]) {
          const expected = resultType === c.c_int64 ? values.reduce((sum, value, i) => sum + BigInt(value) * BigInt(i + 1), 0n) : values.reduce((sum, value, i) => sum + value * (i + 1), 0);
          const callback = make(
            (...args) => {
              assert.deepEqual(args, values);
              return expected;
            },
            resultType,
            types,
          );
          const call = caller(symbol, resultType);
          assert.equal(safe ? await call.callAsync(callback) : call(callback), expected);
        }
      });

      for (const count of [32, 33]) {
        it(`receives all ${count} arguments of a dense scalar signature`, async () => {
          const values = Array.from({ length: count }, (_, i) => i + 1);
          const expected = BigInt((count * (count + 1)) / 2);
          const callback = make(
            (...args) => {
              assert.deepEqual(args, values);
              return expected;
            },
            c.c_int64,
            Array(count).fill(c.c_int32),
          );
          const call = caller(`fixture_callback_i32_${count}`, c.c_int64);
          assert.equal(safe ? await call.callAsync(callback) : call(callback), expected);
        });
      }

      for (const count of [...Array.from({ length: 16 }, (_, i) => i + 1), 17, 19, 24, 31, 32, 33, 65, 257, 4097]) {
        it(`copies ${count}-byte aggregate arguments from compiled C registers/stack`, async () => {
          const Record = c.struct({ values: c.array(c.c_uint8, count) });
          const expected = Array.from({ length: count }, (_, i) => (i + 1) & 255);
          const checksum = expected.reduce((sum, value, i) => sum + BigInt(value) * BigInt(i + 1), 0n);
          for (const [suffix, prefix] of [
            ["", []],
            ["_stack", [1, 2, 3, 4, 5, 6, 7]],
            ["_stack_leading", [1, 2, 3, 4, 5, 6, 7, 8, -127]],
          ]) {
            let saved;
            const tail = prefix.length ? [-128, 65535] : [];
            const callback = make(
              (...args) => {
                assert.deepEqual(
                  args.slice(0, prefix.length),
                  prefix.map((value, i) => (suffix === "_stack_leading" && i === 8 ? value : BigInt(value))),
                );
                saved = args[prefix.length];
                assert.deepEqual([...saved.values], expected);
                assert.deepEqual(args.slice(prefix.length + 1), tail);
                saved.values[0] = 99;
                return checksum;
              },
              c.c_int64,
              [...Array(prefix.length === 9 ? 8 : prefix.length).fill(c.c_int64), ...(prefix.length === 9 ? [c.c_int8] : []), Record, ...(tail.length ? [c.c_int8, c.c_uint16] : [])],
            );
            const call = caller(`fixture_bytes_${count}_callback${suffix}`, c.c_int64);
            assert.equal(safe ? await call.callAsync(callback) : call(callback), checksum);
            assert.equal(saved.values[0], 99);
          }
        });
      }

      for (const [name, type] of [
        ["f32", c.c_float],
        ["f64", c.c_double],
      ]) {
        for (const count of [1, 2, 3, 4, 5]) {
          it(`receives homogeneous ${name}[${count}] arguments in registers, stack or memory`, async () => {
            const Record = c.struct({ values: c.array(type, count) });
            const expected = Array.from({ length: count }, (_, i) => 1.5 + i / 4);
            const result = expected.reduce((sum, value, i) => sum + value * (i + 1), 0);
            for (const [suffix, prefix] of [
              ["", []],
              ["_stack", [1, 2, 3, 4, 5, 6, 7]],
              ["_stack_full", [1, 2, 3, 4, 5, 6, 7, 8, 0.25]],
            ]) {
              let saved;
              const tail = prefix.length ? [8.25, -9] : [];
              const callback = make(
                (...args) => {
                  assert.deepEqual(args.slice(0, prefix.length), prefix);
                  saved = args[prefix.length];
                  assert.deepEqual([...saved.values], expected);
                  assert.deepEqual(args.slice(prefix.length + 1), tail);
                  return result;
                },
                c.c_double,
                [...Array(prefix.length === 9 ? 8 : prefix.length).fill(c.c_double), ...(prefix.length === 9 ? [c.c_float] : []), Record, ...(tail.length ? [c.c_float, c.c_int32] : [])],
              );
              const call = caller(`fixture_hfa_${name}_${count}_callback${suffix}`, c.c_double);
              assert.equal(safe ? await call.callAsync(callback) : call(callback), result);
              assert.deepEqual([...saved.values], expected);
            }
          });
        }
      }

      it("preserves nested homogeneous layouts and nonaliasing large-aggregate snapshots", async () => {
        const Pair = c.struct({ first: c.c_double, second: c.c_double });
        const Nested = c.struct({ pairs: c.array(Pair, 2) });
        const nested = make(
          (value) => {
            assert.deepEqual(
              [...value.pairs].map((pair) => [pair.first, pair.second]),
              [
                [1.25, 2.5],
                [3.75, 5],
              ],
            );
            return 37.5;
          },
          c.c_double,
          [Nested],
        );
        const callNested = caller("fixture_nested_hfa_callback", c.c_double);
        assert.equal(safe ? await callNested.callAsync(nested) : callNested(nested), 37.5);
        const Record = c.struct({ values: c.array(c.c_uint8, 33) });
        const saved = [];
        const alias = make(
          (first, second, original) => {
            saved.push(first, second);
            assert.notEqual(first, second);
            assert.equal(first.values[0], 7);
            first.values[0] = 99;
            assert.equal(second.values[0], 7);
            assert.equal(c.readValue(original, c.c_uint8), 7);
            second.values[1] = 88;
            assert.equal(first.values[1], 8);
            return 73;
          },
          c.c_int32,
          [Record, Record, c.c_void_p],
        );
        const callAlias = caller("fixture_callback_large_alias", c.c_int32, [c.c_uint8]);
        assert.equal(safe ? await callAlias.callAsync(alias, 7) : callAlias(alias, 7), 73);
        assert.equal(saved[0].values[0], 99);
        assert.equal(saved[1].values[1], 88);
      });
    });
  }
});
