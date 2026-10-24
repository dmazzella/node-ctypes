import assert from "node:assert/strict";
import * as c from "node-ctypes";
import { fixturePath, runComparison } from "./runner.js";

let ffi;
try {
  ffi = await import("node:ffi");
} catch (error) {
  if (error.code === "ERR_UNKNOWN_BUILTIN_MODULE") {
    throw new Error("node:ffi requires Node 26+ and --experimental-ffi. Run npm run bench:ffi.", { cause: error });
  }
  throw error;
}

const file = fixturePath();
const lib = new c.CDLL(file);
const other = new ffi.DynamicLibrary(file);
let callback;
let otherCallback;

try {
  const cases = [];
  const add = (name, group, representation, ctypes, other, expected) =>
    cases.push({ name, group, representation, ctypes, other, expected });
  const zero = lib.func("fixture_benchmark_zero", c.c_int32, []);
  const otherZero = other.getFunction("fixture_benchmark_zero", { return: "i32", arguments: [] });
  add("zero arguments", "Synchronous calls", "number", () => zero(), () => otherZero(), 7);
  // Separate call sites keep V8 feedback independent for each signature.
  const i8 = lib.func("fixture_scalar_i8", c.c_int8, [c.c_int8]);
  const otherI8 = other.getFunction("fixture_scalar_i8", { return: "i8", arguments: ["i8"] });
  add("echo i8 (number)", "Synchronous calls", "number", () => i8(-7), () => otherI8(-7), -7);
  const i32 = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherI32 = other.getFunction("fixture_scalar_i32", { return: "i32", arguments: ["i32"] });
  add("echo i32 (number)", "Synchronous calls", "number", () => i32(-7), () => otherI32(-7), -7);
  const u32 = lib.func("fixture_scalar_u32", c.c_uint32, [c.c_uint32]);
  const otherU32 = other.getFunction("fixture_scalar_u32", { return: "u32", arguments: ["u32"] });
  add("echo u32 (number)", "Synchronous calls", "number", () => u32(0xffffffff), () => otherU32(0xffffffff), 0xffffffff);
  const i64 = lib.func("fixture_scalar_i64", c.c_int64, [c.c_int64]);
  const otherI64 = other.getFunction("fixture_scalar_i64", { return: "i64", arguments: ["i64"] });
  const wide = 2n ** 60n + 7n;
  add("echo i64 (bigint)", "Synchronous calls", "bigint", () => i64(wide), () => otherI64(wide), wide);
  const float = lib.func("fixture_scalar_float", c.c_float, [c.c_float]);
  const otherFloat = other.getFunction("fixture_scalar_float", { return: "f32", arguments: ["f32"] });
  add("echo float (number)", "Synchronous calls", "number", () => float(1.5), () => otherFloat(1.5), 1.5);
  const double = lib.func("fixture_scalar_double", c.c_double, [c.c_double]);
  const otherDouble = other.getFunction("fixture_scalar_double", { return: "f64", arguments: ["f64"] });
  add("echo double (number)", "Synchronous calls", "number", () => double(1.5), () => otherDouble(1.5), 1.5);
  const mixed = lib.func("fixture_exact_mixed", c.c_double, [c.c_int32, c.c_double, c.c_float, c.c_int32]);
  const otherMixed = other.getFunction("fixture_exact_mixed", { return: "f64", arguments: ["i32", "f64", "f32", "i32"] });
  add("mixed arguments (i32,f64,f32,i32)", "Synchronous calls", "number",
    () => mixed(-7, 1.5, 2.25, 8), () => otherMixed(-7, 1.5, 2.25, 8), 10.75);

  const sizeType = c.sizeof(c.c_size_t) === 8 ? "u64" : "u32";
  const length = lib.func("fixture_string_length", c.c_size_t, [c.c_char_p]);
  const otherLength = other.getFunction("fixture_string_length", { return: sizeType, arguments: ["string"] });
  for (const size of [16, 4096]) {
    const text = "x".repeat(size);
    add(`string length ${size} B -> number`, "Strings and buffers", "number",
      () => Number(length(text)), () => Number(otherLength(text)), size);
  }
  const buffer = Buffer.from(new Int32Array([1, 2, 3, 4]).buffer);
  const sum = lib.func("fixture_sum_int4", c.c_int32, [c.c_void_p]);
  const otherSum = other.getFunction("fixture_sum_int4", { return: "i32", arguments: ["buffer"] });
  add("buffer argument (4 x i32)", "Strings and buffers", "number", () => sum(buffer), () => otherSum(buffer), 10);

  class Fields extends c.Structure {
    static _fields_ = [["x", c.c_int32], ["y", c.c_int32]];
  }
  const fields = new Fields(10, 20);
  const otherFields = Buffer.alloc(8);
  otherFields.writeInt32LE(10, 0);
  otherFields.writeInt32LE(20, 4);
  const pointer = ffi.getRawPointer(otherFields);
  add("read two i32 fields", "Memory access", "number",
    () => fields.x + fields.y, () => ffi.getInt32(pointer, 0) + ffi.getInt32(pointer, 4), 30);

  callback = c.callback((value) => value + 1, c.c_int32, [c.c_int32]);
  otherCallback = other.registerCallback({ return: "i32", arguments: ["i32"] }, (value) => value + 1);
  const invoke = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
  const otherInvoke = other.getFunction("fixture_scalar_callback", { return: "i32", arguments: ["pointer", "i32"] });
  add("C -> JS callback (i32)", "Callbacks", "number",
    () => invoke(callback, 7), () => otherInvoke(otherCallback, 7), 8);

  await runComparison("node:ffi", cases, {
    externalBuffers: c.EXTERNAL_BUFFERS,
    notes: [
      "Both libraries call the same C fixture with matching native signatures.",
      "String lengths are normalized to Number; BigInt-to-Number conversion is included for both libraries.",
      "Wide i64 values return BigInt in both APIs. Callback registration is outside the timed loop.",
    ],
    unsupported: [
      "aggregate values, variadic signatures and async calls: no equivalent documented node:ffi API.",
      "Variadic functions are not emulated with fixed signatures.",
    ],
  });
  // Read the owner after timing so the raw pointer stays valid throughout.
  assert.equal(otherFields.readInt32LE(0), 10);
  assert.equal(otherFields.readInt32LE(4), 20);
} finally {
  callback?.release();
  if (otherCallback !== undefined) other.unregisterCallback(otherCallback);
  other.close();
  lib.close();
}
