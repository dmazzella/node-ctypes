// Registry — reusable Windows Registry wrapper for node-ctypes
// Usage:
//   import { Registry, HKEY, REG } from "./registry/registry.js";
//
//   // Quick read (no handle management needed)
//   const val = Registry.getValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting");
//
//   // Quick write
//   Registry.setValue(HKEY.CURRENT_USER, "Software\\MyApp", "Setting", "hello");
//   Registry.setValue(HKEY.CURRENT_USER, "Software\\MyApp", "Count", 42);
//
//   // Open key for multiple operations
//   const key = Registry.openKey(HKEY.CURRENT_USER, "Software\\MyApp", { write: true });
//   key.setString("Name", "test");
//   key.setDword("Count", 123);
//   console.log(key.getString("Name"));
//   console.log(key.getDword("Count"));
//   key.deleteValue("Name");
//   key.close();
//
//   // Delete a key
//   Registry.deleteKey(HKEY.CURRENT_USER, "Software\\MyApp");

import { WinDLL, create_unicode_buffer, byref, wstring_at, c_uint32, c_uint, c_void_p } from "node-ctypes";

// ─── Root keys ──────────────────────────────────────────────────────

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

// ─── Shared advapi32 instance (lazy-loaded) ─────────────────────────

let _advapi32 = null;

function advapi32() {
  if (!_advapi32) {
    _advapi32 = new WinDLL("advapi32.dll");

    _advapi32.RegCreateKeyExW.argtypes = [c_uint, c_void_p, c_uint, c_void_p, c_uint, c_uint, c_void_p, c_void_p, c_void_p];
    _advapi32.RegCreateKeyExW.restype = c_uint;

    _advapi32.RegOpenKeyExW.argtypes = [c_uint, c_void_p, c_uint, c_uint, c_void_p];
    _advapi32.RegOpenKeyExW.restype = c_uint;

    _advapi32.RegSetValueExW.argtypes = [c_uint, c_void_p, c_uint, c_uint, c_void_p, c_uint];
    _advapi32.RegSetValueExW.restype = c_uint;

    _advapi32.RegGetValueW.argtypes = [c_uint, c_void_p, c_void_p, c_uint, c_void_p, c_void_p, c_void_p];
    _advapi32.RegGetValueW.restype = c_uint;

    _advapi32.RegDeleteValueW.argtypes = [c_uint, c_void_p];
    _advapi32.RegDeleteValueW.restype = c_uint;

    _advapi32.RegDeleteKeyW.argtypes = [c_uint, c_void_p];
    _advapi32.RegDeleteKeyW.restype = c_uint;

    _advapi32.RegCloseKey.argtypes = [c_uint];
    _advapi32.RegCloseKey.restype = c_uint;
  }
  return _advapi32;
}

// ─── Error helper ───────────────────────────────────────────────────

function check(rc, fn) {
  if (rc !== 0) throw new Error(`${fn} failed (0x${rc.toString(16)})`);
}

// ─── RegistryKey — wraps an opened HKEY handle ─────────────────────

class RegistryKey {
  #handle;
  #closed = false;

  constructor(handle) {
    this.#handle = handle;
  }

  /** Raw HKEY handle value */
  get handle() {
    return this.#handle;
  }

  // ── String (REG_SZ) ──

  getString(valueName) {
    const api = advapi32();
    const lpName = create_unicode_buffer(valueName);
    const pdwType = new c_uint32();
    const pcbData = new c_uint32(0);

    // Query size
    let rc = api.RegGetValueW(this.#handle, null, lpName, RRF_RT_REG_SZ, byref(pdwType), null, byref(pcbData));
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;
    if (rc !== 0 && rc !== ERROR_MORE_DATA) check(rc, "RegGetValueW(size)");

    const needed = pcbData.value;
    if (!needed) return "";

    const outBuf = create_unicode_buffer(Math.ceil(needed / 2));
    rc = api.RegGetValueW(this.#handle, null, lpName, RRF_RT_REG_SZ, byref(pdwType), outBuf, byref(pcbData));
    check(rc, "RegGetValueW");

    return wstring_at(outBuf).replace(/\0+$/, "");
  }

  setString(valueName, data) {
    const api = advapi32();
    const lpName = create_unicode_buffer(valueName);
    const lpData = create_unicode_buffer(data);
    check(api.RegSetValueExW(this.#handle, lpName, 0, REG.SZ, lpData, lpData.length), "RegSetValueExW(SZ)");
  }

  // ── DWORD (REG_DWORD) ──

  getDword(valueName) {
    const api = advapi32();
    const lpName = create_unicode_buffer(valueName);
    const outDword = new c_uint32();
    const cbData = new c_uint32(4);
    const pdwType = new c_uint32();

    const rc = api.RegGetValueW(this.#handle, null, lpName, RRF_RT_REG_DWORD, byref(pdwType), byref(outDword), byref(cbData));
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;
    check(rc, "RegGetValueW(DWORD)");

    return outDword.value;
  }

  setDword(valueName, data) {
    const api = advapi32();
    const lpName = create_unicode_buffer(valueName);
    const dword = new c_uint32(data >>> 0);
    check(api.RegSetValueExW(this.#handle, lpName, 0, REG.DWORD, byref(dword), 4), "RegSetValueExW(DWORD)");
  }

  // ── Delete value ──

  deleteValue(valueName) {
    const api = advapi32();
    const lpName = create_unicode_buffer(valueName);
    const rc = api.RegDeleteValueW(this.#handle, lpName);
    if (rc === ERROR_FILE_NOT_FOUND) return false;
    check(rc, "RegDeleteValueW");
    return true;
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
   * @param {number} rootKey - One of HKEY.CURRENT_USER, HKEY.LOCAL_MACHINE, etc.
   * @param {string} subKey  - e.g. "Software\\MyApp"
   * @param {object} [opts]
   * @param {boolean} [opts.write=false]  - Open with write access
   * @param {boolean} [opts.create=false] - Create the key if it doesn't exist (implies write)
   * @returns {RegistryKey}
   */
  static openKey(rootKey, subKey, { write = false, create = false } = {}) {
    const api = advapi32();
    const lpSubKey = create_unicode_buffer(subKey);
    const phkResult = new c_uint32();

    if (create) {
      const lpdwDisposition = new c_uint32();
      check(api.RegCreateKeyExW(rootKey, lpSubKey, 0, null, REG_OPTION_NON_VOLATILE, KEY_ALL_ACCESS, null, byref(phkResult), byref(lpdwDisposition)), "RegCreateKeyExW");
    } else {
      const access = write ? KEY_READ | KEY_WRITE : KEY_READ;
      check(api.RegOpenKeyExW(rootKey, lpSubKey, 0, access, byref(phkResult)), "RegOpenKeyExW");
    }

    return new RegistryKey(phkResult.value);
  }

  /**
   * Delete an entire key (must have no subkeys on NT).
   * @returns {boolean} true if deleted, false if not found
   */
  static deleteKey(rootKey, subKey) {
    const api = advapi32();
    const rc = api.RegDeleteKeyW(rootKey, create_unicode_buffer(subKey));
    if (rc === ERROR_FILE_NOT_FOUND) return false;
    check(rc, "RegDeleteKeyW");
    return true;
  }

  // ─── Convenience one-liners (auto open + close) ──────────────────

  /**
   * Read a value without opening a key handle (uses RegGetValueW directly on root).
   * Returns `undefined` if not found.
   * Automatically detects REG_SZ vs REG_DWORD.
   */
  static getValue(rootKey, subKey, valueName) {
    const api = advapi32();
    const lpSubKey = create_unicode_buffer(subKey);
    const lpName = create_unicode_buffer(valueName);
    const pdwType = new c_uint32();
    const pcbData = new c_uint32(0);

    // Query size and type
    let rc = api.RegGetValueW(rootKey, lpSubKey, lpName, RRF_RT_ANY, byref(pdwType), null, byref(pcbData));
    if (rc === ERROR_FILE_NOT_FOUND) return undefined;
    if (rc !== 0 && rc !== ERROR_MORE_DATA) check(rc, "RegGetValueW(size)");

    const type = pdwType.value;

    if (type === REG.DWORD) {
      const outDword = new c_uint32();
      const cb = new c_uint32(4);
      rc = api.RegGetValueW(rootKey, lpSubKey, lpName, RRF_RT_REG_DWORD, byref(pdwType), byref(outDword), byref(cb));
      check(rc, "RegGetValueW(DWORD)");
      return outDword.value;
    }

    // Default: treat as string (REG_SZ / REG_EXPAND_SZ)
    const needed = pcbData.value;
    if (!needed) return "";
    const outBuf = create_unicode_buffer(Math.ceil(needed / 2));
    rc = api.RegGetValueW(rootKey, lpSubKey, lpName, RRF_RT_REG_SZ, byref(pdwType), outBuf, byref(pcbData));
    check(rc, "RegGetValueW(SZ)");
    return wstring_at(outBuf).replace(/\0+$/, "");
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
