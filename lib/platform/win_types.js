/**
 * @file win_types.js
 * @module platform/win_types
 * @description Windows API type aliases (Python `ctypes.wintypes` parity).
 *
 * Alias puri dei primitivi C, senza behavior aggiuntivo. Permettono di
 * scrivere signature Win32 leggibili e ricopiabili dalle header MSDN
 * senza tradurre manualmente (DWORD → c_uint32, ecc.).
 *
 * La factory `createWinTypes(prims)` cattura le primitive già caricate
 * da `createPrimitiveTypes` — coerente con gli altri modules della lib.
 *
 * Copre la maggior parte delle typedef `windef.h` / `minwindef.h`
 * utilizzate nelle API Win32, incluse quelle pointer-sized (HANDLE,
 * LPARAM/WPARAM) che variano tra x86 e x64.
 *
 * Python ctypes parity:
 *   `from ctypes.wintypes import DWORD, HANDLE, HWND`
 *
 * Node-ctypes:
 *   `import { wintypes } from 'node-ctypes';`
 *   `const { DWORD, HANDLE, HWND } = wintypes;`
 */

/**
 * @param {Object} prims - primitive types (output di `createPrimitiveTypes`)
 * @returns {Object} namespace con tutti gli alias Win32
 */
export function createWinTypes(prims) {
  const {
    c_int, c_uint, c_long, c_ulong,
    c_short, c_ushort, c_ubyte,
    c_char_p, c_wchar, c_wchar_p,
    c_void_p, c_size_t, c_ssize_t,
    c_int64, c_uint64,
  } = prims;

  // Primitive numeric types
  const BYTE = c_ubyte;
  const WORD = c_ushort;
  const DWORD = c_ulong;
  const QWORD = c_uint64;
  const DWORDLONG = c_uint64;
  const LONGLONG = c_int64;
  const ULONGLONG = c_uint64;
  // Win32 BOOL è definito `typedef int BOOL` in windef.h; su Win LLP64
  // int e long sono entrambi 32-bit. Usiamo c_long per coerenza con
  // l'implementazione storica negli examples/.
  const BOOL = c_long;
  const INT = c_int;
  const UINT = c_uint;
  const LONG = c_long;
  const ULONG = c_ulong;
  const SHORT = c_short;
  const USHORT = c_ushort;
  const ATOM = c_ushort;
  const COLORREF = c_ulong;

  // Character / string types
  const CHAR = c_ubyte;
  const WCHAR = c_wchar;
  const LPSTR = c_char_p;
  const LPCSTR = c_char_p;
  const LPWSTR = c_wchar_p;
  const LPCWSTR = c_wchar_p;

  // Void / generic pointer
  const LPVOID = c_void_p;
  const LPCVOID = c_void_p;
  const PVOID = c_void_p;

  // HANDLE e suoi alias (tutti void* a runtime)
  const HANDLE = c_void_p;
  const HWND = c_void_p;
  const HINSTANCE = c_void_p;
  const HMODULE = c_void_p;
  const HICON = c_void_p;
  const HCURSOR = c_void_p;
  const HBRUSH = c_void_p;
  const HMENU = c_void_p;
  const HFONT = c_void_p;
  const HBITMAP = c_void_p;
  const HGDIOBJ = c_void_p;
  const HKEY = c_void_p;
  const HDC = c_void_p;
  const HRGN = c_void_p;
  const HGLOBAL = c_void_p;

  // Pointer-sized integers (x64: 8 byte, x86: 4 byte).
  // c_size_t / c_ssize_t sono già platform-aware.
  const WPARAM = c_size_t;
  const LPARAM = c_ssize_t;
  const LRESULT = c_ssize_t;
  const UINT_PTR = c_size_t;
  const LONG_PTR = c_ssize_t;
  const ULONG_PTR = c_size_t;

  // Advapi / registry
  const LSTATUS = c_long;  // LONG error code (0 = success)
  const REGSAM = c_ulong;  // access mask

  // Pointer-to-primitive aliases (per *_OUT params / byref usage).
  // Sono void* a livello FFI; il tipo semantico è documentato dal nome.
  const PBYTE = c_void_p;
  const LPBYTE = c_void_p;
  const PDWORD = c_void_p;
  const LPDWORD = c_void_p;
  const PHKEY = c_void_p;

  return {
    // numeric
    BYTE, WORD, DWORD, QWORD, DWORDLONG, LONGLONG, ULONGLONG,
    BOOL, INT, UINT, LONG, ULONG, SHORT, USHORT, ATOM, COLORREF,
    // character/string
    CHAR, WCHAR, LPSTR, LPCSTR, LPWSTR, LPCWSTR,
    // void pointers
    LPVOID, LPCVOID, PVOID,
    // handles
    HANDLE, HWND, HINSTANCE, HMODULE, HICON, HCURSOR, HBRUSH,
    HMENU, HFONT, HBITMAP, HGDIOBJ, HKEY, HDC, HRGN, HGLOBAL,
    // pointer-sized integers
    WPARAM, LPARAM, LRESULT, UINT_PTR, LONG_PTR, ULONG_PTR,
    // registry
    LSTATUS, REGSAM,
    // pointer-to-primitive
    PBYTE, LPBYTE, PDWORD, LPDWORD, PHKEY,
  };
}
