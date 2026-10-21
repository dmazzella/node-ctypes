// demo_python_threads — Python threads running alongside the Node.js event loop
//
// The embedded Python releases the GIL whenever JavaScript is not calling it,
// so Python threads keep working while Node.js runs timers and I/O. Python
// futures are awaited from JavaScript like promises.
//
// Usage:
//   node examples/cross-platform/python/demo_python_threads.js

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Python, kwargs } from "./python.js";

const python = Python.initialize();

python.exec(`
import math, queue, threading, time

def count_primes(start, stop):
    return sum(1 for n in range(max(start, 2), stop) if all(n % d for d in range(2, math.isqrt(n) + 1)))

progress = queue.Queue()

def worker(name, start, stop, steps=4):
    size = (stop - start) // steps
    total = 0
    for i in range(steps):
        total += count_primes(start + i * size, start + (i + 1) * size)
        progress.put((name, i + 1, steps))
    progress.put((name, "done", total))
`);

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(` Python threads + Node.js event loop (Python ${python.version})`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // [1] Python threads report progress through a queue read by a Node.js timer
  console.log("[1] two Python threads count primes; Node.js keeps running");
  const threading = python.import("threading");
  const started = Date.now();
  for (const [name, start, stop] of [
    ["low", 0, 150_000],
    ["high", 150_000, 300_000],
  ]) {
    threading.Thread(kwargs({ target: python.main.worker, args: [name, start, stop], daemon: true })).start();
  }

  let ticks = 0;
  const totals = {};
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      ticks++;
      while (!python.main.progress.empty()) {
        const [name, step, value] = python.main.progress.get().toJS();
        if (step === "done") {
          totals[name] = value;
          console.log(`    ${name}: ${value} primes`);
        } else {
          console.log(`    ${name}: step ${step}/${value}  (Node.js timer tick ${ticks})`);
        }
      }
      if (Object.keys(totals).length === 2) {
        clearInterval(timer);
        resolve();
      }
    }, 20);
  });
  console.log(`    total ${totals.low + totals.high} primes in ${Date.now() - started} ms, ${ticks} timer ticks meanwhile\n`);

  // [2] concurrent.futures awaited as promises, together with Node.js I/O
  console.log("[2] await Python futures and Node.js I/O together");
  const futures = python.import("concurrent.futures");
  const executor = futures.ThreadPoolExecutor(kwargs({ max_workers: 2 }));
  const [primes, sleepy, source] = await Promise.all([executor.submit(python.main.count_primes, 0, 100_000), executor.submit(python.eval("lambda: (time.sleep(0.2), 'slept 200 ms')[1]")), readFile(new URL(import.meta.url), "utf8")]);
  console.log(`    primes below 100000: ${primes} | ${sleepy} | read this file: ${source.length} chars`);

  try {
    await executor.submit(python.main.count_primes, "a", "b");
  } catch (error) {
    console.log(`    a failed future rejects the promise with a ${error.name}: ${error.message}`);
  }
  executor.shutdown();
  console.log();

  // [3] Python threads calling JavaScript: the call runs on the Node.js main
  //     thread and returns a concurrent.futures.Future
  console.log("[3] Python threads calling JavaScript functions");
  python.module("node", {
    hash: (text) => createHash("sha256").update(text).digest("hex").slice(0, 12),
    fetch_size: async (url) => (await readFile(new URL(url))).length, // an async function: the future waits for its promise
  });
  python.exec(`
import node, threading

def checksum(text):
    # .result() waits for Node.js: fine in a worker thread awaited by JavaScript
    return f"{threading.current_thread().name}: {text} → {node.hash(text).result()}"

def size(url):
    return node.fetch_size(url).result()
`);
  const pool = futures.ThreadPoolExecutor(kwargs({ max_workers: 3 }));
  for (const line of await Promise.all(["alpha", "beta", "gamma"].map((word) => pool.submit(python.main.checksum, word)))) {
    console.log(`    ${line}`);
  }
  console.log(`    this file read by Node.js for a Python thread: ${await pool.submit(python.main.size, import.meta.url)} bytes`);
  pool.shutdown();
  console.log("\n    Done!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
