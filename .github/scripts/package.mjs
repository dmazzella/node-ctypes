import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const platforms = Object.freeze(["win32-x64", "win32-arm64", "linux-x64", "linux-arm64", "linux-x64-musl", "linux-arm64-musl", "darwin-arm64", "darwin-x64"]);
const source = path.resolve(import.meta.dirname, "../..");

export function releaseTag(version, ref) {
  assert.equal(ref, `refs/tags/v${version}`, "release tag must match package.json version exactly");
  return /^\d+\.\d+\.\d+-/.test(version) ? "next" : "latest";
}

export function assemblePackage(artifacts, output, targets = platforms) {
  assert.ok(targets.length > 0, "at least one target is required");
  assert.equal(new Set(targets).size, targets.length, "duplicate target");
  for (const target of targets) assert.ok(platforms.includes(target), `unsupported target: ${target}`);
  for (const item of readdirSync(artifacts)) {
    if (item.startsWith("ctypes-")) assert.ok(targets.includes(item.slice(7)), `unexpected addon artifact: ${item}`);
  }
  const binaries = targets.map((target) => ({
    target,
    file: path.join(artifacts, `ctypes-${target}`, "ctypes.node"),
  }));
  for (const { file } of binaries) {
    const info = statSync(file);
    assert.ok(info.isFile() && info.size > 0, `empty or invalid addon artifact: ${file}`);
  }
  assert.ok(!existsSync(output) || readdirSync(output).length === 0, "output directory must be empty");
  const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
  assert.equal(manifest.name, "node-ctypes");
  mkdirSync(path.join(output, "build/Release"), { recursive: true });
  cpSync(path.join(source, "lib"), path.join(output, "lib"), { recursive: true });
  for (const file of ["package.json", "README.md", "CHANGELOG.md", "LICENSE"]) {
    copyFileSync(path.join(source, file), path.join(output, file));
  }
  for (const { target, file } of binaries) {
    copyFileSync(file, path.join(output, "build/Release", `ctypes-${target}.node`));
  }
  return { name: manifest.name, version: manifest.version, platforms: targets, directory: path.resolve(output) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [artifacts, output, ...targets] = process.argv.slice(2);
  assert.ok(artifacts && output, "usage: node package.mjs ARTIFACTS OUTPUT [TARGET ...]");
  console.log(JSON.stringify(assemblePackage(artifacts, output, targets.length ? targets : platforms)));
}
