// demo_python_worker — Python hosted by a worker thread
//
// One thread per process hosts the embedded Python: here a worker, so that
// CPU-bound Python code never blocks the Node.js main thread. The main thread
// sends jobs with postMessage and stays responsive meanwhile.
//
// Usage:
//   node examples/cross-platform/python/demo_python_worker.js

import { Worker, isMainThread, parentPort } from "node:worker_threads";

if (isMainThread) {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" Python in a worker thread");
  console.log("═══════════════════════════════════════════════════════════\n");

  const worker = new Worker(new URL(import.meta.url));
  const pending = new Map();
  let nextId = 0;
  worker.on("message", ({ id, result, error }) => {
    const { resolve, reject } = pending.get(id);
    pending.delete(id);
    if (error) reject(new Error(error));
    else resolve(result);
  });
  const run = (job, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, job, args });
    });

  const version = await run("version");
  console.log(`[1] Python ${version} runs in the worker\n`);

  console.log("[2] CPU-bound Python jobs; the main thread keeps running");
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  const started = Date.now();
  const [primes, digits] = await Promise.all([run("count_primes", 300_000), run("pi_digits", 4_000)]);
  clearInterval(timer);
  console.log(`    primes below 300000: ${primes} | pi: ${digits.slice(0, 20)}... (${digits.length} digits)`);
  console.log(`    ${Date.now() - started} ms, main thread timer ticked ${ticks} times meanwhile\n`);

  console.log("[3] Python errors reach the main thread");
  try {
    await run("count_primes", "many");
  } catch (error) {
    console.log(`    ${error.message}\n`);
  }

  console.log("[4] only one thread per process can host Python");
  const { Python } = await import("./python.js");
  try {
    Python.initialize();
  } catch (error) {
    console.log(`    main thread: ${error.message}`);
  }

  // Let the worker finalize Python before it exits.
  worker.postMessage({ job: "exit" });
  await new Promise((resolve) => worker.once("exit", resolve));
  console.log("\n    Done!");
} else {
  const { Python, PythonError } = await import("./python.js");
  const python = Python.initialize();
  python.exec(`
import math, sys

def version():
    return sys.version.split()[0]

def count_primes(limit):
    # trial division in pure Python: CPU-bound on purpose
    return sum(1 for n in range(2, limit) if all(n % d for d in range(2, math.isqrt(n) + 1)))

def pi_digits(count):
    # Machin's formula with integers
    def arctan(x, unity):
        total = term = unity // x
        n, sign = 3, -1
        while term:
            term //= x * x
            total += sign * (term // n)
            n, sign = n + 2, -sign
        return total
    unity = 10 ** (count + 10)
    pi = 4 * (4 * arctan(5, unity) - arctan(239, unity))
    return str(pi)[:count]
`);
  parentPort.on("message", ({ id, job, args }) => {
    if (job === "exit") {
      python.finalize();
      process.exit(); // ends this worker
    }
    try {
      parentPort.postMessage({ id, result: python.main[job](...args) });
    } catch (error) {
      parentPort.postMessage({ id, error: error instanceof PythonError ? error.message : String(error) });
    }
  });
}
