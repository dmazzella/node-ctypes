// Windows Controls Showcase Demo
// A compact demo that creates a window with a wide set of common Win32 controls

import { WinDLL, Structure, create_unicode_buffer, byref, c_short, c_int, c_uint, c_long, c_void, c_void_p } from "node-ctypes";

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

// Define function signatures (Python-like argtypes/restype syntax)
user32.RegisterClassExW.argtypes = [c_void_p];
user32.RegisterClassExW.restype = c_short;

user32.CreateWindowExW.argtypes = [c_uint, c_void_p, c_void_p, c_uint, c_int, c_int, c_int, c_int, c_void_p, c_void_p, c_void_p, c_void_p];
user32.CreateWindowExW.restype = c_void_p;

user32.ShowWindow.argtypes = [c_void_p, c_int];
user32.ShowWindow.restype = c_int;

user32.UpdateWindow.argtypes = [c_void_p];
user32.UpdateWindow.restype = c_int;

user32.InvalidateRect.argtypes = [c_void_p, c_void_p, c_int];
user32.InvalidateRect.restype = c_int;

user32.RedrawWindow.argtypes = [c_void_p, c_void_p, c_void_p, c_uint];
user32.RedrawWindow.restype = c_int;

user32.GetMessageW.argtypes = [c_void_p, c_void_p, c_uint, c_uint];
user32.GetMessageW.restype = c_int;

user32.TranslateMessage.argtypes = [c_void_p];
user32.TranslateMessage.restype = c_int;

user32.DispatchMessageW.argtypes = [c_void_p];
user32.DispatchMessageW.restype = c_void_p;

user32.DefWindowProcW.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
user32.DefWindowProcW.restype = c_void_p;

user32.PostQuitMessage.argtypes = [c_int];
user32.PostQuitMessage.restype = c_void;

user32.LoadCursorW.argtypes = [c_void_p, c_uint];
user32.LoadCursorW.restype = c_void_p;

kernel32.GetModuleHandleW.argtypes = [c_void_p];
kernel32.GetModuleHandleW.restype = c_void_p;

user32.SetWindowTextW.argtypes = [c_void_p, c_void_p];
user32.SetWindowTextW.restype = c_int;

user32.GetDlgItem.argtypes = [c_void_p, c_int];
user32.GetDlgItem.restype = c_void_p;

user32.GetWindowTextW.argtypes = [c_void_p, c_void_p, c_int];
user32.GetWindowTextW.restype = c_int;

user32.GetClientRect.argtypes = [c_void_p, c_void_p];
user32.GetClientRect.restype = c_int;

user32.GetWindowRect.argtypes = [c_void_p, c_void_p];
user32.GetWindowRect.restype = c_int;

user32.MapWindowPoints.argtypes = [c_void_p, c_void_p, c_void_p, c_uint];
user32.MapWindowPoints.restype = c_int;

user32.SetScrollInfo.argtypes = [c_void_p, c_int, c_void_p, c_int];
user32.SetScrollInfo.restype = c_int;

user32.ScrollWindow.argtypes = [c_void_p, c_int, c_int, c_void_p, c_void_p];
user32.ScrollWindow.restype = c_int;

user32.MoveWindow.argtypes = [c_void_p, c_int, c_int, c_int, c_int, c_int];
user32.MoveWindow.restype = c_int;

user32.BeginDeferWindowPos.argtypes = [c_int];
user32.BeginDeferWindowPos.restype = c_void_p;

user32.DeferWindowPos.argtypes = [c_void_p, c_void_p, c_void_p, c_int, c_int, c_int, c_int, c_uint];
user32.DeferWindowPos.restype = c_void_p;

user32.EndDeferWindowPos.argtypes = [c_void_p];
user32.EndDeferWindowPos.restype = c_int;

user32.SendMessageW.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
user32.SendMessageW.restype = c_long;

user32.PostMessageW.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
user32.PostMessageW.restype = c_int;

user32.SetTimer.argtypes = [c_void_p, c_uint, c_uint, c_void_p];
user32.SetTimer.restype = c_void_p;

user32.KillTimer.argtypes = [c_void_p, c_uint];
user32.KillTimer.restype = c_void;

user32.IsIconic.argtypes = [c_void_p];
user32.IsIconic.restype = c_int;

user32.IsZoomed.argtypes = [c_void_p];
user32.IsZoomed.restype = c_int;

gdi32.CreateFontW.argtypes = [c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_void_p];
gdi32.CreateFontW.restype = c_void_p;

gdi32.DeleteObject.argtypes = [c_void_p];
gdi32.DeleteObject.restype = c_int;

// helper to copy memory from a pointer into a local buffer/struct
try {
  kernel32.RtlMoveMemory.argtypes = [c_void_p, c_void_p, c_uint];
  kernel32.RtlMoveMemory.restype = c_void;
} catch (e) {}

// Initialize common controls (comctl32)
try {
  comctl32.InitCommonControls.argtypes = [];
  comctl32.InitCommonControls.restype = c_void;
  comctl32.InitCommonControls();
} catch (e) {}

// Prefer InitCommonControlsEx for specific control classes
try {
  comctl32.InitCommonControlsEx.argtypes = [c_void_p];
  comctl32.InitCommonControlsEx.restype = c_int;
} catch (e) {}

const ICC_PROGRESS_CLASS = 0x00002000;
const ICC_BAR_CLASSES = 0x00000004;
const ICC_UPDOWN_CLASS = 0x00000040;
const ICC_TRACKBAR_CLASSES = 0x00000001;

class INITCOMMONCONTROLSEX extends Structure {
  static _fields_ = [
    ["dwSize", c_uint],
    ["dwICC", c_uint],
  ];
}

try {
  if (InitCommonControlsEx) {
    const icex = new comctl32.InitCommonControlsEx();
    icex.dwSize = INITCOMMONCONTROLSEX.size;
    icex.dwICC = ICC_BAR_CLASSES | ICC_PROGRESS_CLASS | ICC_UPDOWN_CLASS | ICC_TRACKBAR_CLASSES;
    // Call InitCommonControlsEx early to register control classes before creating windows
    comctl32.InitCommonControlsEx(byref(icex));
  }
} catch (e) {}

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

// We'll need CreateWindowExW already available; SendMessageW used for TB/UD messages

// Windows structures (Python-like syntax)
class POINT extends Structure {
  static _fields_ = [
    ["x", c_long],
    ["y", c_long],
  ];
}

class WNDCLASSEX extends Structure {
  static _fields_ = [
    ["cbSize", c_uint],
    ["style", c_uint],
    ["lpfnWndProc", c_void_p],
    ["cbClsExtra", c_int],
    ["cbWndExtra", c_int],
    ["hInstance", c_void_p],
    ["hIcon", c_void_p],
    ["hCursor", c_void_p],
    ["hbrBackground", c_void_p],
    ["lpszMenuName", c_void_p],
    ["lpszClassName", c_void_p],
    ["hIconSm", c_void_p],
  ];
}

class MSG extends Structure {
  static _fields_ = [
    ["hwnd", c_void_p],
    ["message", c_uint],
    ["wParam", c_void_p],
    ["lParam", c_void_p],
    ["time", c_uint],
    ["pt", POINT],
  ];
}

class RECT extends Structure {
  static _fields_ = [
    ["left", c_long],
    ["top", c_long],
    ["right", c_long],
    ["bottom", c_long],
  ];
}

class SCROLLINFO extends Structure {
  static _fields_ = [
    ["cbSize", c_uint],
    ["fMask", c_uint],
    ["nMin", c_int],
    ["nMax", c_int],
    ["nPage", c_uint],
    ["nPos", c_int],
    ["nTrackPos", c_int],
  ];
}

class TOOLINFOW extends Structure {
  static _fields_ = [
    ["cbSize", c_uint],
    ["uFlags", c_uint],
    ["hwnd", c_void_p],
    ["uId", c_void_p],
    ["rect", RECT],
    ["hinst", c_void_p],
    ["lpszText", c_void_p],
    ["lParam", c_void_p],
  ];
}

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

function log(...args) {
  try {
    console.log(...args);
  } catch (e) {}
}

function createScaledFont() {
  if (hFont) gdi32.DeleteObject(hFont);
  // Fixed comfortable font
  const fontHeight = 24;
  hFont = gdi32.CreateFontW(fontHeight, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 1, 0, create_unicode_buffer("Segoe UI"));
  return hFont;
}

function applyFont(hwnd) {
  if (hFont && hwnd) {
    user32.SendMessageW(hwnd, WM_SETFONT, hFont, 1);
  }
}

function WindowProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_SIZE:
      try {
        const rc = new RECT();
        user32.GetClientRect(hwnd, byref(rc));
        __clientHeight = Number(rc.bottom) - Number(rc.top);
        // update scrollinfo
        const si = new SCROLLINFO();
        si.cbSize = SCROLLINFO.size;
        si.fMask = SIF_RANGE | SIF_PAGE | SIF_POS;
        si.nMin = 0;
        si.nMax = Math.max(0, __contentHeight - 1);
        si.nPage = __clientHeight;
        si.nPos = __scrollY;
        user32.SetScrollInfo(hwnd, SB_VERT, byref(si), 1);
      } catch (e) {}
      break;
    case WM_VSCROLL:
      try {
        const code = Number(wParam) & 0xffff;
        let delta = 0;
        if (code === SB_LINEUP) delta = -20;
        else if (code === SB_LINEDOWN) delta = 20;
        else if (code === SB_PAGEUP) delta = -__clientHeight;
        else if (code === SB_PAGEDOWN) delta = __clientHeight;
        else if (code === SB_THUMBTRACK || code === SB_THUMBPOSITION) {
          // position is in HIWORD(wParam)
          let newPos = (Number(wParam) >> 16) & 0xffff;
          if (newPos & 0x8000) newPos = newPos - 0x10000;
          delta = newPos - __scrollY;
        }
        if (delta !== 0) {
          const newY = Math.max(0, Math.min(__scrollY + delta, Math.max(0, __contentHeight - __clientHeight)));
          const scrollBy = newY - __scrollY;
          if (scrollBy !== 0) {
            __scrollY = newY;
            // positive scrollBy means move content up, so scroll by -scrollBy
            user32.ScrollWindow(hwnd, 0, -scrollBy, null, null);
            // update scrollinfo position
            const si2 = new SCROLLINFO();
            si2.cbSize = SCROLLINFO.size;
            si2.fMask = SIF_POS;
            si2.nPos = __scrollY;
            user32.SetScrollInfo(hwnd, SB_VERT, byref(si2), 1);
          }
        }
      } catch (e) {}
      return 0n;
    case WM_MOUSEWHEEL:
      try {
        // wheel delta in HIWORD of wParam, signed short
        let delta = (Number(wParam) >> 16) & 0xffff;
        if (delta & 0x8000) delta = delta - 0x10000;
        // scroll about 50 pixels per notch
        const scrollPixels = Math.round((delta / 120) * 50);
        const newY = Math.max(0, Math.min(__contentHeight - __clientHeight, __scrollY - scrollPixels));
        const scrollBy = newY - __scrollY;
        if (scrollBy !== 0) {
          __scrollY = newY;
          user32.ScrollWindow(hwnd, 0, -scrollBy, null, null);
          const si3 = new SCROLLINFO();
          si3.cbSize = SCROLLINFO.size;
          si3.fMask = SIF_POS;
          si3.nPos = __scrollY;
          user32.SetScrollInfo(hwnd, SB_VERT, byref(si3), 1);
        }
      } catch (e) {}
      return 0n;
    case WM_HSCROLL:
      // Trackbar sends WM_HSCROLL when value changes
      if (isUpdatingSpin) return 0n; // Prevent re-entrancy
      try {
        const lpNum = BigInt(lParam || 0);
        const tkNum = BigInt(hwndTrack || 0);
        if (lpNum !== 0n && tkNum !== 0n && lpNum === tkNum) {
          const tpos = Number(user32.SendMessageW(hwndTrack, TBM_GETPOS, 0, 0) || 0);
          const pos = Math.max(0, Math.min(100, tpos));
          if (pos !== lastSpinPos) {
            isUpdatingSpin = true;
            lastSpinPos = pos;
            if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
            if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, create_unicode_buffer(String(pos)));
            isUpdatingSpin = false;
          }
        }
      } catch (e) {
        isUpdatingSpin = false;
      }
      return 0n;
    case WM_COMMAND:
      {
        const controlId = Number(wParam) & 0xffff;
        const notification = (Number(wParam) >> 16) & 0xffff;
        switch (controlId) {
          case ID_BUTTON1:
            log("Button 1 clicked");
            break;
          case ID_BUTTON2:
            log("Button 2 clicked");
            break;
          case ID_TOGGLE_WINDOW:
            {
              // If window is minimized, restore/maximize; if normal, minimize; if maximized, restore
              const isMin = user32.IsIconic(hwndMain);
              const isMax = user32.IsZoomed(hwndMain);
              if (isMin) {
                // Restore (use SW_RESTORE)
                user32.ShowWindow(hwndMain, SW_RESTORE);
                log("Window restored from minimized state");
              } else if (isMax) {
                // If currently maximized, restore
                user32.ShowWindow(hwndMain, SW_RESTORE);
                log("Window restored from maximized state");
              } else {
                // Minimize
                user32.ShowWindow(hwndMain, SW_MINIMIZE);
                log("Window minimized");
              }
            }
            break;
          case ID_COUNTER:
            counter += 1;
            log("Counter incremented to:", counter);
            try {
              const text = create_unicode_buffer("Count: " + counter);
              // prefer using the known hwndCounter handle
              if (hwndCounter) user32.SetWindowTextW(hwndCounter, text);
              else user32.SetWindowTextW(user32.GetDlgItem(hwndMain, ID_COUNTER), text);
            } catch (e) {}
            break;
          case ID_CHECKBOX:
            // toggle checkbox state
            {
              const state = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_CHECKBOX), BM_GETCHECK, 0, 0);
              log("Checkbox raw state:", state);
            }
            break;
          case ID_RADIO1:
            log("Radio 1 selected");
            break;
          case ID_RADIO2:
            log("Radio 2 selected");
            break;
          case ID_COMBOBOX:
            if (notification === CBN_SELCHANGE) {
              const sel = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_COMBOBOX), CB_GETCURSEL, 0, 0);
              log("Combobox selection index:", Number(sel));
            }
            break;
          case ID_TEXT_INPUT:
            if (notification === EN_CHANGE) {
              try {
                const textControl = user32.GetDlgItem(hwndMain, ID_TEXT_INPUT);
                const buf = create_unicode_buffer(256);
                const len = user32.GetWindowTextW(textControl, buf, 256);
                if (len > 0) {
                  // buffer is UTF-16LE
                  const text = buf.toString("ucs2", 0, Number(len) * 2);
                  log("Text input changed:", text);
                } else {
                  log("Text input cleared");
                }
              } catch (e) {}
            }
            break;
          case ID_SPIN_EDIT:
            if (notification === EN_CHANGE && !isUpdatingSpin) {
              try {
                const hEdit = user32.GetDlgItem(hwndMain, ID_SPIN_EDIT);
                const buf = create_unicode_buffer(64);
                const len = user32.GetWindowTextW(hEdit, buf, 64);
                let text = "";
                if (len > 0) text = buf.toString("ucs2", 0, Number(len) * 2);
                let num = parseInt(text, 10);
                if (Number.isNaN(num)) num = 0;
                num = Math.max(0, Math.min(100, num));
                // Only update if value actually changed
                if (num !== lastSpinPos) {
                  isUpdatingSpin = true;
                  lastSpinPos = num;
                  // update spin internal state and trackbar to keep everything in sync
                  if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, num);
                  if (hwndTrack) user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, num);
                  isUpdatingSpin = false;
                }
              } catch (e) {
                isUpdatingSpin = false;
              }
            }
            break;
          case ID_LISTBOX:
            if (notification === LBN_SELCHANGE) {
              const selIndex = user32.SendMessageW(user32.GetDlgItem(hwndMain, ID_LISTBOX), LB_GETCURSEL, 0, 0);
              log("Listbox selection index:", Number(selIndex));
            }
            break;
        }
      }
      return 0n;
    case WM_TIMER: {
      try {
        // keep timer simple: advance progress only
        progressPos += 1;
        if (progressPos > 100) progressPos = 0;

        try {
          // set range (MAKELPARAM style) and set position (wParam=bRedraw, lParam=pos for some wrappers)
          user32.SendMessageW(hwndProgressBar, PBM_SETRANGE, 0, (100 << 16) | 0);
          user32.SendMessageW(hwndProgressBar, PBM_SETPOS, progressPos, 0);
        } catch (e) {}

        // force immediate redraw
        try {
          user32.InvalidateRect(hwndProgressBar, 0, 1);
        } catch (e) {}
        try {
          user32.UpdateWindow(hwndProgressBar);
        } catch (e) {}
        try {
          user32.RedrawWindow(hwndProgressBar, 0, 0, 0x85);
        } catch (e) {}
      } catch (e) {
        console.error("WM_TIMER error", e);
      }
      return 0n;
    }
    case WM_NOTIFY:
      try {
        const ctrlId = Number(wParam) & 0xffff;
        // Handle spin control notifications
        if (ctrlId === ID_SPIN) {
          let pos = Number(user32.SendMessageW(hwndSpin, UDM_GETPOS32, 0, 0) || 0);
          // Fallback to reading buddy edit if needed
          if (!pos && hwndSpinEdit) {
            const buf = create_unicode_buffer(64);
            const len = user32.GetWindowTextW(hwndSpinEdit, buf, 64);
            if (len > 0) pos = parseInt(buf.toString("ucs2", 0, Number(len) * 2), 10) || 0;
          }
          pos = Math.max(0, Math.min(100, pos));
          if (pos !== lastSpinPos) {
            lastSpinPos = pos;
            if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, create_unicode_buffer(String(pos)));
            if (hwndTrack) user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, pos);
            if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
          }
        }
        // Handle trackbar notifications
        if (ctrlId === ID_TRACKBAR) {
          const tpos = Number(user32.SendMessageW(hwndTrack, TBM_GETPOS, 0, 0) || 0);
          const pos = Math.max(0, Math.min(100, tpos));
          if (hwndSpin) user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, pos);
          if (hwndSpinEdit) user32.SetWindowTextW(hwndSpinEdit, create_unicode_buffer(String(pos)));
        }
      } catch (e) {}
      break;

    case WM_DESTROY:
      // Cleanup resources: kill timer, delete font, release callback, close libraries
      try {
        if (globalThis.__windowsControlsTimer) {
          user32.KillTimer(hwnd, ID_PROGRESS_TIMER);
          globalThis.__windowsControlsTimer = null;
        }
      } catch (e) {}
      try {
        if (hFont) {
          gdi32.DeleteObject(hFont);
          hFont = null;
        }
      } catch (e) {}
      try {
        if (windowProcCallback && typeof windowProcCallback.release === "function") {
          windowProcCallback.release();
        } else if (windowProcCallback && windowProcCallback._callback && typeof windowProcCallback._callback.release === "function") {
          windowProcCallback._callback.release();
        }
      } catch (e) {}
      // Call PostQuitMessage BEFORE closing libraries
      user32.PostQuitMessage(0);
      try {
        if (user32 && typeof user32.close === "function") user32.close();
        if (kernel32 && typeof kernel32.close === "function") kernel32.close();
        if (comctl32 && typeof comctl32.close === "function") comctl32.close();
        if (gdi32 && typeof gdi32.close === "function") gdi32.close();
      } catch (e) {}
      return 0n;
    default:
      return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

async function createControlsDemo() {
  log("Creating Windows Controls Demo...");

  const className = create_unicode_buffer("WindowsControlsDemoClass");
  const windowClass = new WNDCLASSEX();
  windowClass.cbSize = WNDCLASSEX.size;
  windowClass.style = 0;
  hInstance = kernel32.GetModuleHandleW(null);
  windowClass.hInstance = hInstance;
  windowClass.hIcon = null;
  windowClass.hCursor = user32.LoadCursorW(null, 32512);
  windowClass.hbrBackground = 16; // COLOR_WINDOW + 1
  windowClass.lpszMenuName = null;
  windowClass.lpszClassName = className;
  windowProcCallback = user32.callback(WindowProc, c_void_p, [c_void_p, c_uint, c_void_p, c_void_p]);
  windowClass.lpfnWndProc = windowProcCallback.pointer;

  // Register and create window
  const atom = user32.RegisterClassExW(byref(windowClass));
  if (!atom) throw new Error("RegisterClassExW failed: " + atom);

  const windowTitle = create_unicode_buffer("Windows Controls Showcase Demo");
  const baseW = 1000;
  const baseH = 700;
  const hwnd = user32.CreateWindowExW(0, className, windowTitle, WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT, baseW, baseH, null, null, hInstance, null);
  if (!hwnd) throw new Error("CreateWindowExW failed");
  hwndMain = hwnd;

  // Create group boxes and controls (layout is simple and fixed)
  const gbButtons = create_unicode_buffer("Buttons");
  const gbButtonsH = 140;
  const gbX = 20;
  const gbY = 20;
  const gbW = 460;
  hwndGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbButtons, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbY, gbW, gbButtonsH, hwnd, 3000, hInstance, null);

  // Buttons
  const b1 = create_unicode_buffer("Push");
  hwndButton1 = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), b1, WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 14, gbY + 26, 100, 28, hwnd, ID_BUTTON1, hInstance, null);
  const b2 = create_unicode_buffer("Default");
  hwndButton2 = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), b2, WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 124, gbY + 26, 100, 28, hwnd, ID_BUTTON2, hInstance, null);
  const toggle = create_unicode_buffer("Hide");
  hwndToggle = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), toggle, WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 234, gbY + 26, 100, 28, hwnd, ID_TOGGLE_WINDOW, hInstance, null);
  const counterBtn = create_unicode_buffer("Count: 0");
  hwndCounter = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), counterBtn, WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | WS_TABSTOP, gbX + 344, gbY + 26, 100, 28, hwnd, ID_COUNTER, hInstance, null);

  // Text input group
  const gbText = create_unicode_buffer("Text Input");
  const gbTextY = gbY + gbButtonsH + 16;
  hwndTextGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbText, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbTextY, gbW, 90, hwnd, 3001, hInstance, null);
  hwndTextInput = user32.CreateWindowExW(0, create_unicode_buffer("EDIT"), create_unicode_buffer(""), WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL, gbX + 12, gbTextY + 24, gbW - 24, 28, hwnd, ID_TEXT_INPUT, hInstance, null);

  // Options (checkbox + radios)
  const gbOptions = create_unicode_buffer("Options");
  const gbOptionsY = gbTextY + 90 + 16;
  hwndOptionsGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbOptions, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, gbOptionsY, gbW, 120, hwnd, 3002, hInstance, null);
  hwndCheckbox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), create_unicode_buffer("Enable feature"), WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX | WS_TABSTOP, gbX + 12, gbOptionsY + 28, 160, 24, hwnd, ID_CHECKBOX, hInstance, null);
  hwndRadio1 = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), create_unicode_buffer("Choice A"), WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON | WS_TABSTOP, gbX + 12, gbOptionsY + 56, 120, 24, hwnd, ID_RADIO1, hInstance, null);
  hwndRadio2 = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), create_unicode_buffer("Choice B"), WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON | WS_TABSTOP, gbX + 140, gbOptionsY + 56, 120, 24, hwnd, ID_RADIO2, hInstance, null);

  // Combobox and listbox on the right
  const rightX = gbX + gbW + 20;
  const rightW = 440;
  const gbCombo = create_unicode_buffer("Combo / List");
  hwndComboGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbCombo, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY, rightW, 180, hwnd, 3003, hInstance, null);
  hwndCombobox = user32.CreateWindowExW(0, create_unicode_buffer("COMBOBOX"), null, WS_CHILD | WS_VISIBLE | CBS_DROPDOWN | CBS_HASSTRINGS | WS_TABSTOP, rightX + 12, gbY + 28, rightW - 24, 300, hwnd, ID_COMBOBOX, hInstance, null);
  // populate combobox
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("First option"));
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("Second option"));
  user32.SendMessageW(hwndCombobox, CB_ADDSTRING, 0, create_unicode_buffer("Third option"));
  user32.SendMessageW(hwndCombobox, CB_SETCURSEL, 0, 0);

  const gbList = create_unicode_buffer("List Box");
  hwndListGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbList, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY + 200, rightW, 220, hwnd, 3004, hInstance, null);
  hwndListBox = user32.CreateWindowExW(0, create_unicode_buffer("LISTBOX"), null, WS_CHILD | WS_VISIBLE | LBS_NOTIFY | LBS_SORT | LBS_HASSTRINGS | WS_TABSTOP, rightX + 12, gbY + 224, rightW - 24, 180, hwnd, ID_LISTBOX, hInstance, null);
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item A"));
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item B"));
  user32.SendMessageW(hwndListBox, LB_ADDSTRING, 0, create_unicode_buffer("Item C"));

  // Progress bar
  const gbProg = create_unicode_buffer("Progress");
  hwndProgressGroupBox = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbProg, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, rightX, gbY + 440, rightW, 80, hwnd, 3005, hInstance, null);
  // create a smooth progress bar
  hwndProgressBar = user32.CreateWindowExW(0, create_unicode_buffer("msctls_progress32"), null, WS_CHILD | WS_VISIBLE | PBS_SMOOTH, rightX + 12, gbY + 468, rightW - 24, 20, hwnd, ID_PROGRESSBAR, hInstance, null);
  // set a clear 0..100 range and initial position using PBM_SETRANGE32
  try {
    user32.SendMessageW(hwndProgressBar, PBM_SETRANGE32, 0, 100);
    user32.SendMessageW(hwndProgressBar, PBM_SETPOS, 0, 0);
  } catch (e) {}

  // Trackbar (slider) below the progress bar area
  const gbTrack = create_unicode_buffer("Trackbar");
  const trackY = gbY + 530;
  const trackH = 54;
  const hwndTrackGroup = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbTrack, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, trackY, gbW, trackH, hwnd, 3006, hInstance, null);
  hwndTrack = user32.CreateWindowExW(0, create_unicode_buffer("msctls_trackbar32"), null, WS_CHILD | WS_VISIBLE | WS_TABSTOP, gbX + 12, trackY + 18, gbW - 24, 24, hwnd, ID_TRACKBAR, hInstance, null);
  // set trackbar range 0..100 and start at 0
  try {
    // lParam = MAKELONG(min, max) -> low = min, high = max, so (max<<16)|min
    const rangeParam = (100 << 16) | 0;
    user32.SendMessageW(hwndTrack, TBM_SETRANGE, 0, rangeParam);
    // TBM_SETPOS: wParam = bRedraw (TRUE), lParam = position
    user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, 0);
  } catch (e) {}

  // Up-Down (spin) with numeric edit
  const gbSpin = create_unicode_buffer("Spin / Numeric");
  // place spin group below the Options group to avoid overlap
  const spinY = gbOptionsY + 120 + 16;
  const hwndSpinGroup = user32.CreateWindowExW(0, create_unicode_buffer("BUTTON"), gbSpin, WS_CHILD | WS_VISIBLE | BS_GROUPBOX, gbX, spinY, 220, 80, hwnd, 3007, hInstance, null);
  // small edit to display the spin value
  const spinEdit = create_unicode_buffer("");
  hwndSpinEdit = user32.CreateWindowExW(WS_EX_CLIENTEDGE, create_unicode_buffer("EDIT"), spinEdit, WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_LEFT | ES_AUTOHSCROLL, gbX + 12, spinY + 26, 80, 24, hwnd, ID_SPIN_EDIT, hInstance, null);
  // create up-down control (msctls_updown32) to the right of edit
  // create up-down control with buddy behavior and arrow keys
  const udStyles = UDS_AUTOBUDDY | UDS_SETBUDDYINT | UDS_ALIGNRIGHT | UDS_ARROWKEYS;
  hwndSpin = user32.CreateWindowExW(0, create_unicode_buffer("msctls_updown32"), null, WS_CHILD | WS_VISIBLE | udStyles, gbX + 96, spinY + 26, 16, 24, hwnd, ID_SPIN, hInstance, null);
  try {
    // UDM_SETRANGE32: wParam = nMin, lParam = nMax
    user32.SendMessageW(hwndSpin, UDM_SETRANGE32, 0, 100);
    // UDM_SETPOS32: wParam = 0, lParam = position
    user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, 0);
    // explicitly set the buddy edit control for the up-down so it can update it
    try {
      user32.SendMessageW(hwndSpin, UDM_SETBUDDY, hwndSpinEdit, 0);
    } catch (e) {}
  } catch (e) {}

  // ToolTip (unicode) for a few controls
  hwndTooltip = user32.CreateWindowExW(0, create_unicode_buffer("tooltips_class32"), null, WS_CHILD | TTS_ALWAYSTIP, 0, 0, 0, 0, hwnd, ID_TOOLTIP, hInstance, null);
  try {
    // set max tip width
    const maxw = 300;
    user32.SendMessageW(hwndTooltip, TTM_SETMAXTIPWIDTH, 0, maxw);
    // Add tools: we need to prepare TOOLINFO structure; to simplify we'll use SendMessage with TTM_ADDTOOLW and minimal TOOLINFO data pointer = NULL in this demo (many wrappers need proper struct marshalling). As a practical approach, set tooltip text via control's window text for this demo.
  } catch (e) {}

  // helper to register a tooltip for a control using TOOLINFOW
  function addTooltipForControl(targetHwnd, text) {
    if (!hwndTooltip || !targetHwnd) return;
    try {
      const ti = new TOOLINFOW();
      ti.cbSize = TOOLINFOW.size;
      ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
      ti.hwnd = hwnd;
      ti.uId = targetHwnd;
      ti.hinst = null;
      ti.lpszText = create_unicode_buffer(text + "\0");
      // send pointer to TOOLINFO struct
      user32.SendMessageW(hwndTooltip, TTM_ADDTOOLW, 0, byref(ti));
    } catch (e) {}
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
  const __timer = user32.SetTimer(hwnd, ID_PROGRESS_TIMER, 1000, null);
  globalThis.__windowsControlsTimer = __timer;

  // Compute content height precisely by mapping each child rect into client coords
  try {
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
    for (let i = 0; i < children.length; i++) {
      const h = children[i];
      if (!h) continue;
      try {
        const rc = new RECT();
        user32.GetWindowRect(h, byref(rc));
        // Map from screen to client coords of our main window
        user32.MapWindowPoints(null, hwnd, byref(rc), 2);
        const bottom = Number(rc.bottom);
        if (bottom > maxBottom) maxBottom = bottom;
      } catch (e) {}
    }
    // add a small margin
    __contentHeight = Math.max(__clientHeight, maxBottom + 16);

    const siInit = new SCROLLINFO();
    siInit.cbSize = SCROLLINFO.size;
    siInit.fMask = SIF_RANGE | SIF_PAGE | SIF_POS;
    siInit.nMin = 0;
    siInit.nMax = Math.max(0, __contentHeight - 1);
    siInit.nPage = __clientHeight;
    siInit.nPos = __scrollY;
    user32.SetScrollInfo(hwnd, SB_VERT, byref(siInit), 1);
  } catch (e) {}

  user32.ShowWindow(hwnd, SW_SHOW);
  user32.UpdateWindow(hwnd);

  // register tooltips for some controls
  try {
    addTooltipForControl(hwndButton1, "Push button 1 — performs action A");
    addTooltipForControl(hwndToggle, "Toggle window (minimize/restore)");
    addTooltipForControl(hwndTrack, "Trackbar — controls progress bar value");
    addTooltipForControl(hwndSpinEdit, "Spin control — numeric value with up/down");
    addTooltipForControl(hwndTextInput, "Text input — type here to trigger EN_CHANGE events");
  } catch (e) {}

  // Message loop
  const msg = new MSG();
  while (user32.GetMessageW(byref(msg), null, 0, 0) !== 0) {
    user32.TranslateMessage(byref(msg));
    user32.DispatchMessageW(byref(msg));
  }
  log("Message loop ended");
}

createControlsDemo().catch((err) => {
  console.error("Error creating demo:", err);
});
