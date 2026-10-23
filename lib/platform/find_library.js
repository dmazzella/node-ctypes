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
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
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

// Search order of ctypes.macholib.dyld.dyld_find: DYLD_* paths, then the
// fallback directories of dyld, with Homebrew first as in Homebrew's Python
// (Apple's /usr/lib/libssl.dylib and libcrypto.dylib abort the process).
function findLibraryDarwin(name, inSharedCache) {
  const home = os.homedir();
  const envDirs = (variable) => (process.env[variable] ?? "").split(":").filter(Boolean);
  const libDirs = [...envDirs("DYLD_LIBRARY_PATH"), ...envDirs("DYLD_FALLBACK_LIBRARY_PATH"), "/opt/homebrew/lib", path.join(home, "lib"), "/usr/local/lib", "/lib", "/usr/lib"];
  const frameworkDirs = [
    ...envDirs("DYLD_FRAMEWORK_PATH"),
    ...envDirs("DYLD_FALLBACK_FRAMEWORK_PATH"),
    "/opt/homebrew/Frameworks",
    path.join(home, "Library/Frameworks"),
    "/Library/Frameworks",
    "/Network/Library/Frameworks",
    "/System/Library/Frameworks",
  ];
  const candidates = [
    ...libDirs.map((dir) => path.join(dir, `lib${name}.dylib`)),
    ...libDirs.map((dir) => path.join(dir, `${name}.dylib`)),
    ...frameworkDirs.map((dir) => path.join(dir, `${name}.framework`, name)),
    `/opt/homebrew/opt/${name}/lib/lib${name}.dylib`,
  ];
  for (const candidate of candidates) {
    if (isFile(candidate) || inSharedCache(candidate)) return candidate;
  }
  // Fallback: bare soname, let dlopen do the work
  return `lib${name}.dylib`;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// ABI di `ldconfig -p` per l'architettura del processo, come il mach_map di
// ctypes.util: su sistemi multiarch evita di scegliere la libreria a 32 bit.
function ldconfigAbi() {
  switch (os.arch()) {
    case "x64":
      return "libc6,x86-64";
    case "ppc64":
    case "s390x":
      return "libc6,64bit";
    default:
      return "libc6";
  }
}

// Confronto di versioni numeriche di soname ("so.1.10" > "so.1.9").
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

function findLibraryLinux(name) {
  // 1) ldconfig cache, as ctypes.util._findSoname_ldconfig: the soname (e.g.
  //    "libc.so.6") of the first entry with the ABI of this process.
  try {
    const out = execSync("/sbin/ldconfig -p", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C", LANG: "C" } });
    const re = new RegExp(`\\s+(lib${escapeRegex(name)}\\.[^\\s]+)\\s+\\(${escapeRegex(ldconfigAbi())}`);
    const m = out.match(re);
    if (m) return m[1];
  } catch {}

  // 2) Walk common directories: highest versioned soname, then the bare name.
  const dirs = ["/usr/lib", "/usr/lib64", "/usr/local/lib", "/lib", "/lib64", "/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu"];
  const prefix = `lib${name}.so.`;
  for (const dir of dirs) {
    let versions = [];
    try {
      versions = readdirSync(dir)
        .filter((entry) => entry.startsWith(prefix) && /^\d+(\.\d+)*$/.test(entry.slice(prefix.length)))
        .map((entry) => entry.slice(prefix.length));
    } catch {}
    if (versions.length > 0) {
      versions.sort(compareVersions);
      return path.join(dir, prefix + versions[versions.length - 1]);
    }
    const bare = path.join(dir, `lib${name}.so`);
    if (existsSync(bare)) return bare;
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
 * @param {Object} [native] - Native module (dyld shared cache lookup on macOS)
 * @returns {string|null} Resolved filename/path, or null if the input is invalid.
 *
 * @example
 * find_library("c")        // "libc.so.6" / "msvcrt.dll" / "/usr/lib/libc.dylib"
 * find_library("ssl")      // "libssl.so.3" / "ssl.dll"
 * find_library("user32")   // "user32.dll" (Windows)
 */
export function find_library(name, native) {
  if (!name || typeof name !== "string") return null;
  switch (process.platform) {
    case "win32":
      return findLibraryWindows(name);
    case "darwin":
      return findLibraryDarwin(name, (file) => native?.dyldSharedCacheContains?.(file) === true);
    default:
      return findLibraryLinux(name);
  }
}
