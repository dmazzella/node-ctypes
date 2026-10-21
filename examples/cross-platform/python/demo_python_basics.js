// demo_python_basics — run Python code and use Python modules from Node.js
//
// Embeds the installed CPython (see python.js): runs code, imports
// standard library and third-party modules, converts values between the two
// languages, and turns Python exceptions into JavaScript errors.
//
// Usage:
//   node examples/cross-platform/python/demo_python_basics.js
//   PYTHON=/path/to/venv/bin/python node examples/cross-platform/python/demo_python_basics.js

import { Python, PythonError, Tuple, kwargs } from "./python.js";

const python = Python.initialize();

console.log("═══════════════════════════════════════════════════════════");
console.log(` Python ${python.version} embedded in Node ${process.version}`);
console.log("═══════════════════════════════════════════════════════════");
console.log(`    executable: ${python.executable}`);
console.log(`    library:    ${python.library}\n`);

// [1] exec / eval: code runs in the __main__ module
python.exec(`
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
`);
console.log("[1] exec / eval");
console.log("    fib(10) =", python.main.fib(10));
console.log("    fib(90) =", python.main.fib(90), "(beyond 2^53: BigInt)");
console.log("    2 ** 100 =", python.eval("2 ** 100"));
console.log("    eval converts deeply:", python.eval("{'list': [1, 2.5, None, True], 'tuple': ('é😀', b'xy')}"));
console.log();

// [2] standard library modules
const math = python.import("math");
const statistics = python.import("statistics");
const json = python.import("json");
const datetime = python.import("datetime");
const fractions = python.import("fractions");
const collections = python.import("collections");

console.log("[2] standard library");
console.log("    math.sqrt(2) =", math.sqrt(2), "| math.pi =", math.pi, "| math.factorial(25) =", math.factorial(25));
const samples = [2.5, 3.1, 4.7, 1.2, 5.8, 3.3];
console.log("    statistics: mean", statistics.mean(samples).toFixed(3), "| median", statistics.median(samples), "| stdev", statistics.stdev(samples).toFixed(3));
console.log("    json.dumps with kwargs:", json.dumps({ b: [1, 2], a: "x" }, kwargs({ sort_keys: true, separators: [",", ":"] })));
const today = datetime.date.today();
console.log(`    datetime: today is ${today} (weekday ${today.weekday()}), year ${today.year}`);
const half = fractions.Fraction(1, 3).__add__(fractions.Fraction(1, 6));
console.log(`    fractions: 1/3 + 1/6 = ${half}`);
console.log("    Counter('mississippi').most_common(2) =", collections.Counter("mississippi").most_common(2).toJS());
console.log();

// [3] live Python objects: lists, dicts and instances stay in Python
console.log("[3] live objects");
const items = python.builtins.list([3, 1, 2]);
items.append(10);
items.sort(kwargs({ reverse: true }));
console.log("    list:", items, "| items[0] =", items[0], "| items[-1] =", items[-1], "| len =", python.builtins.len(items));
console.log(
  "    iterated in JS:",
  [...items].map((n) => n * 2),
);
const config = json.loads('{"name": "node-ctypes", "tags": ["ffi", "python"]}');
config.version = "2.0"; // dict keys read and written as properties
console.log("    dict:", config, "| config.name =", config.name, "| config['tags'][0] =", config["tags"][0], "| keys:", Object.keys(config));
console.log("    JSON.stringify:", JSON.stringify({ config, items }), "| items.length =", items.length);
console.log("    repr in console.log:", python.import("decimal").Decimal("1.10"), datetime.timedelta(kwargs({ hours: 1, minutes: 30 })));
const point = python.eval("(3, 4)");
console.log(`    tuples: ${point instanceof Tuple ? "Tuple" : "Array"} [${point}] → math.hypot(*point) = ${math.hypot(...point)}, back as ${python.builtins.repr(point)}`);
console.log(`    Python numbers in JavaScript arithmetic: Fraction(${half}) * 10 = ${half * 10}`);
console.log();

// [4] exceptions
console.log("[4] exceptions");
try {
  python.eval("{'a': 1}['b']");
} catch (error) {
  console.log(`    ${error.name}: ${error.message} (type ${error.type}, instanceof PythonError: ${error instanceof PythonError})`);
}
try {
  json.loads("{not json");
} catch (error) {
  console.log(`    ${error.type}: ${error.exception.msg} at line ${error.exception.lineno}, column ${error.exception.colno}`);
}
try {
  python.exec("def check(x):\n    if x < 0:\n        raise ValueError(f'negative: {x}')\n    return x");
  python.main.check(-1);
} catch (error) {
  console.log("    Python traceback:\n" + error.traceback.replace(/^/gm, "      ").trimEnd());
}
console.log();

// [5] context managers (with) and time limits
console.log("[5] with / withTimeout");
const firstLine = python.with(python.builtins.open(import.meta.filename, kwargs({ encoding: "utf-8" })), (file) => file.readline().trim());
console.log(`    with open(...) as file: ${firstLine}`);
const lock = python.import("threading").Lock();
console.log(`    with lock: locked inside ${python.with(lock, () => lock.locked())}, after ${lock.locked()}`);
const suppress = python.import("contextlib").suppress;
console.log(`    with suppress(ZeroDivisionError): 1 / 0 → ${python.with(suppress(python.builtins.ZeroDivisionError), () => python.eval("1 / 0")) ?? "suppressed"}`);
const started = Date.now();
try {
  python.withTimeout(200, () => python.exec("while True: pass"));
} catch (error) {
  console.log(`    withTimeout(200): ${error.message} (after ${Date.now() - started} ms)`);
}
console.log();

// [6] dates and shared memory
console.log("[6] dates and typed arrays");
const launch = new Date(Date.UTC(2026, 9, 21, 15, 30));
const later = python.import("operator").add(launch, datetime.timedelta(kwargs({ days: 2, hours: 3 }))); // a Date is an aware datetime in Python
console.log(`    Date → datetime: ${python.builtins.repr(launch)}`);
console.log(`    + timedelta(days=2, hours=3) → ${later.isoformat()} → back as a Date: ${new Date(later).toISOString()}`);
console.log("    datetimes in eval() / toJS() are Dates:", python.eval("{'epoch': __import__('datetime').datetime(1970, 1, 1, tzinfo=__import__('datetime').timezone.utc)}"));
const samplesF64 = new Float64Array([2.5, 3.1, 4.7]);
const view = python.toPython(samplesF64); // a memoryview of the same memory, no copy
python.exec("def scale(values, factor):\n    for i in range(len(values)):\n        values[i] *= factor");
python.main.scale(view, 10);
console.log(`    Float64Array as memoryview (format ${view.format}): scaled in place by Python → ${Array.from(samplesF64)}`);
const shared = python.import("array").array("i", [1, 2, 3]);
const int32 = shared.toTypedArray(); // the memory of the Python array
int32[0] = 100;
console.log(`    array('i').toTypedArray() → ${int32.constructor.name}, written by JavaScript: ${shared}`);
console.log();

// [7] third-party packages, if installed in the interpreter's environment
console.log("[7] third-party packages");
try {
  const np = python.import("numpy");
  const matrix = np.arange(12).reshape(3, 4);
  console.log(`    numpy ${np.__version__}:\n${String(matrix).replace(/^/gm, "      ")}`);
  console.log(
    "    column means:",
    matrix
      .mean(kwargs({ axis: 0 }))
      .tolist()
      .toJS(),
    "| sum:",
    matrix.sum().item(),
  );
  // Shared memory both ways: numpy over a Float32Array, a numpy array as a Float64Array.
  const signal = new Float32Array([0.5, 1.5, 2.5, 3.5]);
  np.asarray(signal).__imul__(2);
  const ones = np.ones(4);
  ones.toTypedArray()[0] = 42;
  console.log(`    numpy doubled a Float32Array in place: ${Array.from(signal)} | a numpy array written through a Float64Array: ${ones}`);
} catch (error) {
  if (!(error instanceof PythonError) || error.type !== "ModuleNotFoundError") throw error;
  console.log("    numpy is not installed (pip install numpy): skipped");
}

console.log("\n    Done!");
