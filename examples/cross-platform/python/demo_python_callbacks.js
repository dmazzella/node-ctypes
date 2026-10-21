// demo_python_callbacks — JavaScript functions called by Python
//
// Exposes JavaScript functions to the embedded Python as an importable module
// and as callbacks (key functions, reducers, event handlers), with errors and
// recursion crossing the two languages, and JavaScript objects used by Python
// by reference.
//
// Usage:
//   node examples/cross-platform/python/demo_python_callbacks.js

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Python, PythonError, byReference, kwargs } from "./python.js";

const python = Python.initialize();
const events = new EventEmitter();

console.log("═══════════════════════════════════════════════════════════");
console.log(` JavaScript ↔ Python callbacks (Python ${python.version})`);
console.log("═══════════════════════════════════════════════════════════\n");

// [1] a module written in JavaScript, imported by Python code
python.module("node", {
  version: process.version,
  platform: process.platform,
  read_text: (file) => readFileSync(file, "utf8"),
  sha256: (text) => createHash("sha256").update(text).digest("hex"),
  // A Python callable kept by JavaScript and called from the event loop.
  on: (event, handler) => void events.on(event, (...args) => handler(...args)),
});
python.main.demo_file = fileURLToPath(import.meta.url);

console.log("[1] import node (a JavaScript module)");
python.exec(`
import node
print(f"    Python sees Node {node.version} on {node.platform}")
print(f"    node.sha256('hello') = {node.sha256('hello')[:16]}...")
lines = node.read_text(demo_file).splitlines()
print(f"    this demo has {len(lines)} lines, the first: {lines[0]!r}")
`);
console.log();

// [2] JavaScript functions as Python callbacks
const functools = python.import("functools");
const re = python.import("re");
console.log("[2] callbacks");
const words = ["kiwi", "banana", "fig", "cherry", "apple"];
console.log("    sorted(key=len, reverse) =", python.builtins.sorted(words, kwargs({ key: (word) => word.length, reverse: true })).toJS());
console.log(
  "    reduce(×, 1..10) =",
  functools.reduce((a, b) => a * b, python.builtins.range(1, 11)),
);
console.log(
  "    re.sub(doubling) =",
  re.sub("\\d+", (match) => String(Number(match.group(0)) * 2), "3 apples and 12 pears"),
);
console.log(
  "    map + filter:",
  python.builtins
    .list(
      python.builtins.filter(
        (n) => n % 3 === 0,
        python.builtins.map((n) => n * n, python.builtins.range(10)),
      ),
    )
    .toJS(),
);
console.log();

// [3] recursion across the languages: is_even in JavaScript, is_odd in Python
python.module("parity", { is_even: (n) => (n === 0 ? true : python.main.is_odd(n - 1)) });
python.exec("import parity\ndef is_odd(n):\n    return False if n == 0 else parity.is_even(n - 1)");
console.log("[3] mutual recursion JavaScript ↔ Python");
console.log(`    is_odd(7) = ${python.main.is_odd(7)}, is_odd(10) = ${python.main.is_odd(10)} (each step crosses the boundary)`);
console.log();

// [4] errors in both directions
console.log("[4] errors");
python.exec(`
import node
try:
    node.read_text("/does/not/exist")
except RuntimeError as e:
    print("    Python caught:", e)
`);
python.exec("def apply(f, x):\n    return f(x)");
try {
  // A KeyError raised by Python inside a JavaScript callback keeps its type.
  python.main.apply((key) => python.eval(`{}[${JSON.stringify(key)}]`), "missing");
} catch (error) {
  console.log(`    JavaScript caught ${error.message} (JavaScript → Python → JavaScript, type kept)`);
}
try {
  python.main.apply(() => {
    throw new TypeError("bad input");
  }, 1);
} catch (error) {
  console.log(`    JavaScript caught ${error.message}; error.cause is the original ${error.cause?.name}`);
}
console.log();

// [5] JavaScript objects used by Python by reference (JsProxy)
console.log("[5] JavaScript objects in Python");
class Cart {
  items = [];
  add(name, price) {
    this.items.push({ name, price });
    return this;
  }
  get total() {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  }
}
python.module("shop", { Cart, EventEmitter });
python.exec(`
import shop
def fill(cart):
    cart.add("book", 12.5).add("pen", 1.5)  # methods, chained: the same JavaScript object
    cart.items[0]["price"] = 10              # nested objects are used by reference too
    return len(cart.items), cart.total
`);
const cart = new Cart();
const [count, total] = python.main.fill(cart);
console.log(`    Python filled the cart (${count} items, total ${total}); JavaScript sees ${JSON.stringify(cart.items)}`);
console.log(`    Python creates JavaScript objects: ${python.eval("repr(shop.Cart().add('mug', 8))")}`);
const settings = new Map([["theme", "dark"]]);
python.main.settings = byReference(settings); // by value it would be a dict copy
python.exec('settings["lang"] = "it"\ndel settings["theme"]');
console.log("    byReference(Map) changed by Python:", settings);
python.exec("emitter = shop.EventEmitter.new()  # .new(): constructors that are not classes\nheard = []\nemitter.on('hello', heard.append)\nemitter.emit('hello', 'from Python')");
console.log("    Node.js EventEmitter created and used by Python:", python.eval("heard"));
console.log();

// [6] Python handlers for Node.js events
console.log("[6] Python event handlers (Node.js event loop)");
python.exec(`
import node
received = []
def on_tick(n, payload):
    received.append(n)
    print(f"    Python handler: tick {n}, payload {payload}")
node.on("tick", on_tick)
`);
let tick = 0;
const timer = setInterval(() => {
  events.emit("tick", ++tick, { source: "setInterval", at: Date.now() % 100000 });
  if (tick === 3) {
    clearInterval(timer);
    console.log(`    Python received ticks ${python.eval("received").join(", ")}`);
    console.log("\n    Done!");
  }
}, 100);

process.on("uncaughtException", (error) => {
  console.error(error instanceof PythonError ? `${error.message}\n${error.traceback}` : error);
  process.exit(1);
});
