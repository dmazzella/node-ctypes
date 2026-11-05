import assert from "node:assert/strict";
import * as c from "node-ctypes";
import koffi from "koffi";
import { fixturePath, runComparison } from "./runner.js";

const file = fixturePath();
const lib = new c.CDLL(file);
const other = koffi.load(file);
const callbacks = [];
const otherCallbacks = [];
function bind(symbol, result, args) {
  return lib.func(symbol, result, args);
}

function bindExtra(symbol, result, prefix, args, expected) {
  const fn = bind(symbol, result, prefix);
  assert.equal(fn(...args), expected);
  return fn;
}

function registerCallback(callback, prototype, fn) {
  callbacks.push(callback);
  const otherCallback = koffi.register(fn, koffi.pointer(prototype));
  otherCallbacks.push(otherCallback);
  return otherCallback;
}

try {
  const cases = [];
  const unsupported = [];
  const add = (name, group, representation, ctypes, other, expected) => cases.push({ name, group, representation, ctypes, other, expected });
  function addAsync(name, representation, fn, otherFn, args, expected, otherArgs = args) {
    for (const concurrency of [1, 8]) {
      cases.push({
        name: `async ${name} (${concurrency} in flight)`,
        group: "Async calls (scheduling included)",
        representation,
        ctypes: () => fn.callAsync(...args),
        other: () => new Promise((resolve, reject) => otherFn.async(...otherArgs, (error, result) => (error ? reject(error) : resolve(result)))),
        expected,
        concurrency,
      });
    }
  }
  const zero = bind("fixture_benchmark_zero", c.c_int32, []);
  const otherZero = other.func("int32_t fixture_benchmark_zero(void)");
  add(
    "zero arguments",
    "Synchronous calls",
    "number",
    () => zero(),
    () => otherZero(),
    7,
  );
  // Separate call sites keep V8 feedback independent for each signature.
  const i8 = bind("fixture_scalar_i8", c.c_int8, [c.c_int8]);
  const otherI8 = other.func("int8_t fixture_scalar_i8(int8_t value)");
  add(
    "echo i8 (number)",
    "Synchronous calls",
    "number",
    () => i8(-7),
    () => otherI8(-7),
    -7,
  );
  const u8 = bind("fixture_scalar_u8", c.c_uint8, [c.c_uint8]);
  const otherU8 = other.func("uint8_t fixture_scalar_u8(uint8_t value)");
  add(
    "echo u8 (number)",
    "Synchronous calls",
    "number",
    () => u8(255),
    () => otherU8(255),
    255,
  );
  const i16 = bind("fixture_scalar_i16", c.c_int16, [c.c_int16]);
  const otherI16 = other.func("int16_t fixture_scalar_i16(int16_t value)");
  add(
    "echo i16 (number)",
    "Synchronous calls",
    "number",
    () => i16(-32768),
    () => otherI16(-32768),
    -32768,
  );
  const u16 = bind("fixture_scalar_u16", c.c_uint16, [c.c_uint16]);
  const otherU16 = other.func("uint16_t fixture_scalar_u16(uint16_t value)");
  add(
    "echo u16 (number)",
    "Synchronous calls",
    "number",
    () => u16(65535),
    () => otherU16(65535),
    65535,
  );
  const bool = bind("fixture_scalar_bool", c.c_bool, [c.c_bool]);
  const otherBool = other.func("bool fixture_scalar_bool(bool value)");
  add(
    "echo bool (boolean)",
    "Synchronous calls",
    "boolean",
    () => bool(true),
    () => otherBool(true),
    true,
  );
  const i32 = bind("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherI32 = other.func("int32_t fixture_scalar_i32(int32_t value)");
  add(
    "echo i32 (number)",
    "Synchronous calls",
    "number",
    () => i32(-7),
    () => otherI32(-7),
    -7,
  );
  const u32 = bind("fixture_scalar_u32", c.c_uint32, [c.c_uint32]);
  const otherU32 = other.func("uint32_t fixture_scalar_u32(uint32_t value)");
  add(
    "echo u32 (number)",
    "Synchronous calls",
    "number",
    () => u32(0xffffffff),
    () => otherU32(0xffffffff),
    0xffffffff,
  );
  const i64 = bind("fixture_scalar_i64", c.c_int64, [c.c_int64]);
  const otherI64 = other.func("int64_t fixture_scalar_i64(int64_t value)");
  const wide = 2n ** 60n + 7n;
  add(
    "echo i64 (bigint)",
    "Synchronous calls",
    "bigint",
    () => i64(wide),
    () => otherI64(wide),
    wide,
  );
  const float = bind("fixture_scalar_float", c.c_float, [c.c_float]);
  const otherFloat = other.func("float fixture_scalar_float(float value)");
  add(
    "echo float (number)",
    "Synchronous calls",
    "number",
    () => float(1.5),
    () => otherFloat(1.5),
    1.5,
  );
  const double = bind("fixture_scalar_double", c.c_double, [c.c_double]);
  const otherDouble = other.func("double fixture_scalar_double(double value)");
  add(
    "echo double (number)",
    "Synchronous calls",
    "number",
    () => double(1.5),
    () => otherDouble(1.5),
    1.5,
  );
  const mixed = bind("fixture_exact_mixed", c.c_double, [c.c_int32, c.c_double, c.c_float, c.c_int32]);
  const otherMixed = other.func("double fixture_exact_mixed(int32_t a, double b, float c, int32_t d)");
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
  const narrow = bind("fixture_abi_narrow_stack", c.c_int64, narrowTypes);
  const otherNarrow = other.func("fixture_abi_narrow_stack", "int64_t", Array.from({ length: 4 }, () => ["int8_t", "uint8_t", "int16_t", "uint16_t"]).flat());
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
  const stack = bind("fixture_abi_narrow_mixed_stack", c.c_double, stackTypes);
  const otherStack = other.func("fixture_abi_narrow_mixed_stack", "double", [...Array(8).fill("int32_t"), ...Array(8).fill("double"), "int8_t", "uint8_t", "int16_t", "uint16_t", "int8_t", "uint8_t", "int16_t", "uint16_t", "float", "double"]);
  add(
    "26 mixed narrow/GP/FP arguments",
    "Stack arguments",
    "number",
    () => stack(...stackValues),
    () => otherStack(...stackValues),
    stackValues.reduce((sum, value, i) => sum + value * (i + 1), 0),
  );

  const prototypeZero = c.CFUNCTYPE(c.c_int32)(["fixture_benchmark_zero", lib]);
  const prototypeI32 = c.CFUNCTYPE(c.c_int32, c.c_int32)(["fixture_scalar_i32", lib]);
  const otherPrototypeZero = other.func("int32_t fixture_benchmark_zero(void)");
  const otherPrototypeI32 = other.func("int32_t fixture_scalar_i32(int32_t value)");
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

  const length = bind("fixture_string_length", c.c_size_t, [c.c_char_p]);
  const otherLength = other.func("size_t fixture_string_length(const char *text)");
  for (const size of [16, 4096]) {
    const text = "x".repeat(size);
    add(
      `string length ${size} B -> number`,
      "Strings and buffers",
      "number",
      () => Number(length(text)),
      () => otherLength(text),
      size,
    );
  }
  const buffer = Buffer.from(new Int32Array([1, 2, 3, 4]).buffer);
  const sum = bind("fixture_sum_int4", c.c_int32, [c.c_void_p]);
  const otherSum = other.func("int32_t fixture_sum_int4(const int32_t *values)");
  add(
    "buffer argument (4 x i32)",
    "Strings and buffers",
    "number",
    () => sum(buffer),
    () => otherSum(buffer),
    10,
  );

  const Point = c.struct({ x: c.c_int32, y: c.c_int32 });
  const OtherPoint = koffi.struct("BenchmarkPoint", { x: "int32_t", y: "int32_t" });
  const make = bind("fixture_point_make", Point, [c.c_int32, c.c_int32]);
  const otherMake = other.func("fixture_point_make", OtherPoint, ["int32_t", "int32_t"]);
  add(
    "struct return {x,y}",
    "Aggregate values",
    "object",
    () => make(3, 4),
    () => otherMake(3, 4),
    { x: 3, y: 4 },
  );
  const pointSum = bind("fixture_point_sum", c.c_int32, [Point]);
  const otherPointSum = other.func("fixture_point_sum", "int32_t", [OtherPoint]);
  const point = { x: 3, y: 4 };
  add(
    "struct argument {x,y}",
    "Aggregate values",
    "number",
    () => pointSum(point),
    () => otherPointSum(point),
    7,
  );

  for (const [name, type, otherType] of [
    ["float", c.c_float, "float"],
    ["double", c.c_double, "double"],
  ]) {
    const HFA = c.struct({ a: type, b: type, c: type, d: type });
    const OtherHFA = koffi.struct(`BenchmarkHFA_${name}`, { a: otherType, b: otherType, c: otherType, d: otherType });
    const symbol = `fixture_hfa_${name === "float" ? "f32" : "f64"}_4`;
    const makeHFA = bind(`${symbol}_make`, HFA, [type]);
    const otherMakeHFA = other.func(`${symbol}_make`, OtherHFA, [otherType]);
    add(
      `HFA ${name}4 return`,
      "Aggregate values",
      "object",
      () => makeHFA(1.5),
      () => otherMakeHFA(1.5),
      { a: 1.5, b: 1.75, c: 2, d: 2.25 },
    );
    const sumHFA = bind(`${symbol}_sum`, c.c_double, [HFA]);
    const otherSumHFA = other.func(`${symbol}_sum`, "double", [OtherHFA]);
    const value = { a: 0.25, b: 1.25, c: 2.25, d: 3.25 };
    add(
      `HFA ${name}4 argument`,
      "Aggregate values",
      "number",
      () => sumHFA(value),
      () => otherSumHFA(value),
      22.5,
    );
    if (name === "double") {
      addAsync("HFA double4 return", "object", makeHFA, otherMakeHFA, [1.5], { a: 1.5, b: 1.75, c: 2, d: 2.25 });
      addAsync("HFA double4 argument", "number", sumHFA, otherSumHFA, [value], 22.5);
    }
  }
  const MixedAggregate = c.struct({ first: c.c_float, second: c.c_int32, third: c.c_double });
  const OtherMixedAggregate = koffi.struct("BenchmarkMixedAggregate", { first: "float", second: "int32_t", third: "double" });
  const echoMixed = bind("fixture_mixed_aggregate_echo", MixedAggregate, [MixedAggregate]);
  const otherEchoMixed = other.func("fixture_mixed_aggregate_echo", OtherMixedAggregate, [OtherMixedAggregate]);
  const mixedAggregate = { first: -1.5, second: -7, third: 2.25 };
  add(
    "struct mixed GP return and argument",
    "Aggregate values",
    "object",
    () => echoMixed(mixedAggregate),
    () => otherEchoMixed(mixedAggregate),
    mixedAggregate,
  );

  const LargeAggregate = c.struct({ a: c.c_double, b: c.c_double, c: c.c_double, d: c.c_double, e: c.c_double });
  const OtherLargeAggregate = koffi.struct("BenchmarkLargeAggregate", { a: "double", b: "double", c: "double", d: "double", e: "double" });
  const makeLarge = bind("fixture_hfa_f64_5_make", LargeAggregate, [c.c_double]);
  const otherMakeLarge = other.func("fixture_hfa_f64_5_make", OtherLargeAggregate, ["double"]);
  add(
    "struct double5 return (indirect)",
    "Aggregate values",
    "object",
    () => makeLarge(1.5),
    () => otherMakeLarge(1.5),
    { a: 1.5, b: 1.75, c: 2, d: 2.25, e: 2.5 },
  );
  const sumLarge = bind("fixture_hfa_f64_5_sum", c.c_double, [LargeAggregate]);
  const otherSumLarge = other.func("fixture_hfa_f64_5_sum", "double", [OtherLargeAggregate]);
  const largeValue = { a: 0.25, b: 1.25, c: 2.25, d: 3.25, e: 4.25 };
  add(
    "struct double5 argument (indirect)",
    "Aggregate values",
    "number",
    () => sumLarge(largeValue),
    () => otherSumLarge(largeValue),
    43.75,
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
  add(
    "read two i32 fields",
    "Memory access",
    "number",
    () => fields.x + fields.y,
    () => koffi.decode(otherFields, 0, "int32_t") + koffi.decode(otherFields, 4, "int32_t"),
    30,
  );

  const callback = c.callback((value) => value + 1, c.c_int32, [c.c_int32]);
  const Callback = koffi.proto("int32_t BenchmarkCallback(int32_t value)");
  const otherCallback = registerCallback(callback, Callback, (value) => value + 1);
  const invoke = bind("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
  const otherInvoke = other.func("fixture_scalar_callback", "int32_t", [koffi.pointer(Callback), "int32_t"]);
  add(
    "C -> JS callback (i32)",
    "Callbacks",
    "number",
    () => invoke(callback, 7),
    () => otherInvoke(otherCallback, 7),
    8,
  );
  const invokeLoop = bind("fixture_callback_loop", c.c_int64, [c.c_void_p, c.c_int32]);
  const otherInvokeLoop = other.func("fixture_callback_loop", "int64_t", [koffi.pointer(Callback), "int32_t"]);
  add(
    "C -> JS callback (i32, 64 C-loop calls)",
    "Callbacks",
    "64 callbacks -> normalized number sum",
    () => Number(invokeLoop(callback, 64)),
    () => Number(otherInvokeLoop(otherCallback, 64)),
    2080,
  );

  const PointCallback = koffi.proto("int32_t BenchmarkPointCallback(BenchmarkPoint value)");
  const invokePoint = bind("fixture_point_callback", c.c_int32, [c.c_void_p, c.c_int32, c.c_int32]);
  const otherInvokePoint = other.func("fixture_point_callback", "int32_t", [koffi.pointer(PointCallback), "int32_t", "int32_t"]);
  const CallbackHFA = c.struct({ values: c.array(c.c_double, 4) });
  koffi.struct("BenchmarkCallbackHFA", { values: koffi.array("double", 4) });
  const HFACallback = koffi.proto("double BenchmarkHFACallback(BenchmarkCallbackHFA value)");
  const invokeHFA = bind("fixture_hfa_f64_4_callback", c.c_double, [c.c_void_p]);
  const otherInvokeHFA = other.func("fixture_hfa_f64_4_callback", "double", [koffi.pointer(HFACallback)]);
  const CallbackBytes = c.struct({ values: c.array(c.c_uint8, 33) });
  koffi.struct("BenchmarkCallbackBytes", { values: koffi.array("uint8_t", 33) });
  const BytesCallback = koffi.proto("int64_t BenchmarkBytesCallback(BenchmarkCallbackBytes value)");
  const invokeBytes = bind("fixture_bytes_33_callback", c.c_int64, [c.c_void_p]);
  const otherInvokeBytes = other.func("fixture_bytes_33_callback", "int64_t", [koffi.pointer(BytesCallback)]);
  for (const [name, create] of [
    ["", c.callback],
    ["thread-safe ", c.threadSafeCallback],
  ]) {
    const point = create((value) => value.x + value.y, c.c_int32, [Point]);
    const otherPointCallback = registerCallback(point, PointCallback, (value) => value.x + value.y);
    add(
      `C -> JS ${name}callback (GP Point)`,
      "Callbacks",
      "by-value struct -> number",
      () => invokePoint(point, 3, 7),
      () => otherInvokePoint(otherPointCallback, 3, 7),
      10,
    );
    const hfa = create((value) => value.values[0] + value.values[3], c.c_double, [CallbackHFA]);
    const otherHFA = registerCallback(hfa, HFACallback, (value) => value.values[0] + value.values[3]);
    add(
      `C -> JS ${name}callback (HFA double4)`,
      "Callbacks",
      "by-value struct/array -> number",
      () => invokeHFA(hfa),
      () => otherInvokeHFA(otherHFA),
      3.75,
    );
    const bytes = create((value) => BigInt(value.values[0] + value.values[32]), c.c_int64, [CallbackBytes]);
    const otherBytes = registerCallback(bytes, BytesCallback, (value) => BigInt(value.values[0] + value.values[32]));
    add(
      `C -> JS ${name}callback (indirect bytes33)`,
      "Callbacks",
      "by-value struct/array -> normalized number",
      () => Number(invokeBytes(bytes)),
      () => Number(otherInvokeBytes(otherBytes)),
      34,
    );
  }
  const safeCallback = c.threadSafeCallback((value) => value + 1, c.c_int32, [c.c_int32]);
  const otherSafeCallback = registerCallback(safeCallback, Callback, (value) => value + 1);
  add(
    "C -> JS thread-safe callback (i32 host thread)",
    "Callbacks",
    "number",
    () => invoke(safeCallback, 7),
    () => otherInvoke(otherSafeCallback, 7),
    8,
  );
  addAsync("thread-safe callback i32", "number", invoke, otherInvoke, [safeCallback.pointer, 7], 8, [otherSafeCallback, 7]);

  const variadic = bindExtra("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32], [null, 3, 7, 8, 9], 24);
  const otherVariadic = other.func("int32_t fixture_variadic_sum(void *callback, int32_t count, ...)");
  add(
    "variadic sum (3 integers)",
    "Variadic calls",
    "number",
    () => variadic(null, 3, 7, 8, 9),
    () => otherVariadic(null, 3, "int", 7, "int", 8, "int", 9),
    24,
  );

  const inferredArgs = [7, 1.5, 3];
  const inferred = bindExtra("fixture_inferred_mixed", c.c_double, [], inferredArgs, 322);
  const otherInferred = other.func("double fixture_inferred_mixed(int32_t first, double second, int32_t third)");
  add(
    "inferred mixed (without argtypes)",
    "Inferred calls",
    "number",
    () => inferred(...inferredArgs),
    () => otherInferred(...inferredArgs),
    322,
  );
  const stackArgs = Array.from({ length: 10 }, (_, i) => i + 1);
  const inferredStack = bindExtra("fixture_abi_i32_stack", c.c_int64, [], stackArgs, 385n);
  const otherInferredStack = other.func("fixture_abi_i32_stack", "int64_t", Array(10).fill("int32_t"));
  add(
    "inferred stack (10 integers)",
    "Inferred calls",
    "number (result normalized)",
    () => Number(inferredStack(...stackArgs)),
    () => otherInferredStack(...stackArgs),
    385,
  );
  const doubleValues = Array.from({ length: 10 }, (_, i) => i + 0.25);
  const variadicDouble = bindExtra("fixture_variadic_double_sum", c.c_double, [c.c_int32], [10, ...doubleValues], 47.5);
  const otherVariadicDouble = other.func("double fixture_variadic_double_sum(int32_t count, ...)");
  const otherDoubleArgs = doubleValues.flatMap((value) => ["double", value]);
  add(
    "variadic doubles (10 values)",
    "Variadic calls",
    "number",
    () => variadicDouble(10, ...doubleValues),
    () => otherVariadicDouble(10, ...otherDoubleArgs),
    47.5,
  );
  addAsync("inferred mixed", "number", inferred, otherInferred, inferredArgs, 322);
  if (typeof otherVariadic.async === "function") {
    addAsync("variadic sum", "number", variadic, otherVariadic, [null, 3, 7, 8, 9], 24, [null, 3, "int", 7, "int", 8, "int", 9]);
  } else {
    unsupported.push(`Async variadic calls: Koffi ${koffi.version} does not expose an async entry for variadic functions.`);
  }

  const echo = bind("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherEcho = other.func("int32_t fixture_scalar_i32(int32_t value)");
  addAsync("i32", "number", echo, otherEcho, [7], 7);
  addAsync("double5 return", "object", makeLarge, otherMakeLarge, [1.5], { a: 1.5, b: 1.75, c: 2, d: 2.25, e: 2.5 });
  addAsync("double5 argument", "number", sumLarge, otherSumLarge, [largeValue], 43.75);
  await runComparison("Koffi", cases, {
    version: koffi.version,
    externalBuffers: c.EXTERNAL_BUFFERS,
    unsupported,
    notes: [
      "Both libraries call the same C fixture with matching native signatures.",
      "Fixed sync/async bindings use direct invokers when enabled and eligible; all other signatures use libffi. Direct invokers are controlled at build time.",
      "CFUNCTYPE rows use independently bound functions to keep optimization feedback separate from direct-call rows.",
      "String lengths and the narrow/inferred-stack i64 results are normalized to Number; BigInt-to-Number conversion is included.",
      "Wide i64 values return BigInt in both APIs. Struct results are plain objects in both APIs.",
      "The aggregate workloads use natural structs/HFAs, including large double5 arguments/results. Fixed async workers reuse their binding's direct invoker or prepared libffi interface.",
      "The i32 C-loop row performs 64 completed callbacks inside one native invocation. Times are ns/op per 64-callback batch, not per callback; the int64 sum is normalized to Number in both APIs.",
      "Callback trampolines use libffi, independently of the C caller's outgoing backend. Aggregate arguments are by-value snapshots with equivalent field values, using ctypes objects versus Koffi plain objects. Thread-safe sync rows run on the host thread; async rows include foreign-thread delivery and scheduling. The bytes33 callback result is normalized to Number in both APIs.",
      "node-ctypes uses owned, non-reused pooled snapshots for ordinary aggregate/derived-scalar callback arguments and caches struct proxy handlers. Native raw callbacks and over-aligned snapshots retain the Node-API allocator. Snapshot bytes and object identity/lifetime remain independent across reentry and later calls.",
      "Inferred rows omit node-ctypes argtypes, while Koffi uses an explicit fixed signature for the same C function. Variadic rows include Koffi's explicit extra type tags.",
      "Async compares fixed, inferred and variadic calls at concurrency 1 and 8, including Promise completion; the libraries use different worker pools.",
    ],
  });
} finally {
  for (const callback of callbacks) callback.release();
  for (const callback of otherCallbacks) koffi.unregister(callback);
  other.unload();
  lib.close();
}
