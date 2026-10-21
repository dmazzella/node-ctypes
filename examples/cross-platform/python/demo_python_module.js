// demo_python_module — import a local .py module and use its classes from Node.js
//
// inventory.py (next to this demo) is a plain Python module: its directory is
// added to sys.path, then classes, properties, generators, custom exceptions
// and callbacks are used from JavaScript.
//
// Usage:
//   node examples/cross-platform/python/demo_python_module.js

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Python, PythonError, kwargs } from "./python.js";

const python = Python.initialize();

console.log("═══════════════════════════════════════════════════════════");
console.log(` Local Python module: inventory.py (Python ${python.version})`);
console.log("═══════════════════════════════════════════════════════════\n");

// [1] import inventory.py from this demo's directory (Python: sys.path.insert)
const here = dirname(fileURLToPath(import.meta.url));
python.import("sys").path.insert(0, here);
const inventory = python.import("inventory");
console.log("[1] import inventory");
console.log(`    ${inventory}`);
console.log(`    docstring: ${inventory.__doc__.split("\n")[0]}`);
console.log();

// [2] create an instance and call its methods (positional and keyword arguments)
const shop = inventory.Inventory("node-ctypes shop");
shop.add("keyboard", 49.9, 3);
shop.add("mouse", 19.5, kwargs({ quantity: 10 }));
shop.add("monitor", 189.0);
const cable = shop.add("cable", 4.25, 2);
console.log("[2] Inventory instance");
console.log(`    ${shop}`); // __repr__
console.log(`    len = ${python.builtins.len(shop)}, owner = ${shop.owner}, total value = ${shop.total_value()}`);
console.log(`    returned dataclass: ${cable}, property total = ${cable.total}`);
console.log();

// [3] iterate Python objects from JavaScript: __iter__ and a generator
console.log("[3] iteration");
for (const item of shop) {
  console.log(`    ${item.name.padEnd(9)} ${String(item.quantity).padStart(3)} × ${item.price.toFixed(2).padStart(7)} = ${item.total.toFixed(2).padStart(8)}`);
}
console.log(`    low stock (generator): ${[...shop.low_stock(kwargs({ threshold: 2 }))].join(", ")}`);
console.log();

// [4] attribute writes and JSON for JavaScript
cable.price = 3.99;
console.log("[4] attribute write and JSON");
console.log(`    cable.price = 3.99 → cable.total = ${cable.total}`);
const data = JSON.parse(shop.to_json());
console.log(`    to_json() → JSON.parse: ${data.items.length} items, first ${JSON.stringify(data.items[0])}`);
console.log("    items dict → toJS():", Object.keys(shop.items.toJS()));
console.log();

// [5] custom Python exception, with its attributes
console.log("[5] custom exception");
try {
  shop.remove("monitor", 5);
} catch (error) {
  if (!(error instanceof PythonError) || error.type !== "OutOfStock") throw error;
  const { name, requested, available } = error.exception;
  console.log(`    ${error.message}`);
  console.log(`    attributes: name=${name}, requested=${requested}, available=${available}`);
}
console.log();

// [6] a JavaScript function as the callback of a Python method. The dict it
// receives is a live Python object: item.get("name"), or toJS() for a JS object.
console.log("[6] JavaScript formatter passed to report()");
const lines = shop.report((item) => {
  const { name, quantity, price } = item.toJS();
  return `${name.toUpperCase()}: ${quantity} pcs @ ${price.toFixed(2)} EUR`;
});
for (const line of lines) console.log(`    ${line}`);

console.log("\n    Done!");
