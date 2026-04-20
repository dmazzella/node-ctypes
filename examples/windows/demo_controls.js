// Windows Controls Showcase Demo
// A compact demo that creates a window with a wide set of common Win32 controls

import { WinDLL, Structure, POINTER, WINFUNCTYPE, sizeof, create_unicode_buffer, wstring_at, byref, c_void } from "node-ctypes";
import { ATOM, BOOL, DWORD, HWND, HBRUSH, HCURSOR, HFONT, HICON, HINSTANCE, HMENU, HMODULE, HRGN, INT, LONG, LPCWSTR, LPWSTR, LPVOID, LRESULT, UINT, UINT_PTR, WPARAM, LPARAM } from "./wintypes.js";

// LRESULT CALLBACK WindowProc(HWND, UINT, WPARAM, LPARAM)
const WNDPROC = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPARAM);

// Win32 macros (not provided by ctypes itself; inline-defined as in typical Python scripts)
const LOWORD = (x) => Number(x) & 0xffff;
const HIWORD = (x) => (Number(x) >> 16) & 0xffff;
const MAKELONG = (lo, hi) => ((hi & 0xffff) << 16) | (lo & 0xffff);
const SIGNED_HIWORD = (x) => {
  const v = HIWORD(x);
  return v & 0x8000 ? v - 0x10000 : v;
};

// Constants
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_VISIBLE = 0x10000000;
const WS_CHILD = 0x40000000;
const WS_TABSTOP = 0x00010000;
const BS_PUSHBUTTON = 0x00000001;
const BS_GROUPBOX = 0x00000007;
const BS_AUTOCHECKBOX = 0x00000003;
const BS_AUTORADIOBUTTON = 0x00000009;
const ES_LEFT = 0x0000;
const ES_AUTOHSCROLL = 0x0080;
const WS_EX_CLIENTEDGE = 0x00000200;
const WM_DESTROY = 0x0002;
const WM_COMMAND = 0x0111;
const WM_CLOSE = 0x0010;
const CW_USEDEFAULT = 0x80000000;
const SW_SHOW = 5;
const SW_MINIMIZE = 6;
const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const WM_SETFONT = 0x0030;

const SWP_NOZORDER = 0x0004;
const SWP_NOSIZE = 0x0001;
const SWP_NOREDRAW = 0x0008;

const WM_TIMER = 0x0113;
const ID_PROGRESS_TIMER = 1;
const WM_SIZE = 0x0005;
const WM_VSCROLL = 0x0115;
const WM_HSCROLL = 0x0114;
const WM_MOUSEWHEEL = 0x020a;

const SB_LINEUP = 0;
const SB_LINEDOWN = 1;
const SB_PAGEUP = 2;
const SB_PAGEDOWN = 3;
const SB_THUMBPOSITION = 4;
const SB_THUMBTRACK = 5;
const SB_TOP = 6;
const SB_BOTTOM = 7;
const SB_ENDSCROLL = 8;
const SB_VERT = 1;

const SIF_RANGE = 0x1;
const SIF_PAGE = 0x2;
const SIF_POS = 0x4;
const SIF_TRACKPOS = 0x10;
const SIF_ALL = SIF_RANGE | SIF_PAGE | SIF_POS | SIF_TRACKPOS;

const PBS_SMOOTH = 0x01;
const PBM_SETRANGE = 0x0401;
const PBM_SETPOS = 0x0402;
const PBM_GETPOS = 0x0408;
const PBM_SETRANGE32 = 0x0406;
// Additional constants for progress bar

const EN_CHANGE = 0x0300;

const BM_GETCHECK = 0x00f0;
const BM_SETCHECK = 0x00f1;
const BST_UNCHECKED = 0x0000;
const BST_CHECKED = 0x0001;

const CBS_DROPDOWN = 0x0002;
const CBS_HASSTRINGS = 0x0200;
const CB_ADDSTRING = 0x0143;
const CB_SETCURSEL = 0x014e;
const CB_GETCURSEL = 0x0147;
const CB_GETLBTEXT = 0x0148;
const CBN_SELCHANGE = 0x0001;

const LBS_NOTIFY = 0x0001;
const LBS_SORT = 0x0002;
const LBS_HASSTRINGS = 0x0040;
const LB_ADDSTRING = 0x0180;
const LB_GETCURSEL = 0x0188;
const LB_GETTEXT = 0x0189;
const LBN_SELCHANGE = 0x0001;

// IDs
const ID_BUTTON1 = 2001;
const ID_BUTTON2 = 2002;
const ID_TOGGLE_WINDOW = 2003;
const ID_COUNTER = 2004;
const ID_TEXT_INPUT = 2005;
const ID_CHECKBOX = 2006;
const ID_RADIO1 = 2007;
const ID_RADIO2 = 2008;
const ID_COMBOBOX = 2009;
const ID_PROGRESSBAR = 2010;
const ID_LISTBOX = 2011;
const ID_TRACKBAR = 2012;
const ID_SPIN = 2013;
const ID_SPIN_EDIT = 2014;
const ID_TOOLTIP = 2015;

// Native libs
const user32 = new WinDLL("user32.dll");
const kernel32 = new WinDLL("kernel32.dll");
const comctl32 = new WinDLL("comctl32.dll");
const gdi32 = new WinDLL("gdi32.dll");

// ============================================================================
// Windows structures (defined before argtypes so POINTER(T) can reference them).
// Matches Python ctypes idiom: `class X(Structure): _fields_ = [...]`.
// ============================================================================

const ICC_PROGRESS_CLASS = 0x00002000;
const ICC_BAR_CLASSES = 0x00000004;
const ICC_UPDOWN_CLASS = 0x00000040;
const ICC_TRACKBAR_CLASSES = 0x00000001;

class INITCOMMONCONTROLSEX extends Structure {
  static _fields_ = [
    ["dwSize", DWORD],
    ["dwICC", DWORD],
  ];
}

class POINT extends Structure {
  static _fields_ = [
    ["x", LONG],
    ["y", LONG],
  ];
}

class WNDCLASSEX extends Structure {
  static _fields_ = [
    ["cbSize", UINT],
    ["style", UINT],
    ["lpfnWndProc", LPVOID],
    ["cbClsExtra", INT],
    ["cbWndExtra", INT],
    ["hInstance", HINSTANCE],
    ["hIcon", HICON],
    ["hCursor", HCURSOR],
    ["hbrBackground", HBRUSH],
    ["lpszMenuName", LPCWSTR],
    ["lpszClassName", LPCWSTR],
    ["hIconSm", HICON],
  ];
}

class MSG extends Structure {
  static _fields_ = [
    ["hwnd", HWND],
    ["message", UINT],
    ["wParam", WPARAM],
    ["lParam", LPARAM],
    ["time", DWORD],
    ["pt", POINT],
  ];
}

class RECT extends Structure {
  static _fields_ = [
    ["left", LONG],
    ["top", LONG],
    ["right", LONG],
    ["bottom", LONG],
  ];
}

class SCROLLINFO extends Structure {
  static _fields_ = [
    ["cbSize", UINT],
    ["fMask", UINT],
    ["nMin", INT],
    ["nMax", INT],
    ["nPage", UINT],
    ["nPos", INT],
    ["nTrackPos", INT],
  ];
}

class TOOLINFOW extends Structure {
  static _fields_ = [
    ["cbSize", UINT],
    ["uFlags", UINT],
    ["hwnd", HWND],
    ["uId", UINT_PTR],
    ["rect", RECT],
    ["hinst", HINSTANCE],
    ["lpszText", LPWSTR],
    ["lParam", LPARAM],
  ];
}

// ============================================================================
// Function signatures (Python-ctypes style: argtypes / restype).
// LPCWSTR params use c_wchar_p (accepts JS strings OR wide-char Buffers).
// Struct pointer params use POINTER(T) for self-documentation.
// ============================================================================

user32.RegisterClassExW.argtypes = [POINTER(WNDCLASSEX)];
user32.RegisterClassExW.restype = ATOM;

user32.CreateWindowExW.argtypes = [DWORD, LPCWSTR, LPCWSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, LPVOID];
user32.CreateWindowExW.restype = HWND;

user32.ShowWindow.argtypes = [HWND, INT];
user32.ShowWindow.restype = BOOL;

user32.UpdateWindow.argtypes = [HWND];
user32.UpdateWindow.restype = BOOL;

user32.InvalidateRect.argtypes = [HWND, POINTER(RECT), BOOL];
user32.InvalidateRect.restype = BOOL;

user32.RedrawWindow.argtypes = [HWND, POINTER(RECT), HRGN, UINT];
user32.RedrawWindow.restype = BOOL;

user32.GetMessageW.argtypes = [POINTER(MSG), HWND, UINT, UINT];
user32.GetMessageW.restype = BOOL;

user32.TranslateMessage.argtypes = [POINTER(MSG)];
user32.TranslateMessage.restype = BOOL;

user32.DispatchMessageW.argtypes = [POINTER(MSG)];
user32.DispatchMessageW.restype = LRESULT;

user32.DefWindowProcW.argtypes = [HWND, UINT, WPARAM, LPARAM];
user32.DefWindowProcW.restype = LRESULT;

user32.PostQuitMessage.argtypes = [INT];
user32.PostQuitMessage.restype = c_void;

// Second arg may be MAKEINTRESOURCE (integer cast to pointer), so kept LPVOID.
user32.LoadCursorW.argtypes = [HINSTANCE, LPVOID];
user32.LoadCursorW.restype = HCURSOR;

kernel32.GetModuleHandleW.argtypes = [LPCWSTR];
kernel32.GetModuleHandleW.restype = HMODULE;

user32.SetWindowTextW.argtypes = [HWND, LPCWSTR];
user32.SetWindowTextW.restype = BOOL;

user32.GetDlgItem.argtypes = [HWND, INT];
user32.GetDlgItem.restype = HWND;

user32.GetWindowTextW.argtypes = [HWND, LPWSTR, INT];
user32.GetWindowTextW.restype = INT;

user32.GetClientRect.argtypes = [HWND, POINTER(RECT)];
user32.GetClientRect.restype = BOOL;

user32.GetWindowRect.argtypes = [HWND, POINTER(RECT)];
user32.GetWindowRect.restype = BOOL;

// LPPOINT — RECT passed as pair-of-POINTs is idiomatic Win32 but not statically typable.
user32.MapWindowPoints.argtypes = [HWND, HWND, LPVOID, UINT];
user32.MapWindowPoints.restype = INT;

user32.SetScrollInfo.argtypes = [HWND, INT, POINTER(SCROLLINFO), BOOL];
user32.SetScrollInfo.restype = INT;

user32.ScrollWindow.argtypes = [HWND, INT, INT, POINTER(RECT), POINTER(RECT)];
user32.ScrollWindow.restype = BOOL;

user32.MoveWindow.argtypes = [HWND, INT, INT, INT, INT, BOOL];
user32.MoveWindow.restype = BOOL;

user32.BeginDeferWindowPos.argtypes = [INT];
user32.BeginDeferWindowPos.restype = LPVOID;

user32.DeferWindowPos.argtypes = [LPVOID, HWND, HWND, INT, INT, INT, INT, UINT];
user32.DeferWindowPos.restype = LPVOID;

user32.EndDeferWindowPos.argtypes = [LPVOID];
user32.EndDeferWindowPos.restype = BOOL;

user32.SendMessageW.argtypes = [HWND, UINT, WPARAM, LPARAM];
user32.SendMessageW.restype = LRESULT;

user32.PostMessageW.argtypes = [HWND, UINT, WPARAM, LPARAM];
user32.PostMessageW.restype = BOOL;

// UINT_PTR SetTimer(HWND, UINT_PTR nIDEvent, UINT uElapse, TIMERPROC)
user32.SetTimer.argtypes = [HWND, UINT_PTR, UINT, LPVOID];
user32.SetTimer.restype = UINT_PTR;

user32.KillTimer.argtypes = [HWND, UINT_PTR];
user32.KillTimer.restype = BOOL;

user32.IsIconic.argtypes = [HWND];
user32.IsIconic.restype = BOOL;

user32.IsZoomed.argtypes = [HWND];
user32.IsZoomed.restype = BOOL;

gdi32.CreateFontW.argtypes = [INT, INT, INT, INT, INT, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, LPCWSTR];
gdi32.CreateFontW.restype = HFONT;

gdi32.DeleteObject.argtypes = [LPVOID];
gdi32.DeleteObject.restype = BOOL;

comctl32.InitCommonControlsEx.argtypes = [POINTER(INITCOMMONCONTROLSEX)];
comctl32.InitCommonControlsEx.restype = BOOL;

// Register common control classes before creating windows
const icex = new INITCOMMONCONTROLSEX();
icex.dwSize = sizeof(INITCOMMONCONTROLSEX);
icex.dwICC = ICC_BAR_CLASSES | ICC_PROGRESS_CLASS | ICC_UPDOWN_CLASS | ICC_TRACKBAR_CLASSES;
comctl32.InitCommonControlsEx(byref(icex));

// Trackbar / UpDown / Tooltip constants
// Trackbar messages (based on WM_USER offsets)
const TBM_GETPOS = 0x0400; // WM_USER
const TBM_SETPOS = 0x0405; // WM_USER + 5
const TBM_SETRANGE = 0x0406; // WM_USER + 6

// Up-Down control messages (WM_USER = 0x0400)
const UDM_SETBUDDY = 0x0401; // WM_USER + 1
const UDM_GETPOS = 0x0408; // WM_USER + 8
const UDM_SETRANGE32 = 0x046f; // WM_USER + 111
const UDM_SETPOS32 = 0x0471; // WM_USER + 113
const UDM_GETPOS32 = 0x0472; // WM_USER + 114

const TTS_ALWAYSTIP = 0x01;
const TTM_SETMAXTIPWIDTH = 0x0418;
const TTM_ADDTOOLW = 0x0436;

const TTF_IDISHWND = 0x0001;
const TTF_SUBCLASS = 0x0010;

const WM_NOTIFY = 0x004e;

// Up-Down control styles (UDS_*)
const UDS_WRAP = 0x0001;
const UDS_ALIGNRIGHT = 0x0002;
const UDS_ALIGNLEFT = 0x0004;
const UDS_SETBUDDYINT = 0x0008;
const UDS_AUTOBUDDY = 0x0100;
const UDS_ARROWKEYS = 0x0020;

// Debugging: how often to print values from timer (ms)
const DEBUG_LOG_INTERVAL = 1000;

// Global state for demo
let hInstance = null;
let hwndMain = null;
let windowProcCallback = null;
let hFont = null;
let progressPos = 0;
let counter = 0;
let windowVisible = true;
let hwndGroupBox = null;
let hwndButton1 = null;
let hwndButton2 = null;
let hwndToggle = null;
let hwndCounter = null;
let hwndTextGroupBox = null;
let hwndTextInput = null;
let hwndOptionsGroupBox = null;
let hwndCheckbox = null;
let hwndRadio1 = null;
let hwndRadio2 = null;
let hwndComboGroupBox = null;
let hwndCombobox = null;
let hwndListGroupBox = null;
let hwndListBox = null;
let hwndProgressGroupBox = null;
let hwndProgressBar = null;
let hwndTrack = null;
let hwndSpin = null;
let hwndSpinEdit = null;
let hwndTooltip = null;
let __scrollY = 0;
let __contentHeight = 0;
let __clientHeight = 0;
let lastSpinPos = 0;
let isUpdatingSpin = false; // Re-entrancy guard for spin/trackbar sync
let progressTimerId = null;

function createScaledFont() {
  if (hFont) gdi32.DeleteObject(hFont);
  // Fixed comfortable font
  const fontHeight = 24;
  hFont = gdi32.CreateFontW(fontHeight, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 1, 0, "Segoe UI");
  return hFont;
}

function applyFont(hwnd) {
  if (hFont && hwnd) {
    user32.SendMessageW(hwnd, WM_SETFONT, hFont, 1);
  }
}

function WindowProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_SIZE: {
      const rc = new RECT();
      user32.GetClientRect(hwnd, byref(rc));
      __clientHeight = Number(rc.bottom) - Number(rc.top);
      const si = new SCROLLINFO();
      si.cbSize = sizeof(SCROLLINFO);
      si.fMask = SIF_RANGE | SIF_PAGE | SIF_POS;
      si.nMin = 0;
      si.nMax = Math.max(0, __contentHeight - 1);
      si.nPage = __clientHeight;
      si.nPos = __scrollY;
      user32.SetScrollInfo(hwnd, SB_VERT, byref(si), 1);
      break;
    }
    case WM_VSCROLL: {
      const code = LOWORD(wParam);
      let delta = 0;
      if (code === SB_LINEUP) delta = -20;
      else if (code === SB_LINEDOWN) delta = 20;
      else if (code === SB_PAGEUP) delta = -__clientHeight;
      else if (code === SB_PAGEDOWN) delta = __clientHeight;
      else if (code === SB_THUMBTRACK || code === SB_THUMBPOSITION) {
        delta = SIGNED_HIWORD(wParam) - __scrollY;
      }
      if (delta !== 0) {
        const newY = Math.max(0, Math.min(__scrollY + delta, Math.max(0, __contentHeight - __clientHeight)));
        const scrollBy = newY - __scrollY;
        if (scrollBy !== 0) {
          __scrollY = newY;
          user32.ScrollWindow(hwnd, 0, -scrollBy, null, null);
          const si2 = new SCROLLINFO();
          si2.cbSize = sizeof(SCROLLINFO);
          si2.fMask = SIF_POS;
          si2.nPos = __scrollY;
          user32.SetScrollInfo(hwnd, SB_VERT, byref(si2), 1);
        }
      }
      return 0;
    }
    case WM_MOUSEWHEEL: {
      // wheel delta in HIWORD of wParam, signed short
      const delta = SIGNED_HIWORD(wParam);
      const scrollPixels = Math.round((delta / 120) * 50);
      const newY = Math.max(0, Math.min(__contentHeight - __clientHeight, __scrollY - scrollPixels));
      const scrollBy = newY - __scrollY;
      if (scrollBy !== 0) {
        __scrollY = newY;
        user32.ScrollWindow(hwnd, 0, -scrollBy, null, null);
        const si3 = new SCROLLINFO();
        si3.cbSize = sizeof(SCROLLINFO);
        si3.fMask = SIF_POS;
        si3.nPos = __scrollY;
        user32.SetScrollInfo(hwnd, SB_VERT, byref(si3), 1);
      }
      return 0;
    }
    case WM_HSCROLL: {
      // Trackbar sends WM_HSCROLL when value changes
      if (isUpdatingSpin) return 0;
      const lpNum = BigInt(lParam || 0);
      const tkNum = BigInt(hwndTrack || 0);
      if (lpNum !== 0n && tkNum !== 0n && lpNum === tkNum) {
        const tpos = Number(user32.SendMessageW(hwndTrack, TBM_GETPOS, 0, 0) || 0);
        const pos = Math.max(0, Math.min(100, tpos));
        if (pos !== lastSpinPos) {
          isUpdatingSpin = true;
          lastSpinPos = pos;
          if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
          if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, String(pos));
          isUpdatingSpin = false;
        }
      }
      return 0;
    }
    case WM_COMMAND: {
      const controlId = LOWORD(wParam);
      const notification = HIWORD(wParam);
      switch (controlId) {
        case ID_BUTTON1:
          console.log("Button 1 clicked");
          break;
        case ID_BUTTON2:
          console.log("Button 2 clicked");
          break;
        case ID_TOGGLE_WINDOW: {
          const isMin = user32.IsIconic(hwndMain);
          const isMax = user32.IsZoomed(hwndMain);
          if (isMin) {
            user32.ShowWindow(hwndMain, SW_RESTORE);
            console.log("Window restored from minimized state");
          } else if (isMax) {
            user32.ShowWindow(hwndMain, SW_RESTORE);
            console.log("Window restored from maximized state");
          } else {
            user32.ShowWindow(hwndMain, SW_MINIMIZE);
            console.log("Window minimized");
          }
          break;
        }
        case ID_COUNTER: {
          counter += 1;
          console.log("Counter incremented to:", counter);
          const text = "Count: " + counter;
          const target = hwndCounter || user32.GetDlgItem(hwndMain, ID_COUNTER);
          user32.SetWindowTextW(target, text);
          break;
        }
        case ID_CHECKBOX: {
          const state = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_CHECKBOX), BM_GETCHECK, 0, 0);
          console.log("Checkbox raw state:", state);
          break;
        }
        case ID_RADIO1:
          console.log("Radio 1 selected");
          break;
        case ID_RADIO2:
          console.log("Radio 2 selected");
          break;
        case ID_COMBOBOX:
          if (notification === CBN_SELCHANGE) {
            const sel = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_COMBOBOX), CB_GETCURSEL, 0, 0);
            console.log("Combobox selection index:", Number(sel));
          }
          break;
        case ID_TEXT_INPUT:
          if (notification === EN_CHANGE) {
            const textControl = user32.GetDlgItem(hwndMain, ID_TEXT_INPUT);
            const buf = create_unicode_buffer(256);
            const len = Number(user32.GetWindowTextW(textControl, buf, 256));
            if (len > 0) {
              console.log("Text input changed:", wstring_at(buf, len));
            } else {
              console.log("Text input cleared");
            }
          }
          break;
        case ID_SPIN_EDIT:
          if (notification === EN_CHANGE && !isUpdatingSpin) {
            const hEdit = user32.GetDlgItem(hwndMain, ID_SPIN_EDIT);
            const buf = create_unicode_buffer(64);
            const len = Number(user32.GetWindowTextW(hEdit, buf, 64));
            const text = len > 0 ? wstring_at(buf, len) : "";
            let num = parseInt(text, 10);
            if (Number.isNaN(num)) num = 0;
            num = Math.max(0, Math.min(100, num));
            if (num !== lastSpinPos) {
              isUpdatingSpin = true;
              lastSpinPos = num;
              if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, num);
              if (hwndTrack) user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, num);
              isUpdatingSpin = false;
            }
          }
          break;
        case ID_LISTBOX:
          if (notification === LBN_SELCHANGE) {
            const selIndex = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_LISTBOX), LB_GETCURSEL, 0, 0);
            console.log("Listbox selection index:", Number(selIndex));
          }
          break;
      }
      return 0;
    }
    case WM_TIMER: {
      progressPos += 1;
      if (progressPos > 100) progressPos = 0;
      user32.SendMessageW(hwndProgressBar, PBM_SETRANGE, 0, MAKELONG(0, 100));
      user32.SendMessageW(hwndProgressBar, PBM_SETPOS, progressPos, 0);
      user32.InvalidateRect(hwndProgressBar, 0, 1);
      user32.UpdateWindow(hwndProgressBar);
      user32.RedrawWindow(hwndProgressBar, 0, 0, 0x85);
      return 0;
    }
    case WM_NOTIFY: {
      const ctrlId = LOWORD(wParam);
      if (ctrlId === ID_SPIN) {
        let pos = Number(user32.SendMessageW(hwndSpin, UDM_GETPOS32, 0, 0) || 0);
        if (!pos && hwndSpinEdit) {
          const buf = create_unicode_buffer(64);
          const len = Number(user32.GetWindowTextW(hwndSpinEdit, buf, 64));
          if (len > 0) pos = parseInt(wstring_at(buf, len), 10) || 0;
        }
        pos = Math.max(0, Math.min(100, pos));
        if (pos !== lastSpinPos) {
          lastSpinPos = pos;
          if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, String(pos));
          if (hwndTrack) user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, pos);
          if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
        }
      }
      if (ctrlId === ID_TRACKBAR) {
        const tpos = Number(user32.SendMessageW(hwndTrack, TBM_GETPOS, 0, 0) || 0);
        const pos = Math.max(0, Math.min(100, tpos));
        if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
        if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, String(pos));
      }
      break;
    }

    case WM_DESTROY:
      // Kill timer and delete font here (owned by this window).
      // The callback and DLLs MUST stay alive: the message loop is still
      // dispatching, and we're executing inside the WNDPROC closure right now.
      if (progressTimerId) {
        user32.KillTimer(hwnd, ID_PROGRESS_TIMER);
        progressTimerId = null;
      }
      if (hFont) {
        gdi32.DeleteObject(hFont);
        hFont = null;
      }
      user32.PostQuitMessage(0);
      return 0;
  }
  // Cases that `break` fall through here and still need default processing
  // (e.g. WM_SIZE, WM_NOTIFY). Without this, title-bar / system commands stop
  // working after the first child-control interaction.
  return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
}

async function createControlsDemo() {
  console.log("Creating Windows Controls Demo...");

  const className = "WindowsControlsDemoClass";
  const windowClass = new WNDCLASSEX();
  windowClass.cbSize = sizeof(WNDCLASSEX);
  windowClass.style = 0;
  hInstance = kernel32.GetModuleHandleW(null);
  windowClass.hInstance = hInstance;
  windowClass.hIcon = null;
  windowClass.hCursor = user32.LoadCursorW(null, 32512);
  windowClass.hbrBackground = 16; // COLOR_WINDOW + 1
  windowClass.lpszMenuName = null;
  windowClass.lpszClassName = className;
  // Python idiom: WNDPROC(fn) wraps JS function as a stdcall callback
  windowProcCallback = WNDPROC(WindowProc);
  windowClass.lpfnWndProc = windowProcCallback.pointer;

  // Register and create window
  const atom = user32.RegisterClassExW(byref(windowClass));
  if (!atom) throw new Error("RegisterClassExW failed: " + atom);

  const baseW = 1000;
  const baseH = 700;
  const hwnd = user32.CreateWindowExW(0, className, "Windows Controls Showcase Demo", WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT, baseW, baseH, null, null, hInstance, null);
  if (!hwnd) throw new Error("CreateWindowExW failed");
  hwndMain = hwnd;

  // Create group boxes and controls (layout is simple and fixed)
  const gbButtonsH = 140;
  const gbX = 20;
  const gbY = 20;
  const gbW = 460;
  hwndGroupBox = user32.CreateWindowExW(0, "BUTTON", "Buttons", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbY, gbW, gbButtonsH, hwnd, 3000, hInstance, null);

  // Buttons
  hwndButton1 = user32.CreateWindowExW(0, "BUTTON", "Push", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 14, gbY + 26, 100, 28, hwnd, ID_BUTTON1, hInstance, null);
  hwndButton2 = user32.CreateWindowExW(0, "BUTTON", "Default", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 124, gbY + 26, 100, 28, hwnd, ID_BUTTON2, hInstance, null);
  hwndToggle = user32.CreateWindowExW(0, "BUTTON", "Hide", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 234, gbY + 26, 100, 28, hwnd, ID_TOGGLE_WINDOW, hInstance, null);
  hwndCounter = user32.CreateWindowExW(0, "BUTTON", "Count: 0", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 344, gbY + 26, 100, 28, hwnd, ID_COUNTER, hInstance, null);

  // Text input group
  const gbTextY = gbY + gbButtonsH + 16;
  hwndTextGroupBox = user32.CreateWindowExW(0, "BUTTON", "Text Input", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbTextY, gbW, 90, hwnd, 3001, hInstance, null);
  hwndTextInput = user32.CreateWindowExW(0, "EDIT", "", WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL, gbX + 12, gbTextY + 24, gbW - 24, 28, hwnd, ID_TEXT_INPUT, hInstance, null);

  // Options (checkbox + radios)
  const gbOptionsY = gbTextY + 90 + 16;
  hwndOptionsGroupBox = user32.CreateWindowExW(0, "BUTTON", "Options", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbOptionsY, gbW, 120, hwnd, 3002, hInstance, null);
  hwndCheckbox = user32.CreateWindowExW(0, "BUTTON", "Enable feature", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX | WS_TABSTOP, gbX + 12, gbOptionsY + 28, 160, 24, hwnd, ID_CHECKBOX, hInstance, null);
  hwndRadio1 = user32.CreateWindowExW(0, "BUTTON", "Choice A", WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON | WS_TABSTOP, gbX + 12, gbOptionsY + 56, 120, 24, hwnd, ID_RADIO1, hInstance, null);
  hwndRadio2 = user32.CreateWindowExW(0, "BUTTON", "Choice B", WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON | WS_TABSTOP, gbX + 140, gbOptionsY + 56, 120, 24, hwnd, ID_RADIO2, hInstance, null);

  // Combobox and listbox on the right
  const rightX = gbX + gbW + 20;
  const rightW = 440;
  hwndComboGroupBox = user32.CreateWindowExW(0, "BUTTON", "Combo / List", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY, rightW, 180, hwnd, 3003, hInstance, null);
  hwndCombobox = user32.CreateWindowExW(0, "COMBOBOX", null, WS_CHILD | WS_VISIBLE | CBS_DROPDOWN | CBS_HASSTRINGS | WS_TABSTOP, rightX + 12, gbY + 28, rightW - 24, 300, hwnd, ID_COMBOBOX, hInstance, null);
  // populate combobox
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("First option"));
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("Second option"));
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("Third option"));
  user32.SendMessageW(hwndCombobox, CB_SETCURSEL, 0, 0);

  hwndListGroupBox = user32.CreateWindowExW(0, "BUTTON", "List Box", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY + 200, rightW, 220, hwnd, 3004, hInstance, null);
  hwndListBox = user32.CreateWindowExW(0, "LISTBOX", null, WS_CHILD | WS_VISIBLE | LBS_NOTIFY | LBS_SORT | LBS_HASSTRINGS | WS_TABSTOP, rightX + 12, gbY + 224, rightW - 24, 180, hwnd, ID_LISTBOX, hInstance, null);
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item A"));
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item B"));
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item C"));

  // Progress bar
  hwndProgressGroupBox = user32.CreateWindowExW(0, "BUTTON", "Progress", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY + 440, rightW, 80, hwnd, 3005, hInstance, null);
  // create a smooth progress bar
  hwndProgressBar = user32.CreateWindowExW(0, "msctls_progress32", null, WS_CHILD | WS_VISIBLE | PBS_SMOOTH, rightX + 12, gbY + 468, rightW - 24, 20, hwnd, ID_PROGRESSBAR, hInstance, null);
  // set a clear 0..100 range and initial position using PBM_SETRANGE32
  user32.SendMessageW(hwndProgressBar, PBM_SETRANGE32, 0, 100);
  user32.SendMessageW(hwndProgressBar, PBM_SETPOS, 0, 0);

  // Trackbar (slider) below the progress bar area
  const trackY = gbY + 530;
  const trackH = 54;
  const hwndTrackGroup = user32.CreateWindowExW(0, "BUTTON", "Trackbar", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, trackY, gbW, trackH, hwnd, 3006, hInstance, null);
  hwndTrack = user32.CreateWindowExW(0, "msctls_trackbar32", null, WS_CHILD | WS_VISIBLE | WS_TABSTOP, gbX + 12, trackY + 18, gbW - 24, 24, hwnd, ID_TRACKBAR, hInstance, null);
  // lParam = MAKELONG(min, max) -> (max<<16)|min
  user32.SendMessageW(hwndTrack, TBM_SETRANGE, 0, MAKELONG(0, 100));
  // TBM_SETPOS: wParam = bRedraw (TRUE), lParam = position
  user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, 0);

  // Up-Down (spin) with numeric edit
  // place spin group below the Options group to avoid overlap
  const spinY = gbOptionsY + 120 + 16;
  const hwndSpinGroup = user32.CreateWindowExW(0, "BUTTON", "Spin / Numeric", WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, spinY, 220, 80, hwnd, 3007, hInstance, null);
  // small edit to display the spin value
  hwndSpinEdit = user32.CreateWindowExW(WS_EX_CLIENTEDGE, "EDIT", "", WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL, gbX + 12, spinY + 26, 80, 24, hwnd, ID_SPIN_EDIT, hInstance, null);
  // create up-down control (msctls_updown32) to the right of edit
  // create up-down control with buddy behavior and arrow keys
  const udStyles = UDS_AUTOBUDDY | UDS_SETBUDDYINT | UDS_ALIGNRIGHT | UDS_ARROWKEYS;
  hwndSpin = user32.CreateWindowExW(0, "msctls_updown32", null, WS_CHILD | WS_VISIBLE | udStyles, gbX + 96, spinY + 26, 16, 24, hwnd, ID_SPIN, hInstance, null);
  // UDM_SETRANGE32: wParam = nMin, lParam = nMax
  user32.SendMessageW(hwndSpin, UDM_SETRANGE32, 0, 100);
  // UDM_SETPOS32: wParam = 0, lParam = position
  user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, 0);
  // explicitly set the buddy edit control for the up-down so it can update it
  user32.SendMessageW(hwndSpin, UDM_SETBUDDY, hwndSpinEdit, 0);

  // ToolTip (unicode) for a few controls
  hwndTooltip = user32.CreateWindowExW(0, "tooltips_class32", null, WS_CHILD | TTS_ALWAYSTIP, 0, 0, 0, 0, hwnd, ID_TOOLTIP, hInstance, null);
  user32.SendMessageW(hwndTooltip, TTM_SETMAXTIPWIDTH, 0, 300);

  // helper to register a tooltip for a control using TOOLINFOW
  function addTooltipForControl(targetHwnd, text) {
    if (!hwndTooltip || !targetHwnd) return;
    const ti = new TOOLINFOW();
    ti.cbSize = sizeof(TOOLINFOW);
    ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    ti.hwnd = hwnd;
    ti.uId = targetHwnd;
    ti.hinst = null;
    // LPWSTR (c_wchar_p) field: plain JS string auto-converts to a wide-char
    // buffer and is kept alive on `ti` for the duration of this call (Python
    // ctypes `_objects` parity). Windows copies the text during TTM_ADDTOOLW.
    ti.lpszText = text;
    user32.SendMessageW(hwndTooltip, TTM_ADDTOOLW, 0, byref(ti));
  }

  // Font
  createScaledFont();
  [
    hwndGroupBox,
    hwndButton1,
    hwndButton2,
    hwndToggle,
    hwndCounter,
    hwndTextGroupBox,
    hwndTextInput,
    hwndOptionsGroupBox,
    hwndCheckbox,
    hwndRadio1,
    hwndRadio2,
    hwndComboGroupBox,
    hwndCombobox,
    hwndListGroupBox,
    hwndListBox,
    hwndProgressGroupBox,
    hwndProgressBar,
    hwndTrack,
    hwndSpin,
    hwndSpinEdit,
  ].forEach(applyFont);

  // Start progress timer and keep its handle for cleanup
  progressTimerId = user32.SetTimer(hwnd, ID_PROGRESS_TIMER, 1000, null);

  // Compute content height precisely by mapping each child rect into client coords
  const rcClient = new RECT();
  user32.GetClientRect(hwnd, byref(rcClient));
  __clientHeight = Number(rcClient.bottom) - Number(rcClient.top);

  const children = [
    hwndGroupBox,
    hwndButton1,
    hwndButton2,
    hwndToggle,
    hwndCounter,
    hwndTextGroupBox,
    hwndTextInput,
    hwndOptionsGroupBox,
    hwndCheckbox,
    hwndRadio1,
    hwndRadio2,
    hwndComboGroupBox,
    hwndCombobox,
    hwndListGroupBox,
    hwndListBox,
    hwndProgressGroupBox,
    hwndProgressBar,
    hwndTrack,
    hwndSpin,
    hwndSpinEdit,
  ];

  let maxBottom = 0;
  for (const h of children) {
    if (!h) continue;
    const rc = new RECT();
    user32.GetWindowRect(h, byref(rc));
    user32.MapWindowPoints(null, hwnd, byref(rc), 2);
    const bottom = Number(rc.bottom);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  __contentHeight = Math.max(__clientHeight, maxBottom + 16);

  const siInit = new SCROLLINFO();
  siInit.cbSize = sizeof(SCROLLINFO);
  siInit.fMask = SIF_RANGE | SIF_PAGE | SIF_POS;
  siInit.nMin = 0;
  siInit.nMax = Math.max(0, __contentHeight - 1);
  siInit.nPage = __clientHeight;
  siInit.nPos = __scrollY;
  user32.SetScrollInfo(hwnd, SB_VERT, byref(siInit), 1);

  user32.ShowWindow(hwnd, SW_SHOW);
  user32.UpdateWindow(hwnd);

  addTooltipForControl(hwndButton1, "Push button 1 — performs action A");
  addTooltipForControl(hwndToggle, "Toggle window (minimize/restore)");
  addTooltipForControl(hwndTrack, "Trackbar — controls progress bar value");
  addTooltipForControl(hwndSpinEdit, "Spin control — numeric value with up/down");
  addTooltipForControl(hwndTextInput, "Text input — type here to trigger EN_CHANGE events");

  // Message loop. GetMessageW returns BOOL (c_long → BigInt); using the value
  // directly as a truthy test is the Python-ctypes idiom (`while GetMessage(...)`):
  // 0n is falsy (WM_QUIT), 1n is truthy, and -1n (error) is also truthy so errors
  // break out via the inner logic if ever extended.
  const msg = new MSG();
  while (user32.GetMessageW(byref(msg), null, 0, 0)) {
    user32.TranslateMessage(byref(msg));
    user32.DispatchMessageW(byref(msg));
  }
  console.log("Message loop ended");

  // Post-loop cleanup (safe: no more dispatch into the callback).
  if (windowProcCallback) {
    windowProcCallback.release();
    windowProcCallback = null;
  }
  user32.close();
  kernel32.close();
  comctl32.close();
  gdi32.close();
}

createControlsDemo().catch((err) => {
  console.error(err);
});
