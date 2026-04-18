// Verifica che il tracker di callback emetta un warning quando un callback
// viene garbage-collected senza che sia stato chiamato .release().
// Il test gira in un subprocess con --expose-gc e NODE_CTYPES_DEBUG_CALLBACKS=1
// così non altera lo stato globale degli altri test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeCtypesEntry = pathToFileURL(resolve(__dirname, "../../lib/index.js")).href;

function runSubprocess(envDebug, withRelease) {
  const script = `
    import { callback, c_int32 } from ${JSON.stringify(nodeCtypesEntry)};
    function leaky() { return 0; }
    function createAndDrop() {
      const cb = callback(leaky, c_int32, [c_int32]);
      ${withRelease ? "cb.release();" : ""}
    }
    createAndDrop();
    // Multiple GC cycles: V8 is lazy about FinalizationRegistry callbacks.
    for (let i = 0; i < 5; i++) {
      global.gc();
      await new Promise((r) => setTimeout(r, 50));
    }
  `;
  const res = spawnSync(
    process.execPath,
    ["--expose-gc", "--input-type=module", "-e", script],
    {
      env: { ...process.env, NODE_CTYPES_DEBUG_CALLBACKS: envDebug },
      encoding: "utf8",
    },
  );
  return res.stderr + res.stdout;
}

test("callback leak guard emits warning when debug enabled and not released", () => {
  const output = runSubprocess("1", false);
  assert.match(output, /CallbackLeakWarning/, "should emit CallbackLeakWarning");
  assert.match(output, /leaky/, "should include function name in warning");
});

test("callback leak guard emits no warning when released", () => {
  const output = runSubprocess("1", true);
  assert.doesNotMatch(output, /CallbackLeakWarning/, "released callback must not warn");
});

test("callback leak guard is disabled by default (no warning)", () => {
  const output = runSubprocess("", false);
  assert.doesNotMatch(output, /CallbackLeakWarning/, "default mode must be silent");
});
