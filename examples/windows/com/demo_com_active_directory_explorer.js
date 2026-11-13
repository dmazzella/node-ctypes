// Active Directory Explorer — a Win32 browser of Active Directory with node-ctypes
//
// The domain as a tree of containers (TreeView, read lazily), the objects of
// the selected container (virtual ListView), the attributes of the selected
// object, and a search box (Ambiguous Name Resolution, or an LDAP filter).
// Navigate by expanding the tree, double-clicking objects, and double-clicking
// distinguished names among the attributes (memberOf, member, manager, ...).
// The base DN, above the search box, is one of the naming contexts listed by
// the RootDSE: domain, configuration, schema, DNS zones.
// The searches run in a worker (ads.js AdsWorker): the window never blocks,
// and the panes show skeleton rows while they load.
// Icons are the Active Directory ones (dsuiext.dll DsGetIcon), as in "Active
// Directory Users and Computers". Directory access: ./ads.js (ADSI
// through COM: ADsOpenObject + IDirectorySearch, values typed by ADSI, signed
// and sealed sessions, connection kept open between searches).
//
// Usage:
//   node examples/windows/com/demo_com_active_directory_explorer.js
//   node examples/windows/com/demo_com_active_directory_explorer.js --base "LDAP://DC=corp,DC=example,DC=com"
//   node examples/windows/com/demo_com_active_directory_explorer.js --host dc01.corp.example.com --user admin --pass secret --domain CORP

import { WinDLL, Structure, POINTER, WINFUNCTYPE, WinError, get_last_error, array, byref, cast, c_int, c_ssize_t, c_void, create_unicode_buffer, memmove, sizeof, wstring_at } from "node-ctypes";
import { wintypes } from "node-ctypes";
import { AdsWorker, SCOPE, adsPath } from "./ads.js";
const {
  ATOM,
  BOOL,
  BYTE,
  DWORD,
  HANDLE,
  HBRUSH,
  HCURSOR,
  HFONT,
  HGDIOBJ,
  HICON,
  HINSTANCE,
  HMENU,
  HMODULE,
  HWND,
  INT,
  LANGID,
  LONG,
  LPARAM,
  LPCWSTR,
  LPVOID,
  LPWSTR,
  LRESULT,
  MSG,
  POINT,
  RECT,
  UINT,
  UINT_PTR,
  ULONG,
  ULONG_PTR,
  USHORT,
  WCHAR,
  WPARAM,
} = wintypes;
const LONG_PTR = c_ssize_t;
// LRESULT CALLBACK WindowProc(HWND, UINT, WPARAM, LPARAM)
const WNDPROC = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPARAM);

// Win32 macros (not provided by ctypes itself; inline-defined as in typical Python scripts)
const LOWORD = (x) => Number(x) & 0xffff;
const HIWORD = (x) => (Number(x) >> 16) & 0xffff;
const SIGNED = (v) => (v & 0x8000 ? v - 0x10000 : v);
// HWND, LPARAM and WPARAM values are BigInt (or null for NULL handles).
const sameHandle = (a, b) => a !== null && b !== null && BigInt(a) === BigInt(b);

// ─── Constants (values from the Windows SDK headers) ────────────────

const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_TABSTOP = 0x00010000;
const WS_EX_CLIENTEDGE = 0x00000200;
const WS_EX_CONTROLPARENT = 0x00010000;
const CW_USEDEFAULT = 0x80000000;
const SW_SHOW = 5;
const WS_VSCROLL = 0x00200000;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const FALT = 0x10;
const VK_UP = 0x26;
const COLOR_BTNFACE = 15;
const IDC_ARROW = 32512;
const IDC_SIZEWE = 32644;
const IDC_SIZENS = 32645;
const HTCLIENT = 1;
const IDOK = 1;

const WM_DESTROY = 0x0002;
const WM_SIZE = 0x0005;
const WM_SETFONT = 0x0030;
const WM_SETTINGCHANGE = 0x001a;
const WM_SETCURSOR = 0x0020;
const WM_GETMINMAXINFO = 0x0024;
const WM_NOTIFY = 0x004e;
const WM_CONTEXTMENU = 0x007b;
const WM_COMMAND = 0x0111;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_CAPTURECHANGED = 0x0215;
const WM_DPICHANGED = 0x02e0;
const WM_TIMER = 0x0113;
const WM_APP = 0x8000;
const WM_ADS_REPLY = WM_APP + 1; // posted by the AdsWorker thread after each reply
const ID_SKELETON_TIMER = 1;
const COLOR_WINDOW = 5;
const NULL_PEN = 8;

const BS_DEFPUSHBUTTON = 0x0001;
const ES_AUTOHSCROLL = 0x0080;
// Combo box (the base DN)
const CBS_DROPDOWNLIST = 0x0003;
const CB_ADDSTRING = 0x0143;
const CB_GETCURSEL = 0x0147;
const CB_RESETCONTENT = 0x014b;
const CB_SETCURSEL = 0x014e;
const CB_SHOWDROPDOWN = 0x014f;
const CB_SETITEMHEIGHT = 0x0153;
const CBN_SELCHANGE = 1;
const EN_CHANGE = 0x0300;
const EM_SETSEL = 0x00b1;
const EM_SETCUEBANNER = 0x1501;
const MF_STRING = 0x0000;
const MF_GRAYED = 0x0001;
const MF_SEPARATOR = 0x0800;
const TPM_RIGHTBUTTON = 0x0002;
const FVIRTKEY = 0x01;
const FCONTROL = 0x08;
const VK_F5 = 0x74;
const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

// Common controls
const ICC_LISTVIEW_CLASSES = 0x0001;
const ICC_TREEVIEW_CLASSES = 0x0002;
const ICC_BAR_CLASSES = 0x0004;
const ICC_STANDARD_CLASSES = 0x4000;
const SBARS_SIZEGRIP = 0x0100;
const SB_SETPARTS = 0x0404;
const SB_SETTEXTW = 0x040b;
const ILC_MASK = 0x0001;
const ILC_COLOR32 = 0x0020;
// Notifications: negative codes (NMHDR.code is read as unsigned, see notifyCode)
const NM_DBLCLK = -3;
const NM_CUSTOMDRAW = -12;
// NM_CUSTOMDRAW stages and results
const CDDS_PREPAINT = 0x00000001;
const CDDS_ITEMPREPAINT = 0x00010001;
const CDRF_DODEFAULT = 0x00000000;
const CDRF_SKIPDEFAULT = 0x00000004;
const CDRF_NOTIFYITEMDRAW = 0x00000020;
const TVN_SELCHANGEDW = -451;
const TVN_ITEMEXPANDINGW = -454;
const LVN_ITEMCHANGED = -101;
const LVN_COLUMNCLICK = -108;
const LVN_ITEMACTIVATE = -114;
const LVN_GETDISPINFOW = -177;
// Tree view
const TVS_HASBUTTONS = 0x0001;
const TVS_LINESATROOT = 0x0004;
const TVS_SHOWSELALWAYS = 0x0020;
const TVS_FULLROWSELECT = 0x1000;
const TVS_EX_DOUBLEBUFFER = 0x0004;
const TVM_DELETEITEM = 0x1101;
const TVM_EXPAND = 0x1102;
const TVM_GETITEMSTATE = 0x1127;
const TVM_SETIMAGELIST = 0x1109;
const TVM_SELECTITEM = 0x110b;
const TVM_GETITEMRECT = 0x1104;
const TVM_HITTEST = 0x1111;
const TVM_ENSUREVISIBLE = 0x1114;
const TVM_SETEXTENDEDSTYLE = 0x112c;
const TVM_INSERTITEMW = 0x1132;
const TVM_SETITEMW = 0x113f;
const TVIF_TEXT = 0x0001;
const TVIF_IMAGE = 0x0002;
const TVIF_PARAM = 0x0004;
const TVIF_STATE = 0x0008;
const TVIF_HANDLE = 0x0010;
const TVIF_SELECTEDIMAGE = 0x0020;
const TVIF_CHILDREN = 0x0040;
const TVI_ROOT = -0x10000;
const TVI_LAST = -0xfffe;
const TVIS_BOLD = 0x0010;
const TVE_COLLAPSE = 0x0001;
const TVE_EXPAND = 0x0002;
const TVIS_EXPANDED = 0x0020;
const TVGN_DROPHILITE = 0x0008;
const TVGN_CARET = 0x0009;
const TVSIL_NORMAL = 0;
// List view (virtual: LVS_OWNERDATA) and its header
const LVS_REPORT = 0x0001;
const LVS_SINGLESEL = 0x0004;
const LVS_SHOWSELALWAYS = 0x0008;
const LVS_OWNERDATA = 0x1000;
const LVS_EX_HEADERDRAGDROP = 0x0010;
const LVS_EX_FULLROWSELECT = 0x0020;
const LVS_EX_LABELTIP = 0x4000;
const LVS_EX_DOUBLEBUFFER = 0x10000;
const LVM_SETIMAGELIST = 0x1003;
const LVM_GETNEXTITEM = 0x100c;
const LVM_ENSUREVISIBLE = 0x1013;
const LVM_GETCOLUMNWIDTH = 0x101d;
const LVM_GETHEADER = 0x101f;
const LVM_SETITEMSTATE = 0x102b;
const LVM_SETITEMCOUNT = 0x102f;
const LVM_SETEXTENDEDLISTVIEWSTYLE = 0x1036;
const LVM_INSERTCOLUMNW = 0x1061;
const LVSIL_SMALL = 1;
const LVNI_SELECTED = 0x0002;
const LVIS_FOCUSED = 0x0001;
const LVIS_SELECTED = 0x0002;
const LVCF_FMT = 0x0001;
const LVCF_WIDTH = 0x0002;
const LVCF_TEXT = 0x0004;
const LVIF_TEXT = 0x0001;
const LVIF_IMAGE = 0x0002;
const HDM_GETITEMW = 0x120b;
const HDM_SETITEMW = 0x120c;
const HDI_FORMAT = 0x0004;
const HDF_SORTDOWN = 0x0200;
const HDF_SORTUP = 0x0400;
// Active Directory icons (dsuiext.h)
const DSGIF_ISNORMAL = 0x0000;
const DSGIF_ISOPEN = 0x0001;
const DSGIF_ISDISABLED = 0x0002;
const DSGIF_GETDEFAULTICON = 0x0010;
const SM_CXSMICON = 49;
// DWM, registry, activation context and DPI
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const HKEY_CURRENT_USER = -0x7fffffff; // (HKEY)(ULONG_PTR)(LONG)0x80000001: sign-extended
const RRF_RT_REG_DWORD = 0x0010;
const ACTCTX_FLAG_RESOURCE_NAME_VALID = 0x008;
const INVALID_HANDLE_VALUE = -1n;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const SPI_GETNONCLIENTMETRICS = 0x0029;
const USER_DEFAULT_SCREEN_DPI = 96;
const ComputerNameDnsDomain = 2;

// Control and command IDs
const ID_SEARCH_EDIT = 2001;
const ID_SEARCH = 2002;
const ID_TREE = 2003;
const ID_LIST = 2004;
const ID_DETAILS = 2005;
const ID_BASE = 2006;
const IDM_REFRESH = 3001;
const IDM_FIND = 3002;
const IDM_UP = 3003;
const IDM_BASE = 3004;
const IDM_OPEN = 3010;
const IDM_COPY_DN = 3011;
const IDM_COPY_VALUE = 3012;

// ─── Structures ─────────────────────────────────────────────────────
// POINT, RECT and MSG come from wintypes (Python: ctypes.wintypes).

class ACTCTXW extends Structure {
  static _fields_ = [
    ["cbSize", ULONG],
    ["dwFlags", DWORD],
    ["lpSource", LPCWSTR],
    ["wProcessorArchitecture", USHORT],
    ["wLangId", LANGID],
    ["lpAssemblyDirectory", LPCWSTR],
    ["lpResourceName", LPVOID], // MAKEINTRESOURCE(id): an integer in a pointer
    ["lpApplicationName", LPCWSTR],
    ["hModule", HMODULE],
  ];
}

class INITCOMMONCONTROLSEX extends Structure {
  static _fields_ = [
    ["dwSize", DWORD],
    ["dwICC", DWORD],
  ];
}

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

class MINMAXINFO extends Structure {
  static _fields_ = [
    ["ptReserved", POINT],
    ["ptMaxSize", POINT],
    ["ptMaxPosition", POINT],
    ["ptMinTrackSize", POINT],
    ["ptMaxTrackSize", POINT],
  ];
}

class LOGFONTW extends Structure {
  static _fields_ = [
    ["lfHeight", LONG],
    ["lfWidth", LONG],
    ["lfEscapement", LONG],
    ["lfOrientation", LONG],
    ["lfWeight", LONG],
    ["lfItalic", BYTE],
    ["lfUnderline", BYTE],
    ["lfStrikeOut", BYTE],
    ["lfCharSet", BYTE],
    ["lfOutPrecision", BYTE],
    ["lfClipPrecision", BYTE],
    ["lfQuality", BYTE],
    ["lfPitchAndFamily", BYTE],
    ["lfFaceName", array(WCHAR, 32)],
  ];
}

class NONCLIENTMETRICSW extends Structure {
  static _fields_ = [
    ["cbSize", UINT],
    ["iBorderWidth", INT],
    ["iScrollWidth", INT],
    ["iScrollHeight", INT],
    ["iCaptionWidth", INT],
    ["iCaptionHeight", INT],
    ["lfCaptionFont", LOGFONTW],
    ["iSmCaptionWidth", INT],
    ["iSmCaptionHeight", INT],
    ["lfSmCaptionFont", LOGFONTW],
    ["iMenuWidth", INT],
    ["iMenuHeight", INT],
    ["lfMenuFont", LOGFONTW],
    ["lfStatusFont", LOGFONTW],
    ["lfMessageFont", LOGFONTW],
    ["iPaddedBorderWidth", INT],
  ];
}

class NMHDR extends Structure {
  static _fields_ = [
    ["hwndFrom", HWND],
    ["idFrom", UINT_PTR],
    ["code", UINT],
  ];
}

// The common part of NMLVCUSTOMDRAW / NMTVCUSTOMDRAW: enough to draw a row.
class NMCUSTOMDRAW extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["dwDrawStage", DWORD],
    ["hdc", HANDLE],
    ["rc", RECT],
    ["dwItemSpec", ULONG_PTR],
    ["uItemState", UINT],
    ["lItemlParam", LPARAM],
  ];
}

// HTREEITEM values include TVI_ROOT / TVI_LAST (negative pseudo-handles): LONG_PTR.
class TVITEMW extends Structure {
  static _fields_ = [
    ["mask", UINT],
    ["hItem", LONG_PTR],
    ["state", UINT],
    ["stateMask", UINT],
    ["pszText", LPWSTR],
    ["cchTextMax", INT],
    ["iImage", INT],
    ["iSelectedImage", INT],
    ["cChildren", INT],
    ["lParam", LPARAM],
  ];
}

class TVINSERTSTRUCTW extends Structure {
  static _fields_ = [
    ["hParent", LONG_PTR],
    ["hInsertAfter", LONG_PTR],
    ["item", TVITEMW], // a union with TVITEMEXW in the header: TVITEMW is enough here
  ];
}

class NMTREEVIEWW extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["action", UINT],
    ["itemOld", TVITEMW],
    ["itemNew", TVITEMW],
    ["ptDrag", POINT],
  ];
}

class TVHITTESTINFO extends Structure {
  static _fields_ = [
    ["pt", POINT],
    ["flags", UINT],
    ["hItem", LONG_PTR],
  ];
}

class LVCOLUMNW extends Structure {
  static _fields_ = [
    ["mask", UINT],
    ["fmt", INT],
    ["cx", INT],
    ["pszText", LPWSTR],
    ["cchTextMax", INT],
    ["iSubItem", INT],
    ["iImage", INT],
    ["iOrder", INT],
    ["cxMin", INT],
    ["cxDefault", INT],
    ["cxIdeal", INT],
  ];
}

// pszText is the address of the list view's own buffer in LVN_GETDISPINFOW: LPVOID.
class LVITEMW extends Structure {
  static _fields_ = [
    ["mask", UINT],
    ["iItem", INT],
    ["iSubItem", INT],
    ["state", UINT],
    ["stateMask", UINT],
    ["pszText", LPVOID],
    ["cchTextMax", INT],
    ["iImage", INT],
    ["lParam", LPARAM],
    ["iIndent", INT],
    ["iGroupId", INT],
    ["cColumns", UINT],
    ["puColumns", LPVOID],
    ["piColFmt", LPVOID],
    ["iGroup", INT],
  ];
}

class NMLVDISPINFOW extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["item", LVITEMW],
  ];
}

class NMLISTVIEW extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["iItem", INT],
    ["iSubItem", INT],
    ["uNewState", UINT],
    ["uOldState", UINT],
    ["uChanged", UINT],
    ["ptAction", POINT],
    ["lParam", LPARAM],
  ];
}

class HDITEMW extends Structure {
  static _fields_ = [
    ["mask", UINT],
    ["cxy", INT],
    ["pszText", LPWSTR],
    ["hbm", HANDLE],
    ["cchTextMax", INT],
    ["fmt", INT],
    ["lParam", LPARAM],
    ["iImage", INT],
    ["iOrder", INT],
    ["type", UINT],
    ["pvFilter", LPVOID],
    ["state", UINT],
  ];
}

class ACCEL extends Structure {
  static _fields_ = [
    ["fVirt", BYTE],
    ["key", USHORT],
    ["cmd", USHORT],
  ];
}

// ─── Function signatures (Python-ctypes style: argtypes / restype) ──

const kernel32 = new WinDLL("kernel32.dll", { use_last_error: true });
const user32 = new WinDLL("user32.dll", { use_last_error: true });
const gdi32 = new WinDLL("gdi32.dll");
const advapi32 = new WinDLL("advapi32.dll");
const dwmapi = new WinDLL("dwmapi.dll");
const uxtheme = new WinDLL("uxtheme.dll");
const dsuiext = new WinDLL("dsuiext.dll");

function prototype(fn, restype, argtypes) {
  fn.restype = restype;
  fn.argtypes = argtypes;
}

prototype(kernel32.GetModuleHandleW, HMODULE, [LPCWSTR]);
prototype(kernel32.CreateActCtxW, HANDLE, [POINTER(ACTCTXW)]);
prototype(kernel32.ActivateActCtx, BOOL, [HANDLE, POINTER(ULONG_PTR)]);
prototype(kernel32.GetComputerNameExW, BOOL, [INT, LPWSTR, POINTER(DWORD)]);
prototype(kernel32.GlobalAlloc, HANDLE, [UINT, c_ssize_t]);
prototype(kernel32.GlobalLock, LPVOID, [HANDLE]);
prototype(kernel32.GlobalUnlock, BOOL, [HANDLE]);
prototype(kernel32.GlobalFree, HANDLE, [HANDLE]);

// DPI_AWARENESS_CONTEXT is a pseudo-handle with a negative value (-4).
prototype(user32.SetProcessDpiAwarenessContext, BOOL, [c_ssize_t]);
prototype(user32.GetDpiForWindow, UINT, [HWND]);
prototype(user32.GetDpiForSystem, UINT, []);
prototype(user32.GetSystemMetricsForDpi, INT, [INT, UINT]);
prototype(user32.SystemParametersInfoForDpi, BOOL, [UINT, UINT, LPVOID, UINT, UINT]);
prototype(user32.RegisterClassExW, ATOM, [POINTER(WNDCLASSEX)]);
prototype(user32.CreateWindowExW, HWND, [DWORD, LPCWSTR, LPCWSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, LPVOID]);
prototype(user32.ShowWindow, BOOL, [HWND, INT]);
prototype(user32.SetWindowPos, BOOL, [HWND, HWND, INT, INT, INT, INT, UINT]);
prototype(user32.UpdateWindow, BOOL, [HWND]);
prototype(user32.SetWindowTextW, BOOL, [HWND, LPCWSTR]);
prototype(user32.GetWindowTextW, INT, [HWND, LPWSTR, INT]);
prototype(user32.SetFocus, HWND, [HWND]);
prototype(user32.InvalidateRect, BOOL, [HWND, POINTER(RECT), BOOL]);
prototype(user32.GetMessageW, BOOL, [POINTER(MSG), HWND, UINT, UINT]);
prototype(user32.IsDialogMessageW, BOOL, [HWND, POINTER(MSG)]);
prototype(user32.TranslateAcceleratorW, INT, [HWND, HANDLE, POINTER(MSG)]);
prototype(user32.TranslateMessage, BOOL, [POINTER(MSG)]);
prototype(user32.DispatchMessageW, LRESULT, [POINTER(MSG)]);
prototype(user32.DefWindowProcW, LRESULT, [HWND, UINT, WPARAM, LPARAM]);
prototype(user32.PostQuitMessage, c_void, [INT]);
prototype(user32.LoadCursorW, HCURSOR, [HINSTANCE, LPVOID]);
prototype(user32.SetCursor, HCURSOR, [HCURSOR]);
prototype(user32.SetCapture, HWND, [HWND]);
prototype(user32.ReleaseCapture, BOOL, []);
prototype(user32.GetClientRect, BOOL, [HWND, POINTER(RECT)]);
prototype(user32.GetWindowRect, BOOL, [HWND, POINTER(RECT)]);
prototype(user32.GetCursorPos, BOOL, [POINTER(POINT)]);
prototype(user32.ScreenToClient, BOOL, [HWND, POINTER(POINT)]);
prototype(user32.BeginDeferWindowPos, HANDLE, [INT]);
prototype(user32.DeferWindowPos, HANDLE, [HANDLE, HWND, HWND, INT, INT, INT, INT, UINT]);
prototype(user32.EndDeferWindowPos, BOOL, [HANDLE]);
prototype(user32.CreatePopupMenu, HMENU, []);
prototype(user32.AppendMenuW, BOOL, [HMENU, UINT, UINT_PTR, LPCWSTR]);
prototype(user32.DestroyMenu, BOOL, [HMENU]);
prototype(user32.TrackPopupMenuEx, BOOL, [HMENU, UINT, INT, INT, HWND, LPVOID]);
prototype(user32.CreateAcceleratorTableW, HANDLE, [POINTER(ACCEL), INT]);
prototype(user32.DestroyAcceleratorTable, BOOL, [HANDLE]);
prototype(user32.OpenClipboard, BOOL, [HWND]);
prototype(user32.EmptyClipboard, BOOL, []);
prototype(user32.SetClipboardData, HANDLE, [UINT, HANDLE]);
prototype(user32.CloseClipboard, BOOL, []);
prototype(user32.DestroyIcon, BOOL, [HICON]);
prototype(user32.SetTimer, UINT_PTR, [HWND, UINT_PTR, UINT, LPVOID]);
prototype(user32.KillTimer, BOOL, [HWND, UINT_PTR]);
prototype(user32.FillRect, INT, [HANDLE, POINTER(RECT), HBRUSH]);
prototype(user32.GetSysColorBrush, HBRUSH, [INT]);
prototype(user32.SendMessageW, LRESULT, [HWND, UINT, WPARAM, LPARAM]);
// SendMessageW with a string / structure as lParam: same export, typed
// prototypes (Python: WINFUNCTYPE(...)(("SendMessageW", user32))).
const SendMessageStrW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPCWSTR)(["SendMessageW", user32]);
const SendMessagePtrW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPVOID)(["SendMessageW", user32]);

prototype(gdi32.CreateFontIndirectW, HFONT, [POINTER(LOGFONTW)]);
prototype(gdi32.DeleteObject, BOOL, [HGDIOBJ]);
prototype(gdi32.CreateSolidBrush, HBRUSH, [DWORD]);
prototype(gdi32.SelectObject, HGDIOBJ, [HANDLE, HGDIOBJ]);
prototype(gdi32.GetStockObject, HGDIOBJ, [INT]);
prototype(gdi32.RoundRect, BOOL, [HANDLE, INT, INT, INT, INT, INT, INT]);
prototype(advapi32.RegGetValueW, LONG, [LONG_PTR, LPCWSTR, LPCWSTR, DWORD, LPVOID, LPVOID, POINTER(DWORD)]);
prototype(dwmapi.DwmSetWindowAttribute, LONG, [HWND, DWORD, LPVOID, DWORD]);
prototype(uxtheme.SetWindowTheme, LONG, [HWND, LPCWSTR, LPCWSTR]);
// HICON DsGetIcon(DWORD dwFlags, LPWSTR pObjectClass, INT cxImage, INT cyImage):
// the icon of an Active Directory class, as the directory UI shows it.
prototype(dsuiext.DsGetIcon, HICON, [DWORD, LPCWSTR, INT, INT]);

// ─── Process setup: per-monitor DPI awareness and Common Controls 6 ─

// Fails if the awareness is already set: the demo then uses what the process has.
user32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

// node.exe has no manifest asking for Common Controls 6: activate the one that
// shell32.dll embeds as resource 124 before comctl32.dll is loaded.
const actctx = new ACTCTXW();
actctx.cbSize = sizeof(ACTCTXW);
actctx.dwFlags = ACTCTX_FLAG_RESOURCE_NAME_VALID;
actctx.lpSource = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\shell32.dll`;
actctx.lpResourceName = 124;
const hActCtx = kernel32.CreateActCtxW(byref(actctx));
const actCtxCookie = new ULONG_PTR(0);
if (hActCtx === null || BigInt.asIntN(64, BigInt(hActCtx)) === INVALID_HANDLE_VALUE || !kernel32.ActivateActCtx(hActCtx, byref(actCtxCookie))) {
  console.log("Visual styles unavailable:", WinError(get_last_error()).message);
}

const comctl32 = new WinDLL("comctl32.dll");
prototype(comctl32.InitCommonControlsEx, BOOL, [POINTER(INITCOMMONCONTROLSEX)]);
prototype(comctl32.ImageList_Create, HANDLE, [INT, INT, UINT, INT, INT]);
prototype(comctl32.ImageList_ReplaceIcon, INT, [HANDLE, INT, HICON]);
prototype(comctl32.ImageList_Destroy, BOOL, [HANDLE]);
const icex = new INITCOMMONCONTROLSEX();
icex.dwSize = sizeof(INITCOMMONCONTROLSEX);
icex.dwICC = ICC_STANDARD_CLASSES | ICC_BAR_CLASSES | ICC_LISTVIEW_CLASSES | ICC_TREEVIEW_CLASSES;
comctl32.InitCommonControlsEx(byref(icex));

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

const MARGIN = 8; // DIPs
const SPLITTER = 6; // DIPs between the panes
const SEARCH_HEIGHT = 30;
const MAX_SEARCH_RESULTS = 2000;
const MAX_LOCATED_RESULTS = 50000; // the results marked in the tree, read with their DN only
const MAX_EXPANDED_CONTAINERS = 200; // the tree of the search results: the shallowest ones
const LIST_ATTRIBUTES = ["name", "objectClass", "description", "userAccountControl"];
// Classes shown in the tree: the containers of other objects (in the domain,
// and in the other naming contexts).
const CONTAINER_CLASSES = new Set([
  "domainDNS",
  "organizationalUnit",
  "container",
  "builtinDomain",
  "lostAndFound",
  "configuration",
  "sitesContainer",
  "site",
  "serversContainer",
  "server",
  "subnetContainer",
  "interSiteTransportContainer",
  "interSiteTransport",
  "nTDSService",
  "crossRefContainer",
  "dnsZone",
]);
const TYPE_NAMES = {
  user: "User",
  inetOrgPerson: "InetOrgPerson",
  group: "Group",
  computer: "Computer",
  contact: "Contact",
  organizationalUnit: "Organizational Unit",
  container: "Container",
  builtinDomain: "builtinDomain",
  domainDNS: "Domain",
  configuration: "Configuration",
  site: "Site",
  server: "Server",
  pKIEnrollmentService: "Enrollment Service",
  certificationAuthority: "Certification Authority",
  pKICertificateTemplate: "Certificate Template",
  foreignSecurityPrincipal: "Foreign Security Principal",
  "msDS-GroupManagedServiceAccount": "Group Managed Service Account",
  "msDS-ManagedServiceAccount": "Managed Service Account",
  printQueue: "Printer",
  volume: "Shared Folder",
};
const LIST_COLUMNS = [
  { title: "Name", width: 220 },
  { title: "Type", width: 150 },
  { title: "Description", width: 240 },
  { title: "Location", width: 260 },
];
const DETAIL_COLUMNS = [
  { title: "Attribute", width: 190 },
  { title: "Value", width: 520 },
];

let hInstance = null;
let hwndMain = null;
let hwndBase = null;
let hwndSearch = null;
let hwndSearchButton = null;
let hwndTree = null;
let hwndList = null;
let hwndDetails = null;
let hwndStatus = null;
let hFont = null;
let hAccel = null;
let imageList = null;
let iconSize = 16;
let dpi = USER_DEFAULT_SCREEN_DPI;
let ready = false;
const callbacks = []; // WNDPROC callbacks: alive as long as their windows
const fontTargets = [];
// Splitters (DIPs / ratio) and the one being dragged
let treeWidth = 320;
let listRatio = 0.55;
let dragging = null; // "vertical" | "horizontal"
const splitters = { vertical: null, horizontal: null }; // client rectangles in pixels

// Directory
// Directory: the base DN browsed (the root of the tree)
const directory = { baseDn: "", host: null, options: {} };
const childrenCache = new Map(); // DN (lower case) → rows
const icons = new Map(); // "class|flags" → image list index
// Tree: lParam id → { dn, parent, loaded, hItem }
const nodes = new Map();
const nodeByDn = new Map(); // DN (lower case) → id
let nextNodeId = 1;
let selectedNode = null;
const searchHits = new Map(); // during a search: container DN (lower case) → results below it
let follows = 0; // the search result the tree follows; older reveals are dropped
let expansions = 0; // the search whose tree is being expanded; older ones stop
const searchOpened = new Set(); // the nodes the search expanded (closed before it): collapsed at its end
// List: the objects of a container, or search results
let rows = [];
let listTitle = "";
let sortColumn = 0;
let sortAscending = true;
// Details: the attributes of one object
let detailRows = []; // { attribute, value, dn }
let detailsDn = null;

const px = (dips) => Math.round((dips * dpi) / USER_DEFAULT_SCREEN_DPI);
const dips = (pixels) => (pixels * USER_DEFAULT_SCREEN_DPI) / dpi;
const notifyCode = (hdr) => Number(hdr.code) | 0; // NMHDR.code is a UINT: the codes are negative ints
const key = (dn) => dn.toLowerCase();

function clientRect(hwnd) {
  const rc = new RECT();
  user32.GetClientRect(hwnd, byref(rc));
  return { width: Number(rc.right) - Number(rc.left), height: Number(rc.bottom) - Number(rc.top) };
}

function windowText(hwnd) {
  const buf = create_unicode_buffer(1024);
  user32.GetWindowTextW(hwnd, buf, 1024);
  return buf.value;
}

function setStatus(part, text) {
  SendMessageStrW(hwndStatus, SB_SETTEXTW, part, text);
}

// ═══════════════════════════════════════════════════════════════════════
// Directory: distinguished names and ADSI searches (./ads.js)
// ═══════════════════════════════════════════════════════════════════════

/** The RDNs of a DN, split at the commas that are not escaped ("CN=Doe\, John,OU=..."). */
function splitDn(dn) {
  return dn.match(/(?:[^,\\]|\\.)+/g) ?? [];
}

function parentDn(dn) {
  return splitDn(dn).slice(1).join(",");
}

/** The value of the first RDN, unescaped. */
function rdnValue(dn) {
  const rdn = splitDn(dn)[0] ?? dn;
  return rdn.slice(rdn.indexOf("=") + 1).replace(/\\(.)/g, "$1");
}

/** "OU=Staff,OU=Paris,DC=corp,DC=com" → "corp.com/Paris/Staff", as Active Directory shows locations. */
function canonicalName(dn) {
  const rdns = splitDn(dn);
  const domain = rdns
    .filter((rdn) => /^DC=/i.test(rdn))
    .map((rdn) => rdn.slice(3))
    .join(".");
  const path = rdns
    .filter((rdn) => !/^DC=/i.test(rdn))
    .reverse()
    .map((rdn) => rdn.slice(rdn.indexOf("=") + 1).replace(/\\(.)/g, "$1"));
  return [domain, ...path].join("/");
}

/** A DN inside the base DN or another naming context (memberOf, manager, objectCategory, ...): it can be opened. */
function isDirectoryDn(value) {
  return typeof value === "string" && /^[A-Za-z][\w-]*=/.test(value) && namingContextOf(value) !== null;
}

/**
 * The base DN or the naming context holding a DN; null outside them. The
 * deepest one wins: "CN=Configuration,DC=corp,DC=com" ends with the domain's
 * DN, but it is another partition.
 */
function namingContextOf(dn) {
  const target = key(dn);
  let found = null;
  for (const context of [directory.baseDn, ...baseItems.map((item) => item.dn)]) {
    const root = key(context);
    if ((target === root || target.endsWith(`,${root}`)) && (found === null || root.length > found.length)) found = root;
  }
  return found;
}

/** The ADsPath of a DN, on the server given with --host or --base, if any. */
function directoryPath(dn) {
  return adsPath(dn, directory.host);
}

/** RFC 4515 escaping of a value inside an LDAP filter. */
function escapeFilter(value) {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** A search result as a list row. */
function toRow(obj) {
  const dn = obj.distinguishedName?.[0] ?? "";
  const classes = obj.objectClass ?? [];
  const cls = classes.at(-1) ?? "top"; // the most specific class comes last
  const flags = obj.userAccountControl?.[0];
  return {
    dn,
    name: obj.name?.[0] ?? rdnValue(dn),
    cls,
    type: TYPE_NAMES[cls] ?? cls,
    description: obj.description?.[0] ?? "",
    location: canonicalName(parentDn(dn)),
    container: classes.some((c) => CONTAINER_CLASSES.has(c)),
    // userAccountControl ACCOUNTDISABLE (0x2): the icon shows it.
    disabled: typeof flags === "number" && (flags & 0x2) !== 0,
  };
}

// ─── Requests: the searches run in a worker (AdsWorker), never blocking
// the window. The worker posts WM_ADS_REPLY after each reply; the window
// procedure takes the replies and runs their callbacks on this thread.

let ads = null; // AdsWorker
const requests = new Map(); // id → { what, started, done }

/** Start a search; done(objects or null on error) runs when its reply arrives. */
function request(what, filter, dn, scope, attributes, options, done) {
  track(what, ads.search(filter, directoryPath(dn), scope, attributes, { ...directory.options, ...options }), done);
}

/** Read attributes of the RootDSE of the server; done(attribute → values, or null on error). */
function requestRootDse(what, attributes, done) {
  track(what, ads.rootDse(attributes, directory.host, directory.options), (found) => done(found?.[0] ?? null));
}

function track(what, id, done) {
  requests.set(id, { what, started: performance.now(), done });
  updateSkeletonTimer();
}

function takeReplies() {
  for (let reply = ads.take(); reply; reply = ads.take()) {
    const pending = requests.get(reply.id);
    requests.delete(reply.id);
    if (!pending) continue;
    if (reply.error) {
      setStatus(0, `${pending.what} failed: ${reply.error}`);
      console.error(`${pending.what} failed:`, reply.error);
      pending.done(null);
    } else {
      setStatus(1, `${pending.what}: ${Math.round(performance.now() - pending.started)} ms`);
      pending.done(reply.rows);
    }
  }
  updateSkeletonTimer();
}

const childrenWaiting = new Map(); // DN (lower case) → callbacks of the same pending read

/** The objects directly inside a container, cached until Refresh; done(rows) may run at once. */
function getChildren(dn, done) {
  const k = key(dn);
  if (childrenCache.has(k)) return done(childrenCache.get(k));
  if (childrenWaiting.has(k)) return void childrenWaiting.get(k).push(done);
  childrenWaiting.set(k, [done]);
  request(`Reading ${canonicalName(dn)}`, "(objectClass=*)", dn, SCOPE.ONELEVEL, LIST_ATTRIBUTES, {}, (found) => {
    const result = found ? found.map(toRow) : [];
    if (found) childrenCache.set(k, result);
    const waiting = childrenWaiting.get(k) ?? [];
    childrenWaiting.delete(k);
    for (const callback of waiting) callback(result);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Icons: Active Directory class icons (DsGetIcon) in one image list
// ═══════════════════════════════════════════════════════════════════════

function addIcon(cls, flags) {
  let hIcon = dsuiext.DsGetIcon(flags, cls, iconSize, iconSize);
  if (!hIcon) hIcon = dsuiext.DsGetIcon(flags | DSGIF_GETDEFAULTICON, cls, iconSize, iconSize);
  const index = hIcon ? comctl32.ImageList_ReplaceIcon(imageList, -1, hIcon) : -1;
  if (hIcon) user32.DestroyIcon(hIcon); // the image list keeps a copy
  return index;
}

function iconIndex(cls, flags = DSGIF_ISNORMAL) {
  const name = `${cls}|${flags}`;
  if (!icons.has(name)) icons.set(name, addIcon(cls, flags));
  return icons.get(name);
}

/** (Re)create the image list at the small icon size of the window's DPI, with the same indexes. */
function createImageList() {
  const old = imageList;
  iconSize = user32.GetSystemMetricsForDpi(SM_CXSMICON, dpi);
  imageList = comctl32.ImageList_Create(iconSize, iconSize, ILC_COLOR32 | ILC_MASK, 16, 16);
  for (const name of icons.keys()) {
    const [cls, flags] = name.split("|");
    addIcon(cls, Number(flags));
  }
  if (hwndTree) user32.SendMessageW(hwndTree, TVM_SETIMAGELIST, TVSIL_NORMAL, imageList);
  if (hwndList) user32.SendMessageW(hwndList, LVM_SETIMAGELIST, LVSIL_SMALL, imageList);
  if (old) comctl32.ImageList_Destroy(old);
}

const rowIcon = (row) => (row.skeleton ? -1 : iconIndex(row.cls, row.disabled ? DSGIF_ISDISABLED : DSGIF_ISNORMAL));

// ═══════════════════════════════════════════════════════════════════════
// Skeletons: gray rounded bars drawn with NM_CUSTOMDRAW while a pane loads,
// with a wave of brightness running down the rows
// ═══════════════════════════════════════════════════════════════════════

const SKELETON_DELAY = 150; // ms: a quick load keeps the previous content instead of flashing a skeleton
const SKELETON_ROWS = { list: 12, details: 14 };
const loading = { list: null, details: null }; // { since, shown } while the pane loads
const treePlaceholders = new Set(); // HTREEITEM (string) of the "loading" children in the tree

function beginLoading(pane, immediately = false) {
  loading[pane] = { since: performance.now(), shown: false };
  if (immediately) showSkeleton(pane);
  updateSkeletonTimer();
}

function showSkeleton(pane) {
  loading[pane].shown = true;
  const count = SKELETON_ROWS[pane];
  if (pane === "list") {
    rows = Array.from({ length: count }, () => ({ skeleton: true, name: "", type: "", description: "", location: "", dn: "" }));
    user32.SendMessageW(hwndList, LVM_SETITEMCOUNT, count, 0);
    user32.InvalidateRect(hwndList, null, 0);
  } else {
    detailRows = Array.from({ length: count }, () => ({ skeleton: true, attribute: "", value: "", dn: null }));
    user32.SendMessageW(hwndDetails, LVM_SETITEMCOUNT, count, 0);
    user32.InvalidateRect(hwndDetails, null, 0);
  }
}

/** The animation timer runs while something loads; it also takes late replies. */
function updateSkeletonTimer() {
  const active = requests.size > 0 || loading.list !== null || loading.details !== null || treePlaceholders.size > 0;
  if (active) user32.SetTimer(hwndMain, ID_SKELETON_TIMER, 50, null);
  else user32.KillTimer(hwndMain, ID_SKELETON_TIMER);
}

function onSkeletonTimer() {
  takeReplies(); // a reply whose WM_ADS_REPLY was not seen yet
  for (const [pane, hwnd] of [
    ["list", hwndList],
    ["details", hwndDetails],
  ]) {
    const state = loading[pane];
    if (!state) continue;
    if (!state.shown && performance.now() - state.since >= SKELETON_DELAY) showSkeleton(pane);
    else if (state.shown) user32.InvalidateRect(hwnd, null, 0);
  }
  if (treePlaceholders.size) user32.InvalidateRect(hwndTree, null, 0);
}

/** Gray 0-255 of a skeleton row: a wave that runs down the rows. */
function skeletonShade(row) {
  return 222 + Math.round(14 * (0.5 + 0.5 * Math.sin(performance.now() / 220 - row * 0.6)));
}

/** A deterministic 0-1 value per cell (a hash of row and column): bars of different lengths. */
function cellFraction(row, column) {
  const x = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Rounded bars, one per column (an icon square in the first one), filling a list row. */
function drawSkeletonRow(hdc, rc, row, widths, withIcon) {
  const left = Number(rc.left);
  const top = Number(rc.top);
  const height = Number(rc.bottom) - top;
  user32.FillRect(hdc, byref(rc), user32.GetSysColorBrush(COLOR_WINDOW));
  const shade = skeletonShade(row);
  const brush = gdi32.CreateSolidBrush(shade | (shade << 8) | (shade << 16));
  const oldBrush = gdi32.SelectObject(hdc, brush);
  const oldPen = gdi32.SelectObject(hdc, gdi32.GetStockObject(NULL_PEN));
  const barHeight = Math.max(4, Math.round(height * 0.42));
  const y = top + Math.round((height - barHeight) / 2);
  let x = left;
  widths.forEach((width, column) => {
    let start = x + px(6);
    if (column === 0 && withIcon) {
      const iconTop = top + Math.round((height - iconSize) / 2);
      gdi32.RoundRect(hdc, start, iconTop, start + iconSize, iconTop + iconSize, px(4), px(4));
      start += iconSize + px(6);
    }
    const room = x + width - px(10) - start;
    const end = start + Math.round(room * (0.35 + 0.55 * cellFraction(row, column)));
    if (room > px(12)) gdi32.RoundRect(hdc, start, y, end, y + barHeight, barHeight, barHeight);
    x += width;
  });
  gdi32.SelectObject(hdc, oldPen);
  gdi32.SelectObject(hdc, oldBrush);
  gdi32.DeleteObject(brush);
}

function columnWidths(hwnd, count) {
  return Array.from({ length: count }, (_, i) => Number(user32.SendMessageW(hwnd, LVM_GETCOLUMNWIDTH, i, 0)));
}

/** NM_CUSTOMDRAW of the tree and the lists: skeleton rows replace the default drawing. */
function onCustomDraw(lParam, from) {
  const draw = cast(lParam, POINTER(NMCUSTOMDRAW)).contents;
  const stage = Number(draw.dwDrawStage);
  if (sameHandle(from, hwndTree)) {
    if (stage === CDDS_PREPAINT) return treePlaceholders.size ? CDRF_NOTIFYITEMDRAW : CDRF_DODEFAULT;
    if (stage !== CDDS_ITEMPREPAINT || Number(draw.lItemlParam) !== 0) return CDRF_DODEFAULT;
    // A "loading" child: an icon square and a bar where its label would be.
    // TVM_GETITEMRECT reads the HTREEITEM from the RECT it fills.
    const label = Buffer.alloc(16);
    label.writeBigInt64LE(BigInt(draw.dwItemSpec));
    SendMessagePtrW(hwndTree, TVM_GETITEMRECT, 1, label);
    const row = { left: label.readInt32LE(0) - iconSize - px(3), right: label.readInt32LE(0) + px(160) };
    const rc = new RECT();
    Object.assign(rc, { left: row.left, top: Number(draw.rc.top), right: row.right, bottom: Number(draw.rc.bottom) });
    drawSkeletonRow(draw.hdc, rc, 0, [row.right - row.left], true);
    return CDRF_SKIPDEFAULT;
  }
  const pane = sameHandle(from, hwndList) ? "list" : "details";
  if (!loading[pane]?.shown) return CDRF_DODEFAULT;
  if (stage === CDDS_PREPAINT) return CDRF_NOTIFYITEMDRAW;
  if (stage !== CDDS_ITEMPREPAINT) return CDRF_DODEFAULT;
  const columns = pane === "list" ? LIST_COLUMNS.length : DETAIL_COLUMNS.length;
  drawSkeletonRow(draw.hdc, draw.rc, Number(draw.dwItemSpec), columnWidths(from, columns), pane === "list");
  return CDRF_SKIPDEFAULT;
}

// ═══════════════════════════════════════════════════════════════════════
// Tree: the containers, read when expanded
// ═══════════════════════════════════════════════════════════════════════

function insertTreeItem(parentItem, parentId, row) {
  const id = nextNodeId++;
  const label = parentId ? row.name : canonicalName(row.dn); // the root: the domain's DNS name
  const node = { dn: row.dn, label, parent: parentId, loaded: false, loading: false, waiting: [], hItem: null };
  nodes.set(id, node);
  nodeByDn.set(key(row.dn), id);
  const tvis = new TVINSERTSTRUCTW();
  tvis.hParent = parentItem;
  tvis.hInsertAfter = TVI_LAST;
  tvis.item.mask = TVIF_TEXT | TVIF_IMAGE | TVIF_SELECTEDIMAGE | TVIF_PARAM | TVIF_CHILDREN;
  tvis.item.pszText = label;
  tvis.item.iImage = rowIcon(row);
  tvis.item.iSelectedImage = iconIndex(row.cls, DSGIF_ISOPEN);
  tvis.item.cChildren = 1; // a [+] until the container is read (TVN_ITEMEXPANDINGW)
  tvis.item.lParam = id;
  node.hItem = SendMessagePtrW(hwndTree, TVM_INSERTITEMW, 0, byref(tvis));
  if (searchHits.has(key(row.dn))) markTreeItem(node); // read during a search
  return id;
}

/** The base DN is the root of the tree; selecting it lists its objects. */
function loadRoot(then = null) {
  const baseDn = directory.baseDn;
  // Skeletons right away: there is no previous content to keep.
  const rootPlaceholder = insertPlaceholder(TVI_ROOT);
  beginLoading("list", true);
  beginLoading("details", true);
  setStatus(0, `${canonicalName(baseDn)} — connecting…`);
  request(`Reading ${canonicalName(baseDn)}`, "(objectClass=*)", baseDn, SCOPE.BASE, LIST_ATTRIBUTES, {}, (found) => {
    removePlaceholder(rootPlaceholder);
    if (directory.baseDn !== baseDn) return; // another base DN chosen meanwhile
    if (!found?.length) {
      loading.list = loading.details = null;
      showRows([], canonicalName(baseDn));
      return;
    }
    const id = insertTreeItem(TVI_ROOT, 0, toRow(found[0]));
    user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_CARET, nodes.get(id).hItem);
    loadChildren(id, () => user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_EXPAND, nodes.get(id).hItem));
    then?.();
  });
}

/**
 * Browse another base DN: the tree starts again from it; the search, the list
 * and the details are cleared. then(): once the root is in the tree.
 */
function openBase(dn, then = null) {
  activeSearch = listOwner = null;
  follows++;
  expansions++;
  searchHits.clear();
  searchOpened.clear();
  // The late replies of the old tree find no node (loadChildren) and no placeholder.
  nodes.clear();
  nodeByDn.clear();
  treePlaceholders.clear();
  childrenCache.clear();
  selectedNode = detailsDn = null;
  user32.SendMessageW(hwndTree, TVM_DELETEITEM, 0, TVI_ROOT);
  detailRows = [];
  user32.SendMessageW(hwndDetails, LVM_SETITEMCOUNT, 0, 0);
  directory.baseDn = dn;
  user32.SetWindowTextW(hwndMain, `Active Directory Explorer — ${canonicalName(dn)}`);
  loadRoot(then);
}

/** During a search, a container with results below it is bold, with their number: "Staff (12)". */
function markTreeItem(node) {
  const hits = searchHits.get(key(node.dn));
  const item = new TVITEMW();
  item.mask = TVIF_HANDLE | TVIF_TEXT | TVIF_STATE;
  item.hItem = node.hItem;
  item.pszText = hits ? `${node.label} (${hits})` : node.label;
  item.stateMask = TVIS_BOLD;
  item.state = hits ? TVIS_BOLD : 0;
  SendMessagePtrW(hwndTree, TVM_SETITEMW, 0, byref(item));
}

/** Count the search results below each container of the tree, and mark the tree. */
function markSearchResults(found) {
  const previous = [...searchHits.keys()];
  searchHits.clear();
  for (const row of found) {
    let dn = key(parentDn(row.dn));
    const root = key(directory.baseDn);
    if (dn !== root && !dn.endsWith(`,${root}`)) continue;
    for (;;) {
      searchHits.set(dn, (searchHits.get(dn) ?? 0) + 1);
      if (dn === root) break;
      dn = key(parentDn(dn));
    }
  }
  for (const dn of new Set([...previous, ...searchHits.keys()])) {
    const node = nodes.get(nodeByDn.get(dn));
    if (node?.hItem) markTreeItem(node);
  }
}

/**
 * The tree of the search results: expandTo each container with results opens
 * its ancestors, one level read at a time, the shallowest first, until another
 * search or the end of this one.
 */
function expandSearchResults() {
  const expansion = ++expansions;
  const stale = () => expansion !== expansions;
  const depth = (dn) => splitDn(dn).length;
  const targets = [...searchHits.keys()].sort((a, b) => depth(a) - depth(b)).slice(0, MAX_EXPANDED_CONTAINERS);
  const next = () => {
    if (!stale() && targets.length) expandTo(targets.shift(), next, stale, searchOpened);
  };
  next();
}

/**
 * Collapse the nodes the search expanded, the deepest first; the path to the
 * selected container stays open.
 */
function collapseSearchTree() {
  const keep = new Set();
  for (let id = selectedNode; id; id = nodes.get(id)?.parent) keep.add(id);
  const depth = (id) => splitDn(nodes.get(id).dn).length;
  const opened = [...searchOpened].filter((id) => nodes.has(id) && !keep.has(id)).sort((a, b) => depth(b) - depth(a));
  for (const id of opened) user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_COLLAPSE, nodes.get(id).hItem);
  searchOpened.clear();
}

/** The search is over: the tree as it was, and the list shows the selected container again. */
function endSearch() {
  activeSearch = null;
  follows++;
  expansions++;
  collapseSearchTree();
  user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_DROPHILITE, 0);
  markSearchResults([]);
  if (listOwner?.startsWith("search:") && selectedNode !== null) showContainer(selectedNode);
}

/**
 * The tree follows the selected search result: expanded down to its
 * container, highlighted (TVGN_DROPHILITE) without changing the selection,
 * the container the search runs in.
 */
function followResult(dn) {
  const follow = ++follows;
  expandTo(
    parentDn(dn),
    (id) => {
      if (id === null) return;
      user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_DROPHILITE, nodes.get(id).hItem);
      user32.SendMessageW(hwndTree, TVM_ENSUREVISIBLE, 0, nodes.get(id).hItem);
    },
    () => follow !== follows,
    searchOpened,
  );
}

/** A "loading" child (lParam 0), drawn as a skeleton until the real children arrive. */
function insertPlaceholder(parentItem) {
  const tvis = new TVINSERTSTRUCTW();
  tvis.hParent = parentItem;
  tvis.hInsertAfter = TVI_LAST;
  tvis.item.mask = TVIF_TEXT | TVIF_PARAM;
  tvis.item.pszText = "";
  tvis.item.lParam = 0;
  const hItem = SendMessagePtrW(hwndTree, TVM_INSERTITEMW, 0, byref(tvis));
  treePlaceholders.add(String(hItem));
  updateSkeletonTimer();
  return hItem;
}

function removePlaceholder(hItem) {
  // Already gone when the tree was cleared (another base DN).
  if (!treePlaceholders.delete(String(hItem))) return;
  user32.SendMessageW(hwndTree, TVM_DELETEITEM, 0, hItem);
}

/** Lazy tree: read the containers inside a node the first time it is needed; done() when they are in. */
function loadChildren(id, done = null) {
  const node = nodes.get(id);
  if (!node || node.loaded) return done?.();
  if (done) node.waiting.push(done);
  if (node.loading) return;
  node.loading = true;
  const placeholder = insertPlaceholder(node.hItem);
  getChildren(node.dn, (found) => {
    removePlaceholder(placeholder);
    if (nodes.get(id) !== node) return; // removed by Refresh meanwhile
    node.loading = false;
    node.loaded = true;
    const containers = found.filter((row) => row.container).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const row of containers) insertTreeItem(node.hItem, id, row);
    if (containers.length === 0) {
      const item = new TVITEMW();
      item.mask = TVIF_HANDLE | TVIF_CHILDREN;
      item.hItem = node.hItem;
      item.cChildren = 0;
      SendMessagePtrW(hwndTree, TVM_SETITEMW, 0, byref(item));
    }
    const waiting = node.waiting;
    node.waiting = [];
    for (const callback of waiting) callback();
  });
}

/**
 * Expand the tree down to a container, from the deepest node already in the
 * tree (reading the levels as needed, one reply at a time). done(id, found):
 * the node reached, found false when the DN is not a container of the tree
 * (id is its deepest ancestor, null outside the domain). stale(): stop.
 * opened: a set that receives the nodes expanded here (closed before).
 */
function expandTo(dn, done, stale = () => false, opened = null) {
  const target = key(dn);
  const within = (ancestor) => target === ancestor || target.endsWith(`,${ancestor}`);
  let current = null;
  for (const [id, node] of nodes) {
    if (within(key(node.dn)) && (current === null || node.dn.length > nodes.get(current).dn.length)) current = id;
  }
  if (current === null) return done(null, false);
  const step = () => {
    if (stale()) return;
    if (key(nodes.get(current).dn) === target) return done(current, true);
    loadChildren(current, () => {
      if (stale()) return;
      const { hItem } = nodes.get(current);
      if (opened && !(Number(user32.SendMessageW(hwndTree, TVM_GETITEMSTATE, hItem, TVIS_EXPANDED)) & TVIS_EXPANDED)) opened.add(current);
      user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_EXPAND, hItem);
      let next = null;
      for (const [id, node] of nodes) if (node.parent === current && within(key(node.dn))) next = id;
      if (next === null) return done(current, false);
      current = next;
      step();
    });
  };
  step();
}

/**
 * Select a container in the tree, expanding its ancestors. done(found): false
 * when the DN is not a container of the tree (the deepest ancestor reached is
 * selected).
 */
function revealContainer(dn, done = () => {}) {
  expandTo(dn, (id, found) => {
    if (id === null) return done(false);
    const { hItem } = nodes.get(id);
    if (selectedNode === id)
      showContainer(id); // TVM_SELECTITEM notifies only a change
    else user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_CARET, hItem);
    user32.SendMessageW(hwndTree, TVM_ENSUREVISIBLE, 0, hItem);
    done(found);
  });
}

let listOwner = null; // what the list shows: a container or a search; late replies of others are dropped

/** The selected container: its objects in the list, its attributes in the details. */
function showContainer(id) {
  const node = nodes.get(id);
  if (!node) return; // a "loading" placeholder
  selectedNode = id;
  follows++; // the list shows a container: no search result to follow
  user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_DROPHILITE, 0);
  const title = canonicalName(node.dn);
  const owner = (listOwner = `container:${key(node.dn)}`);
  if (!childrenCache.has(key(node.dn))) {
    beginLoading("list");
    setStatus(0, `${title} — loading…`);
  }
  getChildren(node.dn, (found) => {
    if (listOwner === owner) showRows(found, title);
  });
  showDetails(node.dn);
}

// ═══════════════════════════════════════════════════════════════════════
// List: virtual ListView (LVS_OWNERDATA), cells from LVN_GETDISPINFOW
// ═══════════════════════════════════════════════════════════════════════

function sortRows() {
  const direction = sortAscending ? 1 : -1;
  const keys = ["name", "type", "description", "location"];
  rows.sort((a, b) => {
    if (a.container !== b.container) return a.container ? -1 : 1; // containers first
    const order = a[keys[sortColumn]].localeCompare(b[keys[sortColumn]], undefined, { numeric: true, sensitivity: "base" });
    return direction * (order || a.name.localeCompare(b.name));
  });
  const header = user32.SendMessageW(hwndList, LVM_GETHEADER, 0, 0);
  for (let i = 0; i < LIST_COLUMNS.length; i++) {
    const item = new HDITEMW();
    item.mask = HDI_FORMAT;
    SendMessagePtrW(header, HDM_GETITEMW, i, byref(item));
    item.fmt = (item.fmt & ~(HDF_SORTUP | HDF_SORTDOWN)) | (i === sortColumn ? (sortAscending ? HDF_SORTUP : HDF_SORTDOWN) : 0);
    SendMessagePtrW(header, HDM_SETITEMW, i, byref(item));
  }
}

function showRows(newRows, title) {
  loading.list = null;
  rows = [...newRows];
  listTitle = title;
  sortRows();
  // A virtual list keeps the selection by index: clear it, so that selecting
  // a row of the new list notifies the change (LVN_ITEMCHANGED).
  const none = new LVITEMW();
  none.stateMask = LVIS_SELECTED | LVIS_FOCUSED;
  SendMessagePtrW(hwndList, LVM_SETITEMSTATE, -1, byref(none));
  user32.SendMessageW(hwndList, LVM_SETITEMCOUNT, rows.length, 0);
  user32.InvalidateRect(hwndList, null, 0);
  setStatus(0, `${title} — ${rows.length} object${rows.length === 1 ? "" : "s"}`);
  updateSkeletonTimer();
}

function selectedIndex(hwnd) {
  return Number(user32.SendMessageW(hwnd, LVM_GETNEXTITEM, -1, LVNI_SELECTED));
}

/** Select and show a row of the list. */
function selectRow(index) {
  const item = new LVITEMW();
  item.stateMask = LVIS_SELECTED | LVIS_FOCUSED;
  item.state = LVIS_SELECTED | LVIS_FOCUSED;
  SendMessagePtrW(hwndList, LVM_SETITEMSTATE, index, byref(item));
  user32.SendMessageW(hwndList, LVM_ENSUREVISIBLE, index, 0);
}

const listCell = (row, column) => [row.name, row.type, row.description, row.location][column] ?? "";
const detailCell = (row, column) => (column === 0 ? row.attribute : row.value);

/** LVN_GETDISPINFOW: write the cell text into the list view's own buffer, and the icon. */
function onGetDispInfo(lParam, source, cell, icon) {
  const item = cast(lParam, POINTER(NMLVDISPINFOW)).contents.item;
  const row = source[item.iItem];
  if (!row) return;
  if (item.mask & LVIF_TEXT && item.pszText && item.cchTextMax > 0) {
    const text = String(cell(row, item.iSubItem)).slice(0, item.cchTextMax - 1);
    const bytes = Buffer.from(`${text}\0`, "utf16le");
    memmove(item.pszText, bytes, bytes.length);
  }
  if (item.mask & LVIF_IMAGE && icon) item.iImage = icon(row);
}

// ═══════════════════════════════════════════════════════════════════════
// Details: every attribute of one object, values typed by ADSI (ads.js)
// ═══════════════════════════════════════════════════════════════════════

function formatValue(value) {
  if (Buffer.isBuffer(value)) return `${value.length} bytes: ${value.subarray(0, 24).toString("hex")}${value.length > 24 ? "…" : ""}`;
  return String(value);
}

function showDetails(dn) {
  detailsDn = dn;
  beginLoading("details");
  request(`Reading ${rdnValue(dn)}`, "(objectClass=*)", dn, SCOPE.BASE, [], {}, (found) => {
    if (detailsDn !== dn) return; // another object was selected meanwhile
    loading.details = null;
    detailRows = [];
    const object = found?.[0];
    if (object) {
      const names = Object.keys(object).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      for (const attribute of names) {
        // One row per value: a DN among them can be opened with a double-click.
        object[attribute].forEach((value, i) => {
          detailRows.push({ attribute: i === 0 ? attribute : "", name: attribute, value: formatValue(value), dn: isDirectoryDn(value) ? value : null });
        });
      }
    }
    user32.SendMessageW(hwndDetails, LVM_SETITEMCOUNT, detailRows.length, 0);
    user32.InvalidateRect(hwndDetails, null, 0);
    updateSkeletonTimer();
  });
}

/**
 * Open an object: a container is selected in the tree; another object is
 * selected in the list of its container (the deepest container that
 * revealContainer reached), with its attributes.
 */
function openObject(dn) {
  const context = namingContextOf(dn);
  if (context !== null && context !== key(directory.baseDn)) {
    // In another naming context (objectCategory: the schema): browse it, then open.
    selectBaseItem(context);
    return openBase(baseItems.find((item) => key(item.dn) === context)?.dn ?? context, () => openObject(dn));
  }
  revealContainer(dn, (found) => {
    if (found) return;
    const container = selectedNode !== null ? nodes.get(selectedNode).dn : null;
    if (container === null) return showDetails(dn);
    // After showContainer's own callback: the list shows the container's objects.
    getChildren(container, () => {
      const index = rows.findIndex((r) => key(r.dn) === key(dn));
      if (index >= 0) selectRow(index); // LVN_ITEMCHANGED shows its attributes
      if (key(detailsDn ?? "") !== key(dn)) showDetails(dn);
    });
  });
}

let searches = 0;
let activeSearch = null; // the search the tree shows, until the search box is emptied

/**
 * More results than the list shows: the tree marks all of them, read again
 * with their distinguished names only (the first ones returned by the server
 * come from a few containers, in its own order).
 */
function locateSearchResults(search, filter, label, baseDn) {
  request(`Locating ${label}`, filter, baseDn, SCOPE.SUBTREE, ["distinguishedName"], { maxObjects: MAX_LOCATED_RESULTS }, (found) => {
    if (activeSearch !== search || !found) return; // another search, or the end of this one
    markSearchResults(found.map((obj) => ({ dn: obj.distinguishedName?.[0] ?? "" })));
    expandSearchResults();
  });
}

function runSearch() {
  const text = windowText(hwndSearch).trim();
  if (!text) return;
  // An LDAP filter as is; otherwise Ambiguous Name Resolution (name, account,
  // display name, first and last name, Exchange addresses: proxyAddresses), as
  // the Active Directory search box does, and the e-mail address and the user
  // principal name, which ANR does not cover: values starting with the text.
  const value = escapeFilter(text);
  const filter = text.startsWith("(") ? text : `(|(anr=${value})(mail=${value}*)(userPrincipalName=${value}*))`;
  const label = text.startsWith("(") ? filter : `"${text}"`; // in the status bar
  const baseDn = selectedNode ? nodes.get(selectedNode).dn : directory.baseDn;
  // The tree of the previous search closes; this one opens its own.
  follows++;
  expansions++;
  user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_DROPHILITE, 0);
  collapseSearchTree();
  const owner = (listOwner = activeSearch = `search:${++searches}`);
  beginLoading("list");
  setStatus(0, `Searching ${label} in ${canonicalName(baseDn)}…`);
  request(`Searching ${label}`, filter, baseDn, SCOPE.SUBTREE, LIST_ATTRIBUTES, { maxObjects: MAX_SEARCH_RESULTS }, (found) => {
    if (listOwner !== owner) return; // another search, or a container, meanwhile
    const result = found ? found.map(toRow) : [];
    const truncated = result.length >= MAX_SEARCH_RESULTS;
    markSearchResults(result);
    if (truncated) locateSearchResults(owner, filter, label, baseDn);
    else expandSearchResults();
    showRows(result, `Search ${label} in ${canonicalName(baseDn)}${truncated ? ` (first ${MAX_SEARCH_RESULTS})` : ""}`);
    user32.SetFocus(hwndList);
    if (result.length) selectRow(0);
  });
}

function refresh() {
  childrenCache.clear();
  if (selectedNode === null) return;
  // Forget the subtree of the selection (deleting its child items deletes
  // the whole subtree of the TreeView), then read it again.
  const node = nodes.get(selectedNode);
  const below = `,${key(node.dn)}`;
  for (const [id, other] of [...nodes]) {
    if (!key(other.dn).endsWith(below)) continue;
    if (other.parent === selectedNode) user32.SendMessageW(hwndTree, TVM_DELETEITEM, 0, other.hItem);
    nodes.delete(id);
    nodeByDn.delete(key(other.dn));
  }
  node.loaded = false;
  loadChildren(selectedNode, () => user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_EXPAND, node.hItem));
  showContainer(selectedNode);
}

// ═══════════════════════════════════════════════════════════════════════
// Clipboard and context menus
// ═══════════════════════════════════════════════════════════════════════

/** Copy text to the clipboard (CF_UNICODETEXT in global memory owned by the clipboard). */
function copyText(text) {
  const bytes = Buffer.from(`${text}\0`, "utf16le");
  if (!user32.OpenClipboard(hwndMain)) return;
  try {
    user32.EmptyClipboard();
    const memory = kernel32.GlobalAlloc(GMEM_MOVEABLE, bytes.length);
    if (!memory) return;
    memmove(kernel32.GlobalLock(memory), bytes, bytes.length);
    kernel32.GlobalUnlock(memory);
    if (!user32.SetClipboardData(CF_UNICODETEXT, memory)) kernel32.GlobalFree(memory);
    setStatus(0, `Copied: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
  } finally {
    user32.CloseClipboard();
  }
}

let menuTarget = null; // { dn, value } of the context menu

/** Menu items: [id, text, enabled = true], null for a separator. */
function appendMenuItems(menu, items) {
  for (const item of items) {
    if (item === null) user32.AppendMenuW(menu, MF_SEPARATOR, 0, null);
    else user32.AppendMenuW(menu, MF_STRING | (item[2] === false ? MF_GRAYED : 0), item[0], item[1]);
  }
}

function popupMenu(items, x, y) {
  const menu = user32.CreatePopupMenu();
  appendMenuItems(menu, items);
  if (x === -1 && y === -1) {
    // From the keyboard (Shift+F10): at the cursor.
    const pt = new POINT();
    user32.GetCursorPos(byref(pt));
    [x, y] = [Number(pt.x), Number(pt.y)];
  }
  user32.TrackPopupMenuEx(menu, TPM_RIGHTBUTTON, x, y, hwndMain, null);
  user32.DestroyMenu(menu);
}

function onContextMenu(control, x, y) {
  if (sameHandle(control, hwndTree)) {
    // The item under the pointer becomes the selection, as in File Explorer.
    const pt = new POINT();
    user32.GetCursorPos(byref(pt));
    user32.ScreenToClient(hwndTree, byref(pt));
    const hit = new TVHITTESTINFO();
    hit.pt.x = pt.x;
    hit.pt.y = pt.y;
    const hItem = SendMessagePtrW(hwndTree, TVM_HITTEST, 0, byref(hit));
    if (hItem) user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_CARET, hItem);
    if (selectedNode === null) return;
    menuTarget = { dn: nodes.get(selectedNode).dn };
    popupMenu([[IDM_REFRESH, "Refresh\tF5"], [IDM_UP, "Up one level\tAlt+Up"], null, [IDM_COPY_DN, "Copy distinguished name"]], x, y);
  } else if (sameHandle(control, hwndList)) {
    const row = rows[selectedIndex(hwndList)];
    if (!row) return;
    menuTarget = { dn: row.dn };
    popupMenu([[IDM_OPEN, row.container ? "Open" : "Show in its container"], null, [IDM_COPY_DN, "Copy distinguished name"]], x, y);
  } else if (sameHandle(control, hwndDetails)) {
    const row = detailRows[selectedIndex(hwndDetails)];
    if (!row) return;
    menuTarget = { dn: row.dn, value: row.value, name: row.name };
    popupMenu([[IDM_OPEN, "Open", Boolean(row.dn)], null, [IDM_COPY_VALUE, `Copy ${row.name} value`], [IDM_COPY_DN, "Copy distinguished name", Boolean(row.dn)]], x, y);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Base DN: the naming contexts of the server (RootDSE) in a combo box
// ═══════════════════════════════════════════════════════════════════════

let baseItems = []; // { label, dn }: the items of the combo box

/** The role of a naming context, from the RootDSE attributes that name it. */
function namingContextLabel(dn, rootDse) {
  const is = (attribute) => rootDse[attribute]?.some((value) => key(value) === key(dn));
  if (is("defaultNamingContext")) return "Domain";
  if (is("configurationNamingContext")) return "Configuration";
  if (is("schemaNamingContext")) return "Schema";
  if (/^DC=DomainDnsZones,/i.test(dn)) return "Domain DNS zones";
  if (/^DC=ForestDnsZones,/i.test(dn)) return "Forest DNS zones";
  return "Application partition";
}

/** Fill the combo box; the current base DN is selected (an item of its own when --base is not a naming context). */
function showBaseItems(items) {
  baseItems = items.some((item) => key(item.dn) === key(directory.baseDn)) ? items : [{ label: "Base", dn: directory.baseDn }, ...items];
  user32.SendMessageW(hwndBase, CB_RESETCONTENT, 0, 0);
  for (const item of baseItems) SendMessageStrW(hwndBase, CB_ADDSTRING, 0, `${item.label}: ${item.dn}`);
  selectBaseItem(directory.baseDn);
}

/** Show a base DN as the selection of the combo box (CB_SETCURSEL: no CBN_SELCHANGE). */
function selectBaseItem(dn) {
  user32.SendMessageW(
    hwndBase,
    CB_SETCURSEL,
    baseItems.findIndex((item) => key(item.dn) === key(dn)),
    0,
  );
}

/** The naming contexts listed by the RootDSE (namingContexts). */
function loadBaseItems() {
  showBaseItems([]);
  requestRootDse("Reading the naming contexts", ["namingContexts", "defaultNamingContext", "configurationNamingContext", "schemaNamingContext"], (rootDse) => {
    if (rootDse) showBaseItems((rootDse.namingContexts ?? []).map((dn) => ({ label: namingContextLabel(dn, rootDse), dn })));
  });
}

/** CBN_SELCHANGE: browse the chosen naming context. */
function onBaseChange() {
  const item = baseItems[Number(user32.SendMessageW(hwndBase, CB_GETCURSEL, 0, 0))];
  if (item && key(item.dn) !== key(directory.baseDn)) openBase(item.dn);
}

// ═══════════════════════════════════════════════════════════════════════
// Layout: search bar, tree | (list over details), status bar, splitters
// ═══════════════════════════════════════════════════════════════════════

function layout() {
  const { width, height } = clientRect(hwndMain);
  user32.SendMessageW(hwndStatus, WM_SIZE, 0, 0);
  const statusRect = new RECT();
  user32.GetWindowRect(hwndStatus, byref(statusRect));
  const statusHeight = Number(statusRect.bottom) - Number(statusRect.top);
  const parts = new (array(c_int, 2))();
  parts[0] = Math.max(px(200), width - px(260));
  parts[1] = -1;
  SendMessagePtrW(hwndStatus, SB_SETPARTS, 2, parts);

  const margin = px(MARGIN);
  const gap = px(SPLITTER);
  const searchTop = margin + px(SEARCH_HEIGHT) + margin;
  const top = searchTop + px(SEARCH_HEIGHT) + margin;
  const bottom = height - statusHeight - margin;
  const buttonWidth = px(90);
  // The splitters stay inside the window: each pane keeps at least 120 DIPs.
  const treeRight = Math.max(margin + px(120), Math.min(margin + px(treeWidth), width - margin - gap - px(120)));
  const rightLeft = treeRight + gap;
  const listBottom = Math.max(top + px(80), Math.min(top + Math.round((bottom - top - gap) * listRatio), bottom - gap - px(80)));
  splitters.vertical = { left: treeRight, top, right: rightLeft, bottom };
  splitters.horizontal = { left: rightLeft, top: listBottom, right: width - margin, bottom: listBottom + gap };

  const rects = [
    [hwndBase, margin, margin, width - 2 * margin, px(240)], // the height of the drop-down list
    [hwndSearch, margin, searchTop, width - 3 * margin - buttonWidth, px(SEARCH_HEIGHT)],
    [hwndSearchButton, width - margin - buttonWidth, searchTop, buttonWidth, px(SEARCH_HEIGHT)],
    [hwndTree, margin, top, treeRight - margin, bottom - top],
    [hwndList, rightLeft, top, width - margin - rightLeft, listBottom - top],
    [hwndDetails, rightLeft, listBottom + gap, width - margin - rightLeft, bottom - listBottom - gap],
  ];
  // The selection field of the combo box as high as the search box (its border: 6 pixels).
  user32.SendMessageW(hwndBase, CB_SETITEMHEIGHT, -1, px(SEARCH_HEIGHT) - 6);
  // DeferWindowPos: one repaint for all the moves.
  let hdwp = user32.BeginDeferWindowPos(rects.length);
  for (const [hwnd, x, y, w, h] of rects) hdwp = user32.DeferWindowPos(hdwp, hwnd, null, x, y, Math.max(0, w), Math.max(0, h), SWP_NOZORDER | SWP_NOACTIVATE);
  user32.EndDeferWindowPos(hdwp);
}

function splitterAt(x, y) {
  for (const [name, r] of Object.entries(splitters)) {
    if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return name;
  }
  return null;
}

function onDrag(x, y) {
  if (dragging === "vertical") {
    treeWidth = dips(x - px(MARGIN) - px(SPLITTER) / 2);
  } else {
    const { top } = splitters.vertical;
    const bottom = splitters.vertical.bottom;
    listRatio = Math.min(0.9, Math.max(0.1, (y - top) / (bottom - top)));
  }
  layout();
}

// ═══════════════════════════════════════════════════════════════════════
// Theme and fonts
// ═══════════════════════════════════════════════════════════════════════

function createMessageFont() {
  const ncm = new NONCLIENTMETRICSW();
  ncm.cbSize = sizeof(NONCLIENTMETRICSW);
  if (!user32.SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof(NONCLIENTMETRICSW), byref(ncm), 0, dpi)) throw WinError(get_last_error());
  return gdi32.CreateFontIndirectW(byref(ncm.lfMessageFont));
}

function applyFont() {
  const old = hFont;
  hFont = createMessageFont();
  for (const hwnd of fontTargets) user32.SendMessageW(hwnd, WM_SETFONT, hFont, 1);
  if (old) gdi32.DeleteObject(old);
}

/** The title bar follows the light / dark setting of Windows. */
function applyTitleBar() {
  const light = new DWORD(1);
  const size = new DWORD(sizeof(DWORD));
  const status = advapi32.RegGetValueW(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme", RRF_RT_REG_DWORD, null, byref(light), byref(size));
  const dark = new c_int(Number(status) === 0 && Number(light.value) === 0 ? 1 : 0);
  dwmapi.DwmSetWindowAttribute(hwndMain, DWMWA_USE_IMMERSIVE_DARK_MODE, byref(dark), sizeof(c_int));
}

// ═══════════════════════════════════════════════════════════════════════
// Window procedure
// ═══════════════════════════════════════════════════════════════════════

function onNotify(lParam) {
  const hdr = cast(lParam, POINTER(NMHDR)).contents;
  const code = notifyCode(hdr);
  const from = hdr.hwndFrom;
  if (code === NM_CUSTOMDRAW && (sameHandle(from, hwndTree) || sameHandle(from, hwndList) || sameHandle(from, hwndDetails))) return onCustomDraw(lParam, from);
  if (sameHandle(from, hwndTree)) {
    const tv = cast(lParam, POINTER(NMTREEVIEWW)).contents;
    if (code === TVN_ITEMEXPANDINGW && tv.action & TVE_EXPAND) loadChildren(Number(tv.itemNew.lParam));
    else if (code === TVN_SELCHANGEDW) showContainer(Number(tv.itemNew.lParam));
  } else if (sameHandle(from, hwndList)) {
    switch (code) {
      case LVN_GETDISPINFOW:
        onGetDispInfo(lParam, rows, listCell, rowIcon);
        break;
      case LVN_COLUMNCLICK: {
        if (loading.list?.shown) break;
        const column = cast(lParam, POINTER(NMLISTVIEW)).contents.iSubItem;
        sortAscending = column === sortColumn ? !sortAscending : true;
        sortColumn = column;
        sortRows();
        user32.InvalidateRect(hwndList, null, 0);
        break;
      }
      case LVN_ITEMCHANGED: {
        // The attributes of the selected object (state change to selected only);
        // a search result is also shown in the tree.
        const change = cast(lParam, POINTER(NMLISTVIEW)).contents;
        const row = rows[change.iItem];
        if (!row || row.skeleton || !(change.uNewState & LVIS_SELECTED) || change.uOldState & LVIS_SELECTED) break;
        if (key(row.dn) !== key(detailsDn ?? "")) showDetails(row.dn);
        if (listOwner?.startsWith("search:")) followResult(row.dn);
        break;
      }
      case LVN_ITEMACTIVATE: {
        const row = rows[cast(lParam, POINTER(NMLISTVIEW)).contents.iItem];
        if (row && !row.skeleton) openObject(row.dn);
        break;
      }
    }
  } else if (sameHandle(from, hwndDetails)) {
    if (code === LVN_GETDISPINFOW) onGetDispInfo(lParam, detailRows, detailCell, null);
    else if (code === LVN_ITEMACTIVATE || code === NM_DBLCLK) {
      const row = detailRows[cast(lParam, POINTER(NMLISTVIEW)).contents.iItem];
      if (row?.dn) openObject(row.dn);
    }
  }
  return 0;
}

function onCommand(id, notification) {
  switch (id) {
    case ID_BASE:
      if (notification === CBN_SELCHANGE) onBaseChange();
      return;
    case IDM_BASE:
      user32.SetFocus(hwndBase);
      return user32.SendMessageW(hwndBase, CB_SHOWDROPDOWN, 1, 0);
    case ID_SEARCH_EDIT:
      // The search box emptied: the search is over.
      if (notification === EN_CHANGE && !windowText(hwndSearch).trim() && (searchHits.size || listOwner?.startsWith("search:"))) endSearch();
      return;
    case ID_SEARCH:
    case IDOK: // Enter: IsDialogMessageW presses the default button
      return runSearch();
    case IDM_FIND:
      user32.SetFocus(hwndSearch);
      return user32.SendMessageW(hwndSearch, EM_SETSEL, 0, -1);
    case IDM_REFRESH:
      return refresh();
    case IDM_UP:
      if (selectedNode !== null && nodes.get(selectedNode).parent) revealContainer(parentDn(nodes.get(selectedNode).dn));
      return;
    case IDM_OPEN:
      if (menuTarget?.dn) openObject(menuTarget.dn);
      return;
    case IDM_COPY_DN:
      if (menuTarget?.dn) copyText(menuTarget.dn);
      return;
    case IDM_COPY_VALUE:
      if (menuTarget?.value !== undefined) copyText(menuTarget.value);
      return;
  }
}

function WindowProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_SIZE:
      if (ready) layout();
      break;
    case WM_GETMINMAXINFO: {
      const info = cast(lParam, POINTER(MINMAXINFO)).contents;
      info.ptMinTrackSize.x = px(640);
      info.ptMinTrackSize.y = px(420);
      return 0;
    }
    case WM_DPICHANGED: {
      dpi = HIWORD(wParam);
      const suggested = cast(lParam, POINTER(RECT)).contents;
      const left = Number(suggested.left);
      const top = Number(suggested.top);
      applyFont();
      createImageList();
      user32.SetWindowPos(hwnd, null, left, top, Number(suggested.right) - left, Number(suggested.bottom) - top, SWP_NOZORDER | SWP_NOACTIVATE);
      layout();
      return 0;
    }
    case WM_SETTINGCHANGE:
      if (lParam && wstring_at(lParam) === "ImmersiveColorSet") applyTitleBar();
      break;
    case WM_SETCURSOR:
      // Over a splitter: the resize cursor.
      if (LOWORD(lParam) === HTCLIENT && sameHandle(wParam, hwnd)) {
        const pt = new POINT();
        user32.GetCursorPos(byref(pt));
        user32.ScreenToClient(hwnd, byref(pt));
        const splitter = dragging ?? splitterAt(Number(pt.x), Number(pt.y));
        if (splitter) {
          user32.SetCursor(user32.LoadCursorW(null, splitter === "vertical" ? IDC_SIZEWE : IDC_SIZENS));
          return 1;
        }
      }
      break;
    case WM_LBUTTONDOWN: {
      const splitter = splitterAt(SIGNED(LOWORD(lParam)), SIGNED(HIWORD(lParam)));
      if (splitter) {
        dragging = splitter;
        user32.SetCapture(hwnd);
      }
      return 0;
    }
    case WM_MOUSEMOVE:
      if (dragging) onDrag(SIGNED(LOWORD(lParam)), SIGNED(HIWORD(lParam)));
      return 0;
    case WM_LBUTTONUP:
      if (dragging) user32.ReleaseCapture();
      return 0;
    case WM_CAPTURECHANGED:
      dragging = null;
      return 0;
    case WM_ADS_REPLY:
      takeReplies();
      return 0;
    case WM_TIMER:
      if (Number(wParam) === ID_SKELETON_TIMER) onSkeletonTimer();
      return 0;
    case WM_NOTIFY:
      return onNotify(lParam);
    case WM_COMMAND:
      onCommand(LOWORD(wParam), HIWORD(wParam));
      return 0;
    case WM_CONTEXTMENU:
      onContextMenu(wParam, SIGNED(LOWORD(lParam)), SIGNED(HIWORD(lParam)));
      return 0;
    case WM_DESTROY:
      user32.KillTimer(hwnd, ID_SKELETON_TIMER);
      if (hFont) gdi32.DeleteObject(hFont);
      hFont = null;
      user32.PostQuitMessage(0);
      return 0;
  }
  return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
}

// ═══════════════════════════════════════════════════════════════════════
// Creation
// ═══════════════════════════════════════════════════════════════════════

function createChild(exStyle, className, text, style, id) {
  const hwnd = user32.CreateWindowExW(exStyle, className, text, WS_CHILD | WS_VISIBLE | style, 0, 0, 0, 0, hwndMain, id, hInstance, null);
  if (!hwnd) throw WinError(get_last_error());
  fontTargets.push(hwnd);
  return hwnd;
}

function createListView(id, columns, style = 0) {
  const hwnd = createChild(WS_EX_CLIENTEDGE, "SysListView32", null, LVS_REPORT | LVS_SHOWSELALWAYS | LVS_SINGLESEL | LVS_OWNERDATA | WS_TABSTOP | style, id);
  uxtheme.SetWindowTheme(hwnd, "Explorer", null); // the selection and hover look of File Explorer
  const extended = LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_HEADERDRAGDROP | LVS_EX_LABELTIP;
  user32.SendMessageW(hwnd, LVM_SETEXTENDEDLISTVIEWSTYLE, extended, extended);
  columns.forEach((column, i) => {
    const col = new LVCOLUMNW();
    col.mask = LVCF_FMT | LVCF_WIDTH | LVCF_TEXT;
    col.cx = px(column.width);
    col.pszText = column.title;
    SendMessagePtrW(hwnd, LVM_INSERTCOLUMNW, i, byref(col));
  });
  return hwnd;
}

function registerClass(name, proc) {
  const windowClass = new WNDCLASSEX();
  windowClass.cbSize = sizeof(WNDCLASSEX);
  windowClass.hInstance = hInstance;
  windowClass.hCursor = user32.LoadCursorW(null, IDC_ARROW);
  windowClass.hbrBackground = COLOR_BTNFACE + 1; // a system color as brush: (HBRUSH)(COLOR_BTNFACE + 1)
  windowClass.lpszClassName = name;
  windowClass.hIcon = dsuiext.DsGetIcon(DSGIF_ISNORMAL, "domainDNS", 32, 32);
  windowClass.hIconSm = dsuiext.DsGetIcon(DSGIF_ISNORMAL, "domainDNS", 16, 16);
  // Python idiom: WNDPROC(fn) wraps JS function as a stdcall callback
  const callback = WNDPROC(proc);
  callbacks.push(callback);
  windowClass.lpfnWndProc = callback;
  if (!user32.RegisterClassExW(byref(windowClass))) throw WinError(get_last_error());
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const value = () => args[++i];
    switch (args[i]) {
      case "--base":
        opts.basePath = value();
        break;
      case "--host":
        opts.host = value();
        break;
      case "--user":
        opts.username = value();
        break;
      case "--pass":
        opts.password = value();
        break;
      case "--domain":
        opts.domain = value();
        break;
    }
  }
  return opts;
}

/** The domain to browse: --base, the user's logon domain, or the DNS domain of the computer. */
function detectBaseDn(basePath) {
  if (basePath) return basePath.replace(/^LDAP:\/\/(?:[^/=]+\/)?/i, "");
  let dnsDomain = process.env.USERDNSDOMAIN;
  if (!dnsDomain) {
    const name = create_unicode_buffer(256);
    const size = new DWORD(256);
    if (kernel32.GetComputerNameExW(ComputerNameDnsDomain, name, byref(size))) dnsDomain = name.value;
  }
  return dnsDomain
    ? dnsDomain
        .split(".")
        .map((part) => `DC=${part}`)
        .join(",")
    : null;
}

function main() {
  const opts = parseArgs();
  const baseDn = detectBaseDn(opts.basePath);
  if (!baseDn) {
    console.error('Not in a domain: pass --base "LDAP://DC=corp,DC=example,DC=com" (and --host / credentials if needed).');
    process.exit(1);
  }
  directory.baseDn = baseDn;
  directory.host = opts.host ?? opts.basePath?.match(/^LDAP:\/\/([^/=]+)\//i)?.[1] ?? null;
  directory.options = { username: opts.username, password: opts.password, domain: opts.domain };
  console.log(`Active Directory Explorer — ${directory.host ? `${directory.host}/` : ""}${baseDn}`);

  hInstance = kernel32.GetModuleHandleW(null);
  registerClass("NodeCtypesADExplorer", WindowProc);
  dpi = user32.GetDpiForSystem();
  hwndMain = user32.CreateWindowExW(
    WS_EX_CONTROLPARENT,
    "NodeCtypesADExplorer",
    `Active Directory Explorer — ${canonicalName(baseDn)}`,
    WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
    CW_USEDEFAULT,
    CW_USEDEFAULT,
    px(1200),
    px(760),
    null,
    null,
    hInstance,
    null,
  );
  if (!hwndMain) throw WinError(get_last_error());
  dpi = user32.GetDpiForWindow(hwndMain);

  // Controls in tab order: base DN, search, tree, list, details.
  hwndBase = createChild(0, "COMBOBOX", null, CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, ID_BASE);
  hwndSearch = createChild(WS_EX_CLIENTEDGE, "EDIT", "", ES_AUTOHSCROLL | WS_TABSTOP, ID_SEARCH_EDIT);
  SendMessageStrW(hwndSearch, EM_SETCUEBANNER, 1, "Search the selected container: name, account, e-mail (anr) — or an LDAP filter such as (objectClass=computer)");
  hwndSearchButton = createChild(0, "BUTTON", "Search", BS_DEFPUSHBUTTON | WS_TABSTOP, ID_SEARCH);
  hwndTree = createChild(WS_EX_CLIENTEDGE, "SysTreeView32", null, TVS_HASBUTTONS | TVS_LINESATROOT | TVS_SHOWSELALWAYS | TVS_FULLROWSELECT | WS_TABSTOP, ID_TREE);
  uxtheme.SetWindowTheme(hwndTree, "Explorer", null);
  user32.SendMessageW(hwndTree, TVM_SETEXTENDEDSTYLE, TVS_EX_DOUBLEBUFFER, TVS_EX_DOUBLEBUFFER);
  hwndList = createListView(ID_LIST, LIST_COLUMNS);
  hwndDetails = createListView(ID_DETAILS, DETAIL_COLUMNS);
  hwndStatus = createChild(0, "msctls_statusbar32", null, SBARS_SIZEGRIP, null);
  createImageList(); // assigns it to the tree and the list
  applyFont();
  applyTitleBar();

  const keys = [
    [FVIRTKEY | FCONTROL, "O".charCodeAt(0), IDM_BASE],
    [FVIRTKEY, VK_F5, IDM_REFRESH],
    [FVIRTKEY | FCONTROL, "F".charCodeAt(0), IDM_FIND],
    [FVIRTKEY | FALT, VK_UP, IDM_UP],
  ];
  const table = new (array(ACCEL, keys.length))();
  keys.forEach(([fVirt, key, cmd], i) => {
    table[i].fVirt = fVirt;
    table[i].key = key;
    table[i].cmd = cmd;
  });
  hAccel = user32.CreateAcceleratorTableW(table, keys.length);

  ready = true;
  layout();
  user32.ShowWindow(hwndMain, SW_SHOW);
  user32.UpdateWindow(hwndMain);

  // The searches run in a worker; it posts WM_ADS_REPLY to this window.
  ads = new AdsWorker({ notify: { hwnd: BigInt(hwndMain), message: WM_ADS_REPLY } });
  loadBaseItems();
  loadRoot();
  user32.SetFocus(hwndTree);

  // Message loop: accelerators (Ctrl+O, F5, Ctrl+F, Alt+Up), then Tab / Enter navigation.
  const msg = new MSG();
  for (;;) {
    const result = Number(user32.GetMessageW(byref(msg), null, 0, 0));
    if (result === 0) break;
    if (result === -1) throw WinError(get_last_error());
    if (user32.TranslateAcceleratorW(hwndMain, hAccel, byref(msg))) continue;
    if (user32.IsDialogMessageW(hwndMain, byref(msg))) continue;
    user32.TranslateMessage(byref(msg));
    user32.DispatchMessageW(byref(msg));
  }

  // Post-loop cleanup (safe: no more dispatch into the callbacks).
  user32.DestroyAcceleratorTable(hAccel);
  comctl32.ImageList_Destroy(imageList);
  for (const callback of callbacks) callback.release();
  ads.close();
}

try {
  main();
} catch (err) {
  console.error(err);
}
