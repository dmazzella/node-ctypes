// Registry — reusable Windows Registry wrapper for node-ctypes
//
// Python-ctypes-idiomatic: typed argtypes using wintypes, errcheck for
// automatic error raising, plain JS strings for LPCWSTR args (via the
// c_wchar_p struct-field keepalive).
//
// Usage:
//   import { Registry, HKEY, REG } from "./registry/registry.js";
//
//   const val = Registry.getValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting");
//   Registry.setValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting", "hello");
//
//   const key = Registry.openKey(HKEY.CURRENT_USER, "Software\\MyApp", { write: true });
//   key.setString("Name", "test");
//   key.setDword("Count", 123);
//   key.close();

import { WinDLL, wstring_at, c_void_p } from "node-ctypes";
import { wintypes } from "node-ctypes";
const { DWORD, LSTATUS, REGSAM, HKEY: HKEY_T, LPCWSTR, LPDWORD, LPBYTE, PHKEY } = wintypes;
// ─── Root keys (predefined pseudo-handles) ──────────────────────────
// Python uses module-level HKEY_CURRENT_USER etc.; we expose a namespace
// for ergonomic access: `HKEY.CURRENT_USER`.

export const HKEY = Object.freeze({
  CLASSES_ROOT: 0x80000000,
  CURRENT_USER: 0x80000001,
  LOCAL_MACHINE: 0x80000002,
  USERS: 0x80000003,
  CURRENT_CONFIG: 0x80000005,
});

// ─── Value types ────────────────────────────────────────────────────

export const REG = Object.freeze({
  SZ: 0x00000001,
  EXPAND_SZ: 0x00000002,
  BINARY: 0x00000003,
  DWORD: 0x00000004,
  MULTI_SZ: 0x00000007,
  QWORD: 0x0000000b,
});

// ─── Internal constants ─────────────────────────────────────────────

const KEY_READ = 0x00020019;
const KEY_WRITE = 0x00020006;
const KEY_ALL_ACCESS = 0x000f003f;
const REG_OPTION_NON_VOLATILE = 0x00000000;
const RRF_RT_REG_SZ = 0x00000002;
const RRF_RT_REG_DWORD = 0x00000010;
const RRF_RT_ANY = 0x0000ffff;
const ERROR_MORE_DATA = 0xea;
const ERROR_FILE_NOT_FOUND = 0x02;

// ─── errcheck: raise on non-zero LSTATUS ────────────────────────────
// Equivalent to Python's `def check(result, func, args): if result: raise OSError(...)`
// assigned to `fn.errcheck`. Returning `result` preserves the original code so
// callers that care about specific non-fatal codes (e.g. ERROR_FILE_NOT_FOUND,
// ERROR_MORE_DATA) can still inspect it by catching or by using the no-throw
// variants we expose below.

function lstatusErrcheck(result, func, args) {
  const rc = Number(result);
  if (rc !== 0 && rc !== ERROR_MORE_DATA && rc !== ERROR_FILE_NOT_FOUND) {
    const err = new Error(`${func.funcName || "RegistryCall"} failed (0x${rc.toString(16)})`);
    err.winerror = rc;
    throw err;
  }
  return rc;
}

// ─── Shared advapi32 instance (lazy-loaded) ─────────────────────────

let _advapi32 = null;

function advapi32() {
  if (_advapi32) return _advapi32;

  const lib = new WinDLL("advapi32.dll");

  // LSTATUS RegCreateKeyExW(
  //   HKEY hKey, LPCWSTR lpSubKey, DWORD Reserved, LPWSTR lpClass, DWORD dwOptions,
  //   REGSAM samDesired, LPSECURITY_ATTRIBUTES lpSA, PHKEY phkResult, LPDWORD lpdwDisposition);
  lib.RegCreateKeyExW.argtypes = [HKEY_T, LPCWSTR, DWORD, LPCWSTR, DWORD, REGSAM, c_void_p, PHKEY, LPDWORD];
  lib.RegCreateKeyExW.restype = LSTATUS;
  lib.RegCreateKeyExW.errcheck = lstatusErrcheck;

  // LSTATUS RegOpenKeyExW(HKEY, LPCWSTR, DWORD, REGSAM, PHKEY);
  lib.RegOpenKeyExW.argtypes = [HKEY_T, LPCWSTR, DWORD, REGSAM, PHKEY];
  lib.RegOpenKeyExW.restype = LSTATUS;
  lib.RegOpenKeyExW.errcheck = lstatusErrcheck;

  // LSTATUS RegSetValueExW(HKEY, LPCWSTR, DWORD Reserved, DWORD dwType, const BYTE* lpData, DWORD cbData);
  lib.RegSetValueExW.argtypes = [HKEY_T, LPCWSTR, DWORD, DWORD, LPBYTE, DWORD];
  lib.RegSetValueExW.restype = LSTATUS;
  lib.RegSetValueExW.errcheck = lstatusErrcheck;

  // LSTATUS RegGetValueW(HKEY, LPCWSTR subkey, LPCWSTR value, DWORD flags, LPDWORD pdwType, PVOID pvData, LPDWORD pcbData);
  lib.RegGetValueW.argtypes = [HKEY_T, LPCWSTR, LPCWSTR, DWORD, LPDWORD, c_void_p, LPDWORD];
  lib.RegGetValueW.restype = LSTATUS;
  lib.RegGetValueW.errcheck = lstatusErrcheck;

  // LSTATUS RegDeleteValueW(HKEY, LPCWSTR);
  lib.RegDeleteValueW.argtypes = [HKEY_T, LPCWSTR];
  lib.RegDeleteValueW.restype = LSTATUS;
  lib.RegDeleteValueW.errcheck = lstatusErrcheck;

  // LSTATUS RegDeleteKeyW(HKEY, LPCWSTR);
  lib.RegDeleteKeyW.argtypes = [HKEY_T, LPCWSTR];
  lib.RegDeleteKeyW.restype = LSTATUS;
  lib.RegDeleteKeyW.errcheck = lstatusErrcheck;

  // LSTATUS RegCloseKey(HKEY);
  lib.RegCloseKey.argtypes = [HKEY_T];
  lib.RegCloseKey.restype = LSTATUS;
  // No errcheck on close — ignore failure during cleanup.

  _advapi32 = lib;
  return lib;
}

// ─── DWORD scratch allocator ────────────────────────────────────────
// RegGetValueW / RegCreateKeyExW etc. write back through byref. We allocate
// a 4-byte Buffer for DWORD outputs and an 8-byte Buffer for HKEY outputs
// (pointer-sized on Win64).

function allocDword(initial = 0) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(initial >>> 0, 0);
  return buf;
}

function allocHkey() {
  // HKEY is pointer-sized. On Win64 this is 8 bytes; on Win32, 4.
  const ptrSize = c_void_p._size;
  return Buffer.alloc(ptrSize);
}

function readHkey(buf) {
  return buf.length === 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

// ─── RegistryKey — wraps an opened HKEY handle ─────────────────────

class RegistryKey {
  #handle;
  #closed = false;

  constructor(handle) {
    this.#handle = handle;
  }

  /** Raw HKEY handle value (BigInt on Win64, Number on Win32). */
  get handle() {
    return this.#handle;
  }

  // ── String (REG_SZ) ──

  getString(valueName) {
    const api = advapi32();
    const pdwType = allocDword();
    const pcbData = allocDword();

    // Query size
    let rc = api.RegGetValueW(this.#handle, null, valueName, RRF_RT_REG_SZ, pdwType, null, pcbData);
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;

    const needed = pcbData.readUInt32LE(0);
    if (!needed) return "";

    const outBuf = Buffer.alloc(needed);
    pcbData.writeUInt32LE(needed, 0);
    api.RegGetValueW(this.#handle, null, valueName, RRF_RT_REG_SZ, pdwType, outBuf, pcbData);

    // wstring_at stops at the first null; no manual trim needed.
    return wstring_at(outBuf);
  }

  setString(valueName, data) {
    const api = advapi32();
    // REG_SZ data: UTF-16LE wide string including null terminator.
    const wbuf = Buffer.from(data + "\0", "utf16le");
    api.RegSetValueExW(this.#handle, valueName, 0, REG.SZ, wbuf, wbuf.length);
  }

  // ── DWORD (REG_DWORD) ──

  getDword(valueName) {
    const api = advapi32();
    const outDword = allocDword();
    const cbData = allocDword(4);
    const pdwType = allocDword();

    const rc = api.RegGetValueW(this.#handle, null, valueName, RRF_RT_REG_DWORD, pdwType, outDword, cbData);
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;
    return outDword.readUInt32LE(0);
  }

  setDword(valueName, data) {
    const api = advapi32();
    const dword = allocDword(data);
    api.RegSetValueExW(this.#handle, valueName, 0, REG.DWORD, dword, 4);
  }

  // ── Delete value ──

  deleteValue(valueName) {
    const api = advapi32();
    const rc = api.RegDeleteValueW(this.#handle, valueName);
    return rc !== ERROR_FILE_NOT_FOUND;
  }

  // ── Close ──

  close() {
    if (!this.#closed) {
      advapi32().RegCloseKey(this.#handle);
      this.#closed = true;
    }
  }

  [Symbol.dispose]() {
    this.close();
  }
}

// ─── Registry — static façade ───────────────────────────────────────

export class Registry {
  /**
   * Open (or create) a registry key.
   * @param {number|bigint} rootKey - One of HKEY.CURRENT_USER, HKEY.LOCAL_MACHINE, etc.
   * @param {string} subKey  - e.g. "Software\\MyApp"
   * @param {object} [opts]
   * @param {boolean} [opts.write=false]  - Open with write access
   * @param {boolean} [opts.create=false] - Create the key if it doesn't exist (implies write)
   * @returns {RegistryKey}
   */
  static openKey(rootKey, subKey, { write = false, create = false } = {}) {
    const api = advapi32();
    const phkResult = allocHkey();

    if (create) {
      const lpdwDisposition = allocDword();
      api.RegCreateKeyExW(rootKey, subKey, 0, null, REG_OPTION_NON_VOLATILE, KEY_ALL_ACCESS, null, phkResult, lpdwDisposition);
    } else {
      const access = write ? KEY_READ | KEY_WRITE : KEY_READ;
      api.RegOpenKeyExW(rootKey, subKey, 0, access, phkResult);
    }

    return new RegistryKey(readHkey(phkResult));
  }

  /**
   * Delete an entire key (must have no subkeys on NT).
   * @returns {boolean} true if deleted, false if not found
   */
  static deleteKey(rootKey, subKey) {
    const api = advapi32();
    const rc = api.RegDeleteKeyW(rootKey, subKey);
    return rc !== ERROR_FILE_NOT_FOUND;
  }

  // ─── Convenience one-liners (auto open + close) ──────────────────

  /**
   * Read a value without opening a key handle (uses RegGetValueW directly on root).
   * Returns `undefined` if not found.
   * Automatically detects REG_SZ vs REG_DWORD.
   */
  static getValue(rootKey, subKey, valueName) {
    const api = advapi32();
    const pdwType = allocDword();
    const pcbData = allocDword();

    // Query size and type
    let rc = api.RegGetValueW(rootKey, subKey, valueName, RRF_RT_ANY, pdwType, null, pcbData);
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;

    const type = pdwType.readUInt32LE(0);

    if (type === REG.DWORD) {
      const outDword = allocDword();
      const cb = allocDword(4);
      api.RegGetValueW(rootKey, subKey, valueName, RRF_RT_REG_DWORD, pdwType, outDword, cb);
      return outDword.readUInt32LE(0);
    }

    // Default: treat as string (REG_SZ / REG_EXPAND_SZ)
    const needed = pcbData.readUInt32LE(0);
    if (!needed) return "";
    const outBuf = Buffer.alloc(needed);
    pcbData.writeUInt32LE(needed, 0);
    api.RegGetValueW(rootKey, subKey, valueName, RRF_RT_REG_SZ, pdwType, outBuf, pcbData);
    return wstring_at(outBuf);
  }

  /**
   * Write a value (auto-detects type from JS type).
   * - string → REG_SZ
   * - number → REG_DWORD
   */
  static setValue(rootKey, subKey, valueName, data) {
    const key = Registry.openKey(rootKey, subKey, { create: true });
    try {
      if (typeof data === "number") {
        key.setDword(valueName, data);
      } else {
        key.setString(valueName, String(data));
      }
    } finally {
      key.close();
    }
  }

  /**
   * Delete a single value.
   * @returns {boolean} true if deleted, false if not found
   */
  static deleteValue(rootKey, subKey, valueName) {
    let key;
    try {
      key = Registry.openKey(rootKey, subKey, { write: true });
    } catch {
      return false;
    }
    try {
      return key.deleteValue(valueName);
    } finally {
      key.close();
    }
  }

  /** Release the shared advapi32 DLL handle. */
  static close() {
    if (_advapi32) {
      _advapi32.close();
      _advapi32 = null;
    }
  }
}

export default Registry;
