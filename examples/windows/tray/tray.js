// FluentTray — Fluent Design system tray class for node-ctypes
// Inspired by pit-ray/fluent-tray (https://github.com/pit-ray/fluent-tray)
// API mirrors the C++ reference: create_tray, add_menu, add_separator, update_with_loop, stop.
// Extension of this port: add_submenu() for nested menus.
//
// The menu windows are per-monitor DPI aware (only them: the process
// awareness is left alone), measured with the real font, placed with
// CalculatePopupWindowPosition on the monitor of the click, and keyboard
// navigable. The tray icon comes back when Explorer restarts (TaskbarCreated)
// and the menus follow the Windows light / dark theme.

import { WinDLL, WINFUNCTYPE, Structure, array, sizeof, byref, c_int, c_ssize_t, c_void, c_wchar, wstring_at } from "node-ctypes";
import { wintypes } from "node-ctypes";
const { ATOM, BOOL, BYTE, COLORREF, DWORD, HBITMAP, HBRUSH, HCURSOR, HDC, HFONT, HGDIOBJ, HICON, HINSTANCE, HMODULE, HWND, INT, LONG, LPCWSTR, LPVOID, LPARAM, LRESULT, UINT, WORD, WPARAM, POINT, RECT, SIZE, MSG, LPPOINT, LPRECT, LPMSG } = wintypes;
import { Registry, HKEY } from "../registry/registry.js";

// ─── Win32 Constants ────────────────────────────────────────────────

const WS_POPUP = 0x80000000;
const WS_EX_TOPMOST = 0x00000008;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_NOACTIVATE = 0x08000000;
const CS_DROPSHADOW = 0x00020000;

const WM_DESTROY = 0x0002;
const WM_PAINT = 0x000f;
const WM_CLOSE = 0x0010;
const WM_ERASEBKGND = 0x0014;
const WM_SETTINGCHANGE = 0x001a;
const WM_MOUSEACTIVATE = 0x0021;
const MA_ACTIVATE = 1;
const MA_NOACTIVATE = 3;
const WM_CONTEXTMENU = 0x007b;
const WM_KEYDOWN = 0x0100;
const WM_TIMER = 0x0113;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONUP = 0x0202;
const WM_MOUSELEAVE = 0x02a3;
const WM_DPICHANGED = 0x02e0;
const WM_APP = 0x8000;

const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_SPACE = 0x20;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;

const SW_HIDE = 0;
const NIM_ADD = 0x00000000;
const NIM_DELETE = 0x00000002;
const NIM_SETVERSION = 0x00000004;
const NIF_MESSAGE = 0x00000001;
const NIF_ICON = 0x00000002;
const NIF_TIP = 0x00000004;
const NIF_SHOWTIP = 0x00000080;
const NOTIFYICON_VERSION_4 = 4;
// NOTIFYICON_VERSION_4 events (LOWORD(lParam)): left click, Enter / Space, right click.
const NIN_SELECT = 0x0400;
const NIN_KEYSELECT = 0x0401;

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x00000010;

const TRANSPARENT = 1;
const DT_LEFT = 0x00000000;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const SRCCOPY = 0x00cc0020;
const PS_NULL = 5;
const PS_SOLID = 0;
const FW_MEDIUM = 500;
const DEFAULT_CHARSET = 1;
const CLEARTYPE_QUALITY = 5;
const DI_NORMAL = 0x0003;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;
const LWA_ALPHA = 0x00000002;
const TME_LEAVE = 0x00000002;
const IDC_ARROW = 32512;
const IDI_APPLICATION = 32512;
const SM_CXSMICON = 49;
const SPI_GETMENUSHOWDELAY = 0x006a;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const HWND_TOPMOST = -1;
const PM_REMOVE = 0x0001;
const MONITOR_DEFAULTTONEAREST = 2;
const MDT_EFFECTIVE_DPI = 0;
const MSGFLT_ALLOW = 1;
// CalculatePopupWindowPosition
const TPM_LEFTALIGN = 0x0000;
const TPM_CENTERALIGN = 0x0004;
const TPM_TOPALIGN = 0x0000;
const TPM_BOTTOMALIGN = 0x0020;
const TPM_WORKAREA = 0x10000;
// DPI_AWARENESS_CONTEXT is a pseudo-handle with a negative value.
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const USER_DEFAULT_SCREEN_DPI = 96;

const ID_HOVER_TIMER = 1;

// ─── Helpers ────────────────────────────────────────────────────────

function LOWORD(l) {
  return Number(l) & 0xffff;
}
function GET_X_LPARAM(lp) {
  const v = Number(lp) & 0xffff;
  return v > 32767 ? v - 65536 : v;
}
function GET_Y_LPARAM(lp) {
  const v = (Number(lp) >> 16) & 0xffff;
  return v > 32767 ? v - 65536 : v;
}
function RGB(r, g, b) {
  return (r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16);
}
// HWND values are BigInt (or null for NULL handles).
function sameHandle(a, b) {
  return a !== null && b !== null && BigInt(a) === BigInt(b);
}

function isWindowsDarkMode() {
  try {
    return Registry.getValue(HKEY.CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme") === 0;
  } catch {
    return false;
  }
}

// ─── DLL Setup (module-level singleton) ─────────────────────────────

const user32 = new WinDLL("user32.dll");
const kernel32 = new WinDLL("kernel32.dll");
const gdi32 = new WinDLL("gdi32.dll");
const shell32 = new WinDLL("shell32.dll");
const shcore = new WinDLL("shcore.dll");
let dwmapi;
try {
  dwmapi = new WinDLL("dwmapi.dll");
} catch {
  dwmapi = null;
}

// WNDPROC — standard Win32 window procedure signature
// Python: WNDPROC = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPARAM)
const WNDPROC = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPARAM);

// kernel32
kernel32.GetModuleHandleW.argtypes = [LPCWSTR];
kernel32.GetModuleHandleW.restype = HMODULE;

// user32 — window management
user32.RegisterClassExW.argtypes = [LPVOID];
user32.RegisterClassExW.restype = ATOM;
user32.UnregisterClassW.argtypes = [LPCWSTR, HINSTANCE];
user32.UnregisterClassW.restype = BOOL;
user32.CreateWindowExW.argtypes = [DWORD, LPCWSTR, LPCWSTR, DWORD, INT, INT, INT, INT, HWND, LPVOID, HINSTANCE, LPVOID];
user32.CreateWindowExW.restype = HWND;
user32.DestroyWindow.argtypes = [HWND];
user32.DestroyWindow.restype = BOOL;
user32.DefWindowProcW.argtypes = [HWND, UINT, WPARAM, LPARAM];
user32.DefWindowProcW.restype = LRESULT;
user32.ShowWindow.argtypes = [HWND, INT];
user32.ShowWindow.restype = BOOL;
// hWndInsertAfter: HWND_TOPMOST is the pseudo-handle -1.
user32.SetWindowPos.argtypes = [HWND, c_ssize_t, INT, INT, INT, INT, UINT];
user32.SetWindowPos.restype = BOOL;
user32.GetWindowRect.argtypes = [HWND, LPRECT];
user32.GetWindowRect.restype = BOOL;
user32.SetForegroundWindow.argtypes = [HWND];
user32.SetForegroundWindow.restype = BOOL;
user32.GetForegroundWindow.argtypes = [];
user32.GetForegroundWindow.restype = HWND;
user32.InvalidateRect.argtypes = [HWND, LPRECT, BOOL];
user32.InvalidateRect.restype = BOOL;
user32.GetClientRect.argtypes = [HWND, LPRECT];
user32.GetClientRect.restype = BOOL;
user32.SetTimer.argtypes = [HWND, LPVOID, UINT, LPVOID];
user32.SetTimer.restype = LPVOID;
user32.KillTimer.argtypes = [HWND, LPVOID];
user32.KillTimer.restype = BOOL;
user32.RegisterWindowMessageW.argtypes = [LPCWSTR];
user32.RegisterWindowMessageW.restype = UINT;
user32.ChangeWindowMessageFilterEx.argtypes = [HWND, UINT, DWORD, LPVOID];
user32.ChangeWindowMessageFilterEx.restype = BOOL;

// user32 — message loop
user32.PeekMessageW.argtypes = [LPMSG, HWND, UINT, UINT, UINT];
user32.PeekMessageW.restype = BOOL;
user32.TranslateMessage.argtypes = [LPMSG];
user32.TranslateMessage.restype = BOOL;
user32.DispatchMessageW.argtypes = [LPMSG];
user32.DispatchMessageW.restype = LRESULT;

// user32 — DPI and placement
user32.SetThreadDpiAwarenessContext.argtypes = [c_ssize_t];
user32.SetThreadDpiAwarenessContext.restype = c_ssize_t;
user32.GetDpiForSystem.argtypes = [];
user32.GetDpiForSystem.restype = UINT;
user32.GetSystemMetricsForDpi.argtypes = [INT, UINT];
user32.GetSystemMetricsForDpi.restype = INT;
user32.MonitorFromRect.argtypes = [LPRECT, DWORD];
user32.MonitorFromRect.restype = LPVOID;
user32.CalculatePopupWindowPosition.argtypes = [LPPOINT, LPVOID, UINT, LPRECT, LPRECT];
user32.CalculatePopupWindowPosition.restype = BOOL;
user32.SystemParametersInfoW.argtypes = [UINT, UINT, LPVOID, UINT];
user32.SystemParametersInfoW.restype = BOOL;
shcore.GetDpiForMonitor.argtypes = [LPVOID, INT, LPVOID, LPVOID];
shcore.GetDpiForMonitor.restype = LONG;

// user32 — resources
user32.LoadCursorW.argtypes = [HINSTANCE, LPVOID];
user32.LoadCursorW.restype = HCURSOR;
user32.LoadIconW.argtypes = [HINSTANCE, LPVOID];
user32.LoadIconW.restype = HICON;
user32.LoadImageW.argtypes = [HINSTANCE, LPCWSTR, UINT, INT, INT, UINT];
user32.LoadImageW.restype = LPVOID;
user32.DestroyIcon.argtypes = [HICON];
user32.DestroyIcon.restype = BOOL;

// user32 — painting and input
user32.BeginPaint.argtypes = [HWND, LPVOID];
user32.BeginPaint.restype = HDC;
user32.EndPaint.argtypes = [HWND, LPVOID];
user32.EndPaint.restype = BOOL;
user32.FillRect.argtypes = [HDC, LPRECT, HBRUSH];
user32.FillRect.restype = INT;
user32.DrawIconEx.argtypes = [HDC, INT, INT, HICON, INT, INT, UINT, HBRUSH, UINT];
user32.DrawIconEx.restype = BOOL;
user32.DrawTextW.argtypes = [HDC, LPCWSTR, INT, LPRECT, UINT];
user32.DrawTextW.restype = INT;
user32.SetLayeredWindowAttributes.argtypes = [HWND, COLORREF, BYTE, DWORD];
user32.SetLayeredWindowAttributes.restype = BOOL;
user32.GetCursorPos.argtypes = [LPPOINT];
user32.GetCursorPos.restype = BOOL;
user32.TrackMouseEvent.argtypes = [LPVOID];
user32.TrackMouseEvent.restype = BOOL;

// gdi32
gdi32.CreateSolidBrush.argtypes = [COLORREF];
gdi32.CreateSolidBrush.restype = HBRUSH;
gdi32.CreatePen.argtypes = [INT, INT, COLORREF];
gdi32.CreatePen.restype = LPVOID;
gdi32.DeleteObject.argtypes = [HGDIOBJ];
gdi32.DeleteObject.restype = BOOL;
gdi32.SelectObject.argtypes = [HDC, HGDIOBJ];
gdi32.SelectObject.restype = HGDIOBJ;
gdi32.CreateCompatibleDC.argtypes = [HDC];
gdi32.CreateCompatibleDC.restype = HDC;
gdi32.CreateCompatibleBitmap.argtypes = [HDC, INT, INT];
gdi32.CreateCompatibleBitmap.restype = HBITMAP;
gdi32.DeleteDC.argtypes = [HDC];
gdi32.DeleteDC.restype = BOOL;
gdi32.BitBlt.argtypes = [HDC, INT, INT, INT, INT, HDC, INT, INT, DWORD];
gdi32.BitBlt.restype = BOOL;
gdi32.SetBkMode.argtypes = [HDC, INT];
gdi32.SetBkMode.restype = INT;
gdi32.SetTextColor.argtypes = [HDC, COLORREF];
gdi32.SetTextColor.restype = COLORREF;
gdi32.CreateFontW.argtypes = [INT, INT, INT, INT, INT, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, DWORD, LPCWSTR];
gdi32.CreateFontW.restype = HFONT;
gdi32.GetTextExtentPoint32W.argtypes = [HDC, LPCWSTR, INT, LPVOID];
gdi32.GetTextExtentPoint32W.restype = BOOL;
gdi32.RoundRect.argtypes = [HDC, INT, INT, INT, INT, INT, INT];
gdi32.RoundRect.restype = BOOL;
gdi32.Polyline.argtypes = [HDC, LPVOID, INT];
gdi32.Polyline.restype = BOOL;

// shell32
shell32.Shell_NotifyIconW.argtypes = [DWORD, LPVOID];
shell32.Shell_NotifyIconW.restype = BOOL;

// dwmapi — DwmSetWindowAttribute returns HRESULT (LONG). We don't need an
// auto-throw wrapper for this one (the rounded-corner hint is a best-effort).
if (dwmapi) {
  try {
    dwmapi.DwmSetWindowAttribute.argtypes = [HWND, DWORD, LPVOID, DWORD];
    dwmapi.DwmSetWindowAttribute.restype = LONG;
  } catch {
    dwmapi = null;
  }
}

/**
 * Run `fn` with the calling thread per-monitor DPI aware: windows created
 * meanwhile are per-monitor aware, and coordinates and metrics are physical.
 * The process DPI awareness is left as the application set it.
 */
function perMonitor(fn) {
  const previous = user32.SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  try {
    return fn();
  } finally {
    if (previous) user32.SetThreadDpiAwarenessContext(previous);
  }
}

/** Effective DPI of the monitor containing a point (physical coordinates). */
function dpiAt(x, y) {
  const rc = new RECT();
  rc.left = x;
  rc.top = y;
  rc.right = x + 1;
  rc.bottom = y + 1;
  const monitor = user32.MonitorFromRect(byref(rc), MONITOR_DEFAULTTONEAREST);
  const dpiX = new UINT(0);
  const dpiY = new UINT(0);
  if (monitor && shcore.GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, byref(dpiX), byref(dpiY)) >= 0) return Number(dpiX.value);
  return USER_DEFAULT_SCREEN_DPI;
}

// ─── Structures ─────────────────────────────────────────────────────

// POINT, RECT, SIZE and MSG come from wintypes (Python: ctypes.wintypes).

class WNDCLASSEX extends Structure {
  static _fields_ = [
    ["cbSize", UINT],
    ["style", UINT],
    ["lpfnWndProc", WNDPROC],
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

class GUID extends Structure {
  static _fields_ = [
    ["Data1", DWORD],
    ["Data2", WORD],
    ["Data3", WORD],
    ["Data4", array(BYTE, 8)],
  ];
}

class NOTIFYICONDATA extends Structure {
  static _fields_ = [
    ["cbSize", DWORD],
    ["hWnd", HWND],
    ["uID", UINT],
    ["uFlags", UINT],
    ["uCallbackMessage", UINT],
    ["hIcon", HICON],
    ["szTip", array(c_wchar, 128)],
    ["dwState", DWORD],
    ["dwStateMask", DWORD],
    ["szInfo", array(c_wchar, 256)],
    ["uTimeoutOrVersion", UINT],
    ["szInfoTitle", array(c_wchar, 64)],
    ["dwInfoFlags", DWORD],
    ["guidItem", GUID],
    ["hBalloonIcon", HICON],
  ];
}

class PAINTSTRUCT extends Structure {
  static _fields_ = [
    ["hdc", HDC],
    ["fErase", BOOL],
    ["rcPaint", RECT],
    ["fRestore", BOOL],
    ["fIncUpdate", BOOL],
    ["rgbReserved", array(BYTE, 32)],
  ];
}

class TRACKMOUSEEVENT extends Structure {
  static _fields_ = [
    ["cbSize", DWORD],
    ["dwFlags", DWORD],
    ["hwndTrack", HWND],
    ["dwHoverTime", DWORD],
  ];
}

// ─── Layout (device-independent pixels, scaled to the monitor DPI) ──

const MENU_PADDING_X = 5;
const MENU_PADDING_Y = 5;
const ITEM_HEIGHT = 36;
const SEPARATOR_HEIGHT = 9;
const ICON_SIZE = 16;
const ICON_MARGIN_LEFT = 12;
const TEXT_MARGIN_LEFT = 40;
const TEXT_MARGIN_RIGHT = 24;
const ARROW_WIDTH = 20; // the submenu chevron
const ITEM_BORDER_RADIUS = 4;
const CHECK_INDICATOR_W = 3;
const CHECK_INDICATOR_H = 16;
const FONT_HEIGHT = 14;
const MENU_MIN_WIDTH = 200;

const ITEM_NORMAL = 0;
const ITEM_SEPARATOR = 1;

const scale = (dips, dpi) => Math.round((dips * dpi) / USER_DEFAULT_SCREEN_DPI);

// ─── Theme ──────────────────────────────────────────────────────────

const THEMES = {
  dark: {
    bg: RGB(43, 43, 43),
    bgHover: RGB(60, 60, 60),
    bgChecked: RGB(55, 55, 55),
    text: RGB(255, 255, 255),
    textDisabled: RGB(120, 120, 120),
    separator: RGB(70, 70, 70),
    accent: RGB(96, 205, 255),
  },
  light: {
    bg: RGB(249, 249, 249),
    bgHover: RGB(230, 230, 230),
    bgChecked: RGB(238, 238, 238),
    text: RGB(0, 0, 0),
    textDisabled: RGB(150, 150, 150),
    separator: RGB(210, 210, 210),
    accent: RGB(0, 120, 212),
  },
};

// ─── TrayStatus enum (mirrors C++) ──────────────────────────────────

export const TrayStatus = Object.freeze({
  RUNNING: "RUNNING",
  SHOULD_STOP: "SHOULD_STOP",
  FAILED: "FAILED",
  STOPPED: "STOPPED",
});

// ─── Menus ──────────────────────────────────────────────────────────

/** A menu and its popup window (created the first time it is shown). */
class Menu {
  items = [];
  hwnd = null;
  hovered = -1;
  tracking = false; // TrackMouseEvent(TME_LEAVE) requested
  layout = null; // { dpi, width, height, rows: [{ top, height }] } in physical pixels
}

/**
 * Builds a menu: the tray's own menu and the submenus returned by
 * add_submenu() have the same methods.
 */
export class FluentMenu {
  #menu;

  constructor(menu = new Menu()) {
    this.#menu = menu;
  }

  /**
   * Add a menu item.
   * @param {string} label
   * @param {string} [icon_path]  Path to .ico file
   * @param {boolean} [toggleable=false]
   * @param {function(): boolean} [callback]  Returning false stops the tray
   * @param {function(): boolean} [unchecked_callback]
   * @returns {boolean}
   */
  add_menu(label = "", icon_path = "", toggleable = false, callback = null, unchecked_callback = null) {
    this.#menu.items.push({
      type: ITEM_NORMAL,
      label,
      iconPath: icon_path,
      icons: new Map(), // icon size in pixels → HICON
      checkable: toggleable,
      checked: false,
      enabled: true,
      onClick: callback,
      onUncheck: unchecked_callback,
      submenu: null,
    });
    return true;
  }

  /** Add a separator line under the last menu item added. */
  add_separator() {
    this.#menu.items.push({ type: ITEM_SEPARATOR });
  }

  /**
   * Add an item that opens a submenu (on hover, click or the Right key).
   * @param {string} label
   * @param {string} [icon_path]
   * @returns {FluentMenu} The submenu, to add its items
   */
  add_submenu(label = "", icon_path = "") {
    const submenu = new Menu();
    this.add_menu(label, icon_path);
    this.#menu.items.at(-1).submenu = submenu;
    return new FluentMenu(submenu);
  }

  /** Number of menu items (excluding separators). */
  count_menus() {
    return this.#menu.items.filter((m) => m.type === ITEM_NORMAL).length;
  }

  /** Iterator over menu items. */
  *[Symbol.iterator]() {
    for (const m of this.#menu.items) if (m.type === ITEM_NORMAL) yield m;
  }
}

// ─── FluentTray class ───────────────────────────────────────────────

let _instanceCounter = 0; // unique class name per instance

export class FluentTray {
  #hInstance;
  #className = null;
  #root = new Menu();
  #builder = new FluentMenu(this.#root);
  #windows = new Map(); // HWND (BigInt) → Menu
  #chain = []; // open menus: the root, then each open submenu
  #keyLevel = 0; // the menu of the chain that the keyboard drives
  #pending = null; // hover action waiting for ID_HOVER_TIMER: { level, index }
  #hoverDelay = 400; // SPI_GETMENUSHOWDELAY
  #nid = null;
  #status = TrayStatus.STOPPED;
  #appName = "";
  #iconPath = "";
  #hTrayIcon = null;
  #trayIconLoaded = false; // loaded from a file: destroyed by stop()
  #taskbarCreated = 0;
  #menuHideTime = 0;
  #wndProcCb = null; // prevent GC
  #fonts = new Map(); // DPI → HFONT
  #darkMode = false;
  #roundCorner = true;
  #messageId;
  #opacity;
  #msg = new MSG();

  /**
   * @param {object} [opts]
   * @param {number} [opts.message_id_offset=25] Unique message identifier offset
   * @param {number} [opts.opacity=255] Menu opacity 0-255
   */
  constructor(opts = {}) {
    this.#hInstance = kernel32.GetModuleHandleW(null);
    this.#messageId = WM_APP + (opts.message_id_offset ?? 25);
    this.#opacity = opts.opacity ?? 255;
    this.#darkMode = isWindowsDarkMode();
    const delay = new UINT(0);
    if (user32.SystemParametersInfoW(SPI_GETMENUSHOWDELAY, 0, byref(delay), 0)) this.#hoverDelay = Number(delay.value);
  }

  // ── Public API (mirrors C++ FluentTray) ───────────────────────────

  /**
   * Initialize the tray icon.
   * @param {string} app_name  Tooltip text
   * @param {string} [icon_path]  Path to .ico file
   * @param {boolean} [round_corner=true]
   * @returns {boolean}
   */
  create_tray(app_name, icon_path = "", round_corner = true) {
    this.#appName = app_name;
    this.#iconPath = icon_path;
    this.#roundCorner = round_corner;

    if (!this.#registerClass()) return this.#fail();
    // The root menu window also receives the tray icon notifications.
    if (!this.#ensureWindow(this.#root, true)) return this.#fail();

    // Explorer broadcasts TaskbarCreated when it restarts: add the icon again.
    // The filter lets it through when this process runs elevated.
    this.#taskbarCreated = user32.RegisterWindowMessageW("TaskbarCreated");
    user32.ChangeWindowMessageFilterEx(this.#root.hwnd, this.#taskbarCreated, MSGFLT_ALLOW, null);

    this.#addNotifyIcon();
    this.#status = TrayStatus.RUNNING;
    return true;
  }

  /**
   * Add a menu item.
   * @param {string} label
   * @param {string} [icon_path]
   * @param {boolean} [toggleable=false]
   * @param {function(): boolean} [callback]
   * @param {function(): boolean} [unchecked_callback]
   * @returns {boolean}
   */
  add_menu(label = "", icon_path = "", toggleable = false, callback = null, unchecked_callback = null) {
    return this.#builder.add_menu(label, icon_path, toggleable, callback, unchecked_callback);
  }

  /** Add a separator line under the last menu item added. */
  add_separator() {
    this.#builder.add_separator();
  }

  /**
   * Add an item that opens a submenu.
   * @param {string} label
   * @param {string} [icon_path]
   * @returns {FluentMenu} The submenu: add_menu, add_separator, add_submenu
   */
  add_submenu(label = "", icon_path = "") {
    return this.#builder.add_submenu(label, icon_path);
  }

  /**
   * Single update iteration: dispatch the pending window messages. Returns
   * false on failure.
   * @returns {boolean}
   */
  update() {
    if (this.#status === TrayStatus.FAILED) return false;
    if (this.#status === TrayStatus.SHOULD_STOP) {
      this.#dispose();
      this.#status = TrayStatus.STOPPED;
    }
    if (this.#status === TrayStatus.STOPPED) return true;

    // Every pending message: a mouse move alone queues many.
    const msg = this.#msg;
    while (user32.PeekMessageW(byref(msg), null, 0, 0, PM_REMOVE)) {
      user32.TranslateMessage(byref(msg));
      user32.DispatchMessageW(byref(msg));
    }

    // Dismiss when the menu loses the foreground (like C++ reference). Submenus
    // never take it (WM_MOUSEACTIVATE → MA_NOACTIVATE): the root keeps it while
    // they are used. Any open menu counts, should one become foreground anyway.
    const foreground = user32.GetForegroundWindow();
    if (this.#chain.length && !this.#chain.some((menu) => sameHandle(foreground, menu.hwnd))) this.#hideAll();
    return true;
  }

  /**
   * Create a message loop to update the tray.
   * @param {number} [sleep_ms=1]
   * @returns {Promise<boolean>}
   */
  async update_with_loop(sleep_ms = 1) {
    while (this.#status !== TrayStatus.STOPPED) {
      if (!this.update()) return false;
      if (this.#status === TrayStatus.STOPPED) break;
      await new Promise((r) => setTimeout(r, sleep_ms));
    }
    return true;
  }

  /** Exit the tray successfully: the windows and icons are released by the next update. */
  stop() {
    if (this.#status !== TrayStatus.RUNNING) return;
    this.#hideAll();
    this.#removeNotifyIcon();
    this.#status = TrayStatus.SHOULD_STOP;
  }

  /** @returns {TrayStatus} */
  status() {
    return this.#status;
  }

  /** @returns {HWND} */
  window_handle() {
    return this.#root.hwnd;
  }

  /** Number of menu items (excluding separators). */
  count_menus() {
    return this.#builder.count_menus();
  }

  /** Iterator over menu items. */
  *[Symbol.iterator]() {
    yield* this.#builder;
  }

  // ── Private: windows ──────────────────────────────────────────────

  #fail() {
    this.#status = TrayStatus.FAILED;
    return false;
  }

  #registerClass() {
    const className = `FluentTray_${++_instanceCounter}`;

    // Bind WndProc to this instance. Python: WNDPROC(fn) wraps a JS function
    // as a stdcall callback (same signature as Win32 WindowProc).
    this.#wndProcCb = WNDPROC((hwnd, msg, wParam, lParam) => this.#wndProc(hwnd, msg, wParam, lParam));

    const wc = new WNDCLASSEX();
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = this.#wndProcCb;
    wc.hInstance = this.#hInstance;
    wc.hIcon = user32.LoadIconW(null, IDI_APPLICATION);
    wc.hCursor = user32.LoadCursorW(null, IDC_ARROW);
    wc.lpszClassName = className;
    if (!user32.RegisterClassExW(byref(wc))) return false;
    this.#className = className;
    return true;
  }

  /** The popup window of a menu: the root takes the foreground, submenus never do. */
  #ensureWindow(menu, root = false) {
    if (menu.hwnd) return true;
    const exStyle = WS_EX_TOOLWINDOW | WS_EX_TOPMOST | (root ? 0 : WS_EX_NOACTIVATE) | (this.#opacity < 255 ? WS_EX_LAYERED : 0);
    // Created per-monitor DPI aware: drawn at the monitor's DPI, never stretched.
    const hwnd = perMonitor(() => user32.CreateWindowExW(exStyle, this.#className, this.#appName, WS_POPUP, 0, 0, 100, 100, null, null, this.#hInstance, null));
    if (!hwnd) return false;
    menu.hwnd = hwnd;
    this.#windows.set(BigInt(hwnd), menu);

    if (this.#opacity < 255) user32.SetLayeredWindowAttributes(hwnd, 0, this.#opacity, LWA_ALPHA);
    if (this.#roundCorner && dwmapi) {
      const preference = new c_int(DWMWCP_ROUND);
      dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, byref(preference), sizeof(c_int));
    }
    return true;
  }

  /** Release the windows, the window class, the callback, the icons and the fonts. */
  #dispose() {
    this.#killHoverTimer();
    for (const menu of this.#windows.values()) user32.DestroyWindow(menu.hwnd);
    this.#windows.clear();
    if (this.#className) user32.UnregisterClassW(this.#className, this.#hInstance);
    this.#className = null;
    this.#wndProcCb?.release();
    this.#wndProcCb = null;
    const release = (menu) => {
      menu.hwnd = null;
      for (const item of menu.items) {
        for (const icon of item.icons?.values() ?? []) if (icon) user32.DestroyIcon(icon);
        item.icons?.clear();
        if (item.submenu) release(item.submenu);
      }
    };
    release(this.#root);
    if (this.#trayIconLoaded) user32.DestroyIcon(this.#hTrayIcon);
    this.#hTrayIcon = null;
    for (const font of this.#fonts.values()) gdi32.DeleteObject(font);
    this.#fonts.clear();
  }

  // ── Private: notify icon ──────────────────────────────────────────

  #loadTrayIcon() {
    if (this.#trayIconLoaded) user32.DestroyIcon(this.#hTrayIcon);
    this.#trayIconLoaded = false;
    this.#hTrayIcon = null;
    if (this.#iconPath) {
      // The small icon size of the taskbar's DPI (the system DPI).
      const size = perMonitor(() => user32.GetSystemMetricsForDpi(SM_CXSMICON, user32.GetDpiForSystem()));
      this.#hTrayIcon = user32.LoadImageW(null, this.#iconPath, IMAGE_ICON, size, size, LR_LOADFROMFILE);
      this.#trayIconLoaded = Boolean(this.#hTrayIcon);
    }
    if (!this.#hTrayIcon) this.#hTrayIcon = user32.LoadIconW(null, IDI_APPLICATION);
  }

  #addNotifyIcon() {
    this.#loadTrayIcon();
    this.#nid = new NOTIFYICONDATA();
    this.#nid.cbSize = sizeof(NOTIFYICONDATA);
    this.#nid.hWnd = this.#root.hwnd;
    this.#nid.uID = 1;
    this.#nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
    this.#nid.uCallbackMessage = this.#messageId;
    this.#nid.hIcon = this.#hTrayIcon;
    this.#nid.szTip = this.#appName.substring(0, 127);
    shell32.Shell_NotifyIconW(NIM_ADD, byref(this.#nid));
    // Version 4: the events carry the anchor point, also from the keyboard.
    this.#nid.uTimeoutOrVersion = NOTIFYICON_VERSION_4;
    shell32.Shell_NotifyIconW(NIM_SETVERSION, byref(this.#nid));
  }

  #removeNotifyIcon() {
    if (this.#nid) shell32.Shell_NotifyIconW(NIM_DELETE, byref(this.#nid));
    this.#nid = null;
  }

  // ── Private: measure ──────────────────────────────────────────────

  #font(dpi) {
    if (!this.#fonts.has(dpi)) {
      this.#fonts.set(dpi, gdi32.CreateFontW(-scale(FONT_HEIGHT, dpi), 0, 0, 0, FW_MEDIUM, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, "Segoe UI"));
    }
    return this.#fonts.get(dpi);
  }

  #icon(item, size) {
    if (!item.iconPath) return null;
    if (!item.icons.has(size)) item.icons.set(size, user32.LoadImageW(null, item.iconPath, IMAGE_ICON, size, size, LR_LOADFROMFILE));
    return item.icons.get(size);
  }

  /** Rows and size of a menu at a DPI, with the labels measured in the menu font. */
  #measure(menu, dpi) {
    const hdc = gdi32.CreateCompatibleDC(null);
    const oldFont = gdi32.SelectObject(hdc, this.#font(dpi));
    const extent = new SIZE();
    const hasSubmenus = menu.items.some((item) => item.submenu);
    let width = scale(MENU_MIN_WIDTH, dpi);
    let top = scale(MENU_PADDING_Y, dpi);
    const rows = [];
    for (const item of menu.items) {
      const height = scale(item.type === ITEM_SEPARATOR ? SEPARATOR_HEIGHT : ITEM_HEIGHT, dpi);
      rows.push({ top, height });
      top += height;
      if (item.type === ITEM_SEPARATOR) continue;
      gdi32.GetTextExtentPoint32W(hdc, item.label, item.label.length, byref(extent));
      const itemWidth = scale(MENU_PADDING_X + TEXT_MARGIN_LEFT, dpi) + Number(extent.cx) + scale(TEXT_MARGIN_RIGHT + (hasSubmenus ? ARROW_WIDTH : 0) + MENU_PADDING_X, dpi);
      width = Math.max(width, itemWidth);
    }
    gdi32.SelectObject(hdc, oldFont);
    gdi32.DeleteDC(hdc);
    return { dpi, width, height: top + scale(MENU_PADDING_Y, dpi), rows };
  }

  #hitTest(menu, x, y) {
    const { layout } = menu;
    if (!layout || x < scale(MENU_PADDING_X, layout.dpi) || x >= layout.width - scale(MENU_PADDING_X, layout.dpi)) return -1;
    return layout.rows.findIndex((row, i) => menu.items[i].type === ITEM_NORMAL && y >= row.top && y < row.top + row.height);
  }

  // ── Private: show / hide ──────────────────────────────────────────

  /**
   * Show a menu at chain position `level`, next to an anchor point (physical
   * coordinates), avoiding `exclude` (the item that opened a submenu).
   */
  #openMenu(menu, level, x, y, exclude = null) {
    if (!this.#ensureWindow(menu, level === 0)) return;
    perMonitor(() => {
      const layout = this.#measure(menu, dpiAt(x, y));
      menu.layout = layout;
      menu.hovered = -1;
      // CalculatePopupWindowPosition keeps the menu in the work area of the
      // anchor's monitor, flipping it when needed (taskbar on any side).
      const anchor = new POINT();
      anchor.x = x;
      anchor.y = y;
      const size = new SIZE();
      size.cx = layout.width;
      size.cy = layout.height;
      const position = new RECT();
      const flags = (level === 0 ? TPM_CENTERALIGN | TPM_BOTTOMALIGN : TPM_LEFTALIGN | TPM_TOPALIGN) | TPM_WORKAREA;
      let left = x;
      let top = y;
      if (user32.CalculatePopupWindowPosition(byref(anchor), byref(size), flags, exclude ? byref(exclude) : null, byref(position))) {
        left = Number(position.left);
        top = Number(position.top);
      }
      user32.SetWindowPos(menu.hwnd, HWND_TOPMOST, left, top, layout.width, layout.height, SWP_SHOWWINDOW | (level === 0 ? 0 : SWP_NOACTIVATE));
      user32.InvalidateRect(menu.hwnd, null, 0);
    });
    if (level === 0) user32.SetForegroundWindow(menu.hwnd);
    this.#chain.length = level;
    this.#chain.push(menu);
  }

  /** Open the submenu of item `index` of the menu at chain position `level`. */
  #openSubmenu(level, index, fromKeyboard) {
    const menu = this.#chain[level];
    const submenu = menu.items[index]?.submenu;
    if (!submenu) return;
    this.#cancelHover();
    menu.hovered = index;
    user32.InvalidateRect(menu.hwnd, null, 0);
    if (this.#chain[level + 1] !== submenu) {
      this.#closeFrom(level + 1);
      const rc = perMonitor(() => {
        const window = new RECT();
        user32.GetWindowRect(menu.hwnd, byref(window));
        return window;
      });
      const row = menu.layout.rows[index];
      // RECT fields are LONG (BigInt when read back): compute with numbers.
      const top = Number(rc.top) + row.top;
      const item = new RECT();
      item.left = Number(rc.left);
      item.right = Number(rc.right);
      item.top = top;
      item.bottom = top + row.height;
      this.#openMenu(submenu, level + 1, Number(rc.right), top - scale(MENU_PADDING_Y, menu.layout.dpi), item);
    }
    if (fromKeyboard) {
      this.#keyLevel = level + 1;
      this.#moveHover(submenu, 1);
    }
  }

  /** Hide the menus from chain position `level` on. */
  #closeFrom(level) {
    for (const menu of this.#chain.splice(level)) {
      user32.ShowWindow(menu.hwnd, SW_HIDE);
      menu.hovered = -1;
      menu.tracking = false;
    }
    this.#keyLevel = Math.max(0, Math.min(this.#keyLevel, this.#chain.length - 1));
  }

  #hideAll() {
    if (!this.#chain.length) return;
    this.#cancelHover();
    this.#closeFrom(0);
    this.#keyLevel = 0;
    this.#menuHideTime = Date.now();
  }

  // ── Private: hover delay (SPI_GETMENUSHOWDELAY, like native menus) ─

  #scheduleHover(level, index) {
    if (this.#pending?.level === level && this.#pending?.index === index) return;
    this.#pending = { level, index };
    user32.SetTimer(this.#root.hwnd, ID_HOVER_TIMER, Math.max(1, this.#hoverDelay), null);
  }

  #killHoverTimer() {
    if (this.#root.hwnd) user32.KillTimer(this.#root.hwnd, ID_HOVER_TIMER);
  }

  #cancelHover() {
    this.#pending = null;
    this.#killHoverTimer();
  }

  /** The pointer rested on an item: open its submenu, or close the deeper ones. */
  #onHoverTimer() {
    const pending = this.#pending;
    this.#cancelHover();
    if (!pending || pending.level >= this.#chain.length) return;
    const menu = this.#chain[pending.level];
    if (menu.items[pending.index]?.submenu) this.#openSubmenu(pending.level, pending.index, false);
    else this.#closeFrom(pending.level + 1);
  }

  // ── Private: input ────────────────────────────────────────────────

  #onMouseMove(menu, level, x, y) {
    if (!menu.tracking) {
      const tme = new TRACKMOUSEEVENT();
      tme.cbSize = sizeof(TRACKMOUSEEVENT);
      tme.dwFlags = TME_LEAVE;
      tme.hwndTrack = menu.hwnd;
      user32.TrackMouseEvent(byref(tme));
      menu.tracking = true;
    }
    // In a submenu, its parent item stays highlighted.
    if (level > 0) {
      const parent = this.#chain[level - 1];
      const index = parent.items.findIndex((item) => item.submenu === menu);
      if (parent.hovered !== index) {
        parent.hovered = index;
        user32.InvalidateRect(parent.hwnd, null, 0);
      }
      if (this.#pending?.level === level - 1) this.#cancelHover();
    }
    this.#keyLevel = level;
    const index = this.#hitTest(menu, x, y);
    if (index !== menu.hovered) {
      menu.hovered = index;
      user32.InvalidateRect(menu.hwnd, null, 0);
    }
    if (index < 0) return;
    const openSubmenu = this.#chain[level + 1];
    const item = menu.items[index];
    if (openSubmenu && item.submenu === openSubmenu) this.#cancelHover();
    else if (item.submenu || openSubmenu)
      this.#scheduleHover(level, index); // open it, or close the open one
    else this.#cancelHover(); // a plain item: nothing to open or close
  }

  #onMouseLeave(menu, level) {
    menu.tracking = false;
    // The item whose submenu is open, or about to open, stays highlighted: the
    // pointer leaves the menu on its way to the submenu, so a pending hover
    // action is kept.
    const open = this.#chain[level + 1];
    const item = menu.items[menu.hovered];
    const pending = this.#pending?.level === level && this.#pending.index === menu.hovered && item?.submenu;
    if (menu.hovered !== -1 && !(open && item?.submenu === open) && !pending) {
      menu.hovered = -1;
      user32.InvalidateRect(menu.hwnd, null, 0);
    }
  }

  /** Move the keyboard highlight to the next enabled item, wrapping around. */
  #moveHover(menu, direction) {
    const count = menu.items.length;
    // Without a highlight, Down starts from the first item and Up from the last.
    let index = menu.hovered < 0 ? (direction > 0 ? -1 : 0) : menu.hovered;
    for (let step = 0; step < count; step++) {
      index = (index + direction + count) % count;
      const item = menu.items[index];
      if (item.type === ITEM_NORMAL && item.enabled) break;
    }
    menu.hovered = index;
    user32.InvalidateRect(menu.hwnd, null, 0);
  }

  #onKeyDown(key) {
    if (!this.#chain.length) return;
    const level = Math.min(this.#keyLevel, this.#chain.length - 1);
    const menu = this.#chain[level];
    this.#cancelHover();
    switch (key) {
      case VK_ESCAPE:
        if (level > 0) {
          this.#closeFrom(level);
          this.#keyLevel = level - 1;
        } else {
          this.#hideAll();
        }
        break;
      case VK_UP:
      case VK_DOWN:
        this.#moveHover(menu, key === VK_DOWN ? 1 : -1);
        break;
      case VK_RIGHT:
        if (menu.items[menu.hovered]?.submenu) this.#openSubmenu(level, menu.hovered, true);
        break;
      case VK_LEFT:
        if (level > 0) {
          this.#closeFrom(level);
          this.#keyLevel = level - 1;
        }
        break;
      case VK_RETURN:
      case VK_SPACE:
        if (menu.hovered >= 0) this.#activate(level, menu.hovered, true);
        break;
    }
  }

  /** Click or Enter on an item: open its submenu, or run its callback and close the menus. */
  #activate(level, index, fromKeyboard) {
    const item = this.#chain[level]?.items[index];
    if (!item || item.type !== ITEM_NORMAL || !item.enabled) return;
    if (item.submenu) return this.#openSubmenu(level, index, fromKeyboard);
    this.#hideAll();
    let result = true;
    if (item.checkable) {
      item.checked = !item.checked;
      if (!item.checked && item.onUncheck) result = item.onUncheck();
      else if (item.onClick) result = item.onClick();
    } else if (item.onClick) {
      result = item.onClick();
    }
    if (result === false) this.stop();
  }

  /** Tray icon events (NOTIFYICON_VERSION_4): toggle the menu at the anchor point. */
  #onTrayEvent(event, wParam) {
    if (event !== NIN_SELECT && event !== NIN_KEYSELECT && event !== WM_CONTEXTMENU) return;
    if (this.#chain.length) return this.#hideAll();
    // A click on the icon takes the foreground from the menu, which closes it
    // just before this event: do not reopen it right away.
    if (Date.now() - this.#menuHideTime <= 300) return;
    this.#keyLevel = 0;
    this.#openMenu(this.#root, 0, GET_X_LPARAM(wParam), GET_Y_LPARAM(wParam));
    if (event === NIN_KEYSELECT) this.#moveHover(this.#root, 1);
  }

  // ── Private: painting ─────────────────────────────────────────────

  #paint(menu, hdc) {
    const { dpi, width: w, height: h, rows } = menu.layout;
    const colors = this.#darkMode ? THEMES.dark : THEMES.light;
    const s = (dips) => scale(dips, dpi);

    const memDC = gdi32.CreateCompatibleDC(hdc);
    const memBmp = gdi32.CreateCompatibleBitmap(hdc, w, h);
    const oldBmp = gdi32.SelectObject(memDC, memBmp);

    // Background
    const bgBrush = gdi32.CreateSolidBrush(colors.bg);
    const bgR = new RECT();
    bgR.right = w;
    bgR.bottom = h;
    user32.FillRect(memDC, byref(bgR), bgBrush);
    gdi32.DeleteObject(bgBrush);

    const oldFont = gdi32.SelectObject(memDC, this.#font(dpi));
    gdi32.SetBkMode(memDC, TRANSPARENT);
    const iconSize = s(ICON_SIZE);

    for (let i = 0; i < menu.items.length; i++) {
      const item = menu.items[i];
      const { top: it, height } = rows[i];

      if (item.type === ITEM_SEPARATOR) {
        const sepY = it + (height >> 1);
        const sb = gdi32.CreateSolidBrush(colors.separator);
        const sr = new RECT();
        sr.left = s(MENU_PADDING_X + ICON_MARGIN_LEFT);
        sr.top = sepY;
        sr.right = w - s(MENU_PADDING_X + 8);
        sr.bottom = sepY + Math.max(1, s(1));
        user32.FillRect(memDC, byref(sr), sb);
        gdi32.DeleteObject(sb);
        continue;
      }

      const hovered = i === menu.hovered;
      const il = s(MENU_PADDING_X),
        ir = w - s(MENU_PADDING_X),
        ib = it + height;

      if (hovered && item.enabled) {
        const hb = gdi32.CreateSolidBrush(colors.bgHover),
          hp = gdi32.CreatePen(PS_NULL, 0, 0);
        const oP = gdi32.SelectObject(memDC, hp),
          oB = gdi32.SelectObject(memDC, hb);
        gdi32.RoundRect(memDC, il, it, ir, ib, s(ITEM_BORDER_RADIUS * 2), s(ITEM_BORDER_RADIUS * 2));
        gdi32.SelectObject(memDC, oP);
        gdi32.SelectObject(memDC, oB);
        gdi32.DeleteObject(hb);
        gdi32.DeleteObject(hp);
      } else if (item.checked) {
        const cb = gdi32.CreateSolidBrush(colors.bgChecked);
        const cr = new RECT();
        cr.left = il;
        cr.top = it;
        cr.right = ir;
        cr.bottom = ib;
        user32.FillRect(memDC, byref(cr), cb);
        gdi32.DeleteObject(cb);
      }

      if (item.checked) {
        const ab = gdi32.CreateSolidBrush(colors.accent);
        const iy = it + ((height - s(CHECK_INDICATOR_H)) >> 1);
        const ar = new RECT();
        ar.left = il + s(4);
        ar.top = iy;
        ar.right = il + s(4 + CHECK_INDICATOR_W);
        ar.bottom = iy + s(CHECK_INDICATOR_H);
        user32.FillRect(memDC, byref(ar), ab);
        gdi32.DeleteObject(ab);
      }

      // Icons are loaded at the size of this DPI from the .ico file: no scaling.
      const hIcon = this.#icon(item, iconSize);
      if (hIcon) user32.DrawIconEx(memDC, il + s(ICON_MARGIN_LEFT), it + ((height - iconSize) >> 1), hIcon, iconSize, iconSize, 0, null, DI_NORMAL);

      gdi32.SetTextColor(memDC, item.enabled ? colors.text : colors.textDisabled);
      const tr = new RECT();
      tr.left = il + s(TEXT_MARGIN_LEFT);
      tr.top = it;
      tr.right = ir - s(8);
      tr.bottom = ib;
      user32.DrawTextW(memDC, item.label, -1, byref(tr), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

      // Submenu chevron, drawn with two lines so that it is sharp at any DPI.
      if (item.submenu) {
        const cx = ir - s(14);
        const cy = it + (height >> 1);
        const half = s(4);
        const chevron = new (array(POINT, 3))();
        chevron[0].x = cx - (half >> 1);
        chevron[0].y = cy - half;
        chevron[1].x = cx + (half >> 1);
        chevron[1].y = cy;
        chevron[2].x = cx - (half >> 1);
        chevron[2].y = cy + half + 1;
        const pen = gdi32.CreatePen(PS_SOLID, Math.max(1, s(1)), item.enabled ? colors.text : colors.textDisabled);
        const oP = gdi32.SelectObject(memDC, pen);
        gdi32.Polyline(memDC, chevron, 3);
        gdi32.SelectObject(memDC, oP);
        gdi32.DeleteObject(pen);
      }
    }

    gdi32.SelectObject(memDC, oldFont);
    gdi32.BitBlt(hdc, 0, 0, w, h, memDC, 0, 0, SRCCOPY);
    gdi32.SelectObject(memDC, oldBmp);
    gdi32.DeleteObject(memBmp);
    gdi32.DeleteDC(memDC);
  }

  // ── Private: WndProc ──────────────────────────────────────────────

  #wndProc(hwnd, msg, wParam, lParam) {
    const m = Number(msg);
    const menu = this.#windows.get(BigInt(hwnd));
    const level = menu ? this.#chain.indexOf(menu) : -1;

    // Tray icon callback — toggle
    if (m === this.#messageId) {
      this.#onTrayEvent(LOWORD(lParam), wParam);
      return 0;
    }
    // Explorer restarted: the notification area is new.
    if (m === this.#taskbarCreated && this.#taskbarCreated && this.#status === TrayStatus.RUNNING) {
      this.#addNotifyIcon();
      return 0;
    }

    switch (m) {
      case WM_PAINT: {
        const ps = new PAINTSTRUCT();
        const hdc = user32.BeginPaint(hwnd, byref(ps));
        try {
          if (menu?.layout && level >= 0) this.#paint(menu, hdc);
        } catch (e) {
          console.error("Paint:", e);
        }
        user32.EndPaint(hwnd, byref(ps));
        return 0;
      }

      case WM_ERASEBKGND:
        return 1;

      case WM_DPICHANGED:
        // #openMenu() already sized the menu for the monitor it moves to.
        return 0;

      case WM_SETTINGCHANGE:
        // lParam "ImmersiveColorSet": the user switched between light and dark.
        if (lParam && wstring_at(lParam) === "ImmersiveColorSet") {
          this.#darkMode = isWindowsDarkMode();
          for (const open of this.#chain) user32.InvalidateRect(open.hwnd, null, 0);
        }
        break;

      case WM_TIMER:
        if (Number(wParam) === ID_HOVER_TIMER) this.#onHoverTimer();
        return 0;

      case WM_MOUSEMOVE:
        if (level >= 0) this.#onMouseMove(menu, level, GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        return 0;

      case WM_MOUSELEAVE:
        if (level >= 0) this.#onMouseLeave(menu, level);
        return 0;

      case WM_MOUSEACTIVATE:
        // A click in a submenu must not activate it: the root keeps the
        // foreground and the keyboard. DefWindowProcW would answer MA_ACTIVATE.
        return level > 0 ? MA_NOACTIVATE : MA_ACTIVATE;

      case WM_LBUTTONUP:
        if (level >= 0) this.#activate(level, this.#hitTest(menu, GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)), false);
        return 0;

      case WM_KEYDOWN:
        // The root has the keyboard focus; the keys drive the deepest menu in use.
        this.#onKeyDown(Number(wParam));
        return 0;

      case WM_CLOSE:
        this.stop();
        return 0;

      case WM_DESTROY:
        return 0;
    }

    return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

export default FluentTray;
