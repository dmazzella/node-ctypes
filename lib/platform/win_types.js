/**
 * @file win_types.js
 * @module platform/win_types
 * @description Windows API types, mirroring Python's `ctypes.wintypes`:
 * the same names, aliases, structures (`RECT`, `POINT`, `MSG`, ...) and
 * pointer types (`LPDWORD = POINTER(DWORD)`, ...), plus a few common extras
 * (`QWORD`, `LRESULT`, `UINT_PTR`, `LSTATUS`, ...).
 *
 * Python ctypes parity:
 *   `from ctypes.wintypes import DWORD, HANDLE, HWND, RECT`
 *
 * Node-ctypes:
 *   `import { wintypes } from 'node-ctypes';`
 *   `const { DWORD, HANDLE, HWND, RECT } = wintypes;`
 */

/**
 * @param {Object} prims - Primitive types (output of `createPrimitiveTypes`)
 * @param {Object} deps - `{ Structure, POINTER, array }`
 * @returns {Object} Namespace with all the Win32 types
 */
export function createWinTypes(prims, { Structure, POINTER, array }) {
  const { c_int, c_uint, c_long, c_ulong, c_short, c_ushort, c_ubyte, c_char, c_char_p, c_wchar, c_wchar_p, c_void_p, c_size_t, c_ssize_t, c_int64, c_uint64, c_float, c_double } = prims;

  // Numeric types
  const BYTE = c_ubyte;
  const WORD = c_ushort;
  const DWORD = c_ulong;
  const CHAR = c_char;
  const WCHAR = c_wchar;
  const UINT = c_uint;
  const INT = c_int;
  const DOUBLE = c_double;
  const FLOAT = c_float;
  const BOOLEAN = BYTE;
  const BOOL = c_long;
  const ULONG = c_ulong;
  const LONG = c_long;
  const USHORT = c_ushort;
  const SHORT = c_short;
  const LARGE_INTEGER = c_int64;
  const ULARGE_INTEGER = c_uint64;

  // VARIANT_BOOL: 16-bit, VARIANT_TRUE = -1. Reads as a boolean, as Python.
  class VARIANT_BOOL extends c_short {
    static _reader = (buf, off) => buf.readInt16LE(off) !== 0;
    static _writer = (buf, off, val) => buf.writeInt16LE(val ? -1 : 0, off);
    static _readerBE = (buf, off) => buf.readInt16BE(off) !== 0;
    static _writerBE = (buf, off, val) => buf.writeInt16BE(val ? -1 : 0, off);
    static from_param(val) {
      return val ? -1 : 0;
    }
  }

  // String types
  const LPCOLESTR = c_wchar_p;
  const LPOLESTR = c_wchar_p;
  const OLESTR = c_wchar_p;
  const LPCWSTR = c_wchar_p;
  const LPWSTR = c_wchar_p;
  const LPCSTR = c_char_p;
  const LPSTR = c_char_p;
  const LPCVOID = c_void_p;
  const LPVOID = c_void_p;

  // Pointer-sized integers (8 bytes on 64-bit, 4 on 32-bit)
  const WPARAM = c_size_t;
  const LPARAM = c_ssize_t;

  const ATOM = WORD;
  const LANGID = WORD;
  const COLORREF = DWORD;
  const LGRPID = DWORD;
  const LCTYPE = DWORD;
  const LCID = DWORD;

  // Handles
  const HANDLE = c_void_p;
  const handles = {};
  for (const name of [
    "HACCEL",
    "HBITMAP",
    "HBRUSH",
    "HCOLORSPACE",
    "HDC",
    "HDESK",
    "HDWP",
    "HENHMETAFILE",
    "HFONT",
    "HGDIOBJ",
    "HGLOBAL",
    "HHOOK",
    "HICON",
    "HINSTANCE",
    "HKEY",
    "HKL",
    "HLOCAL",
    "HMENU",
    "HMETAFILE",
    "HMODULE",
    "HMONITOR",
    "HPALETTE",
    "HPEN",
    "HRGN",
    "HRSRC",
    "HSTR",
    "HTASK",
    "HWINSTA",
    "HWND",
    "SC_HANDLE",
    "SERVICE_STATUS_HANDLE",
  ]) {
    handles[name] = HANDLE;
  }

  // Structures
  class RECT extends Structure {
    static _fields_ = [
      ["left", LONG],
      ["top", LONG],
      ["right", LONG],
      ["bottom", LONG],
    ];
  }

  class SMALL_RECT extends Structure {
    static _fields_ = [
      ["Left", SHORT],
      ["Top", SHORT],
      ["Right", SHORT],
      ["Bottom", SHORT],
    ];
  }

  class _COORD extends Structure {
    static _fields_ = [
      ["X", SHORT],
      ["Y", SHORT],
    ];
  }

  class POINT extends Structure {
    static _fields_ = [
      ["x", LONG],
      ["y", LONG],
    ];
  }

  class SIZE extends Structure {
    static _fields_ = [
      ["cx", LONG],
      ["cy", LONG],
    ];
  }

  class FILETIME extends Structure {
    static _fields_ = [
      ["dwLowDateTime", DWORD],
      ["dwHighDateTime", DWORD],
    ];
  }

  class MSG extends Structure {
    static _fields_ = [
      ["hWnd", handles.HWND],
      ["message", UINT],
      ["wParam", WPARAM],
      ["lParam", LPARAM],
      ["time", DWORD],
      ["pt", POINT],
    ];
  }

  const MAX_PATH = 260;

  class WIN32_FIND_DATAA extends Structure {
    static _fields_ = [
      ["dwFileAttributes", DWORD],
      ["ftCreationTime", FILETIME],
      ["ftLastAccessTime", FILETIME],
      ["ftLastWriteTime", FILETIME],
      ["nFileSizeHigh", DWORD],
      ["nFileSizeLow", DWORD],
      ["dwReserved0", DWORD],
      ["dwReserved1", DWORD],
      ["cFileName", array(CHAR, MAX_PATH)],
      ["cAlternateFileName", array(CHAR, 14)],
    ];
  }

  class WIN32_FIND_DATAW extends Structure {
    static _fields_ = [
      ["dwFileAttributes", DWORD],
      ["ftCreationTime", FILETIME],
      ["ftLastAccessTime", FILETIME],
      ["ftLastWriteTime", FILETIME],
      ["nFileSizeHigh", DWORD],
      ["nFileSizeLow", DWORD],
      ["dwReserved0", DWORD],
      ["dwReserved1", DWORD],
      ["cFileName", array(WCHAR, MAX_PATH)],
      ["cAlternateFileName", array(WCHAR, 14)],
    ];
  }

  const RGB = (red, green, blue) => red + (green << 8) + (blue << 16);

  // Pointer types
  const LPBOOL = POINTER(BOOL);
  const PBOOLEAN = POINTER(BOOLEAN);
  const LPBYTE = POINTER(BYTE);
  const PCHAR = POINTER(CHAR);
  const LPCOLORREF = POINTER(COLORREF);
  const LPDWORD = POINTER(DWORD);
  const LPFILETIME = POINTER(FILETIME);
  const PFLOAT = POINTER(FLOAT);
  const LPHANDLE = POINTER(HANDLE);
  const PHKEY = POINTER(handles.HKEY);
  const LPHKL = POINTER(handles.HKL);
  const LPINT = POINTER(INT);
  const PLARGE_INTEGER = POINTER(LARGE_INTEGER);
  const PLCID = POINTER(LCID);
  const LPLONG = POINTER(LONG);
  const LPMSG = POINTER(MSG);
  const LPPOINT = POINTER(POINT);
  const LPRECT = POINTER(RECT);
  const LPSC_HANDLE = POINTER(handles.SC_HANDLE);
  const PSHORT = POINTER(SHORT);
  const LPSIZE = POINTER(SIZE);
  const PSMALL_RECT = POINTER(SMALL_RECT);
  const LPUINT = POINTER(UINT);
  const PULARGE_INTEGER = POINTER(ULARGE_INTEGER);
  const PULONG = POINTER(ULONG);
  const PUSHORT = POINTER(USHORT);
  const PWCHAR = POINTER(WCHAR);
  const LPWIN32_FIND_DATAA = POINTER(WIN32_FIND_DATAA);
  const LPWIN32_FIND_DATAW = POINTER(WIN32_FIND_DATAW);
  const LPWORD = POINTER(WORD);

  return {
    // Python ctypes.wintypes
    BYTE,
    WORD,
    DWORD,
    CHAR,
    WCHAR,
    UINT,
    INT,
    DOUBLE,
    FLOAT,
    BOOLEAN,
    BOOL,
    VARIANT_BOOL,
    ULONG,
    LONG,
    USHORT,
    SHORT,
    _LARGE_INTEGER: LARGE_INTEGER,
    LARGE_INTEGER,
    _ULARGE_INTEGER: ULARGE_INTEGER,
    ULARGE_INTEGER,
    LPCOLESTR,
    LPOLESTR,
    OLESTR,
    LPCWSTR,
    LPWSTR,
    LPCSTR,
    LPSTR,
    LPCVOID,
    LPVOID,
    WPARAM,
    LPARAM,
    ATOM,
    LANGID,
    COLORREF,
    LGRPID,
    LCTYPE,
    LCID,
    HANDLE,
    ...handles,
    RECT,
    tagRECT: RECT,
    _RECTL: RECT,
    RECTL: RECT,
    _SMALL_RECT: SMALL_RECT,
    SMALL_RECT,
    _COORD,
    POINT,
    tagPOINT: POINT,
    _POINTL: POINT,
    POINTL: POINT,
    SIZE,
    tagSIZE: SIZE,
    SIZEL: SIZE,
    RGB,
    FILETIME,
    _FILETIME: FILETIME,
    MSG,
    tagMSG: MSG,
    MAX_PATH,
    WIN32_FIND_DATAA,
    WIN32_FIND_DATAW,
    LPBOOL,
    PBOOL: LPBOOL,
    PBOOLEAN,
    LPBYTE,
    PBYTE: LPBYTE,
    PCHAR,
    LPCOLORREF,
    LPDWORD,
    PDWORD: LPDWORD,
    LPFILETIME,
    PFILETIME: LPFILETIME,
    PFLOAT,
    LPHANDLE,
    PHANDLE: LPHANDLE,
    PHKEY,
    LPHKL,
    LPINT,
    PINT: LPINT,
    PLARGE_INTEGER,
    PLCID,
    LPLONG,
    PLONG: LPLONG,
    LPMSG,
    PMSG: LPMSG,
    LPPOINT,
    PPOINT: LPPOINT,
    PPOINTL: LPPOINT,
    LPRECT,
    PRECT: LPRECT,
    LPRECTL: LPRECT,
    PRECTL: LPRECT,
    LPSC_HANDLE,
    PSHORT,
    LPSIZE,
    PSIZE: LPSIZE,
    LPSIZEL: LPSIZE,
    PSIZEL: LPSIZE,
    PSMALL_RECT,
    LPUINT,
    PUINT: LPUINT,
    PULARGE_INTEGER,
    PULONG,
    PUSHORT,
    PWCHAR,
    LPWIN32_FIND_DATAA,
    PWIN32_FIND_DATAA: LPWIN32_FIND_DATAA,
    LPWIN32_FIND_DATAW,
    PWIN32_FIND_DATAW: LPWIN32_FIND_DATAW,
    LPWORD,
    PWORD: LPWORD,

    // Extras (not in Python's wintypes)
    QWORD: c_uint64,
    DWORDLONG: c_uint64,
    LONGLONG: c_int64,
    ULONGLONG: c_uint64,
    PVOID: c_void_p,
    HCURSOR: HANDLE,
    LRESULT: c_ssize_t,
    UINT_PTR: c_size_t,
    LONG_PTR: c_ssize_t,
    ULONG_PTR: c_size_t,
    LSTATUS: c_long,
    REGSAM: c_ulong,
  };
}
