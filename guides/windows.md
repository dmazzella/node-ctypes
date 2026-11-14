---
title: Windows API
---

# Windows API

## Windows API

`wintypes` is Python's `ctypes.wintypes`: the same types (BOOL, BYTE,
WORD, DWORD, HANDLE, HWND, LPARAM, WPARAM, LPCWSTR, …), structures (`RECT`,
`POINT`, `SIZE`, `MSG`, `FILETIME`, `WIN32_FIND_DATAW`, …) and pointer types
(`LPDWORD = POINTER(DWORD)`, `LPRECT`, `PHANDLE`, …), plus common extras
(`LRESULT`, `UINT_PTR`, `LSTATUS`, …).

```javascript
import { WinDLL, Structure, POINTER, byref, wintypes } from "node-ctypes";
const { WORD, HWND, BOOL, RECT, LPRECT } = wintypes;

const kernel32 = new WinDLL("kernel32.dll");

class SYSTEMTIME extends Structure {
  static _fields_ = [
    ["wYear", WORD],
    ["wMonth", WORD],
    ["wDayOfWeek", WORD],
    ["wDay", WORD],
    ["wHour", WORD],
    ["wMinute", WORD],
    ["wSecond", WORD],
    ["wMilliseconds", WORD],
  ];
}

kernel32.GetLocalTime.argtypes = [POINTER(SYSTEMTIME)];
kernel32.GetLocalTime.restype = null;
const st = new SYSTEMTIME();
kernel32.GetLocalTime(byref(st));

const user32 = new WinDLL("user32.dll");
user32.GetClientRect.argtypes = [HWND, LPRECT];
user32.GetClientRect.restype = BOOL;
const rect = new RECT();
user32.GetClientRect(hwnd, byref(rect));
rect.right - rect.left; // LONG (c_long) values are BigInt
```
