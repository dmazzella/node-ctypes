// Registry Demo — using the reusable Registry class
// Demonstrates: setValue, getValue, openKey, deleteValue, deleteKey

import { Registry, HKEY } from "./registry/registry.js";

async function main() {
  const subKey = "Software\\node_ctypes_demo";

  // ── Quick one-liners ──────────────────────────────────────────────

  // Write string + DWORD (auto-creates key)
  Registry.setValue(HKEY.CURRENT_USER, subKey, "TestValue", "Hello from node-ctypes");
  Registry.setValue(HKEY.CURRENT_USER, subKey, "TestDword", 0x12345678);
  console.log(`Wrote values to HKCU\\${subKey}`);

  // Read back
  const strVal = Registry.getValue(HKEY.CURRENT_USER, subKey, "TestValue");
  const dwordVal = Registry.getValue(HKEY.CURRENT_USER, subKey, "TestDword");
  console.log(`Read back string: '${strVal}'`);
  console.log(`Read back DWORD:  0x${dwordVal.toString(16)}`);

  // ── Key handle for multiple operations ────────────────────────────

  const key = Registry.openKey(HKEY.CURRENT_USER, subKey, { write: true });

  key.setString("Extra", "batch write");
  console.log(`Extra = '${key.getString("Extra")}'`);

  key.setDword("Counter", 999);
  console.log(`Counter = ${key.getDword("Counter")}`);

  // ── Cleanup ───────────────────────────────────────────────────────

  key.deleteValue("Extra");
  key.deleteValue("Counter");
  key.deleteValue("TestValue");
  key.deleteValue("TestDword");
  key.close();

  Registry.deleteKey(HKEY.CURRENT_USER, subKey);
  console.log(`Deleted key HKCU\\${subKey}`);

  // Non-existent value returns undefined
  const missing = Registry.getValue(HKEY.CURRENT_USER, subKey, "Nope");
  console.log(`Missing value:`, missing); // undefined

  Registry.close();
}

main().catch((err) => {
  console.error("Error:", err);
});
