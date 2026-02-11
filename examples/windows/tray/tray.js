// FluentTray — Fluent Design system tray class for node-ctypes
// Inspired by pit-ray/fluent-tray (https://github.com/pit-ray/fluent-tray)
// API mirrors the C++ reference: create_tray, add_menu, add_separator, update_with_loop, stop

import { WinDLL, Structure, array, create_unicode_buffer, byref, c_byte, c_short, c_int, c_uint, c_long, c_void, c_void_p, c_wchar } from "node-ctypes";
import { Registry, HKEY } from "../registry/registry.js";

// ─── Win32 Constants ────────────────────────────────────────────────

const WS_POPUP = 0x80000000;
const WS_BORDER = 0x00800000;
const WS_SYSMENU = 0x00080000;
const WS_POPUPWINDOW = WS_POPUP | WS_BORDER | WS_SYSMENU;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_LAYERED = 0x00080000;

const WM_DESTROY = 0x0002;
const WM_PAINT = 0x000f;
const WM_CLOSE = 0x0010;
const WM_ERASEBKGND = 0x0014;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONUP = 0x0205;
const WM_MOUSELEAVE = 0x02a3;
const WM_APP = 0x8000;

const SW_HIDE = 0;
const NIM_ADD = 0x00000000;
const NIM_DELETE = 0x00000002;
const NIF_MESSAGE = 0x00000001;
const NIF_ICON = 0x00000002;
const NIF_TIP = 0x00000004;

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x00000010;

const TRANSPARENT = 1;
const DT_LEFT = 0x00000000;
const DT_VCENTER = 0x00000004;
const DT_SINGLELINE = 0x00000020;
const DT_NOPREFIX = 0x00000800;
const SRCCOPY = 0x00cc0020;
const PS_NULL = 5;
const FW_MEDIUM = 500;
const DEFAULT_CHARSET = 1;
const CLEARTYPE_QUALITY = 5;
const DI_NORMAL = 0x0003;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const LWA_ALPHA = 0x00000002;
const TME_LEAVE = 0x00000002;
const IDC_ARROW = 32512;
const SPI_GETWORKAREA = 0x0030;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;
const SWP_SHOWWINDOW = 0x0040;
const HWND_TOP = 0;
const PM_REMOVE = 0x0001;
const CS_HREDRAW = 0x0001;
const CS_VREDRAW = 0x0002;
const IDI_APPLICATION = 32512;

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
let dwmapi;
try {
  dwmapi = new WinDLL("dwmapi.dll");
} catch {
  dwmapi = null;
}

// kernel32
kernel32.GetModuleHandleW.argtypes = [c_void_p];
kernel32.GetModuleHandleW.restype = c_void_p;

// user32 — window management
user32.RegisterClassExW.argtypes = [c_void_p];
user32.RegisterClassExW.restype = c_short;
user32.CreateWindowExW.argtypes = [c_uint, c_void_p, c_void_p, c_uint, c_int, c_int, c_int, c_int, c_void_p, c_void_p, c_void_p, c_void_p];
user32.CreateWindowExW.restype = c_void_p;
user32.DefWindowProcW.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
user32.DefWindowProcW.restype = c_void_p;
user32.ShowWindow.argtypes = [c_void_p, c_int];
user32.ShowWindow.restype = c_int;
user32.SetWindowPos.argtypes = [c_void_p, c_void_p, c_int, c_int, c_int, c_int, c_uint];
user32.SetWindowPos.restype = c_int;
user32.SetForegroundWindow.argtypes = [c_void_p];
user32.SetForegroundWindow.restype = c_int;
user32.GetForegroundWindow.argtypes = [];
user32.GetForegroundWindow.restype = c_void_p;
user32.InvalidateRect.argtypes = [c_void_p, c_void_p, c_int];
user32.InvalidateRect.restype = c_int;
user32.GetClientRect.argtypes = [c_void_p, c_void_p];
user32.GetClientRect.restype = c_int;
user32.PostQuitMessage.argtypes = [c_int];
user32.PostQuitMessage.restype = c_void;
user32.PostMessageW.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
user32.PostMessageW.restype = c_int;

// user32 — message loop
user32.PeekMessageW.argtypes = [c_void_p, c_void_p, c_uint, c_uint, c_uint];
user32.PeekMessageW.restype = c_int;
user32.DispatchMessageW.argtypes = [c_void_p];
user32.DispatchMessageW.restype = c_void_p;

// user32 — resources
user32.LoadCursorW.argtypes = [c_void_p, c_uint];
user32.LoadCursorW.restype = c_void_p;
user32.LoadIconW.argtypes = [c_void_p, c_uint];
user32.LoadIconW.restype = c_void_p;
user32.LoadImageW.argtypes = [c_void_p, c_void_p, c_uint, c_int, c_int, c_uint];
user32.LoadImageW.restype = c_void_p;

// user32 — painting
user32.BeginPaint.argtypes = [c_void_p, c_void_p];
user32.BeginPaint.restype = c_void_p;
user32.EndPaint.argtypes = [c_void_p, c_void_p];
user32.EndPaint.restype = c_int;
user32.FillRect.argtypes = [c_void_p, c_void_p, c_void_p];
user32.FillRect.restype = c_int;
user32.DrawIconEx.argtypes = [c_void_p, c_int, c_int, c_void_p, c_int, c_int, c_uint, c_void_p, c_uint];
user32.DrawIconEx.restype = c_int;
user32.DrawTextW.argtypes = [c_void_p, c_void_p, c_int, c_void_p, c_uint];
user32.DrawTextW.restype = c_int;
user32.SetLayeredWindowAttributes.argtypes = [c_void_p, c_uint, c_uint, c_uint];
user32.SetLayeredWindowAttributes.restype = c_int;
user32.GetCursorPos.argtypes = [c_void_p];
user32.GetCursorPos.restype = c_int;
user32.TrackMouseEvent.argtypes = [c_void_p];
user32.TrackMouseEvent.restype = c_int;
user32.GetSystemMetrics.argtypes = [c_int];
user32.GetSystemMetrics.restype = c_int;
user32.SystemParametersInfoW.argtypes = [c_uint, c_uint, c_void_p, c_uint];
user32.SystemParametersInfoW.restype = c_int;

// gdi32
gdi32.CreateSolidBrush.argtypes = [c_uint];
gdi32.CreateSolidBrush.restype = c_void_p;
gdi32.CreatePen.argtypes = [c_int, c_int, c_uint];
gdi32.CreatePen.restype = c_void_p;
gdi32.DeleteObject.argtypes = [c_void_p];
gdi32.DeleteObject.restype = c_int;
gdi32.SelectObject.argtypes = [c_void_p, c_void_p];
gdi32.SelectObject.restype = c_void_p;
gdi32.CreateCompatibleDC.argtypes = [c_void_p];
gdi32.CreateCompatibleDC.restype = c_void_p;
gdi32.CreateCompatibleBitmap.argtypes = [c_void_p, c_int, c_int];
gdi32.CreateCompatibleBitmap.restype = c_void_p;
gdi32.DeleteDC.argtypes = [c_void_p];
gdi32.DeleteDC.restype = c_int;
gdi32.BitBlt.argtypes = [c_void_p, c_int, c_int, c_int, c_int, c_void_p, c_int, c_int, c_uint];
gdi32.BitBlt.restype = c_int;
gdi32.SetBkMode.argtypes = [c_void_p, c_int];
gdi32.SetBkMode.restype = c_int;
gdi32.SetTextColor.argtypes = [c_void_p, c_uint];
gdi32.SetTextColor.restype = c_uint;
gdi32.CreateFontW.argtypes = [c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_void_p];
gdi32.CreateFontW.restype = c_void_p;
gdi32.RoundRect.argtypes = [c_void_p, c_int, c_int, c_int, c_int, c_int, c_int];
gdi32.RoundRect.restype = c_int;

// shell32
shell32.Shell_NotifyIconW.argtypes = [c_uint, c_void_p];
shell32.Shell_NotifyIconW.restype = c_int;

// dwmapi
if (dwmapi) {
  try {
    dwmapi.DwmSetWindowAttribute.argtypes = [c_void_p, c_uint, c_void_p, c_uint];
    dwmapi.DwmSetWindowAttribute.restype = c_long;
  } catch {
    dwmapi = null;
  }
}

// ─── Structures ─────────────────────────────────────────────────────

class POINT extends Structure {
  static _fields_ = [
    ["x", c_long],
    ["y", c_long],
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

class GUID extends Structure {
  static _fields_ = [
    ["Data1", c_uint],
    ["Data2", c_short],
    ["Data3", c_short],
    ["Data4", array(c_byte, 8)],
  ];
}

class NOTIFYICONDATA extends Structure {
  static _fields_ = [
    ["cbSize", c_uint],
    ["hWnd", c_void_p],
    ["uID", c_uint],
    ["uFlags", c_uint],
    ["uCallbackMessage", c_uint],
    ["hIcon", c_void_p],
    ["szTip", array(c_wchar, 128)],
    ["dwState", c_uint],
    ["dwStateMask", c_uint],
    ["szInfo", array(c_wchar, 256)],
    ["uTimeoutOrVersion", c_uint],
    ["szInfoTitle", array(c_wchar, 64)],
    ["dwInfoFlags", c_uint],
    ["guidItem", GUID],
    ["hBalloonIcon", c_void_p],
  ];
}

class PAINTSTRUCT extends Structure {
  static _fields_ = [
    ["hdc", c_void_p],
    ["fErase", c_int],
    ["rcPaint", RECT],
    ["fRestore", c_int],
    ["fIncUpdate", c_int],
    ["rgbReserved", array(c_byte, 32)],
  ];
}

class TRACKMOUSEEVENT extends Structure {
  static _fields_ = [
    ["cbSize", c_uint],
    ["dwFlags", c_uint],
    ["hwndTrack", c_void_p],
    ["dwHoverTime", c_uint],
  ];
}

// ─── Layout ─────────────────────────────────────────────────────────

const MENU_PADDING_X = 5;
const MENU_PADDING_Y = 5;
const ITEM_HEIGHT = 36;
const SEPARATOR_HEIGHT = 9;
const ICON_SIZE = 16;
const ICON_MARGIN_LEFT = 12;
const TEXT_MARGIN_LEFT = 40;
const TEXT_MARGIN_RIGHT = 24;
const ITEM_BORDER_RADIUS = 4;
const CHECK_INDICATOR_W = 3;
const CHECK_INDICATOR_H = 16;
const MENU_MIN_WIDTH = 200;

const ITEM_NORMAL = 0;
const ITEM_SEPARATOR = 1;

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

// ─── FluentTray class ───────────────────────────────────────────────

let _instanceCounter = 0; // unique class name per instance

export class FluentTray {
  #hInstance;
  #hwnd = null;
  #visible = false;
  #nid = null;
  #status = TrayStatus.STOPPED;
  #menus = [];
  #appName = "";
  #hTrayIcon = null;
  #hoveredIndex = -1;
  #trackingMouse = false;
  #menuWidth = MENU_MIN_WIDTH;
  #menuHeight = 100;
  #menuHideTime = 0;
  #wndProcCb = null; // prevent GC
  #darkMode = false;
  #messageId;
  #opacity;

  /**
   * @param {object} [opts]
   * @param {number} [opts.message_id_offset=25] Unique message identifier offset
   * @param {number} [opts.opacity=250] Menu opacity 0-255
   */
  constructor(opts = {}) {
    this.#hInstance = kernel32.GetModuleHandleW(null);
    this.#messageId = WM_APP + (opts.message_id_offset ?? 25);
    this.#opacity = opts.opacity ?? 250;
    try {
      this.#darkMode = isWindowsDarkMode();
    } catch {}
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

    // Load icon
    if (icon_path) {
      try {
        this.#hTrayIcon = user32.LoadImageW(null, create_unicode_buffer(icon_path), IMAGE_ICON, 0, 0, LR_LOADFROMFILE);
      } catch {}
    }
    if (!this.#hTrayIcon) {
      this.#hTrayIcon = user32.LoadIconW(null, IDI_APPLICATION);
    }

    // Create popup window
    if (!this.#createWindow(round_corner)) return false;

    // Add tray icon
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
    const item = {
      type: ITEM_NORMAL,
      label,
      hIcon: null,
      checkable: toggleable,
      checked: false,
      enabled: true,
      onClick: callback,
      onUncheck: unchecked_callback,
    };

    if (icon_path) {
      try {
        item.hIcon = user32.LoadImageW(null, create_unicode_buffer(icon_path), IMAGE_ICON, ICON_SIZE, ICON_SIZE, LR_LOADFROMFILE);
      } catch {}
    }

    this.#menus.push(item);
    this.#recalcSize();
    return true;
  }

  /** Add a separator line under the last menu item added. */
  add_separator() {
    this.#menus.push({ type: ITEM_SEPARATOR });
    this.#recalcSize();
  }

  /**
   * Single update iteration. Returns false on failure.
   * @returns {boolean}
   */
  update() {
    if (this.#status === TrayStatus.FAILED) return false;

    const msg = new MSG();
    if (user32.PeekMessageW(byref(msg), this.#hwnd, 0, 0, PM_REMOVE)) {
      user32.DispatchMessageW(byref(msg));
    }

    // Dismiss when popup loses foreground (like C++ reference)
    if (this.#visible) {
      const fg = user32.GetForegroundWindow();
      if (BigInt(fg || 0) !== BigInt(this.#hwnd || 0)) {
        this.#hideMenu();
      }
    }

    return true;
  }

  /**
   * Create a message loop to update the tray.
   * @param {number} [sleep_ms=1]
   * @returns {Promise<boolean>}
   */
  async update_with_loop(sleep_ms = 1) {
    while (true) {
      if (this.#status === TrayStatus.SHOULD_STOP) {
        this.#status = TrayStatus.STOPPED;
        break;
      }
      if (!this.update()) return false;
      await new Promise((r) => setTimeout(r, sleep_ms));
    }
    return true;
  }

  /** Exit the tray successfully. */
  stop() {
    this.#removeNotifyIcon();
    this.#status = TrayStatus.SHOULD_STOP;
  }

  /** @returns {TrayStatus} */
  status() {
    return this.#status;
  }

  /** @returns {HWND} */
  window_handle() {
    return this.#hwnd;
  }

  /** Number of menu items (excluding separators). */
  count_menus() {
    return this.#menus.filter((m) => m.type === ITEM_NORMAL).length;
  }

  /** Iterator over menu items. */
  *[Symbol.iterator]() {
    for (const m of this.#menus) if (m.type === ITEM_NORMAL) yield m;
  }

  // ── Private: window creation ──────────────────────────────────────

  #createWindow(round_corner) {
    const className = create_unicode_buffer(`FluentTray_${++_instanceCounter}`);

    // Must bind WndProc to this instance via closure
    const self = this;
    this.#wndProcCb = user32.callback((hwnd, msg, wParam, lParam) => self.#wndProc(hwnd, msg, wParam, lParam), c_void_p, [c_void_p, c_uint, c_void_p, c_void_p]);

    const wc = new WNDCLASSEX();
    wc.cbSize = WNDCLASSEX.size;
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = this.#wndProcCb.pointer;
    wc.hInstance = this.#hInstance;
    wc.hIcon = user32.LoadIconW(null, IDI_APPLICATION);
    wc.hCursor = user32.LoadCursorW(null, IDC_ARROW);
    wc.lpszClassName = className;

    if (!user32.RegisterClassExW(byref(wc))) return false;

    this.#hwnd = user32.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_LAYERED, className, className, WS_POPUPWINDOW, 0, 0, 100, 100, null, null, this.#hInstance, null);
    if (!this.#hwnd) return false;

    user32.SetLayeredWindowAttributes(this.#hwnd, 0, this.#opacity, LWA_ALPHA);

    if (round_corner && dwmapi) {
      try {
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(2, 0);
        dwmapi.DwmSetWindowAttribute(this.#hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, buf, 4);
      } catch {}
    }

    return true;
  }

  // ── Private: notify icon ──────────────────────────────────────────

  #addNotifyIcon() {
    this.#nid = new NOTIFYICONDATA();
    this.#nid.cbSize = NOTIFYICONDATA.size;
    this.#nid.hWnd = this.#hwnd;
    this.#nid.uID = 1;
    this.#nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    this.#nid.uCallbackMessage = this.#messageId;
    this.#nid.hIcon = this.#hTrayIcon;
    this.#nid.szTip = Buffer.from(this.#appName.substring(0, 127) + "\0", "utf16le");
    shell32.Shell_NotifyIconW(NIM_ADD, byref(this.#nid));
  }

  #removeNotifyIcon() {
    if (this.#nid) shell32.Shell_NotifyIconW(NIM_DELETE, byref(this.#nid));
  }

  // ── Private: menu size ────────────────────────────────────────────

  #recalcSize() {
    let h = MENU_PADDING_Y * 2,
      w = MENU_MIN_WIDTH;
    for (const item of this.#menus) {
      if (item.type === ITEM_SEPARATOR) {
        h += SEPARATOR_HEIGHT;
      } else {
        h += ITEM_HEIGHT;
        const tw = TEXT_MARGIN_LEFT + item.label.length * 8 + TEXT_MARGIN_RIGHT;
        if (tw > w) w = tw;
      }
    }
    this.#menuWidth = w;
    this.#menuHeight = h;
  }

  // ── Private: hit test ─────────────────────────────────────────────

  #hitTest(x, y) {
    let cy = MENU_PADDING_Y;
    for (let i = 0; i < this.#menus.length; i++) {
      const item = this.#menus[i];
      const h = item.type === ITEM_SEPARATOR ? SEPARATOR_HEIGHT : ITEM_HEIGHT;
      if (item.type === ITEM_NORMAL && y >= cy && y < cy + h && x >= MENU_PADDING_X && x < this.#menuWidth - MENU_PADDING_X) return i;
      cy += h;
    }
    return -1;
  }

  // ── Private: show / hide ──────────────────────────────────────────

  #showMenu() {
    if (!this.#hwnd) return;
    this.#recalcSize();
    this.#hoveredIndex = -1;

    const pt = new POINT();
    if (!user32.GetCursorPos(byref(pt))) return;
    const cx = Number(pt.x),
      cy = Number(pt.y);

    const wr = new RECT();
    user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, byref(wr), 0);
    const screenW = Number(user32.GetSystemMetrics(SM_CXSCREEN));
    const screenH = Number(user32.GetSystemMetrics(SM_CYSCREEN));
    const workW = Number(wr.right) - Number(wr.left);
    const workH = Number(wr.bottom) - Number(wr.top);
    const taskbarW = screenW - workW,
      taskbarH = screenH - workH;

    let x = cx,
      y = cy;
    if (taskbarW === 0) {
      y = cy <= taskbarH ? taskbarH : screenH - (this.#menuHeight + Math.floor((taskbarH * 12) / 10));
      x = cx - Math.floor(this.#menuWidth / 2);
    } else {
      x = cx <= taskbarW ? taskbarW : screenW - (this.#menuWidth + Math.floor((taskbarW * 12) / 10));
      y = cy - Math.floor(this.#menuHeight / 2);
    }

    user32.SetWindowPos(this.#hwnd, HWND_TOP, x, y, this.#menuWidth, this.#menuHeight, SWP_SHOWWINDOW);
    user32.SetForegroundWindow(this.#hwnd);
    this.#visible = true;
  }

  #hideMenu() {
    if (!this.#hwnd) return;
    user32.ShowWindow(this.#hwnd, SW_HIDE);
    this.#visible = false;
    this.#hoveredIndex = -1;
    this.#trackingMouse = false;
    this.#menuHideTime = Date.now();
  }

  // ── Private: painting ─────────────────────────────────────────────

  #paint(hwnd, hdc) {
    const colors = this.#darkMode ? THEMES.dark : THEMES.light;
    const rc = new RECT();
    user32.GetClientRect(hwnd, byref(rc));
    const w = Number(rc.right),
      h = Number(rc.bottom);

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

    // Font
    const hFont = gdi32.CreateFontW(-14, 0, 0, 0, FW_MEDIUM, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, create_unicode_buffer("Segoe UI"));
    const oldFont = gdi32.SelectObject(memDC, hFont);
    gdi32.SetBkMode(memDC, TRANSPARENT);

    let currentY = MENU_PADDING_Y;
    for (let i = 0; i < this.#menus.length; i++) {
      const item = this.#menus[i];

      if (item.type === ITEM_SEPARATOR) {
        const sepY = currentY + (SEPARATOR_HEIGHT >> 1);
        const sb = gdi32.CreateSolidBrush(colors.separator);
        const sr = new RECT();
        sr.left = MENU_PADDING_X + ICON_MARGIN_LEFT;
        sr.top = sepY;
        sr.right = w - MENU_PADDING_X - 8;
        sr.bottom = sepY + 1;
        user32.FillRect(memDC, byref(sr), sb);
        gdi32.DeleteObject(sb);
        currentY += SEPARATOR_HEIGHT;
        continue;
      }

      const hovered = i === this.#hoveredIndex;
      const il = MENU_PADDING_X,
        ir = w - MENU_PADDING_X,
        it = currentY,
        ib = currentY + ITEM_HEIGHT;

      if (hovered && item.enabled) {
        const hb = gdi32.CreateSolidBrush(colors.bgHover),
          hp = gdi32.CreatePen(PS_NULL, 0, 0);
        const oP = gdi32.SelectObject(memDC, hp),
          oB = gdi32.SelectObject(memDC, hb);
        gdi32.RoundRect(memDC, il, it, ir, ib, ITEM_BORDER_RADIUS * 2, ITEM_BORDER_RADIUS * 2);
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
        const iy = it + ((ITEM_HEIGHT - CHECK_INDICATOR_H) >> 1);
        const ar = new RECT();
        ar.left = il + 4;
        ar.top = iy;
        ar.right = il + 4 + CHECK_INDICATOR_W;
        ar.bottom = iy + CHECK_INDICATOR_H;
        user32.FillRect(memDC, byref(ar), ab);
        gdi32.DeleteObject(ab);
      }

      if (item.hIcon) user32.DrawIconEx(memDC, il + ICON_MARGIN_LEFT, it + ((ITEM_HEIGHT - ICON_SIZE) >> 1), item.hIcon, ICON_SIZE, ICON_SIZE, 0, null, DI_NORMAL);

      gdi32.SetTextColor(memDC, item.enabled ? colors.text : colors.textDisabled);
      const tr = new RECT();
      tr.left = il + TEXT_MARGIN_LEFT;
      tr.top = it;
      tr.right = ir - 8;
      tr.bottom = ib;
      user32.DrawTextW(memDC, create_unicode_buffer(item.label), -1, byref(tr), DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);

      currentY += ITEM_HEIGHT;
    }

    gdi32.SelectObject(memDC, oldFont);
    gdi32.DeleteObject(hFont);
    gdi32.BitBlt(hdc, 0, 0, w, h, memDC, 0, 0, SRCCOPY);
    gdi32.SelectObject(memDC, oldBmp);
    gdi32.DeleteObject(memBmp);
    gdi32.DeleteDC(memDC);
  }

  // ── Private: WndProc ──────────────────────────────────────────────

  #wndProc(hwnd, msg, wParam, lParam) {
    const m = Number(msg);

    // Tray icon callback — toggle
    if (m === this.#messageId) {
      const event = LOWORD(lParam);
      if (event === WM_LBUTTONUP || event === WM_RBUTTONUP) {
        if (this.#visible) {
          this.#hideMenu();
        } else if (Date.now() - this.#menuHideTime > 300) {
          this.#showMenu();
        }
      }
      return 0n;
    }

    switch (m) {
      case WM_PAINT: {
        const ps = new PAINTSTRUCT();
        const hdc = user32.BeginPaint(hwnd, byref(ps));
        try {
          if (this.#visible) this.#paint(hwnd, hdc);
        } catch (e) {
          console.error("Paint:", e);
        }
        user32.EndPaint(hwnd, byref(ps));
        return 0n;
      }

      case WM_ERASEBKGND:
        return 1n;

      case WM_MOUSEMOVE: {
        const idx = this.#hitTest(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        if (idx !== this.#hoveredIndex) {
          this.#hoveredIndex = idx;
          user32.InvalidateRect(hwnd, null, 0);
        }
        if (!this.#trackingMouse) {
          const tme = new TRACKMOUSEEVENT();
          tme.cbSize = TRACKMOUSEEVENT.size;
          tme.dwFlags = TME_LEAVE;
          tme.hwndTrack = hwnd;
          user32.TrackMouseEvent(byref(tme));
          this.#trackingMouse = true;
        }
        return 0n;
      }

      case WM_MOUSELEAVE:
        this.#trackingMouse = false;
        if (this.#hoveredIndex !== -1) {
          this.#hoveredIndex = -1;
          user32.InvalidateRect(hwnd, null, 0);
        }
        return 0n;

      case WM_LBUTTONUP: {
        const idx = this.#hitTest(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        if (idx >= 0) {
          const item = this.#menus[idx];
          if (item && item.type === ITEM_NORMAL && item.enabled) {
            if (item.checkable) {
              item.checked = !item.checked;
              if (!item.checked && item.onUncheck) {
                if (item.onUncheck() === false) {
                  this.stop();
                  return 0n;
                }
              } else if (item.onClick) {
                if (item.onClick() === false) {
                  this.stop();
                  return 0n;
                }
              }
            } else if (item.onClick) {
              if (item.onClick() === false) {
                this.stop();
                return 0n;
              }
            }
            this.#hideMenu();
          }
        }
        return 0n;
      }

      case WM_DESTROY:
      case WM_CLOSE:
        this.stop();
        return 0n;
    }

    return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

export default FluentTray;
