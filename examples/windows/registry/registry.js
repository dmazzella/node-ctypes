// Registry — reusable Windows Registry wrapper for node-ctypes
//
// Python-ctypes-idiomatic: typed argtypes using wintypes, errcheck for
// automatic error raising (WinError, like Python's OSError), plain JS strings
// for LPCWSTR args, DWORD()/HKEY() instances + byref() for output parameters.
//
// Usage:
//   import { Registry, HKEY, REG } from "./registry.js";
//
//   const val = Registry.getValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting");
//   Registry.setValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting", "hello");
//
//   const key = Registry.openKey(HKEY.CURRENT_USER, "Software\\MyApp", { write: true });
//   key.setString("Name", "test");
//   key.setDword("Count", 123);
//   key.close();
//
// Values are converted by type, both ways: REG_SZ / REG_EXPAND_SZ ↔ string
// (expanded when read), REG_DWORD ↔ number, REG_QWORD ↔ bigint, REG_MULTI_SZ ↔
// array of strings, REG_BINARY (and other types) ↔ Buffer.

import { WinDLL, WinError, byref, create_unicode_buffer, sizeof, c_void_p, c_wchar } from "node-ctypes";
import { wintypes } from "node-ctypes";
const { DWORD, LSTATUS, REGSAM, HKEY: HKEY_T, LPCWSTR, LPDWORD, PHKEY } = wintypes;
// ─── Root keys (predefined pseudo-handles) ──────────────────────────
// Python uses module-level HKEY_CURRENT_USER etc.; we expose a namespace
// for ergonomic access: `HKEY.CURRENT_USER`. The SDK defines them as
// ((HKEY)(ULONG_PTR)((LONG)0x80000001)): sign-extended to the pointer size.

const rootKey = (value) => BigInt.asUintN(sizeof(c_void_p) * 8, BigInt.asIntN(32, BigInt(value)));

export const HKEY = Object.freeze({
  CLASSES_ROOT: rootKey(0x80000000),
  CURRENT_USER: rootKey(0x80000001),
  LOCAL_MACHINE: rootKey(0x80000002),
  USERS: rootKey(0x80000003),
  CURRENT_CONFIG: rootKey(0x80000005),
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
const RRF_RT_ANY = 0x0000ffff;
const RRF_NOEXPAND = 0x10000000;
const ERROR_MORE_DATA = 0xea;
const ERROR_FILE_NOT_FOUND = 0x02;

// ─── errcheck: raise on non-zero LSTATUS ────────────────────────────
// Equivalent to Python's `def check(result, func, args): if result: raise WinError(result)`
// assigned to `fn.errcheck`. ERROR_MORE_DATA and ERROR_FILE_NOT_FOUND are
// returned instead: the callers handle them (a value that grew meanwhile, a
// missing value).

function lstatusErrcheck(name) {
  return function (result, func, args) {
    const rc = Number(result);
    if (rc !== 0 && rc !== ERROR_MORE_DATA && rc !== ERROR_FILE_NOT_FOUND) {
      const err = WinError(rc);
      err.message = `${name}: ${err.message}`;
      throw err;
    }
    return rc;
  };
}

function notFound(what) {
  const err = WinError(ERROR_FILE_NOT_FOUND);
  err.message = `${what}: ${err.message}`;
  return err;
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
  lib.RegCreateKeyExW.errcheck = lstatusErrcheck("RegCreateKeyExW");

  // LSTATUS RegOpenKeyExW(HKEY, LPCWSTR, DWORD, REGSAM, PHKEY);
  lib.RegOpenKeyExW.argtypes = [HKEY_T, LPCWSTR, DWORD, REGSAM, PHKEY];
  lib.RegOpenKeyExW.restype = LSTATUS;
  lib.RegOpenKeyExW.errcheck = lstatusErrcheck("RegOpenKeyExW");

  // LSTATUS RegSetValueExW(HKEY, LPCWSTR, DWORD Reserved, DWORD dwType, const BYTE* lpData, DWORD cbData);
  lib.RegSetValueExW.argtypes = [HKEY_T, LPCWSTR, DWORD, DWORD, c_void_p, DWORD];
  lib.RegSetValueExW.restype = LSTATUS;
  lib.RegSetValueExW.errcheck = lstatusErrcheck("RegSetValueExW");

  // LSTATUS RegGetValueW(HKEY, LPCWSTR subkey, LPCWSTR value, DWORD flags, LPDWORD pdwType, PVOID pvData, LPDWORD pcbData);
  lib.RegGetValueW.argtypes = [HKEY_T, LPCWSTR, LPCWSTR, DWORD, LPDWORD, c_void_p, LPDWORD];
  lib.RegGetValueW.restype = LSTATUS;
  lib.RegGetValueW.errcheck = lstatusErrcheck("RegGetValueW");

  // LSTATUS RegDeleteValueW(HKEY, LPCWSTR);
  lib.RegDeleteValueW.argtypes = [HKEY_T, LPCWSTR];
  lib.RegDeleteValueW.restype = LSTATUS;
  lib.RegDeleteValueW.errcheck = lstatusErrcheck("RegDeleteValueW");

  // LSTATUS RegDeleteKeyW(HKEY, LPCWSTR);
  lib.RegDeleteKeyW.argtypes = [HKEY_T, LPCWSTR];
  lib.RegDeleteKeyW.restype = LSTATUS;
  lib.RegDeleteKeyW.errcheck = lstatusErrcheck("RegDeleteKeyW");

  // LSTATUS RegDeleteTreeW(HKEY, LPCWSTR): the key, its values and its subkeys.
  lib.RegDeleteTreeW.argtypes = [HKEY_T, LPCWSTR];
  lib.RegDeleteTreeW.restype = LSTATUS;
  lib.RegDeleteTreeW.errcheck = lstatusErrcheck("RegDeleteTreeW");

  // LSTATUS RegCloseKey(HKEY);
  lib.RegCloseKey.argtypes = [HKEY_T];
  lib.RegCloseKey.restype = LSTATUS;
  // No errcheck on close — ignore failure during cleanup.

  _advapi32 = lib;
  return lib;
}

// ─── Reading and writing values ─────────────────────────────────────

/**
 * Read a value with RegGetValueW: the size first, then the data. A value that
 * grows between the two calls returns ERROR_MORE_DATA with the new size: retry.
 * Returns { type, data: Buffer } or undefined if the value does not exist.
 */
function readValue(hkey, subKey, valueName, flags) {
  const api = advapi32();
  const type = new DWORD();
  const size = new DWORD();
  let rc = api.RegGetValueW(hkey, subKey, valueName, flags, byref(type), null, byref(size));
  if (rc === ERROR_FILE_NOT_FOUND) return undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = Buffer.alloc(Number(size.value));
    rc = api.RegGetValueW(hkey, subKey, valueName, flags, byref(type), data.length ? data : null, byref(size));
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;
    if (rc === ERROR_MORE_DATA) continue;
    return { type: Number(type.value), data: data.subarray(0, Number(size.value)) };
  }
  throw WinError(ERROR_MORE_DATA);
}

// A string value ends at its first NUL (the buffer may hold more after it).
const utf16 = (data) => data.toString("utf16le").split("\0")[0];

/** A registry value as a JavaScript value, by type. REG_EXPAND_SZ is expanded. */
function getValue(hkey, subKey, valueName) {
  const raw = readValue(hkey, subKey, valueName, RRF_RT_ANY | RRF_NOEXPAND);
  if (raw === undefined) return undefined;
  switch (raw.type) {
    case REG.SZ:
      return utf16(raw.data);
    case REG.EXPAND_SZ:
      // RRF_RT_REG_SZ without RRF_NOEXPAND: RegGetValueW expands the environment variables.
      return utf16(readValue(hkey, subKey, valueName, RRF_RT_REG_SZ)?.data ?? raw.data);
    case REG.DWORD:
      return raw.data.readUInt32LE(0);
    case REG.QWORD:
      return raw.data.readBigUInt64LE(0);
    case REG.MULTI_SZ: {
      // Strings separated by NUL, the list ended by an empty string.
      const text = raw.data.toString("utf16le").replace(/\0+$/, "");
      return text ? text.split("\0") : [];
    }
    default:
      return Buffer.from(raw.data);
  }
}

/** The registry type and bytes of a JavaScript value. */
function encodeValue(data) {
  if (typeof data === "number") {
    if (!Number.isInteger(data) || data < 0 || data > 0xffffffff) throw new RangeError("A number is stored as REG_DWORD: an integer from 0 to 0xFFFFFFFF");
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(data);
    return [REG.DWORD, bytes];
  }
  if (typeof data === "bigint") {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt.asUintN(64, data));
    return [REG.QWORD, bytes];
  }
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return [REG.BINARY, Buffer.from(data)];
  if (Array.isArray(data)) return [REG.MULTI_SZ, Buffer.from(`${data.map(String).join("\0")}\0\0`, "utf16le")];
  // REG_SZ data: wide string including the NUL terminator.
  return [REG.SZ, Buffer.from(`${String(data)}\0`, "utf16le")];
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

  /**
   * Read a value, converted by its type (see the module header).
   * @returns {string|number|bigint|string[]|Buffer|undefined} undefined if not found
   */
  getValue(valueName) {
    return getValue(this.#handle, null, valueName);
  }

  /**
   * Write a value, typed from the JavaScript value: string → REG_SZ, number →
   * REG_DWORD, bigint → REG_QWORD, array → REG_MULTI_SZ, Buffer → REG_BINARY.
   */
  setValue(valueName, data) {
    const [type, bytes] = encodeValue(data);
    advapi32().RegSetValueExW(this.#handle, valueName, 0, type, bytes, bytes.length);
  }

  // ── String (REG_SZ) ──

  getString(valueName) {
    const raw = readValue(this.#handle, null, valueName, RRF_RT_REG_SZ);
    return raw === undefined ? undefined : utf16(raw.data);
  }

  setString(valueName, data) {
    const api = advapi32();
    // REG_SZ data: wide string including the NUL terminator.
    const buf = create_unicode_buffer(data);
    api.RegSetValueExW(this.#handle, valueName, 0, REG.SZ, buf, sizeof(buf));
  }

  // ── DWORD (REG_DWORD) ──

  getDword(valueName) {
    const value = this.getValue(valueName);
    return typeof value === "number" ? value : undefined;
  }

  setDword(valueName, data) {
    const api = advapi32();
    const dword = new DWORD(data);
    api.RegSetValueExW(this.#handle, valueName, 0, REG.DWORD, byref(dword), sizeof(DWORD));
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
   * @param {bigint} rootKey - One of HKEY.CURRENT_USER, HKEY.LOCAL_MACHINE, etc.
   * @param {string} subKey  - e.g. "Software\\MyApp"
   * @param {object} [opts]
   * @param {boolean} [opts.write=false]  - Open with write access
   * @param {boolean} [opts.create=false] - Create the key if it doesn't exist (implies write)
   * @returns {RegistryKey}
   * @throws {Error} WinError 2 (ERROR_FILE_NOT_FOUND) if the key does not exist and create is false
   */
  static openKey(rootKey, subKey, { write = false, create = false } = {}) {
    const api = advapi32();
    const hkResult = new HKEY_T();

    if (create) {
      const dwDisposition = new DWORD();
      api.RegCreateKeyExW(rootKey, subKey, 0, null, REG_OPTION_NON_VOLATILE, KEY_ALL_ACCESS, null, byref(hkResult), byref(dwDisposition));
    } else {
      const access = write ? KEY_READ | KEY_WRITE : KEY_READ;
      if (api.RegOpenKeyExW(rootKey, subKey, 0, access, byref(hkResult)) === ERROR_FILE_NOT_FOUND) throw notFound(`RegOpenKeyExW(${subKey})`);
    }

    return new RegistryKey(hkResult.value);
  }

  /**
   * Delete a key. Without `recursive` the key must have no subkeys
   * (RegDeleteKeyW); with it, its subkeys are deleted too (RegDeleteTreeW).
   * @returns {boolean} true if deleted, false if not found
   */
  static deleteKey(rootKey, subKey, { recursive = false } = {}) {
    const api = advapi32();
    const rc = recursive ? api.RegDeleteTreeW(rootKey, subKey) : api.RegDeleteKeyW(rootKey, subKey);
    return rc !== ERROR_FILE_NOT_FOUND;
  }

  // ─── Convenience one-liners (auto open + close) ──────────────────

  /**
   * Read a value without opening a key handle (uses RegGetValueW directly on root),
   * converted by its type (see the module header). Returns `undefined` if not found.
   */
  static getValue(rootKey, subKey, valueName) {
    return getValue(rootKey, subKey, valueName);
  }

  /**
   * Write a value (creates the key), typed from the JavaScript value:
   * - string → REG_SZ
   * - number → REG_DWORD
   * - bigint → REG_QWORD
   * - array of strings → REG_MULTI_SZ
   * - Buffer → REG_BINARY
   */
  static setValue(rootKey, subKey, valueName, data) {
    const key = Registry.openKey(rootKey, subKey, { create: true });
    try {
      key.setValue(valueName, data);
    } finally {
      key.close();
    }
  }

  /**
   * Delete a single value.
   * @returns {boolean} true if deleted, false if not found (value or key)
   */
  static deleteValue(rootKey, subKey, valueName) {
    let key;
    try {
      key = Registry.openKey(rootKey, subKey, { write: true });
    } catch (error) {
      if (error.winerror === ERROR_FILE_NOT_FOUND) return false;
      throw error;
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
