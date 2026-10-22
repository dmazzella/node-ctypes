---
title: Embedded Python
---

# Embedded Python (CPython)

Loads the shared library of an installed Python (`libpython3.x.so`, `Python.framework`, `python3x.dll`) and drives it through the Python C API, as a C extension would: run code, import modules (standard library, numpy, local `.py` files), call Python objects from JavaScript and expose JavaScript functions to Python.

**Platforms:** Windows, macOS, Linux (glibc and musl) · **Library:** [python.js](python.js) · **Requires:** Python 3.12+ built with a shared library (default on Windows and macOS; Debian/Ubuntu: `libpython3.x`; pyenv: `PYTHON_CONFIGURE_OPTS=--enable-shared`)

## Run

```bash
node examples/cross-platform/python/demo_python_basics.js     # code, standard library, live objects, exceptions, numpy
node examples/cross-platform/python/demo_python_callbacks.js  # JavaScript functions called by Python
node examples/cross-platform/python/demo_python_threads.js    # Python threads alongside the Node.js event loop
node examples/cross-platform/python/demo_python_async.js      # asyncio coroutines ↔ JavaScript promises, Node.js fetch() → Python asyncio server
node examples/cross-platform/python/demo_python_module.js     # import the local inventory.py
node examples/cross-platform/python/demo_python_worker.js     # Python hosted by a worker thread

# Choose the interpreter (e.g. a virtual environment) and, if needed, its library
PYTHON=/path/to/venv/bin/python node examples/cross-platform/python/demo_python_basics.js
PYTHON=/opt/python3.12/bin/python3 PYTHON_LIBRARY=/opt/python3.12/lib/libpython3.12.so node examples/cross-platform/python/demo_python_threads.js
```

## Use the library

```javascript
import { Python, kwargs } from "./python.js";

const python = Python.initialize(); // $PYTHON, python3, python or py on PATH
const math = python.import("math");
console.log(math.sqrt(2)); // 1.4142135623730951

python.module("node", { hello: (name) => `hello ${name} from Node ${process.version}` });
python.exec("import node\nprint(node.hello('Python'))");

const sorted = python.builtins.sorted(["kiwi", "fig", "banana"], kwargs({ key: (s) => s.length }));
console.log(sorted.toJS()); // ['fig', 'kiwi', 'banana']
```

A local `.py` file is imported after adding its directory to `sys.path`, as in Python:

```javascript
python.import("sys").path.insert(0, import.meta.dirname);
const inventory = python.import("inventory"); // ./inventory.py
const shop = inventory.Inventory("shop");
shop.add("mouse", 19.5, kwargs({ quantity: 10 }));
console.log(shop.total_value()); // 195
```

Packages and subpackages work as in Python: `python.import("xml.etree.ElementTree")` returns the submodule, and local packages (folders with `__init__.py`, relative imports, namespace packages) are found through `sys.path`. Modules written in JavaScript can be submodules too: `python.module("node.fs", {...})` is importable with `import node.fs` and `from node import fs`, and missing parent packages are created.

- **Values:** `None`, `bool`, `int` (BigInt beyond 2^53), `float`, `str` and `bytes` (Buffer) become JavaScript values; lists, dicts, modules and instances stay live Python objects (attributes, calls, `obj[i]`, iteration, `toJS()`). JavaScript arrays, `Tuple`s, plain objects, Maps, Sets, Dates (aware `datetime`) and functions are converted to Python by value.
- **Dicts as objects:** keys are properties (`config.name`, `config["name"] = v`, `"name" in config`, `Object.keys(config)`, `{ ...config }`); attributes come first, so `config.get` is the method. `JSON.stringify()` works on any proxy, `obj.length` is `len(obj)`, and Python numbers (`Fraction`, `Decimal`, numpy scalars) work in JavaScript arithmetic.
- **Tuples:** deep conversions (`eval()`, `toJS()`) turn tuples into `Tuple` arrays, which go back to Python as tuples; `Tuple.of(1, 2)` creates one.
- **Errors:** Python exceptions are thrown as `PythonError` (`type`, `traceback`, `exception`); JavaScript errors raised in functions called by Python become `RuntimeError` in Python.

```javascript
const config = python.import("json").loads('{"name": "demo", "tags": ["a"]}');
config.version = 2;
console.log(config.name, Object.keys(config), JSON.stringify(config)); // demo [ 'name', 'tags', 'version' ] {"name":"demo",...}
```

### JavaScript objects in Python

Other JavaScript objects (class instances, promises, iterators, Node.js objects) reach Python **by reference**, as a `JsProxy`: attributes and methods, items (`obj[key]`, Maps and arrays too), `len()`, `in`, iteration, `async for`, `await` (promises), `dir()` and `repr()` work on the JavaScript object, and it comes back to JavaScript as itself. `byReference(value)` passes arrays, plain objects, Maps and Sets the same way instead of copying them.

```javascript
class Cart {
  items = [];
  add(name, price) {
    this.items.push({ name, price });
    return this;
  }
}
python.module("shop", { Cart, EventEmitter });
python.exec("def fill(cart): cart.add('book', 12.5).add('pen', 1.5)");
const cart = new Cart();
python.main.fill(cart); // cart.items has 2 items
python.eval("shop.Cart().add('mug', 8)"); // JavaScript classes are instantiated by calling them
python.exec("emitter = shop.EventEmitter.new()"); // .new(): constructors that are not classes
python.main.update(byReference(settingsMap)); // Python changes the Map itself
```

### Shared memory

Typed arrays (other than `Uint8Array`), `ArrayBuffer` and `DataView` become a `memoryview` of their memory, without copies (`byReference(buffer)` does the same for a Buffer); numpy can use it directly (`np.asarray(float32Array)`). The other way, `obj.toTypedArray()` returns a typed array over the memory of a Python buffer (`bytearray`, `array.array`, numpy arrays; read-only buffers are copied). The memory stays valid while either side uses it; do not transfer or detach an `ArrayBuffer` used by Python.

```javascript
const samples = new Float64Array([2.5, 3.1, 4.7]);
np.asarray(samples).__imul__(10); // samples is [25, 31, 47]
const values = np.zeros(4).toTypedArray(); // Float64Array over the numpy memory
```

### Dates

A `Date` becomes an aware `datetime` (UTC); `datetime`s become `Date`s in deep conversions (`eval()`, `toJS()`; naive ones are local time) and with `new Date(dt)`.

Where `Temporal` exists (Node.js 26+), the other date types convert too:

| Python                                                                        | JavaScript                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `date`                                                                        | `Temporal.PlainDate`                                                                               |
| `time` (without time zone)                                                    | `Temporal.PlainTime`                                                                               |
| `timedelta`                                                                   | `Temporal.Duration` (a `Duration` with years or months has no `timedelta` equivalent: `TypeError`) |
| naive `datetime`                                                              | ← `Temporal.PlainDateTime`                                                                         |
| aware `datetime` (UTC)                                                        | ← `Temporal.Instant`                                                                               |
| aware `datetime` (`zoneinfo.ZoneInfo`, a fixed offset without time zone data) | ← `Temporal.ZonedDateTime`                                                                         |

Python to JavaScript conversions happen in deep conversions (`eval()`, `toJS()`), as for `Date`; without `Temporal` these values stay Python objects.

### with, async with, time limits

```javascript
const text = python.with(python.builtins.open("data.txt"), (file) => file.read()); // with open(...) as file
await python.asyncWith(python.import("asyncio").Lock(), async () => {}); // async with lock
python.withTimeout(1000, () => python.main.solve(puzzle)); // TimeoutError after 1 s
```

`with` passes the error thrown by the body to `__exit__()`, which can suppress it (`contextlib.suppress`). `withTimeout` interrupts Python code between bytecodes: a long call into C code (such as `time.sleep()`) is interrupted when it returns.

### Threads and asyncio

- **Threads:** the GIL is released while JavaScript runs, so Python threads keep working.
- **asyncio:** coroutines, tasks and `concurrent.futures.Future` objects are awaited from JavaScript like promises; they run on an asyncio event loop in a Python thread. `for await` iterates Python async generators, `async for` JavaScript async iterables.
- **Cancellation:** `python.run(coro, { signal })` cancels the coroutine when the AbortSignal aborts (`AbortSignal.timeout(ms)`); a function marked with `cancellable(fn)` gets an AbortSignal as last argument, aborted when Python cancels the call (`asyncio.wait_for`, `task.cancel()`).
- **Free-threaded Python** (`python3.14t`) works too: Python threads run in parallel.
- **JavaScript from other Python threads:** JavaScript functions always run on the Node.js main thread. Called from a coroutine they are awaitable; called from another thread they return a `concurrent.futures.Future` (`node.hash(text).result()`). An async function's promise is awaited.

```javascript
python.module("node", {
  read_text: (file) => readFile(file, "utf8"), // async JavaScript function
  download: cancellable((url, signal) => fetch(url, { signal })), // aborted if Python cancels it
});
python.exec(`
import asyncio, node
async def sizes(paths):
    texts = await asyncio.gather(*(node.read_text(p) for p in paths))
    return [len(t) for t in texts]
`);
console.log((await python.main.sizes(["a.txt", "b.txt"])).toJS()); // [120, 42]
await python.run(python.main.crawl(), { signal: AbortSignal.timeout(5000) }); // cancelled after 5 s
for await (const event of python.main.events()) console.log(event); // a Python async generator
```

Node.js is woken through a node-ctypes `threadSafeCallback`, called by a Python thread (through Python's own `ctypes`), so calls from Python threads run as soon as the Node.js event loop is free. The callback is `unref()`'d: like an unref'd timer, Python activity alone does not keep Node.js alive, while JavaScript awaiting Python code does. If the main thread is running Python code meanwhile (for example `Thread.join()` on that thread, in synchronous code), it runs the call itself: a `SIGURG` signal (unused by Node.js) on POSIX systems, the interrupt event of Ctrl+C on Windows with Python 3.14+, interrupts its wait, the call runs, and the wait resumes, so waiting for threads that call JavaScript is not a deadlock. Two cases still are, and Python prints a `RuntimeWarning` after 5 s: an **async** JavaScript function awaited by such a thread (its promise needs the Node.js event loop), and on Windows before Python 3.14 a main thread blocked in a wait (it runs calls only while executing Python code). Await the work from JavaScript in those cases (`await pool.submit(...)`).

### Python in a worker

One thread per process hosts the interpreter: the main thread or a `worker_threads` Worker, whichever calls `Python.initialize()` first (other threads get an error). Hosting it in a worker keeps CPU-bound Python code off the Node.js main thread; the main thread sends jobs with `postMessage` (see `demo_python_worker.js`).

### Diagnostics and options

- `python.stats()` counts the objects shared by the two languages: PyObject proxies alive in JavaScript (about 40 are used by python.js itself), JavaScript functions and objects used by Python, pending awaits and calls. A number that keeps growing is a leak.
- `Python.initialize({ stdin: false })` leaves the process stdin to Node.js: Python reads stdin through its own buffer, so `input()` would also consume lines meant for Node.js.

### Limits

- Requires node-ctypes 2.1+ (`threadSafeCallback().unref()`).
- One thread per process uses Python (see [Python in a worker](#python-in-a-worker)).
- Reference cycles between the two languages (a JavaScript object kept by Python that holds a proxy of the same Python object) are never collected.
- A `JsProxy` used from a Python thread other than the main one waits for Node.js like any JavaScript call (see above).

## node-ctypes features used

`CDLL(path, RTLD_GLOBAL)` · a `Structure` with a `CFUNCTYPE` field (`PyMethodDef`) · `CFUNCTYPE` callbacks · `threadSafeCallback` called from a Python thread · `addressof()` and `ptrToBuffer()` for shared memory · `c_void_p.in_dll()` and `symbol()` for exported data · `byref()` output parameters · `string_at(address, size)` · `memmove` from an address · `WinDLL` (`AddDllDirectory`)
