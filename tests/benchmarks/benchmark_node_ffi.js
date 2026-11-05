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
// getFunction caches per library; prototype rows need independent function identities.
const prototypeOther = new ffi.DynamicLibrary(file);
const callbacks = [];
const otherCallbacks = [];

function registerCallback(callback, signature, fn) {
  callbacks.push(callback);
  const otherCallback = other.registerCallback(signature, fn);
  otherCallbacks.push(otherCallback);
  return otherCallback;
}

try {
  const cases = [];
  const add = (name, group, representation, ctypes, other, expected) => cases.push({ name, group, representation, ctypes, other, expected });
  const zero = lib.func("fixture_benchmark_zero", c.c_int32, []);
  const otherZero = other.getFunction("fixture_benchmark_zero", { return: "i32", arguments: [] });
  add(
    "zero arguments",
    "Synchronous calls",
    "number",
    () => zero(),
    () => otherZero(),
    7,
  );
  // Separate call sites keep V8 feedback independent for each signature.
  const i8 = lib.func("fixture_scalar_i8", c.c_int8, [c.c_int8]);
  const otherI8 = other.getFunction("fixture_scalar_i8", { return: "i8", arguments: ["i8"] });
  add(
    "echo i8 (number)",
    "Synchronous calls",
    "number",
    () => i8(-7),
    () => otherI8(-7),
    -7,
  );
  const u8 = lib.func("fixture_scalar_u8", c.c_uint8, [c.c_uint8]);
  const otherU8 = other.getFunction("fixture_scalar_u8", { return: "u8", arguments: ["u8"] });
  add(
    "echo u8 (number)",
    "Synchronous calls",
    "number",
    () => u8(255),
    () => otherU8(255),
    255,
  );
  const i16 = lib.func("fixture_scalar_i16", c.c_int16, [c.c_int16]);
  const otherI16 = other.getFunction("fixture_scalar_i16", { return: "i16", arguments: ["i16"] });
  add(
    "echo i16 (number)",
    "Synchronous calls",
    "number",
    () => i16(-32768),
    () => otherI16(-32768),
    -32768,
  );
  const u16 = lib.func("fixture_scalar_u16", c.c_uint16, [c.c_uint16]);
  const otherU16 = other.getFunction("fixture_scalar_u16", { return: "u16", arguments: ["u16"] });
  add(
    "echo u16 (number)",
    "Synchronous calls",
    "number",
    () => u16(65535),
    () => otherU16(65535),
    65535,
  );
  const bool = lib.func("fixture_scalar_bool", c.c_bool, [c.c_bool]);
  const otherBool = other.getFunction("fixture_scalar_bool", { return: "bool", arguments: ["bool"] });
  add(
    "echo bool (0/1 number)",
    "Synchronous calls",
    "0/1 number (bool result normalized)",
    () => Number(bool(1)),
    () => Number(otherBool(1)),
    1,
  );
  const i32 = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherI32 = other.getFunction("fixture_scalar_i32", { return: "i32", arguments: ["i32"] });
  add(
    "echo i32 (number)",
    "Synchronous calls",
    "number",
    () => i32(-7),
    () => otherI32(-7),
    -7,
  );
  const u32 = lib.func("fixture_scalar_u32", c.c_uint32, [c.c_uint32]);
  const otherU32 = other.getFunction("fixture_scalar_u32", { return: "u32", arguments: ["u32"] });
  add(
    "echo u32 (number)",
    "Synchronous calls",
    "number",
    () => u32(0xffffffff),
    () => otherU32(0xffffffff),
    0xffffffff,
  );
  const i64 = lib.func("fixture_scalar_i64", c.c_int64, [c.c_int64]);
  const otherI64 = other.getFunction("fixture_scalar_i64", { return: "i64", arguments: ["i64"] });
  const wide = 2n ** 60n + 7n;
  add(
    "echo i64 (bigint)",
    "Synchronous calls",
    "bigint",
    () => i64(wide),
    () => otherI64(wide),
    wide,
  );
  const float = lib.func("fixture_scalar_float", c.c_float, [c.c_float]);
  const otherFloat = other.getFunction("fixture_scalar_float", { return: "f32", arguments: ["f32"] });
  add(
    "echo float (number)",
    "Synchronous calls",
    "number",
    () => float(1.5),
    () => otherFloat(1.5),
    1.5,
  );
  const double = lib.func("fixture_scalar_double", c.c_double, [c.c_double]);
  const otherDouble = other.getFunction("fixture_scalar_double", { return: "f64", arguments: ["f64"] });
  add(
    "echo double (number)",
    "Synchronous calls",
    "number",
    () => double(1.5),
    () => otherDouble(1.5),
    1.5,
  );
  const mixed = lib.func("fixture_exact_mixed", c.c_double, [c.c_int32, c.c_double, c.c_float, c.c_int32]);
  const otherMixed = other.getFunction("fixture_exact_mixed", { return: "f64", arguments: ["i32", "f64", "f32", "i32"] });
  add(
    "mixed arguments (i32,f64,f32,i32)",
    "Synchronous calls",
    "number",
    () => mixed(-7, 1.5, 2.25, 8),
    () => otherMixed(-7, 1.5, 2.25, 8),
    10.75,
  );

  const narrowTypes = Array.from({ length: 4 }, () => [c.c_int8, c.c_uint8, c.c_int16, c.c_uint16]).flat();
  const narrowValues = [-128, 255, -32768, 65535, 127, 128, 32767, 32768, -128, 255, -32768, 65535, 127, 128, 32767, 32768];
  const narrow = lib.func("fixture_abi_narrow_stack", c.c_int64, narrowTypes);
  const otherNarrow = other.getFunction("fixture_abi_narrow_stack", { return: "i64", arguments: Array.from({ length: 4 }, () => ["i8", "u8", "i16", "u16"]).flat() });
  add(
    "16 narrow arguments (i64 -> number)",
    "Stack arguments",
    "number",
    () => Number(narrow(...narrowValues)),
    () => Number(otherNarrow(...narrowValues)),
    narrowValues.reduce((sum, value, i) => sum + value * (i + 1), 0),
  );
  const stackTypes = [...Array(8).fill(c.c_int32), ...Array(8).fill(c.c_double), ...narrowTypes.slice(0, 8), c.c_float, c.c_double];
  const stackValues = [...Array.from({ length: 8 }, (_, i) => i - 4), ...Array.from({ length: 8 }, (_, i) => i + 0.25), ...narrowValues.slice(0, 8), -1.5, 2.25];
  const stack = lib.func("fixture_abi_narrow_mixed_stack", c.c_double, stackTypes);
  const otherStack = other.getFunction("fixture_abi_narrow_mixed_stack", { return: "f64", arguments: [...Array(8).fill("i32"), ...Array(8).fill("f64"), "i8", "u8", "i16", "u16", "i8", "u8", "i16", "u16", "f32", "f64"] });
  add(
    "26 mixed narrow/GP/FP arguments",
    "Stack arguments",
    "number",
    () => stack(...stackValues),
    () => otherStack(...stackValues),
    stackValues.reduce((sum, value, i) => sum + value * (i + 1), 0),
  );

  const sizeType = c.sizeof(c.c_size_t) === 8 ? "u64" : "u32";
  const prototypeZero = c.CFUNCTYPE(c.c_int32)(["fixture_benchmark_zero", lib]);
  const prototypeI32 = c.CFUNCTYPE(c.c_int32, c.c_int32)(["fixture_scalar_i32", lib]);
  const otherPrototypeZero = prototypeOther.getFunction("fixture_benchmark_zero", { return: "i32", arguments: [] });
  const otherPrototypeI32 = prototypeOther.getFunction("fixture_scalar_i32", { return: "i32", arguments: ["i32"] });
  assert.notEqual(otherPrototypeZero, otherZero);
  assert.notEqual(otherPrototypeI32, otherI32);
  add(
    "zero arguments via CFUNCTYPE",
    "Prototype callers",
    "number",
    () => prototypeZero(),
    () => otherPrototypeZero(),
    7,
  );
  add(
    "echo i32 via CFUNCTYPE",
    "Prototype callers",
    "number",
    () => prototypeI32(-7),
    () => otherPrototypeI32(-7),
    -7,
  );

  const length = lib.func("fixture_string_length", c.c_size_t, [c.c_char_p]);
  const otherLength = other.getFunction("fixture_string_length", { return: sizeType, arguments: ["string"] });
  for (const size of [16, 4096]) {
    const text = "x".repeat(size);
    add(
      `string length ${size} B -> number`,
      "Strings and buffers",
      "number",
      () => Number(length(text)),
      () => Number(otherLength(text)),
      size,
    );
  }
  const buffer = Buffer.from(new Int32Array([1, 2, 3, 4]).buffer);
  const sum = lib.func("fixture_sum_int4", c.c_int32, [c.c_void_p]);
  const otherSum = other.getFunction("fixture_sum_int4", { return: "i32", arguments: ["buffer"] });
  add(
    "buffer argument (4 x i32)",
    "Strings and buffers",
    "number",
    () => sum(buffer),
    () => otherSum(buffer),
    10,
  );

  class Fields extends c.Structure {
    static _fields_ = [
      ["x", c.c_int32],
      ["y", c.c_int32],
    ];
  }
  const fields = new Fields(10, 20);
  const otherFields = Buffer.alloc(8);
  otherFields.writeInt32LE(10, 0);
  otherFields.writeInt32LE(20, 4);
  const pointer = ffi.getRawPointer(otherFields);
  add(
    "read two i32 fields",
    "Memory access",
    "number",
    () => fields.x + fields.y,
    () => ffi.getInt32(pointer, 0) + ffi.getInt32(pointer, 4),
    30,
  );

  const callback = c.callback((value) => value + 1, c.c_int32, [c.c_int32]);
  const otherCallback = registerCallback(callback, { return: "i32", arguments: ["i32"] }, (value) => value + 1);
  const invoke = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
  const otherInvoke = other.getFunction("fixture_scalar_callback", { return: "i32", arguments: ["pointer", "i32"] });
  add(
    "C -> JS callback (i32)",
    "Callbacks",
    "number",
    () => invoke(callback, 7),
    () => otherInvoke(otherCallback, 7),
    8,
  );
  const invokeLoop = lib.func("fixture_callback_loop", c.c_int64, [c.c_void_p, c.c_int32]);
  const otherInvokeLoop = other.getFunction("fixture_callback_loop", { return: "i64", arguments: ["pointer", "i32"] });
  add(
    "C -> JS callback (i32, 64 C-loop calls)",
    "Callbacks",
    "64 callbacks -> normalized number sum",
    () => Number(invokeLoop(callback, 64)),
    () => Number(otherInvokeLoop(otherCallback, 64)),
    2080,
  );
  const safeCallback = c.threadSafeCallback((value) => value + 1, c.c_int32, [c.c_int32]);
  const otherSafeCallback = registerCallback(safeCallback, { return: "i32", arguments: ["i32"] }, (value) => value + 1);
  add(
    "C -> JS thread-safe callback (i32 host thread)",
    "Callbacks",
    "number",
    () => invoke(safeCallback, 7),
    () => otherInvoke(otherSafeCallback, 7),
    8,
  );

  const inferredArgs = [7, 1.5, 3];
  const inferred = lib.func("fixture_inferred_mixed", c.c_double, []);
  const otherInferred = other.getFunction("fixture_inferred_mixed", { return: "f64", arguments: ["i32", "f64", "i32"] });
  add(
    "inferred mixed (without argtypes)",
    "Inferred calls",
    "number",
    () => inferred(...inferredArgs),
    () => otherInferred(...inferredArgs),
    322,
  );
  const stackArgs = Array.from({ length: 10 }, (_, i) => i + 1);
  const inferredStack = lib.func("fixture_abi_i32_stack", c.c_int64, []);
  const otherInferredStack = other.getFunction("fixture_abi_i32_stack", { return: "i64", arguments: Array(10).fill("i32") });
  add(
    "inferred stack (10 integers)",
    "Inferred calls",
    "number (result normalized)",
    () => Number(inferredStack(...stackArgs)),
    () => Number(otherInferredStack(...stackArgs)),
    385,
  );

  await runComparison("node:ffi", cases, {
    externalBuffers: c.EXTERNAL_BUFFERS,
    notes: [
      "Both libraries call the same C fixture with matching native signatures.",
      "CFUNCTYPE rows use a separate library binding: node:ffi caches functions per library, so direct-call feedback stays separate.",
      "The bool row passes numeric 1 and normalizes results to Number in both APIs: node:ffi accepts uint8 inputs and returns 0/1, while node-ctypes returns a Boolean.",
      "String lengths, narrow/inferred-stack i64 results and the C-loop sum are normalized to Number; BigInt-to-Number conversion is included for both libraries.",
      "Wide i64 values return BigInt in both APIs. Callback registration is outside the timed loop.",
      "The i32 C-loop row performs 64 completed callbacks inside one native invocation. Times are ns/op per 64-callback batch, not per callback.",
      "The thread-safe callback row measures node-ctypes host-thread dispatch against a node:ffi callback on the same thread, not cross-thread handoff.",
      "Inferred rows omit node-ctypes argtypes, while node:ffi uses an explicit fixed signature for the same C function; node:ffi does not infer the argument types.",
    ],
    unsupported: ["aggregate arguments/results and callbacks, variadic signatures and async calls: no equivalent documented node:ffi API.", "Variadic functions are not emulated with fixed signatures."],
  });
  // Read the owner after timing so the raw pointer stays valid throughout.
  assert.equal(otherFields.readInt32LE(0), 10);
  assert.equal(otherFields.readInt32LE(4), 20);
} finally {
  for (const callback of callbacks) callback.release();
  for (const callback of otherCallbacks) other.unregisterCallback(callback);
  other.close();
  prototypeOther.close();
  lib.close();
}
