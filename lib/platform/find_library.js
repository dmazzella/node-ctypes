/**
 * @file find_library.js
 * @module platform/find_library
 * @description Cross-platform library name resolver, mirroring CPython's
 * `ctypes.util.find_library()`.
 *
 * Resolves a bare library name like "c", "ssl", "user32" to a platform-specific
 * filename or path suitable for passing to CDLL/WinDLL.
 *
 * **Python ctypes Compatibility**:
 * Direct equivalent to Python's `ctypes.util.find_library(name)`.
 *
 * @example
 * ```javascript
 * import { find_library, CDLL } from "node-ctypes";
 * const libc = new CDLL(find_library("c"));
 * ```
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Windows has no canonical mapping for generic library names (CPython returns
// None for find_library("c")), but some aliases are universal enough to be
// convenient. Portable cross-platform code like `CDLL(find_library("c"))`
// usually expects these to work.
const WINDOWS_ALIASES = {
  c: "msvcrt.dll", // CRT (deprecated but present on all Windows)
  m: "msvcrt.dll", // math functions live in msvcrt too
  dl: null, // no equivalent; dlopen/dlsym are builtin on Win
  pthread: null, // no equivalent
  crypt: "advapi32.dll",
  ssl: "schannel.dll", // closest Win equivalent for TLS
};

function findLibraryWindows(name) {
  if (name.toLowerCase().endsWith(".dll")) return name;
  if (Object.prototype.hasOwnProperty.call(WINDOWS_ALIASES, name)) {
    return WINDOWS_ALIASES[name];
  }
  // LoadLibrary does its own search path resolution for bare names.
  return `${name}.dll`;
}

function findLibraryDarwin(name) {
  const candidates = [`lib${name}.dylib`, `${name}.framework/${name}`, `/usr/lib/lib${name}.dylib`, `/usr/local/lib/lib${name}.dylib`, `/opt/homebrew/lib/lib${name}.dylib`, `/opt/homebrew/opt/${name}/lib/lib${name}.dylib`];
  for (const p of candidates) {
    if (p.startsWith("/") && existsSync(p)) return p;
  }
  // Fallback: bare soname, let dlopen do the work
  return `lib${name}.dylib`;
}

function findLibraryLinux(name) {
  // 1) Try the ldconfig cache — most reliable on modern glibc.
  try {
    const out = execSync("/sbin/ldconfig -p", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const re = new RegExp(`^\\s*lib${escapeRegex(name)}\\.so[^\\s]*\\s.*=>\\s*(\\S+)`, "m");
    const m = out.match(re);
    if (m) return m[1];
  } catch {}

  // 2) Walk common directories.
  const dirs = ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/lib", "/lib64", "/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"];
  for (const dir of dirs) {
    const bare = path.join(dir, `lib${name}.so`);
    if (existsSync(bare)) return bare;
    // Also try versioned sonames (libc.so.6, libssl.so.3, ...)
    try {
      // Can't glob here without fs.readdirSync; do a cheap scan.
      const fs = require("node:fs");
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith(`lib${name}.so.`)) return path.join(dir, entry);
      }
    } catch {}
  }

  // 3) Fallback: bare soname. dlopen will still try LD_LIBRARY_PATH.
  return `lib${name}.so`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a library name to a platform-specific filename/path.
 *
 * @param {string} name - Bare library name (e.g. "c", "ssl", "user32").
 * @returns {string|null} Resolved filename/path, or null if the input is invalid.
 *
 * @example
 * find_library("c")        // "libc.so.6" / "msvcrt.dll" / "/usr/lib/libc.dylib"
 * find_library("ssl")      // "libssl.so.3" / "ssl.dll"
 * find_library("user32")   // "user32.dll" (Windows)
 */
export function find_library(name) {
  if (!name || typeof name !== "string") return null;
  switch (process.platform) {
    case "win32":
      return findLibraryWindows(name);
    case "darwin":
      return findLibraryDarwin(name);
    default:
      return findLibraryLinux(name);
  }
}
