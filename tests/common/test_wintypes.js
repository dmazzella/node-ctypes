/**
 * test_wintypes.js — esposizione degli alias Windows API.
 *
 * La sorgente di verità è `lib/platform/win_types.js` esposta a runtime
 * come `ctypes.wintypes`. Gli examples in `examples/windows/*` fanno
 * `import { wintypes } from "node-ctypes"` + `const { HWND, ... } = wintypes`.
 *
 * I test validano solo corretta *mappatura* degli alias → primitive.
 * Interop con API Win32 reali sta in `tests/windows/`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";

describe("wintypes aliases (Python ctypes.wintypes parity)", function () {
  it("exposes wintypes namespace", function () {
    assert.ok(ctypes.wintypes);
    assert.strictEqual(typeof ctypes.wintypes, "object");
  });

  it("integer aliases", function () {
    const w = ctypes.wintypes;
    assert.strictEqual(w.BYTE, ctypes.c_ubyte);
    assert.strictEqual(w.WORD, ctypes.c_ushort);
    assert.strictEqual(w.DWORD, ctypes.c_ulong);
    assert.strictEqual(w.QWORD, ctypes.c_uint64);
    assert.strictEqual(w.DWORDLONG, ctypes.c_uint64);
    assert.strictEqual(w.LONGLONG, ctypes.c_int64);
    assert.strictEqual(w.ULONGLONG, ctypes.c_uint64);
    // Win32 BOOL = typedef int — usiamo c_long (32-bit su Win LLP64) per
    // coerenza con examples/.
    assert.strictEqual(w.BOOL, ctypes.c_long);
    assert.strictEqual(w.INT, ctypes.c_int);
    assert.strictEqual(w.UINT, ctypes.c_uint);
    assert.strictEqual(w.LONG, ctypes.c_long);
    assert.strictEqual(w.ULONG, ctypes.c_ulong);
    assert.strictEqual(w.SHORT, ctypes.c_short);
    assert.strictEqual(w.USHORT, ctypes.c_ushort);
    assert.strictEqual(w.ATOM, ctypes.c_ushort);
    assert.strictEqual(w.COLORREF, ctypes.c_ulong);
  });

  it("HANDLE family all reduce to c_void_p", function () {
    const w = ctypes.wintypes;
    const HANDLE_ALIASES = [
      "HANDLE", "HWND", "HINSTANCE", "HMODULE", "HICON", "HCURSOR",
      "HBRUSH", "HMENU", "HFONT", "HBITMAP", "HGDIOBJ", "HKEY",
      "HDC", "HRGN",
      "PVOID", "LPVOID", "LPCVOID",
    ];
    for (const name of HANDLE_ALIASES) {
      assert.strictEqual(w[name], ctypes.c_void_p, `${name} === c_void_p`);
    }
  });

  it("string pointer aliases", function () {
    const w = ctypes.wintypes;
    assert.strictEqual(w.LPSTR, ctypes.c_char_p);
    assert.strictEqual(w.LPCSTR, ctypes.c_char_p);
    assert.strictEqual(w.LPWSTR, ctypes.c_wchar_p);
    assert.strictEqual(w.LPCWSTR, ctypes.c_wchar_p);
  });

  it("pointer-sized integers reduce to c_size_t / c_ssize_t", function () {
    const w = ctypes.wintypes;
    assert.strictEqual(w.WPARAM, ctypes.c_size_t);
    assert.strictEqual(w.LPARAM, ctypes.c_ssize_t);
    assert.strictEqual(w.LRESULT, ctypes.c_ssize_t);
    assert.strictEqual(w.UINT_PTR, ctypes.c_size_t);
    assert.strictEqual(w.LONG_PTR, ctypes.c_ssize_t);
    assert.strictEqual(w.ULONG_PTR, ctypes.c_size_t);
  });

  it("pointer-to-primitive aliases reduce to c_void_p", function () {
    const w = ctypes.wintypes;
    for (const name of ["PBYTE", "LPBYTE", "PDWORD", "LPDWORD", "PHKEY"]) {
      assert.strictEqual(w[name], ctypes.c_void_p, `${name} === c_void_p`);
    }
  });

  it("registry types", function () {
    const w = ctypes.wintypes;
    assert.strictEqual(w.LSTATUS, ctypes.c_long);
    assert.strictEqual(w.REGSAM, ctypes.c_ulong);
  });
});
