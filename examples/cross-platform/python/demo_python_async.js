// demo_python_async — asyncio coroutines and JavaScript promises together
//
// Python coroutines run on an asyncio event loop in a Python thread, next to
// the Node.js event loop: JavaScript awaits them as promises, and coroutines
// await JavaScript functions (async or not), which run on the Node.js main
// thread. The two loops are connected by a node-ctypes threadSafeCallback.
// Async iterators work in both directions (for await / async for), and so
// does cancellation (AbortSignal → task.cancel(), Python cancel → AbortSignal).
//
// Usage:
//   node examples/cross-platform/python/demo_python_async.js

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Python, PythonError, cancellable, kwargs } from "./python.js";

const python = Python.initialize();
const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

const paths = ["/hello", "/time", "/numbers"];
let fetched; // responses of the requests to the Python server

python.module("node", {
  delay,
  read_text: (file) => readFile(file, "utf8"),
  version: () => process.version,
  fail: async (message) => {
    await delay(10);
    throw new RangeError(message);
  },
  // [6] a cancellable JavaScript function: its AbortSignal is aborted when Python cancels the call
  download: cancellable(
    (name, ms, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms, `${name} downloaded`);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          console.log(`    JavaScript: download of ${name} aborted (${signal.reason.name})`);
          reject(signal.reason);
        });
      }),
  ),
  // [4] HTTP server written in Python: JavaScript fetches and renders the pages
  listening: (port) => {
    console.log(`    Python listens on 127.0.0.1:${port}`);
    fetched = Promise.all(paths.map((path) => fetch(`http://127.0.0.1:${port}${path}`).then((response) => response.text())));
  },
  render: async (path) => {
    await delay(50);
    if (path === "/time") return `It is ${new Date().toISOString()} in Node.js`;
    if (path === "/numbers") return `sorted by Python: ${python.builtins.sorted([5, 3, 8, 1])}`;
    return `Hello from JavaScript, served by Python ${python.version}`;
  },
});
python.main.demo_file = fileURLToPath(import.meta.url);

python.exec(`
import asyncio, time
import node

async def brew(item, seconds):
    await asyncio.sleep(seconds)
    return f"{item} ({seconds}s)"

async def breakfast():
    started = time.perf_counter()
    items = await asyncio.gather(brew("coffee", 0.3), brew("toast", 0.2), brew("eggs", 0.25))
    return {"items": items, "seconds": round(time.perf_counter() - started, 2)}

async def describe(path):
    # JavaScript functions are awaited, concurrently with asyncio.gather
    text, version, _ = await asyncio.gather(node.read_text(path), node.version(), node.delay(100))
    return f"{len(text.splitlines())} lines read by Node {version}"

async def careless():
    return await node.fail("not caught by Python")

async def careful():
    try:
        await node.fail("rejected by JavaScript")
    except RuntimeError as error:
        return f"caught in Python: {error}"

async def serve(pages):
    """HTTP server answering 'pages' requests; the pages are rendered by JavaScript."""
    served = []
    finished = asyncio.Event()

    async def handle(reader, writer):
        path = (await reader.readline()).split()[1].decode()
        while (await reader.readline()).strip():
            pass  # headers
        body = (await node.render(path)).encode()
        writer.write(b"HTTP/1.1 200 OK\\r\\nContent-Type: text/plain; charset=utf-8\\r\\n")
        writer.write(b"Content-Length: %d\\r\\nConnection: close\\r\\n\\r\\n%s" % (len(body), body))
        await writer.drain()
        writer.close()
        served.append(path)
        if len(served) == pages:
            finished.set()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    async with server:
        await node.listening(server.sockets[0].getsockname()[1])
        await asyncio.wait_for(finished.wait(), 10)
    return served

async def countdown(n):
    """An async generator, consumed by JavaScript with for await."""
    for i in range(n, 0, -1):
        await asyncio.sleep(0.05)
        yield i

async def total(numbers):
    """async for over a JavaScript async iterable."""
    result = 0
    async for n in numbers:
        result += n
    return result

async def patient(seconds):
    try:
        await asyncio.sleep(seconds)
        return "finished"
    except asyncio.CancelledError:
        print("    Python: patient() cancelled, cleaning up")
        raise

async def impatient():
    try:
        return await asyncio.wait_for(node.download("dataset", 5000), 0.1)
    except TimeoutError:
        return "gave up after 0.1 s"
`);

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(` Python asyncio + JavaScript promises (Python ${python.version})`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // [1] a coroutine awaited from JavaScript; Node.js keeps running meanwhile
  console.log("[1] await a Python coroutine");
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const { items, seconds } = (await python.main.breakfast()).toJS();
  clearInterval(timer);
  console.log(`    ${items.join(", ")} → ready in ${seconds}s, not 0.75s`);
  console.log(`    Node.js timer ticked ${ticks} times meanwhile\n`);

  // [2] Python coroutines and Node.js promises in the same Promise.all
  console.log("[2] Promise.all with Python coroutines and Node.js promises");
  const started = Date.now();
  const results = await Promise.all([python.main.brew("tea", 0.2), delay(200, "Node.js timer (0.2s)"), python.import("asyncio").sleep(0.2, "asyncio.sleep (0.2s)")]);
  console.log(`    ${results.join(" | ")} → ${Date.now() - started} ms`);
  const tasks = python.import("asyncio");
  try {
    await tasks.wait_for(python.main.brew("slow", 5), kwargs({ timeout: 0.1 }));
  } catch (error) {
    console.log(`    asyncio.wait_for timed out: ${error instanceof PythonError} ${error.type}`);
  }
  const executor = python.import("concurrent.futures").ThreadPoolExecutor();
  console.log(`    a concurrent.futures.Future is awaitable too: sum(range(10**6)) = ${await executor.submit(python.builtins.sum, python.builtins.range(10 ** 6))}\n`);
  executor.shutdown();

  // [3] coroutines awaiting JavaScript functions
  console.log("[3] Python awaits JavaScript");
  console.log(`    ${await python.main.describe(python.main.demo_file)}`);
  console.log(`    ${await python.main.careful()}`);
  try {
    await python.main.careless();
  } catch (error) {
    console.log(`    back in JavaScript: ${error.type}, cause ${error.cause.name}: ${error.cause.message}\n`);
  }

  // [4] the two event loops talking over TCP: Node.js fetch() → Python asyncio
  //     server → JavaScript renderer
  console.log("[4] Node.js fetch() against a Python asyncio server");
  const served = (await python.main.serve(paths.length)).toJS();
  for (const [i, text] of (await fetched).entries()) console.log(`    GET ${paths[i]} → ${text}`);
  console.log(`    the server handled ${served.length} requests\n`);

  // [5] async iteration in both directions
  console.log("[5] async iterators");
  const counted = [];
  for await (const n of python.main.countdown(3)) counted.push(n);
  console.log(`    for await over a Python async generator: ${counted.join(", ")}`);
  async function* readings() {
    for (const value of [3, 5, 8]) {
      await delay(20);
      yield value;
    }
  }
  console.log(`    async for in Python over a JavaScript async generator: total ${await python.main.total(readings())}\n`);

  // [6] cancellation in both directions
  console.log("[6] cancellation");
  try {
    await python.run(python.main.patient(10), { signal: AbortSignal.timeout(100) });
  } catch (error) {
    console.log(`    JavaScript: python.run() rejected with ${error.name} after 100 ms`);
  }
  console.log(`    Python: ${await python.main.impatient()}`);

  console.log("\n    Done!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
