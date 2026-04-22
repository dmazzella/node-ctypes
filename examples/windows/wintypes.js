/**
 * wintypes.js - Win32 type aliases, mirroring Python's `ctypes.wintypes`.
 *
 * These are pure aliases (no runtime behavior added). Using them in Win32
 * example code makes the signatures read almost identically to the
 * equivalent Python ctypes source.
 *
 * Python: `from ctypes import wintypes`
 * Here:   `import { HWND, DWORD, WPARAM, ... } from "./wintypes.js"`
 */

import { c_int, c_uint, c_long, c_ulong, c_short, c_ushort, c_ubyte, c_char_p, c_wchar, c_wchar_p, c_void_p, c_size_t, c_ssize_t, c_int64, c_uint64 } from "node-ctypes";

// Primitive numeric types
export const BYTE = c_ubyte;
export const WORD = c_ushort;
export const DWORD = c_ulong;
export const QWORD = c_uint64;
export const DWORDLONG = c_uint64;
export const LONGLONG = c_int64;
export const ULONGLONG = c_uint64;
export const BOOL = c_long;
export const INT = c_int;
export const UINT = c_uint;
export const LONG = c_long;
export const ULONG = c_ulong;
export const SHORT = c_short;
export const USHORT = c_ushort;
export const ATOM = c_ushort;
export const COLORREF = c_ulong;

// Character / string types
export const CHAR = c_ubyte;
export const WCHAR = c_wchar;
export const LPSTR = c_char_p;
export const LPCSTR = c_char_p;
export const LPWSTR = c_wchar_p;
export const LPCWSTR = c_wchar_p;

// Void / generic pointer
export const LPVOID = c_void_p;
export const LPCVOID = c_void_p;
export const PVOID = c_void_p;

// HANDLE and its many aliases (all void* under the hood)
export const HANDLE = c_void_p;
export const HWND = c_void_p;
export const HINSTANCE = c_void_p;
export const HMODULE = c_void_p;
export const HICON = c_void_p;
export const HCURSOR = c_void_p;
export const HBRUSH = c_void_p;
export const HMENU = c_void_p;
export const HFONT = c_void_p;
export const HBITMAP = c_void_p;
export const HGDIOBJ = c_void_p;
export const HKEY = c_void_p;
export const HDC = c_void_p;
export const HRGN = c_void_p;

// Pointer-sized integers (win64: 8 bytes, win32: 4 bytes)
export const WPARAM = c_size_t;
export const LPARAM = c_ssize_t;
export const LRESULT = c_ssize_t;
export const UINT_PTR = c_size_t;
export const LONG_PTR = c_ssize_t;
export const ULONG_PTR = c_size_t;

// Advapi / registry
export const LSTATUS = c_long; // LONG error code (0 = success, otherwise Win32 error)
export const REGSAM = c_ulong; // Access mask for registry APIs

// Pointer-to-primitive aliases (for *_OUT params / byref usage)
// These are void* at the FFI level; semantic type documented by name.
export const PBYTE = c_void_p;
export const LPBYTE = c_void_p;
export const PDWORD = c_void_p;
export const LPDWORD = c_void_p;
export const PHKEY = c_void_p;
