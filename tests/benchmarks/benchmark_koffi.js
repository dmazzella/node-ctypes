import * as c from "node-ctypes";
import koffi from "koffi";
import { fixturePath, runComparison } from "./runner.js";

const file = fixturePath();
const lib = new c.CDLL(file);
const other = koffi.load(file);
let callback;
let otherCallback;

try {
  const cases = [];
  const add = (name, group, representation, ctypes, other, expected) =>
    cases.push({ name, group, representation, ctypes, other, expected });
  const zero = lib.func("fixture_benchmark_zero", c.c_int32, []);
  const otherZero = other.func("int32_t fixture_benchmark_zero(void)");
  add("zero arguments", "Synchronous calls", "number", () => zero(), () => otherZero(), 7);
  // Separate call sites keep V8 feedback independent for each signature.
  const i8 = lib.func("fixture_scalar_i8", c.c_int8, [c.c_int8]);
  const otherI8 = other.func("int8_t fixture_scalar_i8(int8_t value)");
  add("echo i8 (number)", "Synchronous calls", "number", () => i8(-7), () => otherI8(-7), -7);
  const i32 = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherI32 = other.func("int32_t fixture_scalar_i32(int32_t value)");
  add("echo i32 (number)", "Synchronous calls", "number", () => i32(-7), () => otherI32(-7), -7);
  const u32 = lib.func("fixture_scalar_u32", c.c_uint32, [c.c_uint32]);
  const otherU32 = other.func("uint32_t fixture_scalar_u32(uint32_t value)");
  add("echo u32 (number)", "Synchronous calls", "number", () => u32(0xffffffff), () => otherU32(0xffffffff), 0xffffffff);
  const i64 = lib.func("fixture_scalar_i64", c.c_int64, [c.c_int64]);
  const otherI64 = other.func("int64_t fixture_scalar_i64(int64_t value)");
  const wide = 2n ** 60n + 7n;
  add("echo i64 (bigint)", "Synchronous calls", "bigint", () => i64(wide), () => otherI64(wide), wide);
  const float = lib.func("fixture_scalar_float", c.c_float, [c.c_float]);
  const otherFloat = other.func("float fixture_scalar_float(float value)");
  add("echo float (number)", "Synchronous calls", "number", () => float(1.5), () => otherFloat(1.5), 1.5);
  const double = lib.func("fixture_scalar_double", c.c_double, [c.c_double]);
  const otherDouble = other.func("double fixture_scalar_double(double value)");
  add("echo double (number)", "Synchronous calls", "number", () => double(1.5), () => otherDouble(1.5), 1.5);
  const mixed = lib.func("fixture_exact_mixed", c.c_double, [c.c_int32, c.c_double, c.c_float, c.c_int32]);
  const otherMixed = other.func("double fixture_exact_mixed(int32_t a, double b, float c, int32_t d)");
  add("mixed arguments (i32,f64,f32,i32)", "Synchronous calls", "number",
    () => mixed(-7, 1.5, 2.25, 8), () => otherMixed(-7, 1.5, 2.25, 8), 10.75);

  const length = lib.func("fixture_string_length", c.c_size_t, [c.c_char_p]);
  const otherLength = other.func("size_t fixture_string_length(const char *text)");
  for (const size of [16, 4096]) {
    const text = "x".repeat(size);
    add(`string length ${size} B -> number`, "Strings and buffers", "number",
      () => Number(length(text)), () => otherLength(text), size);
  }
  const buffer = Buffer.from(new Int32Array([1, 2, 3, 4]).buffer);
  const sum = lib.func("fixture_sum_int4", c.c_int32, [c.c_void_p]);
  const otherSum = other.func("int32_t fixture_sum_int4(const int32_t *values)");
  add("buffer argument (4 x i32)", "Strings and buffers", "number", () => sum(buffer), () => otherSum(buffer), 10);

  const Point = c.struct({ x: c.c_int32, y: c.c_int32 });
  const OtherPoint = koffi.struct("BenchmarkPoint", { x: "int32_t", y: "int32_t" });
  const make = lib.func("fixture_point_make", Point, [c.c_int32, c.c_int32]);
  const otherMake = other.func("fixture_point_make", OtherPoint, ["int32_t", "int32_t"]);
  add("struct return {x,y}", "Aggregate values", "object", () => make(3, 4), () => otherMake(3, 4), { x: 3, y: 4 });
  const pointSum = lib.func("fixture_point_sum", c.c_int32, [Point]);
  const otherPointSum = other.func("fixture_point_sum", "int32_t", [OtherPoint]);
  const point = { x: 3, y: 4 };
  add("struct argument {x,y}", "Aggregate values", "number", () => pointSum(point), () => otherPointSum(point), 7);

  class Fields extends c.Structure {
    static _fields_ = [["x", c.c_int32], ["y", c.c_int32]];
  }
  const fields = new Fields(10, 20);
  const otherFields = Buffer.alloc(8);
  otherFields.writeInt32LE(10, 0);
  otherFields.writeInt32LE(20, 4);
  add("read two i32 fields", "Memory access", "number",
    () => fields.x + fields.y,
    () => koffi.decode(otherFields, 0, "int32_t") + koffi.decode(otherFields, 4, "int32_t"), 30);

  callback = c.callback((value) => value + 1, c.c_int32, [c.c_int32]);
  const Callback = koffi.proto("int32_t BenchmarkCallback(int32_t value)");
  otherCallback = koffi.register((value) => value + 1, koffi.pointer(Callback));
  const invoke = lib.func("fixture_scalar_callback", c.c_int32, [c.c_void_p, c.c_int32]);
  const otherInvoke = other.func("fixture_scalar_callback", "int32_t", [koffi.pointer(Callback), "int32_t"]);
  add("C -> JS callback (i32)", "Callbacks", "number",
    () => invoke(callback, 7), () => otherInvoke(otherCallback, 7), 8);

  const variadic = lib.func("fixture_variadic_sum", c.c_int32, [c.c_void_p, c.c_int32]);
  const otherVariadic = other.func("int32_t fixture_variadic_sum(void *callback, int32_t count, ...)");
  add("variadic sum (3 integers)", "Variadic calls", "number",
    () => variadic(null, 3, 7, 8, 9), () => otherVariadic(null, 3, "int", 7, "int", 8, "int", 9), 24);

  const echo = lib.func("fixture_scalar_i32", c.c_int32, [c.c_int32]);
  const otherEcho = other.func("int32_t fixture_scalar_i32(int32_t value)");
  const otherAsync = () => new Promise((resolve, reject) =>
    otherEcho.async(7, (error, result) => error ? reject(error) : resolve(result)));
  for (const concurrency of [1, 8]) {
    cases.push({
      name: `async i32 (${concurrency} in flight)`, group: "Async calls (scheduling included)", representation: "number",
      ctypes: () => echo.callAsync(7), other: otherAsync, expected: 7, concurrency,
    });
  }
  await runComparison("Koffi", cases, {
    version: koffi.version, externalBuffers: c.EXTERNAL_BUFFERS,
    notes: [
      "Both libraries call the same C fixture with matching native signatures.",
      "String lengths are normalized to Number; node-ctypes BigInt-to-Number conversion is included.",
      "Wide i64 values return BigInt in both APIs. Struct results are plain objects in both APIs.",
      "Async compares Promise completion at the stated concurrency; the libraries use different worker pools.",
    ],
  });
} finally {
  callback?.release();
  if (otherCallback !== undefined) koffi.unregister(otherCallback);
  other.unload();
  lib.close();
}
