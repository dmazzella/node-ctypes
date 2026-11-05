import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const executable = path.join(root, "build/diagnostics", `ctypes_variadic_abi_repro${process.platform === "win32" ? ".exe" : ""}`);
if (!existsSync(executable)) {
  throw new Error("Missing ctypes_variadic_abi_repro; run cmake --build build --config Release --target ctypes_variadic_abi_repro first");
}

const diagnostics = ["reference", "fixed-hfa", "variadic-stack", "variadic-hfa"].map((mode) => ({ name: `C/libffi ${mode}`, command: executable, args: [mode] }));
for (const name of ["places anonymous variadic values after narrow named stack arguments", "keeps named homogeneous arguments and aggregate results separate from anonymous FP arguments"]) {
  diagnostics.push({
    name: `Node ${name}`,
    command: process.execPath,
    args: ["--test", "--test-reporter=tap", "--test-timeout=5000", `--test-name-pattern=${name}`, "tests/node_specific/test_function_abi.js"],
  });
}

console.log(`Variadic ABI diagnostics: ${process.platform}-${process.arch}, Node ${process.version}`);
const failures = [];
for (const diagnostic of diagnostics) {
  console.log(`::group::${diagnostic.name}`);
  const result = spawnSync(diagnostic.command, diagnostic.args, { cwd: root, stdio: "inherit", timeout: 30_000 });
  if (result.error) {
    console.error(result.error);
  }
  const code = result.status === null ? "none" : `${result.status} (0x${(result.status >>> 0).toString(16).padStart(8, "0")})`;
  console.log(`Exit code: ${code}; signal: ${result.signal ?? "none"}`);
  if (result.error || result.status !== 0) {
    failures.push(diagnostic.name);
  }
  console.log("::endgroup::");
}
if (failures.length > 0) {
  console.error(`Variadic ABI diagnostic failures:\n${failures.join("\n")}`);
  process.exitCode = 1;
}
