// Windows Controls Showcase Demo
// A small Win32 application written in JavaScript with node-ctypes, in the
// style of a Python ctypes GUI script:
//   - menu bar with keyboard accelerators, toolbar with system icons, status bar
//   - tab control with three pages: common controls (with a live GDI chart),
//     a file browser (TreeView + virtual ListView, drag and drop) and date/time
//   - a task dialog driven by a JavaScript callback, a notification area icon
//   - Common Controls 6 visual styles, per-monitor DPI awareness, Windows 11
//     dark / Mica title bar
//
// Usage:
//   node examples/windows/controls/demo_controls.js

import { WinDLL, Structure, Union, POINTER, WINFUNCTYPE, WinError, get_last_error, addressof, array, byref, cast, c_int, c_long, c_ssize_t, c_void, create_unicode_buffer, memmove, sizeof, wstring_at } from "node-ctypes";
import { wintypes } from "node-ctypes";
const {
  ATOM,
  BOOL,
  BYTE,
  COLORREF,
  DWORD,
  FILETIME,
  HANDLE,
  HBITMAP,
  HBRUSH,
  HCURSOR,
  HDC,
  HFONT,
  HGDIOBJ,
  HICON,
  HINSTANCE,
  HMENU,
  HMODULE,
  HPEN,
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
  WORD,
  WPARAM,
} = wintypes;
const HRESULT = c_long;
const LONG_PTR = c_ssize_t;
// LRESULT CALLBACK WindowProc(HWND, UINT, WPARAM, LPARAM)
const WNDPROC = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPARAM);
// HRESULT CALLBACK TaskDialogCallbackProc(HWND, UINT, WPARAM, LPARAM, LONG_PTR)
const PFTASKDIALOGCALLBACK = WINFUNCTYPE(HRESULT, HWND, UINT, WPARAM, LPARAM, LONG_PTR);

// Win32 macros (not provided by ctypes itself; inline-defined as in typical Python scripts)
const LOWORD = (x) => Number(x) & 0xffff;
const HIWORD = (x) => (Number(x) >> 16) & 0xffff;
const SIGNED = (v) => (v & 0x8000 ? v - 0x10000 : v);
const SIGNED_HIWORD = (x) => SIGNED(HIWORD(x));
const MAKELONG = (lo, hi) => ((hi & 0xffff) << 16) | (lo & 0xffff);
const RGB = (r, g, b) => r | (g << 8) | (b << 16);
// HWND, LPARAM and WPARAM values are BigInt (or null for NULL handles).
const sameHandle = (a, b) => a !== null && b !== null && BigInt(a) === BigInt(b);

// Window styles and messages
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_VSCROLL = 0x00200000;
const WS_GROUP = 0x00020000;
const WS_TABSTOP = 0x00010000;
const WS_EX_CLIENTEDGE = 0x00000200;
const WS_EX_CONTROLPARENT = 0x00010000;
const WS_EX_TOPMOST = 0x00000008;
const CW_USEDEFAULT = 0x80000000;
const SW_HIDE = 0;
const SW_SHOW = 5;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const SW_SHOWNORMAL = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const HWND_BOTTOM = 1n;
const SM_CXVSCROLL = 2;
const RDW_INVALIDATE = 0x0001;
const RDW_ERASE = 0x0004;
const RDW_ALLCHILDREN = 0x0080;
const COLOR_BTNFACE = 15;
const IDC_ARROW = 32512;
const ICON_SMALL = 0;
const ICON_BIG = 1;

const WM_DESTROY = 0x0002;
const WM_SIZE = 0x0005;
const WM_PAINT = 0x000f;
const WM_CLOSE = 0x0010;
const WM_ERASEBKGND = 0x0014;
const WM_SETTINGCHANGE = 0x001a;
const WM_GETMINMAXINFO = 0x0024;
const WM_SETFONT = 0x0030;
const WM_COPYDATA = 0x004a;
const WM_COPYGLOBALDATA = 0x0049;
const WM_NOTIFY = 0x004e;
const WM_CONTEXTMENU = 0x007b;
const WM_SETICON = 0x0080;
const WM_COMMAND = 0x0111;
const WM_TIMER = 0x0113;
const WM_HSCROLL = 0x0114;
const WM_VSCROLL = 0x0115;
const WM_MOUSEWHEEL = 0x020a;
const WM_DROPFILES = 0x0233;
const WM_DPICHANGED = 0x02e0;
const WM_SETREDRAW = 0x000b;
const WM_APP = 0x8000;
const WM_TRAYICON = WM_APP + 1;
const WHEEL_DELTA = 120;
const MSGFLT_ALLOW = 1;

// Scroll bars
const SB_LINEUP = 0;
const SB_LINEDOWN = 1;
const SB_PAGEUP = 2;
const SB_PAGEDOWN = 3;
const SB_THUMBTRACK = 5;
const SB_TOP = 6;
const SB_BOTTOM = 7;
const SB_VERT = 1;
const SIF_RANGE = 0x1;
const SIF_PAGE = 0x2;
const SIF_POS = 0x4;
const SIF_DISABLENOSCROLL = 0x8;
const SIF_TRACKPOS = 0x10;
const SW_SCROLLCHILDREN = 0x0001;
const SW_INVALIDATE = 0x0002;
const SW_ERASE = 0x0004;

// Buttons, statics, edit, combo box and list box
const BS_PUSHBUTTON = 0x00000000;
const BS_DEFPUSHBUTTON = 0x00000001;
const BS_AUTOCHECKBOX = 0x00000003;
const BS_GROUPBOX = 0x00000007;
const BS_AUTORADIOBUTTON = 0x00000009;
const BM_GETCHECK = 0x00f0;
const BM_SETCHECK = 0x00f1;
const BST_UNCHECKED = 0x0000;
const BST_CHECKED = 0x0001;
const BN_CLICKED = 0;
const SS_LEFT = 0x0000;
const ES_AUTOHSCROLL = 0x0080;
const ES_NUMBER = 0x2000;
const EN_CHANGE = 0x0300;
const CBS_DROPDOWNLIST = 0x0003;
const CBS_HASSTRINGS = 0x0200;
const CB_ADDSTRING = 0x0143;
const CB_GETCURSEL = 0x0147;
const CB_GETLBTEXT = 0x0148;
const CB_SETCURSEL = 0x014e;
const CBN_SELCHANGE = 1;
const LBS_NOTIFY = 0x0001;
const LBS_SORT = 0x0002;
const LBS_HASSTRINGS = 0x0040;
const LB_ADDSTRING = 0x0180;
const LB_GETCURSEL = 0x0188;
const LB_GETTEXT = 0x0189;
const LBN_SELCHANGE = 1;

// Menus and accelerators
const MF_STRING = 0x0000;
const MF_GRAYED = 0x0001;
const MF_CHECKED = 0x0008;
const MF_UNCHECKED = 0x0000;
const MF_POPUP = 0x0010;
const MF_SEPARATOR = 0x0800;
const MF_BYCOMMAND = 0x0000;
const TPM_RIGHTBUTTON = 0x0002;
const FVIRTKEY = 0x01;
const FCONTROL = 0x08;
const VK_F1 = 0x70;
const VK_F5 = 0x74;

// Common controls (WM_USER = 0x0400). Values checked against commctrl.h.
const ICC_LISTVIEW_CLASSES = 0x0001;
const ICC_TREEVIEW_CLASSES = 0x0002;
const ICC_BAR_CLASSES = 0x0004;
const ICC_TAB_CLASSES = 0x0008;
const ICC_UPDOWN_CLASS = 0x0010;
const ICC_PROGRESS_CLASS = 0x0020;
const ICC_DATE_CLASSES = 0x0100;
const ICC_STANDARD_CLASSES = 0x4000;
const PBS_SMOOTH = 0x01;
const PBM_SETPOS = 0x0402;
const PBM_SETRANGE32 = 0x0406;
const TBS_AUTOTICKS = 0x0001;
const TBM_GETPOS = 0x0400;
const TBM_SETPOS = 0x0405;
const TBM_SETRANGE = 0x0406;
const TBM_SETTICFREQ = 0x0414;
const UDS_SETBUDDYINT = 0x0002;
const UDS_ALIGNRIGHT = 0x0004;
const UDS_ARROWKEYS = 0x0020;
const UDS_NOTHOUSANDS = 0x0080;
const UDM_SETBUDDY = 0x0469;
const UDM_SETRANGE32 = 0x046f;
const UDM_SETPOS32 = 0x0471;
const TTS_ALWAYSTIP = 0x01;
const TTS_NOPREFIX = 0x02;
const TTF_IDISHWND = 0x0001;
const TTF_SUBCLASS = 0x0010;
const TTM_ADDTOOLW = 0x0432;
const TTM_SETMAXTIPWIDTH = 0x0418;
// Notifications: negative codes (NMHDR.code is read as unsigned, see notifyCode)
const NM_RCLICK = -5;
const TCN_SELCHANGE = -551;
const TVN_SELCHANGEDW = -451;
const TVN_ITEMEXPANDINGW = -454;
const LVN_ITEMCHANGED = -101;
const LVN_COLUMNCLICK = -108;
const LVN_ITEMACTIVATE = -114;
const LVN_GETDISPINFOW = -177;
const DTN_DATETIMECHANGE = -759;
const MCN_SELCHANGE = -749;
// Tab control
const TCIF_TEXT = 0x0001;
const TCM_GETCURSEL = 0x130b;
const TCM_INSERTITEMW = 0x133e;
const TCM_SETCURSEL = 0x130c;
const TCM_ADJUSTRECT = 0x1328;
// Tree view
const TVS_HASBUTTONS = 0x0001;
const TVS_LINESATROOT = 0x0004;
const TVS_SHOWSELALWAYS = 0x0020;
const TVS_FULLROWSELECT = 0x1000;
const TVS_EX_DOUBLEBUFFER = 0x0004;
const TVM_EXPAND = 0x1102;
const TVM_SETIMAGELIST = 0x1109;
const TVM_SELECTITEM = 0x110b;
const TVM_SETEXTENDEDSTYLE = 0x112c;
const TVM_INSERTITEMW = 0x1132;
const TVM_ENSUREVISIBLE = 0x1114;
const TVM_SETITEMW = 0x113f;
const TVIF_TEXT = 0x0001;
const TVIF_IMAGE = 0x0002;
const TVIF_PARAM = 0x0004;
const TVIF_HANDLE = 0x0010;
const TVIF_SELECTEDIMAGE = 0x0020;
const TVIF_CHILDREN = 0x0040;
const TVI_ROOT = -0x10000;
const TVI_LAST = -0xfffe;
const TVE_EXPAND = 0x0002;
const TVGN_CARET = 0x0009;
const TVSIL_NORMAL = 0;
// List view (virtual: LVS_OWNERDATA) and its header
const LVS_REPORT = 0x0001;
const LVS_SHOWSELALWAYS = 0x0008;
const LVS_SHAREIMAGELISTS = 0x0040;
const LVS_OWNERDATA = 0x1000;
const LVS_EX_HEADERDRAGDROP = 0x0010;
const LVS_EX_FULLROWSELECT = 0x0020;
const LVS_EX_LABELTIP = 0x4000;
const LVS_EX_DOUBLEBUFFER = 0x10000;
const LVM_SETIMAGELIST = 0x1003;
const LVM_SETCOLUMNWIDTH = 0x101e;
const LVM_GETHEADER = 0x101f;
const LVM_SETITEMCOUNT = 0x102f;
const LVM_GETSELECTEDCOUNT = 0x1032;
const LVM_SETEXTENDEDLISTVIEWSTYLE = 0x1036;
const LVM_INSERTCOLUMNW = 0x1061;
const LVM_SETVIEW = 0x108e;
const LV_VIEW_ICON = 0;
const LV_VIEW_DETAILS = 1;
const LV_VIEW_SMALLICON = 2;
const LV_VIEW_LIST = 3;
const LVSIL_NORMAL = 0;
const LVSIL_SMALL = 1;
const LVCF_FMT = 0x0001;
const LVCF_WIDTH = 0x0002;
const LVCF_TEXT = 0x0004;
const LVCFMT_RIGHT = 0x0001;
const LVIF_TEXT = 0x0001;
const LVIF_IMAGE = 0x0002;
const HDM_GETITEMW = 0x120b;
const HDM_SETITEMW = 0x120c;
const HDI_FORMAT = 0x0004;
const HDF_SORTDOWN = 0x0200;
const HDF_SORTUP = 0x0400;
// Date and time picker, month calendar
const DTS_SHORTDATEFORMAT = 0x0000;
const DTS_UPDOWN = 0x0001;
const DTS_TIMEFORMAT = 0x0009;
const DTM_GETSYSTEMTIME = 0x1001;
const DTM_SETSYSTEMTIME = 0x1002;
const MCS_WEEKNUMBERS = 0x0004;
const MCM_GETCURSEL = 0x1001;
const MCM_SETCURSEL = 0x1002;
const MCM_GETMINREQRECT = 0x1009;
const GDT_VALID = 0;
const DATE_LONGDATE = 0x0002;
// Toolbar and status bar
const TBSTYLE_TOOLTIPS = 0x0100;
const TBSTYLE_FLAT = 0x0800;
const TBSTYLE_LIST = 0x1000;
const TBSTYLE_EX_DOUBLEBUFFER = 0x0080;
const BTNS_BUTTON = 0x00;
const BTNS_SEP = 0x01;
const BTNS_CHECK = 0x02;
const BTNS_AUTOSIZE = 0x10;
const TBSTATE_ENABLED = 0x04;
const TB_CHECKBUTTON = 0x0402;
const TB_BUTTONSTRUCTSIZE = 0x041e;
const TB_AUTOSIZE = 0x0421;
const TB_SETIMAGELIST = 0x0430;
const TB_ADDBUTTONSW = 0x0444;
const TB_SETEXTENDEDSTYLE = 0x0454;
const SBARS_SIZEGRIP = 0x0100;
const SB_SETPARTS = 0x0404;
const SB_SETTEXTW = 0x040b;
// Task dialog
const TDF_ENABLE_HYPERLINKS = 0x0001;
const TDF_ALLOW_DIALOG_CANCELLATION = 0x0008;
const TDF_USE_COMMAND_LINKS = 0x0010;
const TDF_EXPAND_FOOTER_AREA = 0x0040;
const TDF_SHOW_PROGRESS_BAR = 0x0200;
const TDF_CALLBACK_TIMER = 0x0800;
const TDF_POSITION_RELATIVE_TO_WINDOW = 0x1000;
const TDCBF_OK_BUTTON = 0x0001;
const TDCBF_CLOSE_BUTTON = 0x0020;
const TDN_CREATED = 0;
const TDN_BUTTON_CLICKED = 2;
const TDN_HYPERLINK_CLICKED = 3;
const TDN_TIMER = 4;
const TDN_RADIO_BUTTON_CLICKED = 6;
const TDM_SET_PROGRESS_BAR_STATE = 0x0468;
const TDM_SET_PROGRESS_BAR_RANGE = 0x0469;
const TDM_SET_PROGRESS_BAR_POS = 0x046a;
const PBST_NORMAL = 1;
const PBST_ERROR = 2;
const PBST_PAUSED = 3;
const TD_INFORMATION_ICON = 0xfffdn; // MAKEINTRESOURCEW(-3)
const TD_SHIELD_ICON = 0xfffcn; // MAKEINTRESOURCEW(-4)
const S_OK = 0;
const S_FALSE = 1;
// Shell
const SHGFI_LARGEICON = 0x0000;
const SHGFI_SMALLICON = 0x0001;
const SHGFI_OPENICON = 0x0002;
const SHGFI_USEFILEATTRIBUTES = 0x0010;
const SHGFI_DISPLAYNAME = 0x0200;
const SHGFI_TYPENAME = 0x0400;
const SHGFI_SYSICONINDEX = 0x4000;
const SHGSI_ICON = 0x0100;
const SHGSI_SMALLICON = 0x0001;
const SHGSI_SYSICONINDEX = 0x4000;
const SIID_FOLDEROPEN = 4;
const SIID_FIND = 22;
const SIID_HELP = 23;
const SIID_INFO = 79;
const SIID_WORLD = 13;
const SIID_VIDEOFILES = 73;
const SIID_DESKTOPPC = 94;
const NIM_ADD = 0;
const NIM_MODIFY = 1;
const NIM_DELETE = 2;
const NIM_SETVERSION = 4;
const NIF_MESSAGE = 0x01;
const NIF_ICON = 0x02;
const NIF_TIP = 0x04;
const NIF_INFO = 0x10;
const NIF_SHOWTIP = 0x80;
const NIIF_INFO = 0x01;
const NOTIFYICON_VERSION_4 = 4;
const NIN_SELECT = 0x0400;
const NIN_KEYSELECT = 0x0401;
const BIF_RETURNONLYFSDIRS = 0x0001;
const BIF_NEWDIALOGSTYLE = 0x0040;
const FILE_ATTRIBUTE_HIDDEN = 0x02;
const FILE_ATTRIBUTE_SYSTEM = 0x04;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const DRIVE_NO_ROOT_DIR = 1;
// GDI
const PS_SOLID = 0;
const NULL_PEN = 8;
const TRANSPARENT = 1;
const SRCCOPY = 0x00cc0020;
const DT_SINGLELINE = 0x0020;
const DT_NOPREFIX = 0x0800;
// DWM, registry, activation context and DPI
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const DWMWA_SYSTEMBACKDROP_TYPE = 38;
const DWMSBT_NONE = 1;
const DWMSBT_MAINWINDOW = 2; // Mica
const HKEY_CURRENT_USER = -0x7fffffff; // (HKEY)(ULONG_PTR)(LONG)0x80000001: sign-extended
const RRF_RT_REG_DWORD = 0x0010;
const ACTCTX_FLAG_RESOURCE_NAME_VALID = 0x008;
const INVALID_HANDLE_VALUE = -1n;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const SPI_GETNONCLIENTMETRICS = 0x0029;
const USER_DEFAULT_SCREEN_DPI = 96;

// Control IDs
const ID_BUTTON = 2001;
const ID_DEFAULT = 2002;
const ID_MINIMIZE = 2003;
const ID_COUNTER = 2004;
const ID_TEXT_INPUT = 2005;
const ID_ANIMATE = 2006;
const ID_RADIO1 = 2007;
const ID_RADIO2 = 2008;
const ID_COMBOBOX = 2009;
const ID_PROGRESSBAR = 2010;
const ID_LISTBOX = 2011;
const ID_TRACKBAR = 2012;
const ID_SPIN = 2013;
const ID_SPIN_EDIT = 2014;
// Commands: menus, accelerators, toolbar and context menus
const IDM_BROWSE = 3001;
const IDM_REFRESH = 3002;
const IDM_EXIT = 3003;
const IDM_VIEW_DETAILS = 3010;
const IDM_VIEW_LIST = 3011;
const IDM_VIEW_SMALL = 3012;
const IDM_VIEW_LARGE = 3013;
const IDM_DARK = 3020;
const IDM_MICA = 3021;
const IDM_ANIMATE = 3030;
const IDM_TASKDIALOG = 3031;
const IDM_NOTIFY = 3032;
const IDM_ABOUT = 3040;
const IDM_SHOW = 3050;
const IDM_VALUE_0 = 3060;
const IDM_VALUE_50 = 3061;
const IDM_VALUE_100 = 3062;
// Timers
const ID_ANIMATE_TIMER = 1;
const ID_RESTORE_TIMER = 2;
const ID_CLOCK_TIMER = 3;
const ID_SAMPLE_TIMER = 4;
// Task dialog buttons
const ID_TD_RESTART = 101;
const ID_TD_SET75 = 102;
const ID_TD_NORMAL = 201;
const ID_TD_PAUSED = 202;
const ID_TD_ERROR = 203;

// ============================================================================
// Windows structures (defined before argtypes so POINTER(T) can reference them).
// Matches Python ctypes idiom: `class X(Structure): _fields_ = [...]`.
// POINT, RECT, MSG and FILETIME come from wintypes (Python: ctypes.wintypes).
// Sizes match the Windows SDK headers on 64-bit Windows.
// ============================================================================

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

class MINMAXINFO extends Structure {
  static _fields_ = [
    ["ptReserved", POINT],
    ["ptMaxSize", POINT],
    ["ptMaxPosition", POINT],
    ["ptMinTrackSize", POINT],
    ["ptMaxTrackSize", POINT],
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

class NMDATETIMECHANGE extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["dwFlags", DWORD],
    ["st", SYSTEMTIME],
  ];
}

class NMSELCHANGE extends Structure {
  static _fields_ = [
    ["hdr", NMHDR],
    ["stSelStart", SYSTEMTIME],
    ["stSelEnd", SYSTEMTIME],
  ];
}

class TCITEMW extends Structure {
  static _fields_ = [
    ["mask", UINT],
    ["dwState", DWORD],
    ["dwStateMask", DWORD],
    ["pszText", LPWSTR],
    ["cchTextMax", INT],
    ["iImage", INT],
    ["lParam", LPARAM],
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
    ["hbm", HBITMAP],
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

// iString: the address of the button text (INT_PTR).
class TBBUTTON extends Structure {
  static _fields_ = [
    ["iBitmap", INT],
    ["idCommand", INT],
    ["fsState", BYTE],
    ["fsStyle", BYTE],
    ["bReserved", array(BYTE, sizeof(LPVOID) === 8 ? 6 : 2)],
    ["dwData", ULONG_PTR],
    ["iString", LONG_PTR],
  ];
}

class ACCEL extends Structure {
  static _fields_ = [
    ["fVirt", BYTE],
    ["key", WORD],
    ["cmd", WORD],
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

class SHFILEINFOW extends Structure {
  static _fields_ = [
    ["hIcon", HICON],
    ["iIcon", INT],
    ["dwAttributes", DWORD],
    ["szDisplayName", array(WCHAR, 260)],
    ["szTypeName", array(WCHAR, 80)],
  ];
}

class SHSTOCKICONINFO extends Structure {
  static _fields_ = [
    ["cbSize", DWORD],
    ["hIcon", HICON],
    ["iSysImageIndex", INT],
    ["iIcon", INT],
    ["szPath", array(WCHAR, 260)],
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
    ["cFileName", array(WCHAR, 260)],
    ["cAlternateFileName", array(WCHAR, 14)],
  ];
}

class BROWSEINFOW extends Structure {
  static _fields_ = [
    ["hwndOwner", HWND],
    ["pidlRoot", LPVOID],
    ["pszDisplayName", LPWSTR],
    ["lpszTitle", LPCWSTR],
    ["ulFlags", UINT],
    ["lpfn", LPVOID],
    ["lParam", LPARAM],
    ["iImage", INT],
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

class NOTIFYICONDATAW extends Structure {
  static _fields_ = [
    ["cbSize", DWORD],
    ["hWnd", HWND],
    ["uID", UINT],
    ["uFlags", UINT],
    ["uCallbackMessage", UINT],
    ["hIcon", HICON],
    ["szTip", array(WCHAR, 128)],
    ["dwState", DWORD],
    ["dwStateMask", DWORD],
    ["szInfo", array(WCHAR, 256)],
    ["uVersion", UINT], // a union with uTimeout
    ["szInfoTitle", array(WCHAR, 64)],
    ["dwInfoFlags", DWORD],
    ["guidItem", GUID],
    ["hBalloonIcon", HICON],
  ];
}

class OSVERSIONINFOW extends Structure {
  static _fields_ = [
    ["dwOSVersionInfoSize", DWORD],
    ["dwMajorVersion", DWORD],
    ["dwMinorVersion", DWORD],
    ["dwBuildNumber", DWORD],
    ["dwPlatformId", DWORD],
    ["szCSDVersion", array(WCHAR, 128)],
  ];
}

// commctrl.h declares the task dialog structures with #include <pshpack1.h>:
// one-byte packing, and unions for the icons (a handle or a resource name).
class TASKDIALOG_BUTTON extends Structure {
  static _pack_ = 1;
  static _fields_ = [
    ["nButtonID", INT],
    ["pszButtonText", LPVOID], // address of a wide string kept alive by the caller
  ];
}

class TASKDIALOG_ICON extends Union {
  static _fields_ = [
    ["hIcon", HICON],
    ["pszIcon", LPCWSTR],
  ];
}

class TASKDIALOGCONFIG extends Structure {
  static _pack_ = 1;
  static _fields_ = [
    ["cbSize", UINT],
    ["hwndParent", HWND],
    ["hInstance", HINSTANCE],
    ["dwFlags", INT],
    ["dwCommonButtons", INT],
    ["pszWindowTitle", LPCWSTR],
    ["mainIcon", TASKDIALOG_ICON],
    ["pszMainInstruction", LPCWSTR],
    ["pszContent", LPCWSTR],
    ["cButtons", UINT],
    ["pButtons", LPVOID],
    ["nDefaultButton", INT],
    ["cRadioButtons", UINT],
    ["pRadioButtons", LPVOID],
    ["nDefaultRadioButton", INT],
    ["pszVerificationText", LPCWSTR],
    ["pszExpandedInformation", LPCWSTR],
    ["pszExpandedControlText", LPCWSTR],
    ["pszCollapsedControlText", LPCWSTR],
    ["footerIcon", TASKDIALOG_ICON],
    ["pszFooter", LPCWSTR],
    ["pfCallback", PFTASKDIALOGCALLBACK],
    ["lpCallbackData", LONG_PTR],
    ["cxWidth", UINT],
  ];
}

// ============================================================================
// Function signatures (Python-ctypes style: argtypes / restype).
// ============================================================================

const kernel32 = new WinDLL("kernel32.dll", { use_last_error: true });
const user32 = new WinDLL("user32.dll", { use_last_error: true });
const gdi32 = new WinDLL("gdi32.dll");
const shell32 = new WinDLL("shell32.dll");
const ole32 = new WinDLL("ole32.dll");
const advapi32 = new WinDLL("advapi32.dll");
const dwmapi = new WinDLL("dwmapi.dll");
const uxtheme = new WinDLL("uxtheme.dll");
const ntdll = new WinDLL("ntdll.dll");

function prototype(fn, restype, argtypes) {
  fn.restype = restype;
  fn.argtypes = argtypes;
}

// kernel32 / ntdll
prototype(kernel32.GetModuleHandleW, HMODULE, [LPCWSTR]);
prototype(kernel32.CreateActCtxW, HANDLE, [POINTER(ACTCTXW)]);
prototype(kernel32.ActivateActCtx, BOOL, [HANDLE, POINTER(ULONG_PTR)]);
prototype(kernel32.DeactivateActCtx, BOOL, [DWORD, ULONG_PTR]);
prototype(kernel32.ReleaseActCtx, c_void, [HANDLE]);
prototype(kernel32.FindFirstFileW, HANDLE, [LPCWSTR, POINTER(WIN32_FIND_DATAW)]);
prototype(kernel32.FindNextFileW, BOOL, [HANDLE, POINTER(WIN32_FIND_DATAW)]);
prototype(kernel32.FindClose, BOOL, [HANDLE]);
prototype(kernel32.GetLogicalDrives, DWORD, []);
prototype(kernel32.GetDriveTypeW, UINT, [LPCWSTR]);
prototype(kernel32.GetDateFormatEx, INT, [LPCWSTR, DWORD, POINTER(SYSTEMTIME), LPCWSTR, LPWSTR, INT, LPCWSTR]);
prototype(kernel32.GetTimeFormatEx, INT, [LPCWSTR, DWORD, POINTER(SYSTEMTIME), LPCWSTR, LPWSTR, INT]);
prototype(ntdll.RtlGetVersion, LONG, [POINTER(OSVERSIONINFOW)]);

// user32: windows, messages, menus
// DPI_AWARENESS_CONTEXT is a pseudo-handle with a negative value (-4).
prototype(user32.SetProcessDpiAwarenessContext, BOOL, [c_ssize_t]);
prototype(user32.GetDpiForWindow, UINT, [HWND]);
prototype(user32.GetDpiForSystem, UINT, []);
prototype(user32.GetSystemMetricsForDpi, INT, [INT, UINT]);
prototype(user32.AdjustWindowRectExForDpi, BOOL, [POINTER(RECT), DWORD, BOOL, DWORD, UINT]);
prototype(user32.SystemParametersInfoForDpi, BOOL, [UINT, UINT, LPVOID, UINT, UINT]);
prototype(user32.RegisterClassExW, ATOM, [POINTER(WNDCLASSEX)]);
prototype(user32.CreateWindowExW, HWND, [DWORD, LPCWSTR, LPCWSTR, DWORD, INT, INT, INT, INT, HWND, HMENU, HINSTANCE, LPVOID]);
prototype(user32.DestroyWindow, BOOL, [HWND]);
prototype(user32.ShowWindow, BOOL, [HWND, INT]);
prototype(user32.UpdateWindow, BOOL, [HWND]);
prototype(user32.SetForegroundWindow, BOOL, [HWND]);
prototype(user32.IsWindowVisible, BOOL, [HWND]);
prototype(user32.InvalidateRect, BOOL, [HWND, POINTER(RECT), BOOL]);
prototype(user32.RedrawWindow, BOOL, [HWND, POINTER(RECT), LPVOID, UINT]);
prototype(user32.GetMessageW, BOOL, [POINTER(MSG), HWND, UINT, UINT]);
prototype(user32.IsDialogMessageW, BOOL, [HWND, POINTER(MSG)]);
prototype(user32.TranslateAcceleratorW, INT, [HWND, HANDLE, POINTER(MSG)]);
prototype(user32.TranslateMessage, BOOL, [POINTER(MSG)]);
prototype(user32.DispatchMessageW, LRESULT, [POINTER(MSG)]);
prototype(user32.DefWindowProcW, LRESULT, [HWND, UINT, WPARAM, LPARAM]);
prototype(user32.PostQuitMessage, c_void, [INT]);
// Second arg may be MAKEINTRESOURCE (integer cast to pointer), so kept LPVOID.
prototype(user32.LoadCursorW, HCURSOR, [HINSTANCE, LPVOID]);
prototype(user32.DestroyIcon, BOOL, [HICON]);
prototype(user32.SetWindowTextW, BOOL, [HWND, LPCWSTR]);
prototype(user32.GetWindowTextW, INT, [HWND, LPWSTR, INT]);
prototype(user32.GetClientRect, BOOL, [HWND, POINTER(RECT)]);
prototype(user32.GetWindowRect, BOOL, [HWND, POINTER(RECT)]);
prototype(user32.GetCursorPos, BOOL, [POINTER(POINT)]);
prototype(user32.MoveWindow, BOOL, [HWND, INT, INT, INT, INT, BOOL]);
prototype(user32.SetWindowPos, BOOL, [HWND, HWND, INT, INT, INT, INT, UINT]);
// HDWP BeginDeferWindowPos(int), DeferWindowPos(HDWP, ...), EndDeferWindowPos(HDWP)
prototype(user32.BeginDeferWindowPos, HANDLE, [INT]);
prototype(user32.DeferWindowPos, HANDLE, [HANDLE, HWND, HWND, INT, INT, INT, INT, UINT]);
prototype(user32.EndDeferWindowPos, BOOL, [HANDLE]);
prototype(user32.GetScrollInfo, BOOL, [HWND, INT, POINTER(SCROLLINFO)]);
prototype(user32.SetScrollInfo, INT, [HWND, INT, POINTER(SCROLLINFO), BOOL]);
prototype(user32.ScrollWindowEx, INT, [HWND, INT, INT, POINTER(RECT), POINTER(RECT), LPVOID, POINTER(RECT), UINT]);
prototype(user32.SetTimer, UINT_PTR, [HWND, UINT_PTR, UINT, LPVOID]);
prototype(user32.KillTimer, BOOL, [HWND, UINT_PTR]);
prototype(user32.ChangeWindowMessageFilterEx, BOOL, [HWND, UINT, DWORD, LPVOID]);
prototype(user32.CreateMenu, HMENU, []);
prototype(user32.CreatePopupMenu, HMENU, []);
prototype(user32.AppendMenuW, BOOL, [HMENU, UINT, UINT_PTR, LPCWSTR]);
prototype(user32.SetMenu, BOOL, [HWND, HMENU]);
prototype(user32.DestroyMenu, BOOL, [HMENU]);
prototype(user32.CheckMenuItem, DWORD, [HMENU, UINT, UINT]);
prototype(user32.CheckMenuRadioItem, BOOL, [HMENU, UINT, UINT, UINT, UINT]);
prototype(user32.EnableMenuItem, BOOL, [HMENU, UINT, UINT]);
prototype(user32.TrackPopupMenuEx, BOOL, [HMENU, UINT, INT, INT, HWND, LPVOID]);
prototype(user32.CreateAcceleratorTableW, HANDLE, [POINTER(ACCEL), INT]);
prototype(user32.DestroyAcceleratorTable, BOOL, [HANDLE]);
prototype(user32.SendMessageW, LRESULT, [HWND, UINT, WPARAM, LPARAM]);

// SendMessageW with a string / text buffer / structure as lParam: same export,
// typed prototypes (Python: WINFUNCTYPE(...)(("SendMessageW", user32))).
const SendMessageStrW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPCWSTR)(["SendMessageW", user32]);
const SendMessageBufW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPWSTR)(["SendMessageW", user32]);
const SendMessagePtrW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, LPVOID)(["SendMessageW", user32]);

// user32 / gdi32: painting
prototype(user32.BeginPaint, HDC, [HWND, POINTER(PAINTSTRUCT)]);
prototype(user32.EndPaint, BOOL, [HWND, POINTER(PAINTSTRUCT)]);
prototype(user32.FillRect, INT, [HDC, POINTER(RECT), HBRUSH]);
prototype(user32.DrawTextW, INT, [HDC, LPCWSTR, INT, POINTER(RECT), UINT]);
prototype(gdi32.CreateFontIndirectW, HFONT, [POINTER(LOGFONTW)]);
prototype(gdi32.DeleteObject, BOOL, [HGDIOBJ]);
prototype(gdi32.CreateCompatibleDC, HDC, [HDC]);
prototype(gdi32.CreateCompatibleBitmap, HBITMAP, [HDC, INT, INT]);
prototype(gdi32.DeleteDC, BOOL, [HDC]);
prototype(gdi32.SelectObject, HGDIOBJ, [HDC, HGDIOBJ]);
prototype(gdi32.GetStockObject, HGDIOBJ, [INT]);
prototype(gdi32.CreateSolidBrush, HBRUSH, [COLORREF]);
prototype(gdi32.CreatePen, HPEN, [INT, INT, COLORREF]);
prototype(gdi32.MoveToEx, BOOL, [HDC, INT, INT, LPVOID]);
prototype(gdi32.LineTo, BOOL, [HDC, INT, INT]);
prototype(gdi32.Polygon, BOOL, [HDC, POINTER(POINT), INT]);
prototype(gdi32.Polyline, BOOL, [HDC, POINTER(POINT), INT]);
prototype(gdi32.SetBkMode, INT, [HDC, INT]);
prototype(gdi32.SetTextColor, COLORREF, [HDC, COLORREF]);
prototype(gdi32.BitBlt, BOOL, [HDC, INT, INT, INT, INT, HDC, INT, INT, DWORD]);

// shell32 / ole32 / advapi32 / dwmapi / uxtheme
prototype(shell32.SHGetFileInfoW, ULONG_PTR, [LPCWSTR, DWORD, POINTER(SHFILEINFOW), UINT, UINT]);
prototype(shell32.SHGetStockIconInfo, HRESULT, [UINT, UINT, POINTER(SHSTOCKICONINFO)]);
prototype(shell32.Shell_NotifyIconW, BOOL, [DWORD, POINTER(NOTIFYICONDATAW)]);
prototype(shell32.ShellExecuteW, HINSTANCE, [HWND, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, INT]);
prototype(shell32.DragAcceptFiles, c_void, [HWND, BOOL]);
prototype(shell32.DragQueryFileW, UINT, [HANDLE, UINT, LPWSTR, UINT]);
prototype(shell32.DragFinish, c_void, [HANDLE]);
prototype(shell32.SHBrowseForFolderW, LPVOID, [POINTER(BROWSEINFOW)]);
prototype(shell32.SHGetPathFromIDListW, BOOL, [LPVOID, LPWSTR]);
prototype(ole32.OleInitialize, HRESULT, [LPVOID]);
prototype(ole32.OleUninitialize, c_void, []);
prototype(ole32.CoTaskMemFree, c_void, [LPVOID]);
// HKEY_CURRENT_USER is a sign-extended pseudo-handle: LONG_PTR.
prototype(advapi32.RegGetValueW, LONG, [LONG_PTR, LPCWSTR, LPCWSTR, DWORD, LPVOID, LPVOID, POINTER(DWORD)]);
prototype(dwmapi.DwmSetWindowAttribute, HRESULT, [HWND, DWORD, LPVOID, DWORD]);
prototype(uxtheme.SetWindowTheme, HRESULT, [HWND, LPCWSTR, LPCWSTR]);

// ============================================================================
// Process setup: per-monitor DPI awareness and Common Controls 6.
// ============================================================================

// Fails if the awareness is already set (e.g. by the executable manifest): the
// demo then uses what the process has.
user32.SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

// node.exe has no manifest asking for Common Controls 6, so controls would be
// drawn in the classic Windows 95 style. Activate the manifest that shell32.dll
// embeds as resource 124 (the usual trick for hosts without their own), before
// comctl32.dll is loaded: the process then binds version 6 and its themed classes.
const actctx = new ACTCTXW();
actctx.cbSize = sizeof(ACTCTXW);
actctx.dwFlags = ACTCTX_FLAG_RESOURCE_NAME_VALID;
actctx.lpSource = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\shell32.dll`;
actctx.lpResourceName = 124;
const hActCtx = kernel32.CreateActCtxW(byref(actctx));
const actCtxCookie = new ULONG_PTR(0);
const visualStyles = hActCtx !== null && BigInt.asIntN(64, BigInt(hActCtx)) !== INVALID_HANDLE_VALUE && Boolean(kernel32.ActivateActCtx(hActCtx, byref(actCtxCookie)));
if (!visualStyles) console.log("Visual styles unavailable:", WinError(get_last_error()).message);

const comctl32 = new WinDLL("comctl32.dll");
prototype(comctl32.InitCommonControlsEx, BOOL, [POINTER(INITCOMMONCONTROLSEX)]);
// Task dialogs exist only in Common Controls 6.
const taskDialogs = visualStyles;
if (taskDialogs) {
  prototype(comctl32.TaskDialogIndirect, HRESULT, [POINTER(TASKDIALOGCONFIG), POINTER(c_int), POINTER(c_int), POINTER(BOOL)]);
  prototype(comctl32.TaskDialog, HRESULT, [HWND, HINSTANCE, LPCWSTR, LPCWSTR, LPCWSTR, INT, LPVOID, POINTER(c_int)]);
}

// Register common control classes before creating windows
const icex = new INITCOMMONCONTROLSEX();
icex.dwSize = sizeof(INITCOMMONCONTROLSEX);
icex.dwICC = ICC_STANDARD_CLASSES | ICC_BAR_CLASSES | ICC_PROGRESS_CLASS | ICC_UPDOWN_CLASS | ICC_TAB_CLASSES | ICC_LISTVIEW_CLASSES | ICC_TREEVIEW_CLASSES | ICC_DATE_CLASSES;
comctl32.InitCommonControlsEx(byref(icex));

// The folder dialog (SHBrowseForFolderW with BIF_NEWDIALOGSTYLE) needs OLE.
ole32.OleInitialize(null);

// ============================================================================
// Layout, in device-independent pixels (96 DPI), scaled to the window's DPI.
// On the Controls page the group boxes form two columns that share the width;
// below TWO_COLUMNS_WIDTH they stack in one column, and the page scrolls.
// ============================================================================

const MARGIN = 20;
const GAP = 16; // between group boxes
const INSET = 14; // left and right padding inside a group box
const MIN_COLUMN = 400;
const TWO_COLUMNS_WIDTH = 2 * MIN_COLUMN + 3 * MARGIN;
const WINDOW_W = 1100;
const WINDOW_H = 720;
const MIN_WINDOW_H = 420;
// Widths of controls inside a group box of width `w`.
const FILL = (w) => w - 2 * INSET;
// Cell `i` of `n` equal buttons in a row, at most 140 wide.
const cellWidth = (w, n) => Math.min(140, (w - 2 * INSET - (n - 1) * 10) / n);
const cell = (i, n) => ({ x: (w) => INSET + i * (cellWidth(w, n) + 10), w: (w) => cellWidth(w, n) });
const HISTORY = 100; // chart samples: 10 s at ID_SAMPLE_TIMER

// Global state for demo
let hInstance = null;
let ready = false; // the children exist: WM_SIZE can lay them out
let hwndMain = null;
let hFont = null;
let dpi = USER_DEFAULT_SCREEN_DPI;
let counter = 0;
let value = 0; // shared by the trackbar, the spin control, the progress bar and the chart
let syncing = false; // re-entrancy guard: setValue() changes the other controls
let animating = false;
let notifyAt100 = false;
const history = new Array(HISTORY).fill(0);
const callbacks = []; // WNDPROC callbacks: alive as long as their windows
const fontTargets = []; // every window that uses the message font
let hwndToolbar = null;
let hwndStatus = null;
let hwndTab = null;
let hMenuBar = null;
let hAccel = null;
let hIconSmall = null;
let hIconBig = null;
let smallImages = null; // the system image lists (shared, never destroyed)
let largeImages = null;
const toolbarTexts = []; // button strings referenced by TBBUTTON.iString
// Pages of the tab control: { hwnd, title, layout() }
const pages = [];
// Title bar
let darkTitle = false;
let followSystemTheme = true;
let mica = true;
// Controls page
let controlsPage = null;
const sections = []; // { group, height, column, items: [{ hwnd, x, y, w, h }] }: a group box and its controls
let scrollY = 0; // device pixels
let clientHeight = 0;
let contentHeight = 0;
let hwndTrack = null;
let hwndSpin = null;
let hwndSpinEdit = null;
let hwndProgressBar = null;
let hwndAnimate = null;
let hwndChart = null;
// Files page
let hwndTree = null;
let hwndList = null;
const nodes = new Map(); // tree item lParam → { path, loaded }
let rows = []; // list view rows: { name, path, isDir, size, type, modified, icon }
let currentFolder = null;
let revealing = false; // openFolder() is selecting a tree item
let sortColumn = 0;
let sortAscending = true;
let listView = LV_VIEW_DETAILS;
const COLUMNS = [
  { title: "Name", width: 260 },
  { title: "Size", width: 90, right: true },
  { title: "Type", width: 170 },
  { title: "Date modified", width: 150 },
];
// Date page
let hwndDate = null;
let hwndTime = null;
let hwndCalendar = null;
let hwndSummary = null;
const dateLabels = [];

const px = (dips) => Math.round((dips * dpi) / USER_DEFAULT_SCREEN_DPI);
const dips = (pixels) => (pixels * USER_DEFAULT_SCREEN_DPI) / dpi;
// x and w of an item: DIPs, or a function of the group box width.
const resolve = (v, width) => (typeof v === "function" ? v(width) : v);
// NMHDR.code is a UINT: the notification codes are negative ints.
const notifyCode = (hdr) => Number(hdr.code) | 0;

function clientRect(hwnd) {
  const rc = new RECT();
  user32.GetClientRect(hwnd, byref(rc));
  return { width: Number(rc.right) - Number(rc.left), height: Number(rc.bottom) - Number(rc.top) };
}

function windowHeight(hwnd) {
  const rc = new RECT();
  user32.GetWindowRect(hwnd, byref(rc));
  return Number(rc.bottom) - Number(rc.top);
}

function windowText(hwnd) {
  const buf = create_unicode_buffer(256);
  user32.GetWindowTextW(hwnd, buf, 256);
  return buf.value;
}

/** A child window using the message font. */
function createChild(exStyle, className, text, style, parent, id = null) {
  const hwnd = user32.CreateWindowExW(exStyle, className, text, WS_CHILD | WS_VISIBLE | style, 0, 0, 0, 0, parent, id, hInstance, null);
  if (!hwnd) throw WinError(get_last_error());
  fontTargets.push(hwnd);
  if (hFont) user32.SendMessageW(hwnd, WM_SETFONT, hFont, 1);
  return hwnd;
}

/** A window class with its procedure, as in a Python ctypes script. */
function registerClass(name, proc, background) {
  const windowClass = new WNDCLASSEX();
  windowClass.cbSize = sizeof(WNDCLASSEX);
  windowClass.hInstance = hInstance;
  windowClass.hCursor = user32.LoadCursorW(null, IDC_ARROW);
  windowClass.hbrBackground = background; // a system color as brush: (HBRUSH)(COLOR_* + 1)
  windowClass.lpszClassName = name;
  windowClass.hIcon = hIconBig;
  windowClass.hIconSm = hIconSmall;
  // Python idiom: WNDPROC(fn) wraps JS function as a stdcall callback
  const callback = WNDPROC(proc);
  callbacks.push(callback);
  windowClass.lpfnWndProc = callback;
  if (!user32.RegisterClassExW(byref(windowClass))) throw WinError(get_last_error());
}

/** The message font of the system (Segoe UI 9 pt) at the given DPI. */
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

function setStatus(part, text) {
  SendMessageStrW(hwndStatus, SB_SETTEXTW, part, text);
}

/** A stock shell icon: its index in the system image list, or an icon handle. */
function stockIcon(siid, flags) {
  const info = new SHSTOCKICONINFO();
  info.cbSize = sizeof(SHSTOCKICONINFO);
  if (shell32.SHGetStockIconInfo(siid, flags, byref(info)) < 0) return null;
  return flags & SHGSI_SYSICONINDEX ? info.iSysImageIndex : info.hIcon;
}

/** SHGetFileInfoW: icon index, display and type names; with `attributes` the path need not exist. */
function fileInfo(path, flags, attributes = 0) {
  const info = new SHFILEINFOW();
  const result = shell32.SHGetFileInfoW(path, attributes, byref(info), sizeof(SHFILEINFOW), flags | (attributes ? SHGFI_USEFILEATTRIBUTES : 0));
  return { result, icon: info.iIcon, name: info.szDisplayName, type: info.szTypeName };
}

// ============================================================================
// Controls page: group boxes in a responsive, scrollable layout.
// ============================================================================

/** Start a group box of the given height, in column 0 (left) or 1 (right); the next controls belong to it. */
function createSection(title, height, column) {
  const group = createChild(0, "BUTTON", title, BS_GROUPBOX, controlsPage.hwnd);
  sections.push({ group, height, column, items: [] });
}

/**
 * Create a control of the last group box, placed by layoutControls(): `place`
 * is { x, y, w, h } in DIPs from the group box's top-left corner; x and w may
 * be functions of the group box width.
 */
function createControl(exStyle, className, text, style, place, id) {
  const hwnd = createChild(exStyle, className, text, style, controlsPage.hwnd, id);
  sections.at(-1).items.push({ hwnd, ...place });
  return hwnd;
}

/** Place every control for the page size, the DPI and the scroll position. */
function layoutControls() {
  const { width: pageWidth, height } = clientRect(controlsPage.hwnd);
  clientHeight = height;
  const width = dips(pageWidth);
  const twoColumns = width >= TWO_COLUMNS_WIDTH;
  const columnWidth = Math.max(MIN_COLUMN, twoColumns ? (width - 3 * MARGIN) / 2 : width - 2 * MARGIN);

  // Rectangles in DIPs, column by column; then the scroll position is clamped
  // to the new content height and everything is moved at once.
  const rects = [];
  const bottoms = [MARGIN, MARGIN];
  for (const { group, height: groupHeight, column: preferred, items } of sections) {
    const column = twoColumns ? preferred : 0;
    const x = MARGIN + column * (columnWidth + MARGIN);
    const y = bottoms[column];
    rects.push([group, x, y, columnWidth, groupHeight]);
    for (const item of items) rects.push([item.hwnd, x + resolve(item.x, columnWidth), y + item.y, resolve(item.w, columnWidth), item.h]);
    bottoms[column] = y + groupHeight + GAP;
  }
  contentHeight = px(Math.max(...bottoms) - GAP + MARGIN);
  scrollY = Math.max(0, Math.min(scrollY, contentHeight - clientHeight));

  // DeferWindowPos: one repaint for all the moves.
  let hdwp = user32.BeginDeferWindowPos(rects.length);
  for (const [hwnd, x, y, w, h] of rects) {
    hdwp = user32.DeferWindowPos(hdwp, hwnd, null, px(x), px(y) - scrollY, px(w), px(h), SWP_NOZORDER | SWP_NOACTIVATE);
  }
  user32.EndDeferWindowPos(hdwp);
  // UDS_ALIGNRIGHT puts the up-down control inside the right edge of its buddy.
  user32.SendMessageW(hwndSpin, UDM_SETBUDDY, hwndSpinEdit, 0);
  scrollTo(scrollY);
  user32.RedrawWindow(controlsPage.hwnd, null, null, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
}

/** Scroll the Controls page to `y` (clamped), moving the child windows. */
function scrollTo(y) {
  const target = Math.max(0, Math.min(y, contentHeight - clientHeight));
  if (target !== scrollY) {
    user32.ScrollWindowEx(controlsPage.hwnd, 0, scrollY - target, null, null, null, null, SW_SCROLLCHILDREN | SW_INVALIDATE | SW_ERASE);
    scrollY = target;
  }
  // SIF_DISABLENOSCROLL: the scroll bar stays (disabled) when everything
  // fits, so the page width, and the layout, do not change with it.
  const si = new SCROLLINFO();
  si.cbSize = sizeof(SCROLLINFO);
  si.fMask = SIF_RANGE | SIF_PAGE | SIF_POS | SIF_DISABLENOSCROLL;
  si.nMin = 0;
  si.nMax = Math.max(0, contentHeight - 1);
  si.nPage = clientHeight;
  si.nPos = scrollY;
  user32.SetScrollInfo(controlsPage.hwnd, SB_VERT, byref(si), 1);
}

function onPageScroll(wParam) {
  const line = px(20);
  switch (LOWORD(wParam)) {
    case SB_LINEUP:
      return scrollTo(scrollY - line);
    case SB_LINEDOWN:
      return scrollTo(scrollY + line);
    case SB_PAGEUP:
      return scrollTo(scrollY - clientHeight);
    case SB_PAGEDOWN:
      return scrollTo(scrollY + clientHeight);
    case SB_TOP:
      return scrollTo(0);
    case SB_BOTTOM:
      return scrollTo(contentHeight);
    case SB_THUMBTRACK: {
      // The 32-bit position: HIWORD(wParam) is limited to 16 bits.
      const si = new SCROLLINFO();
      si.cbSize = sizeof(SCROLLINFO);
      si.fMask = SIF_TRACKPOS;
      user32.GetScrollInfo(controlsPage.hwnd, SB_VERT, byref(si));
      return scrollTo(si.nTrackPos);
    }
  }
}

/** The value shown by the trackbar, the spin control, the progress bar and the chart. */
function setValue(next, source) {
  if (syncing) return;
  next = Math.max(0, Math.min(100, Math.round(next)));
  syncing = true;
  try {
    value = next;
    if (source !== "trackbar") user32.SendMessageW(hwndTrack, TBM_SETPOS, 1, value);
    // While the user types, the edit keeps its text (and caret) unless the
    // number was clamped. The up-down control reads its position from the
    // text (UDS_SETBUDDYINT).
    if (source !== "edit") {
      user32.SendMessageW(hwndSpin, UDM_SETPOS32, 0, value);
      user32.SetWindowTextW(hwndSpinEdit, String(value));
    }
    user32.SendMessageW(hwndProgressBar, PBM_SETPOS, value, 0);
    setStatus(1, `Value: ${value}`);
  } finally {
    syncing = false;
  }
}

/** Start or stop the animation everywhere it is shown: checkbox, toolbar and menu. */
function setAnimate(on) {
  animating = on;
  if (on) {
    notifyAt100 = true;
    user32.SetTimer(hwndMain, ID_ANIMATE_TIMER, 50, null);
  } else {
    user32.KillTimer(hwndMain, ID_ANIMATE_TIMER);
  }
  user32.SendMessageW(hwndAnimate, BM_SETCHECK, on ? BST_CHECKED : BST_UNCHECKED, 0);
  user32.SendMessageW(hwndToolbar, TB_CHECKBUTTON, IDM_ANIMATE, on ? 1 : 0);
  user32.CheckMenuItem(hMenuBar, IDM_ANIMATE, MF_BYCOMMAND | (on ? MF_CHECKED : MF_UNCHECKED));
  console.log("Animation", on ? "started" : "stopped");
}

// ============================================================================
// Chart: a custom window class painted with GDI, double-buffered.
// ============================================================================

function ChartProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_ERASEBKGND:
      return 1; // WM_PAINT covers everything: no flicker
    case WM_PAINT:
      paintChart(hwnd);
      return 0;
  }
  return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
}

function paintChart(hwnd) {
  const ps = new PAINTSTRUCT();
  const hdc = user32.BeginPaint(hwnd, byref(ps));
  const { width, height } = clientRect(hwnd);
  // Draw on a memory bitmap, then copy it in one BitBlt.
  const mem = gdi32.CreateCompatibleDC(hdc);
  const bitmap = gdi32.CreateCompatibleBitmap(hdc, width, height);
  const oldBitmap = gdi32.SelectObject(mem, bitmap);
  const rc = new RECT();
  rc.right = width;
  rc.bottom = height;
  const background = gdi32.CreateSolidBrush(RGB(255, 255, 255));
  user32.FillRect(mem, byref(rc), background);

  const top = px(22);
  const bottom = height - px(6);
  const yOf = (v) => Math.round(bottom - (v / 100) * (bottom - top));
  // Grid at 0, 25, 50, 75 and 100.
  const gridPen = gdi32.CreatePen(PS_SOLID, 1, RGB(229, 229, 229));
  const oldPen = gdi32.SelectObject(mem, gridPen);
  for (const v of [0, 25, 50, 75, 100]) {
    gdi32.MoveToEx(mem, 0, yOf(v), null);
    gdi32.LineTo(mem, width, yOf(v));
  }

  // The area under the series (a polygon closed along the bottom), then the line.
  const step = width / (HISTORY - 1);
  const area = new (array(POINT, HISTORY + 2))();
  for (let i = 0; i < HISTORY; i++) {
    area[i].x = Math.round(i * step);
    area[i].y = yOf(history[i]);
  }
  area[HISTORY].x = width;
  area[HISTORY].y = bottom;
  area[HISTORY + 1].x = 0;
  area[HISTORY + 1].y = bottom;
  const fill = gdi32.CreateSolidBrush(RGB(204, 228, 247));
  const oldBrush = gdi32.SelectObject(mem, fill);
  gdi32.SelectObject(mem, gdi32.GetStockObject(NULL_PEN));
  gdi32.Polygon(mem, area, HISTORY + 2);
  const linePen = gdi32.CreatePen(PS_SOLID, Math.max(1, px(2)), RGB(0, 120, 212));
  gdi32.SelectObject(mem, linePen);
  gdi32.Polyline(mem, area, HISTORY);

  // Caption in the message font.
  const oldFont = gdi32.SelectObject(mem, hFont);
  gdi32.SetBkMode(mem, TRANSPARENT);
  gdi32.SetTextColor(mem, RGB(96, 96, 96));
  const text = new RECT();
  text.left = px(6);
  text.top = px(2);
  text.right = width - px(6);
  text.bottom = top;
  user32.DrawTextW(mem, `Last 10 seconds — now ${value}`, -1, byref(text), DT_SINGLELINE | DT_NOPREFIX);

  gdi32.BitBlt(hdc, 0, 0, width, height, mem, 0, 0, SRCCOPY);
  gdi32.SelectObject(mem, oldFont);
  gdi32.SelectObject(mem, oldBrush);
  gdi32.SelectObject(mem, oldPen);
  gdi32.SelectObject(mem, oldBitmap);
  for (const object of [background, gridPen, fill, linePen, bitmap]) gdi32.DeleteObject(object);
  gdi32.DeleteDC(mem);
  user32.EndPaint(hwnd, byref(ps));
}

// ============================================================================
// Files page: a TreeView of folders and a virtual ListView (LVS_OWNERDATA)
// whose cells are provided on demand through LVN_GETDISPINFOW.
// ============================================================================

const typeCache = new Map(); // extension → { type, icon }
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const EPOCH_DIFFERENCE_MS = 11644473600000n; // 1601-01-01 → 1970-01-01

/** One entry of FindFirstFileW / FindNextFileW as a list row. */
function rowOf(data, path, name = data.cFileName) {
  const attributes = Number(data.dwFileAttributes);
  const isDir = Boolean(attributes & FILE_ATTRIBUTE_DIRECTORY);
  const time = data.ftLastWriteTime;
  const ticks = (BigInt(Number(time.dwHighDateTime)) << 32n) | BigInt(Number(time.dwLowDateTime));
  const extension = isDir ? "\\" : (name.match(/\.[^.\\]*$/)?.[0] ?? "").toLowerCase();
  // Icon and type name by extension (SHGFI_USEFILEATTRIBUTES): no disk access per file.
  if (!typeCache.has(extension)) {
    const info = fileInfo(isDir ? "folder" : `file${extension}`, SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_TYPENAME, isDir ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL);
    typeCache.set(extension, { type: info.type, icon: info.icon });
  }
  const { type, icon } = typeCache.get(extension);
  return {
    name,
    path,
    isDir,
    size: Number(data.nFileSizeHigh) * 2 ** 32 + Number(data.nFileSizeLow),
    type,
    icon,
    modified: Number(ticks / 10000n - EPOCH_DIFFERENCE_MS),
  };
}

/** The visible entries of a folder (FindFirstFileW / FindNextFileW). */
function listDirectory(folder) {
  const data = new WIN32_FIND_DATAW();
  const handle = kernel32.FindFirstFileW(`${folder.replace(/\\$/, "")}\\*`, byref(data));
  if (handle === null || BigInt.asIntN(64, BigInt(handle)) === INVALID_HANDLE_VALUE) return [];
  const entries = [];
  try {
    do {
      const name = data.cFileName;
      if (name === "." || name === ".." || Number(data.dwFileAttributes) & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) continue;
      entries.push(rowOf(data, `${folder.replace(/\\$/, "")}\\${name}`));
    } while (kernel32.FindNextFileW(handle, byref(data)));
  } finally {
    kernel32.FindClose(handle);
  }
  return entries;
}

function insertTreeItem(parent, parentId, text, path, image, selectedImage) {
  const id = nodes.size + 1;
  const node = { path, parent: parentId, loaded: false, hItem: null };
  nodes.set(id, node);
  const tvis = new TVINSERTSTRUCTW();
  tvis.hParent = parent;
  tvis.hInsertAfter = TVI_LAST;
  tvis.item.mask = TVIF_TEXT | TVIF_IMAGE | TVIF_SELECTEDIMAGE | TVIF_PARAM | TVIF_CHILDREN;
  tvis.item.pszText = text;
  tvis.item.iImage = image;
  tvis.item.iSelectedImage = selectedImage;
  tvis.item.cChildren = 1; // a [+] until the folder is read (TVN_ITEMEXPANDINGW)
  tvis.item.lParam = id;
  node.hItem = SendMessagePtrW(hwndTree, TVM_INSERTITEMW, 0, byref(tvis));
  return node.hItem;
}

/** Lazy tree: read the subfolders the first time an item is expanded. */
function loadChildren(hItem, id) {
  const node = nodes.get(id);
  if (!node || node.loaded) return;
  node.loaded = true;
  const folders = listDirectory(node.path)
    .filter((entry) => entry.isDir)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const closed = fileInfo("folder", SHGFI_SYSICONINDEX | SHGFI_SMALLICON, FILE_ATTRIBUTE_DIRECTORY).icon;
  const open = fileInfo("folder", SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_OPENICON, FILE_ATTRIBUTE_DIRECTORY).icon;
  for (const folder of folders) insertTreeItem(hItem, id, folder.name, folder.path, closed, open);
  if (folders.length === 0) {
    const item = new TVITEMW();
    item.mask = TVIF_HANDLE | TVIF_CHILDREN;
    item.hItem = hItem;
    item.cChildren = 0;
    SendMessagePtrW(hwndTree, TVM_SETITEMW, 0, byref(item));
  }
}

// Paths compared case-insensitively, without a trailing backslash ("C:\" → "c:").
const pathKey = (path) => path.replace(/\\+$/, "").toLowerCase();
const isWithin = (folder, path) => path === folder || path.startsWith(`${folder}\\`);

/**
 * Open a folder and select it in the tree, as File Explorer does: from the
 * deepest tree item containing it, expand (reading the subfolders) down to it.
 * Folders the tree does not show (hidden, or outside its roots) are listed anyway.
 */
function openFolder(path) {
  const target = pathKey(path);
  let current = null;
  for (const [id, node] of nodes) {
    if (isWithin(pathKey(node.path), target) && (!current || node.path.length > nodes.get(current).path.length)) current = id;
  }
  while (current !== null && pathKey(nodes.get(current).path) !== target) {
    const { hItem } = nodes.get(current);
    loadChildren(hItem, current);
    user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_EXPAND, hItem);
    let next = null;
    for (const [id, node] of nodes) if (node.parent === current && isWithin(pathKey(node.path), target)) next = id;
    if (next === null) break;
    current = next;
  }
  if (current !== null) {
    // TVN_SELCHANGEDW does not list the folder meanwhile (it would list the
    // item's folder, and nothing when the item is already selected).
    revealing = true;
    try {
      user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_CARET, nodes.get(current).hItem);
      user32.SendMessageW(hwndTree, TVM_ENSUREVISIBLE, 0, nodes.get(current).hItem);
    } finally {
      revealing = false;
    }
  }
  showFolder(path);
}

function sortRows() {
  const direction = sortAscending ? 1 : -1;
  const keys = ["name", "size", "type", "modified"];
  rows.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // folders first, like Explorer
    const x = a[keys[sortColumn]];
    const y = b[keys[sortColumn]];
    const order = typeof x === "number" ? x - y : x.localeCompare(y, undefined, { numeric: true });
    return direction * (order || a.name.localeCompare(b.name));
  });
  // The sort arrow in the header.
  const header = user32.SendMessageW(hwndList, LVM_GETHEADER, 0, 0);
  for (let i = 0; i < COLUMNS.length; i++) {
    const item = new HDITEMW();
    item.mask = HDI_FORMAT;
    SendMessagePtrW(header, HDM_GETITEMW, i, byref(item));
    item.fmt = (item.fmt & ~(HDF_SORTUP | HDF_SORTDOWN)) | (i === sortColumn ? (sortAscending ? HDF_SORTUP : HDF_SORTDOWN) : 0);
    SendMessagePtrW(header, HDM_SETITEMW, i, byref(item));
  }
}

/** Show rows in the virtual list: only the count is sent, cells come from LVN_GETDISPINFOW. */
function showRows(newRows, title) {
  rows = newRows;
  sortRows();
  user32.SendMessageW(hwndList, LVM_SETITEMCOUNT, rows.length, 0);
  user32.InvalidateRect(hwndList, null, 0);
  updateFilesStatus(title);
}

function showFolder(folder) {
  currentFolder = folder;
  const started = performance.now();
  const entries = listDirectory(folder);
  showRows(entries, folder);
  console.log(`Listed ${entries.length} entries of ${folder} in ${Math.round(performance.now() - started)} ms`);
}

function updateFilesStatus(title = currentFolder ?? "Dropped files") {
  const selected = Number(user32.SendMessageW(hwndList, LVM_GETSELECTEDCOUNT, 0, 0));
  setStatus(0, `${title} — ${rows.length} item${rows.length === 1 ? "" : "s"}${selected ? `, ${selected} selected` : ""}`);
}

function formatSize(size) {
  return `${Math.ceil(size / 1024).toLocaleString()} KB`;
}

function cellText(row, column) {
  switch (column) {
    case 0:
      return row.name;
    case 1:
      return row.isDir ? "" : formatSize(row.size);
    case 2:
      return row.type;
    default:
      return dateFormat.format(row.modified);
  }
}

/** LVN_GETDISPINFOW: write the cell text into the list view's own buffer, and the icon. */
function onGetDispInfo(lParam) {
  const item = cast(lParam, POINTER(NMLVDISPINFOW)).contents.item;
  const row = rows[item.iItem];
  if (!row) return;
  if (item.mask & LVIF_TEXT && item.pszText && item.cchTextMax > 0) {
    const text = cellText(row, item.iSubItem).slice(0, item.cchTextMax - 1);
    const bytes = Buffer.from(`${text}\0`, "utf16le");
    memmove(item.pszText, bytes, bytes.length);
  }
  if (item.mask & LVIF_IMAGE) item.iImage = row.icon;
}

/** Files dropped from Explorer (WM_DROPFILES). */
function onDropFiles(hDrop) {
  const count = shell32.DragQueryFileW(hDrop, 0xffffffff, null, 0);
  const dropped = [];
  for (let i = 0; i < count; i++) {
    const path = create_unicode_buffer(32768);
    shell32.DragQueryFileW(hDrop, i, path, 32768);
    const data = new WIN32_FIND_DATAW();
    const handle = kernel32.FindFirstFileW(path.value, byref(data));
    if (handle === null || BigInt.asIntN(64, BigInt(handle)) === INVALID_HANDLE_VALUE) continue;
    kernel32.FindClose(handle);
    dropped.push(rowOf(data, path.value, path.value));
  }
  shell32.DragFinish(hDrop);
  console.log(`Dropped ${dropped.length} item(s)`);
  currentFolder = null;
  showPage(1);
  showRows(dropped, "Dropped files");
}

function setListView(view) {
  listView = view;
  user32.SendMessageW(hwndList, LVM_SETVIEW, view, 0);
  const command = { [LV_VIEW_DETAILS]: IDM_VIEW_DETAILS, [LV_VIEW_LIST]: IDM_VIEW_LIST, [LV_VIEW_SMALLICON]: IDM_VIEW_SMALL, [LV_VIEW_ICON]: IDM_VIEW_LARGE }[view];
  user32.CheckMenuRadioItem(hMenuBar, IDM_VIEW_DETAILS, IDM_VIEW_LARGE, command, MF_BYCOMMAND);
}

function layoutFiles() {
  const { width, height } = clientRect(pages[1].hwnd);
  const margin = px(8);
  const treeWidth = Math.round((width - 3 * margin) * 0.32);
  user32.MoveWindow(hwndTree, margin, margin, treeWidth, height - 2 * margin, 1);
  user32.MoveWindow(hwndList, 2 * margin + treeWidth, margin, width - 3 * margin - treeWidth, height - 2 * margin, 1);
}

// ============================================================================
// Date and time page: date picker, time picker and month calendar in sync.
// ============================================================================

function formatSystemTime(st) {
  const date = create_unicode_buffer(128);
  const time = create_unicode_buffer(64);
  kernel32.GetDateFormatEx(null, DATE_LONGDATE, byref(st), null, date, 128, null);
  kernel32.GetTimeFormatEx(null, 0, byref(st), null, time, 64);
  return [date.value, time.value];
}

function updateDateSummary() {
  const day = new SYSTEMTIME();
  const clock = new SYSTEMTIME();
  SendMessagePtrW(hwndDate, DTM_GETSYSTEMTIME, 0, byref(day));
  SendMessagePtrW(hwndTime, DTM_GETSYSTEMTIME, 0, byref(clock));
  day.wHour = clock.wHour;
  day.wMinute = clock.wMinute;
  day.wSecond = clock.wSecond;
  const [date, time] = formatSystemTime(day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(day.wYear, day.wMonth - 1, day.wDay) - today) / 86400000);
  const relative = days === 0 ? "today" : days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`;
  user32.SetWindowTextW(hwndSummary, `${date}, ${time}\n${relative[0].toUpperCase()}${relative.slice(1)}\n\nFormatted by GetDateFormatEx / GetTimeFormatEx with the user's locale.`);
}

function layoutDate() {
  const left = px(MARGIN);
  const labelWidth = px(70);
  const pickerX = left + labelWidth;
  user32.MoveWindow(dateLabels[0], left, px(MARGIN + 4), labelWidth, px(24), 1);
  user32.MoveWindow(hwndDate, pickerX, px(MARGIN), px(220), px(28), 1);
  user32.MoveWindow(dateLabels[1], left, px(MARGIN + 44), labelWidth, px(24), 1);
  user32.MoveWindow(hwndTime, pickerX, px(MARGIN + 40), px(220), px(28), 1);
  // The calendar's size depends on its font: ask for it.
  const rc = new RECT();
  SendMessagePtrW(hwndCalendar, MCM_GETMINREQRECT, 0, byref(rc));
  const calendarWidth = Number(rc.right) - Number(rc.left);
  const calendarHeight = Number(rc.bottom) - Number(rc.top);
  user32.MoveWindow(hwndCalendar, left, px(MARGIN + 88), calendarWidth, calendarHeight, 1);
  const summaryX = left + Math.max(calendarWidth, labelWidth + px(220)) + px(MARGIN);
  user32.MoveWindow(hwndSummary, summaryX, px(MARGIN), Math.max(px(200), clientRect(pages[2].hwnd).width - summaryX - left), px(160), 1);
}

// ============================================================================
// Task dialog: TaskDialogIndirect with a packed TASKDIALOGCONFIG and a
// JavaScript callback driving its progress bar.
// ============================================================================

/** Wide strings for LPVOID fields: the buffers stay referenced by the caller. */
function wideStrings(texts) {
  const buffers = texts.map((text) => create_unicode_buffer(text));
  return { buffers, addresses: buffers.map((buffer) => addressof(buffer)) };
}

function showTaskDialog() {
  if (!taskDialogs) return console.log("Task dialogs need Common Controls 6");
  // The button texts are wide-string buffers referenced by address: `commands`
  // and `radios` keep them alive until TaskDialogIndirect returns.
  const commands = wideStrings(["Restart the progress\nThe callback resets the bar: the dialog stays open", "Set the value to 75\nCloses the dialog and moves the trackbar"]);
  const radios = wideStrings(["Normal progress", "Paused", "Error state"]);
  const buttons = new (array(TASKDIALOG_BUTTON, 2))();
  buttons[0].nButtonID = ID_TD_RESTART;
  buttons[0].pszButtonText = commands.addresses[0];
  buttons[1].nButtonID = ID_TD_SET75;
  buttons[1].pszButtonText = commands.addresses[1];
  const radioButtons = new (array(TASKDIALOG_BUTTON, 3))();
  [ID_TD_NORMAL, ID_TD_PAUSED, ID_TD_ERROR].forEach((id, i) => {
    radioButtons[i].nButtonID = id;
    radioButtons[i].pszButtonText = radios.addresses[i];
  });

  let progress = 0;
  let paused = false;
  // HRESULT CALLBACK (HWND, UINT notification, WPARAM, LPARAM, LONG_PTR)
  const callback = PFTASKDIALOGCALLBACK((hwnd, notification, wParam, lParam) => {
    switch (notification) {
      case TDN_CREATED:
        user32.SendMessageW(hwnd, TDM_SET_PROGRESS_BAR_RANGE, 0, MAKELONG(0, 100));
        break;
      case TDN_TIMER: // about every 200 ms
        if (!paused && progress < 100) user32.SendMessageW(hwnd, TDM_SET_PROGRESS_BAR_POS, (progress = Math.min(100, progress + 2)), 0);
        break;
      case TDN_BUTTON_CLICKED:
        if (Number(wParam) === ID_TD_RESTART) {
          progress = 0;
          user32.SendMessageW(hwnd, TDM_SET_PROGRESS_BAR_POS, 0, 0);
          return S_FALSE; // keep the dialog open
        }
        break;
      case TDN_RADIO_BUTTON_CLICKED: {
        const state = { [ID_TD_NORMAL]: PBST_NORMAL, [ID_TD_PAUSED]: PBST_PAUSED, [ID_TD_ERROR]: PBST_ERROR }[Number(wParam)];
        paused = state !== PBST_NORMAL;
        user32.SendMessageW(hwnd, TDM_SET_PROGRESS_BAR_STATE, state, 0);
        break;
      }
      case TDN_HYPERLINK_CLICKED: // lParam: the href, a wide string
        shell32.ShellExecuteW(hwnd, "open", wstring_at(lParam), null, null, SW_SHOWNORMAL);
        break;
    }
    return S_OK;
  });

  const config = new TASKDIALOGCONFIG();
  config.cbSize = sizeof(TASKDIALOGCONFIG);
  config.hwndParent = hwndMain;
  config.hInstance = hInstance;
  config.dwFlags = TDF_ENABLE_HYPERLINKS | TDF_ALLOW_DIALOG_CANCELLATION | TDF_USE_COMMAND_LINKS | TDF_SHOW_PROGRESS_BAR | TDF_CALLBACK_TIMER | TDF_EXPAND_FOOTER_AREA | TDF_POSITION_RELATIVE_TO_WINDOW;
  config.dwCommonButtons = TDCBF_CLOSE_BUTTON;
  config.pszWindowTitle = "node-ctypes";
  config.mainIcon.hIcon = TD_INFORMATION_ICON; // a union: the icon as a resource ID
  config.pszMainInstruction = "A native Windows task dialog, from JavaScript";
  config.pszContent = "TaskDialogIndirect is called through node-ctypes. The progress bar is driven by a JavaScript callback (TDN_TIMER); the command links and radio buttons talk to the same callback.";
  config.cButtons = 2;
  config.pButtons = addressof(buttons);
  config.cRadioButtons = 3;
  config.pRadioButtons = addressof(radioButtons);
  config.nDefaultRadioButton = ID_TD_NORMAL;
  config.pszVerificationText = "Show a notification when the dialog closes";
  config.pszExpandedInformation = "TASKDIALOGCONFIG is declared with one-byte packing (_pack_ = 1) and contains two unions for the icons; the callback is a PFTASKDIALOGCALLBACK made with WINFUNCTYPE.";
  config.pszExpandedControlText = "Hide the details";
  config.pszCollapsedControlText = "How does it work?";
  config.footerIcon.hIcon = TD_SHIELD_ICON;
  config.pszFooter = 'Powered by <a href="https://github.com/dmazzella/node-ctypes">node-ctypes</a>';
  config.pfCallback = callback;

  const button = new c_int(0);
  const radio = new c_int(0);
  const verified = new BOOL(0);
  try {
    const hr = comctl32.TaskDialogIndirect(byref(config), byref(button), byref(radio), byref(verified));
    if (hr < 0) throw new Error(`TaskDialogIndirect failed: 0x${(Number(hr) >>> 0).toString(16)}`);
  } finally {
    callback.release();
  }
  console.log(`Task dialog closed: button ${button.value}, radio ${radio.value}, checkbox ${Boolean(verified.value)}`);
  if (button.value === ID_TD_SET75) setValue(75, "dialog");
  if (verified.value) showNotification("Task dialog", "The task dialog was closed with the checkbox selected.");
}

function showAbout() {
  const version = new OSVERSIONINFOW();
  version.dwOSVersionInfoSize = sizeof(OSVERSIONINFOW);
  ntdll.RtlGetVersion(byref(version));
  const windows = `Windows ${version.dwMajorVersion}.${version.dwMinorVersion} build ${version.dwBuildNumber}`;
  const content = `${windows} (RtlGetVersion)\nNode.js ${process.version} ${process.arch}\n${dpi} DPI, visual styles ${visualStyles ? "on" : "off"}`;
  if (!taskDialogs) return console.log(content);
  const button = new c_int(0);
  comctl32.TaskDialog(hwndMain, hInstance, "About", "Windows Controls Showcase", content, TDCBF_OK_BUTTON, TD_INFORMATION_ICON, byref(button));
}

// ============================================================================
// Notification area icon (Shell_NotifyIconW), with balloon notifications.
// ============================================================================

function notifyIconData(flags) {
  const data = new NOTIFYICONDATAW();
  data.cbSize = sizeof(NOTIFYICONDATAW);
  data.hWnd = hwndMain;
  data.uID = 1;
  data.uFlags = flags;
  return data;
}

function addTrayIcon() {
  const data = notifyIconData(NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP);
  data.uCallbackMessage = WM_TRAYICON;
  data.hIcon = hIconSmall;
  data.szTip = "node-ctypes controls demo";
  shell32.Shell_NotifyIconW(NIM_ADD, byref(data));
  data.uVersion = NOTIFYICON_VERSION_4;
  shell32.Shell_NotifyIconW(NIM_SETVERSION, byref(data));
}

function removeTrayIcon() {
  shell32.Shell_NotifyIconW(NIM_DELETE, byref(notifyIconData(0)));
}

function showNotification(title, text) {
  const data = notifyIconData(NIF_INFO);
  data.szInfoTitle = title;
  data.szInfo = text;
  data.dwInfoFlags = NIIF_INFO;
  shell32.Shell_NotifyIconW(NIM_MODIFY, byref(data));
}

function restoreWindow() {
  user32.ShowWindow(hwndMain, SW_RESTORE);
  user32.SetForegroundWindow(hwndMain);
}

// ============================================================================
// Windows 11 title bar: dark mode following the system theme, Mica backdrop.
// ============================================================================

function systemUsesDarkTheme() {
  const light = new DWORD(1);
  const size = new DWORD(sizeof(DWORD));
  const status = advapi32.RegGetValueW(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme", RRF_RT_REG_DWORD, null, byref(light), byref(size));
  return Number(status) === 0 && Number(light.value) === 0;
}

function applyTitleBar() {
  const dark = new c_int(darkTitle ? 1 : 0);
  dwmapi.DwmSetWindowAttribute(hwndMain, DWMWA_USE_IMMERSIVE_DARK_MODE, byref(dark), sizeof(c_int));
  const backdrop = new c_int(mica ? DWMSBT_MAINWINDOW : DWMSBT_NONE);
  const supported = dwmapi.DwmSetWindowAttribute(hwndMain, DWMWA_SYSTEMBACKDROP_TYPE, byref(backdrop), sizeof(c_int)) >= 0;
  user32.CheckMenuItem(hMenuBar, IDM_DARK, MF_BYCOMMAND | (darkTitle ? MF_CHECKED : MF_UNCHECKED));
  user32.CheckMenuItem(hMenuBar, IDM_MICA, MF_BYCOMMAND | (mica && supported ? MF_CHECKED : MF_UNCHECKED));
  if (!supported) user32.EnableMenuItem(hMenuBar, IDM_MICA, MF_BYCOMMAND | MF_GRAYED); // before Windows 11 22H2
}

// ============================================================================
// Menus, accelerators and toolbar: they all send WM_COMMAND with the IDM_* IDs.
// ============================================================================

function createMenus() {
  const menu = (items) => {
    const popup = user32.CreatePopupMenu();
    for (const item of items) {
      if (item === null) user32.AppendMenuW(popup, MF_SEPARATOR, 0, null);
      else user32.AppendMenuW(popup, MF_STRING, item[0], item[1]);
    }
    return popup;
  };
  hMenuBar = user32.CreateMenu();
  const bar = [
    ["&File", [[IDM_BROWSE, "&Browse for a folder...\tCtrl+O"], [IDM_REFRESH, "&Refresh\tF5"], null, [IDM_EXIT, "E&xit"]]],
    ["&View", [[IDM_VIEW_DETAILS, "&Details"], [IDM_VIEW_LIST, "&List"], [IDM_VIEW_SMALL, "&Small icons"], [IDM_VIEW_LARGE, "Lar&ge icons"], null, [IDM_DARK, "Dar&k title bar"], [IDM_MICA, "&Mica backdrop"]]],
    [
      "&Tools",
      [
        [IDM_ANIMATE, "&Animate the value\tCtrl+M"],
        [IDM_TASKDIALOG, "&Task dialog...\tCtrl+T"],
        [IDM_NOTIFY, "Show a &notification\tCtrl+N"],
      ],
    ],
    ["&Help", [[IDM_ABOUT, "&About...\tF1"]]],
  ];
  for (const [title, items] of bar) user32.AppendMenuW(hMenuBar, MF_POPUP, menu(items), title);
  user32.SetMenu(hwndMain, hMenuBar);

  const keys = [
    [FVIRTKEY | FCONTROL, "O".charCodeAt(0), IDM_BROWSE],
    [FVIRTKEY, VK_F5, IDM_REFRESH],
    [FVIRTKEY | FCONTROL, "M".charCodeAt(0), IDM_ANIMATE],
    [FVIRTKEY | FCONTROL, "T".charCodeAt(0), IDM_TASKDIALOG],
    [FVIRTKEY | FCONTROL, "N".charCodeAt(0), IDM_NOTIFY],
    [FVIRTKEY, VK_F1, IDM_ABOUT],
  ];
  const table = new (array(ACCEL, keys.length))();
  keys.forEach(([fVirt, key, cmd], i) => {
    table[i].fVirt = fVirt;
    table[i].key = key;
    table[i].cmd = cmd;
  });
  hAccel = user32.CreateAcceleratorTableW(table, keys.length);
}

/** A popup menu at the cursor; the chosen command arrives as WM_COMMAND. */
function popupMenu(items, x, y) {
  const popup = user32.CreatePopupMenu();
  for (const item of items) {
    if (item === null) user32.AppendMenuW(popup, MF_SEPARATOR, 0, null);
    else user32.AppendMenuW(popup, MF_STRING | (item[2] ? MF_CHECKED : 0), item[0], item[1]);
  }
  if (x === -1 && y === -1) {
    // From the keyboard (Shift+F10): at the cursor.
    const pt = new POINT();
    user32.GetCursorPos(byref(pt));
    [x, y] = [Number(pt.x), Number(pt.y)];
  }
  user32.TrackPopupMenuEx(popup, TPM_RIGHTBUTTON, x, y, hwndMain, null);
  user32.DestroyMenu(popup);
}

function createToolbar() {
  hwndToolbar = createChild(0, "ToolbarWindow32", null, TBSTYLE_FLAT | TBSTYLE_LIST | TBSTYLE_TOOLTIPS, hwndMain);
  user32.SendMessageW(hwndToolbar, TB_BUTTONSTRUCTSIZE, sizeof(TBBUTTON), 0);
  user32.SendMessageW(hwndToolbar, TB_SETEXTENDEDSTYLE, 0, TBSTYLE_EX_DOUBLEBUFFER);
  // Icons: the system image list, with modern stock icons (SHGetStockIconInfo).
  user32.SendMessageW(hwndToolbar, TB_SETIMAGELIST, 0, smallImages);
  const items = [
    [SIID_FOLDEROPEN, IDM_BROWSE, "Browse", BTNS_BUTTON],
    [SIID_FIND, IDM_REFRESH, "Refresh", BTNS_BUTTON],
    null,
    [SIID_VIDEOFILES, IDM_ANIMATE, "Animate", BTNS_CHECK],
    [SIID_INFO, IDM_TASKDIALOG, "Task dialog", BTNS_BUTTON],
    [SIID_WORLD, IDM_NOTIFY, "Notify", BTNS_BUTTON],
    null,
    [SIID_HELP, IDM_ABOUT, "About", BTNS_BUTTON],
  ];
  const buttons = new (array(TBBUTTON, items.length))();
  items.forEach((item, i) => {
    if (item === null) {
      buttons[i].fsStyle = BTNS_SEP;
      return;
    }
    const [siid, command, text, style] = item;
    const label = create_unicode_buffer(text);
    toolbarTexts.push(label);
    buttons[i].iBitmap = stockIcon(siid, SHGSI_SYSICONINDEX | SHGSI_SMALLICON) ?? 0;
    buttons[i].idCommand = command;
    buttons[i].fsState = TBSTATE_ENABLED;
    buttons[i].fsStyle = style | BTNS_AUTOSIZE;
    buttons[i].iString = addressof(label);
  });
  SendMessagePtrW(hwndToolbar, TB_ADDBUTTONSW, items.length, buttons);
  user32.SendMessageW(hwndToolbar, TB_AUTOSIZE, 0, 0);
}

// ============================================================================
// Main window layout: toolbar, tab control with its pages, status bar.
// ============================================================================

function showPage(index) {
  pages.forEach((page, i) => user32.ShowWindow(page.hwnd, i === index ? SW_SHOW : SW_HIDE));
  if (index !== Number(user32.SendMessageW(hwndTab, TCM_GETCURSEL, 0, 0))) user32.SendMessageW(hwndTab, TCM_SETCURSEL, index, 0);
}

function layoutMain() {
  const { width, height } = clientRect(hwndMain);
  user32.SendMessageW(hwndToolbar, TB_AUTOSIZE, 0, 0);
  user32.SendMessageW(hwndStatus, WM_SIZE, 0, 0);
  const toolbarHeight = windowHeight(hwndToolbar);
  const statusHeight = windowHeight(hwndStatus);
  const parts = new (array(c_int, 3))();
  parts[0] = Math.max(px(100), width - px(320));
  parts[1] = Math.max(px(200), width - px(150));
  parts[2] = -1;
  SendMessagePtrW(hwndStatus, SB_SETPARTS, 3, parts);

  const margin = px(6);
  const tab = { left: margin, top: toolbarHeight + margin, right: width - margin, bottom: height - statusHeight - margin };
  user32.MoveWindow(hwndTab, tab.left, tab.top, tab.right - tab.left, tab.bottom - tab.top, 1);
  // TCM_ADJUSTRECT: from the tab control's rectangle to its display area.
  const area = new RECT();
  Object.assign(area, tab);
  SendMessagePtrW(hwndTab, TCM_ADJUSTRECT, 0, byref(area));
  for (const page of pages) user32.MoveWindow(page.hwnd, Number(area.left), Number(area.top), Number(area.right) - Number(area.left), Number(area.bottom) - Number(area.top), 1);
}

function applyDpi() {
  applyFont();
  COLUMNS.forEach((column, i) => user32.SendMessageW(hwndList, LVM_SETCOLUMNWIDTH, i, px(column.width)));
  layoutMain();
}

// ============================================================================
// Window procedures
// ============================================================================

/** Pages forward the notifications of their controls to the main window. */
function PageProc(hwnd, msg, wParam, lParam) {
  const page = pages.find((p) => sameHandle(p.hwnd, hwnd));
  switch (msg) {
    case WM_SIZE:
      page?.layout();
      return 0;
    case WM_VSCROLL:
      // The up-down control sends WM_VSCROLL too: its buddy's EN_CHANGE
      // updates the value. Only the page's own scroll bar (lParam NULL) scrolls.
      if (page === controlsPage && !lParam) onPageScroll(wParam);
      return 0;
    case WM_MOUSEWHEEL:
      // Three lines of 20 DIPs per wheel notch (signed HIWORD of wParam).
      if (page === controlsPage) scrollTo(scrollY - Math.round((SIGNED_HIWORD(wParam) / WHEEL_DELTA) * px(60)));
      return 0;
    case WM_COMMAND:
    case WM_NOTIFY:
    case WM_HSCROLL:
      return user32.SendMessageW(hwndMain, msg, wParam, lParam);
  }
  return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
}

function onNotify(lParam) {
  const hdr = cast(lParam, POINTER(NMHDR)).contents;
  const code = notifyCode(hdr);
  const from = hdr.hwndFrom;
  if (sameHandle(from, hwndTab)) {
    if (code === TCN_SELCHANGE) showPage(Number(user32.SendMessageW(hwndTab, TCM_GETCURSEL, 0, 0)));
  } else if (sameHandle(from, hwndTree)) {
    const tv = cast(lParam, POINTER(NMTREEVIEWW)).contents;
    if (code === TVN_ITEMEXPANDINGW && tv.action & TVE_EXPAND) loadChildren(tv.itemNew.hItem, Number(tv.itemNew.lParam));
    else if (code === TVN_SELCHANGEDW && !revealing) showFolder(nodes.get(Number(tv.itemNew.lParam)).path);
  } else if (sameHandle(from, hwndList)) {
    switch (code) {
      case LVN_GETDISPINFOW:
        onGetDispInfo(lParam);
        break;
      case LVN_COLUMNCLICK: {
        const column = cast(lParam, POINTER(NMLISTVIEW)).contents.iSubItem;
        sortAscending = column === sortColumn ? !sortAscending : true;
        sortColumn = column;
        sortRows();
        user32.InvalidateRect(hwndList, null, 0);
        break;
      }
      case LVN_ITEMACTIVATE: {
        const row = rows[cast(lParam, POINTER(NMLISTVIEW)).contents.iItem];
        if (row?.isDir) openFolder(row.path);
        else if (row) shell32.ShellExecuteW(hwndMain, "open", row.path, null, null, SW_SHOWNORMAL); // its default application
        break;
      }
      case LVN_ITEMCHANGED:
        updateFilesStatus();
        break;
    }
  } else if (code === DTN_DATETIMECHANGE && sameHandle(from, hwndDate)) {
    const change = cast(lParam, POINTER(NMDATETIMECHANGE)).contents;
    if (Number(change.dwFlags) === GDT_VALID) SendMessagePtrW(hwndCalendar, MCM_SETCURSEL, 0, byref(change.st));
    updateDateSummary();
  } else if (code === DTN_DATETIMECHANGE && sameHandle(from, hwndTime)) {
    updateDateSummary();
  } else if (code === MCN_SELCHANGE && sameHandle(from, hwndCalendar)) {
    const selection = cast(lParam, POINTER(NMSELCHANGE)).contents;
    SendMessagePtrW(hwndDate, DTM_SETSYSTEMTIME, GDT_VALID, byref(selection.stSelStart));
    updateDateSummary();
  }
  return 0;
}

function onCommand(controlId, notification, control) {
  switch (controlId) {
    // Controls page
    case ID_BUTTON:
      return console.log("Push button clicked");
    case ID_DEFAULT:
      // Also pressed by Enter: IsDialogMessageW sends it for the default button.
      return console.log("Default button clicked");
    case ID_MINIMIZE:
      console.log("Window minimized: restored in 2 s");
      user32.ShowWindow(hwndMain, SW_MINIMIZE);
      user32.SetTimer(hwndMain, ID_RESTORE_TIMER, 2000, null);
      return;
    case ID_COUNTER:
      counter += 1;
      console.log("Counter incremented to:", counter);
      user32.SetWindowTextW(control, `Count: ${counter}`);
      return;
    case ID_ANIMATE:
      if (notification === BN_CLICKED) setAnimate(Number(user32.SendMessageW(control, BM_GETCHECK, 0, 0)) === BST_CHECKED);
      return;
    case ID_RADIO1:
    case ID_RADIO2:
      if (notification === BN_CLICKED) console.log(`Choice ${controlId === ID_RADIO1 ? "A" : "B"} selected`);
      return;
    case ID_COMBOBOX:
      if (notification === CBN_SELCHANGE) {
        const index = Number(user32.SendMessageW(control, CB_GETCURSEL, 0, 0));
        const text = create_unicode_buffer(256);
        SendMessageBufW(control, CB_GETLBTEXT, index, text);
        console.log(`Combo box selection: ${index} (${text.value})`);
      }
      return;
    case ID_LISTBOX:
      if (notification === LBN_SELCHANGE) {
        const index = Number(user32.SendMessageW(control, LB_GETCURSEL, 0, 0));
        const text = create_unicode_buffer(256);
        SendMessageBufW(control, LB_GETTEXT, index, text);
        console.log(`List box selection: ${index} (${text.value})`);
      }
      return;
    case ID_TEXT_INPUT:
      if (notification === EN_CHANGE) {
        const text = windowText(control);
        console.log(text ? `Text input changed: ${text}` : "Text input cleared");
      }
      return;
    case ID_SPIN_EDIT:
      // Typed digits, or the up-down control writing its position (UDS_SETBUDDYINT).
      if (notification === EN_CHANGE && !syncing) {
        const typed = parseInt(windowText(control), 10) || 0;
        setValue(typed, typed >= 0 && typed <= 100 ? "edit" : "clamped");
      }
      return;
    // Menus, accelerators, toolbar and context menus
    case IDM_BROWSE: {
      const name = create_unicode_buffer(260);
      const info = new BROWSEINFOW();
      info.hwndOwner = hwndMain;
      info.pszDisplayName = name;
      info.lpszTitle = "Choose a folder to show in the Files page";
      info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
      const pidl = shell32.SHBrowseForFolderW(byref(info));
      if (!pidl) return;
      const path = create_unicode_buffer(260);
      const ok = shell32.SHGetPathFromIDListW(pidl, path);
      ole32.CoTaskMemFree(pidl);
      if (ok) {
        showPage(1);
        openFolder(path.value);
      }
      return;
    }
    case IDM_REFRESH:
      if (currentFolder) showFolder(currentFolder);
      return;
    case IDM_EXIT:
      return user32.DestroyWindow(hwndMain);
    case IDM_VIEW_DETAILS:
      return setListView(LV_VIEW_DETAILS);
    case IDM_VIEW_LIST:
      return setListView(LV_VIEW_LIST);
    case IDM_VIEW_SMALL:
      return setListView(LV_VIEW_SMALLICON);
    case IDM_VIEW_LARGE:
      return setListView(LV_VIEW_ICON);
    case IDM_DARK:
      followSystemTheme = false;
      darkTitle = !darkTitle;
      return applyTitleBar();
    case IDM_MICA:
      mica = !mica;
      return applyTitleBar();
    case IDM_ANIMATE:
      return setAnimate(!animating);
    case IDM_TASKDIALOG:
      return showTaskDialog();
    case IDM_NOTIFY:
      return showNotification("node-ctypes", `The value is ${value}. Notifications come from Shell_NotifyIconW.`);
    case IDM_ABOUT:
      return showAbout();
    case IDM_SHOW:
      return restoreWindow();
    case IDM_VALUE_0:
      return setValue(0, "menu");
    case IDM_VALUE_50:
      return setValue(50, "menu");
    case IDM_VALUE_100:
      return setValue(100, "menu");
  }
}

function WindowProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_SIZE:
      if (ready) layoutMain(); // also sent while the window and its children are created
      break;
    case WM_GETMINMAXINFO: {
      // Minimum size: one column on the Controls page, with its scroll bar and the frames.
      const frame = new RECT();
      frame.right = px(MIN_COLUMN + 2 * MARGIN + 20) + user32.GetSystemMetricsForDpi(SM_CXVSCROLL, dpi);
      frame.bottom = px(MIN_WINDOW_H);
      user32.AdjustWindowRectExForDpi(byref(frame), WS_OVERLAPPEDWINDOW, 1, WS_EX_CONTROLPARENT, dpi);
      const info = cast(lParam, POINTER(MINMAXINFO)).contents;
      info.ptMinTrackSize.x = Number(frame.right) - Number(frame.left);
      info.ptMinTrackSize.y = Number(frame.bottom) - Number(frame.top);
      return 0;
    }
    case WM_DPICHANGED: {
      // The window moved to a monitor with another scale: new font, the size
      // Windows suggests (lParam: RECT*), then the layout for both.
      const next = HIWORD(wParam);
      scrollY = Math.round((scrollY * next) / dpi);
      dpi = next;
      const suggested = cast(lParam, POINTER(RECT)).contents;
      const left = Number(suggested.left);
      const top = Number(suggested.top);
      user32.SetWindowPos(hwnd, null, left, top, Number(suggested.right) - left, Number(suggested.bottom) - top, SWP_NOZORDER | SWP_NOACTIVATE);
      applyDpi();
      return 0;
    }
    case WM_SETTINGCHANGE:
      // lParam "ImmersiveColorSet": the user switched between light and dark.
      if (followSystemTheme && lParam && wstring_at(lParam) === "ImmersiveColorSet") {
        darkTitle = systemUsesDarkTheme();
        applyTitleBar();
      }
      break;
    case WM_HSCROLL:
      // The trackbar notifies its moves through WM_HSCROLL (lParam: its handle).
      if (sameHandle(lParam, hwndTrack)) setValue(Number(user32.SendMessageW(hwndTrack, TBM_GETPOS, 0, 0)), "trackbar");
      return 0;
    case WM_COMMAND:
      onCommand(LOWORD(wParam), HIWORD(wParam), lParam);
      return 0;
    case WM_NOTIFY:
      return onNotify(lParam);
    case WM_CONTEXTMENU: {
      // wParam: the window clicked; lParam: screen coordinates (-1, -1 from the keyboard).
      const x = SIGNED(LOWORD(lParam));
      const y = SIGNED_HIWORD(lParam);
      if (sameHandle(wParam, hwndList)) {
        popupMenu(
          [
            [IDM_VIEW_DETAILS, "Details", listView === LV_VIEW_DETAILS],
            [IDM_VIEW_LIST, "List", listView === LV_VIEW_LIST],
            [IDM_VIEW_SMALL, "Small icons", listView === LV_VIEW_SMALLICON],
            [IDM_VIEW_LARGE, "Large icons", listView === LV_VIEW_ICON],
            null,
            [IDM_REFRESH, "Refresh"],
          ],
          x,
          y,
        );
      } else if (user32.IsWindowVisible(controlsPage.hwnd) && !sameHandle(wParam, hwndTab) && !sameHandle(wParam, hwndToolbar)) {
        popupMenu([[IDM_VALUE_0, "Value 0"], [IDM_VALUE_50, "Value 50"], [IDM_VALUE_100, "Value 100"], null, [IDM_ANIMATE, "Animate", animating]], x, y);
      }
      return 0;
    }
    case WM_DROPFILES:
      onDropFiles(wParam);
      return 0;
    case WM_TRAYICON:
      // NOTIFYICON_VERSION_4: LOWORD(lParam) is the event, wParam the anchor point.
      switch (LOWORD(lParam)) {
        case NIN_SELECT:
        case NIN_KEYSELECT:
          restoreWindow();
          break;
        case WM_CONTEXTMENU:
          user32.SetForegroundWindow(hwnd); // otherwise the menu does not close when clicking elsewhere
          popupMenu([[IDM_SHOW, "Show the window"], [IDM_NOTIFY, "Show a notification"], null, [IDM_EXIT, "Exit"]], SIGNED(LOWORD(wParam)), SIGNED_HIWORD(wParam));
          break;
      }
      return 0;
    case WM_TIMER:
      switch (Number(wParam)) {
        case ID_ANIMATE_TIMER:
          setValue(value === 100 ? 0 : value + 1, "timer");
          if (value === 100 && notifyAt100) {
            notifyAt100 = false;
            showNotification("Animation", "The value reached 100.");
          }
          break;
        case ID_RESTORE_TIMER:
          user32.KillTimer(hwnd, ID_RESTORE_TIMER);
          restoreWindow();
          console.log("Window restored");
          break;
        case ID_CLOCK_TIMER:
          setStatus(2, new Date().toLocaleTimeString());
          break;
        case ID_SAMPLE_TIMER:
          history.shift();
          history.push(value);
          if (user32.IsWindowVisible(controlsPage.hwnd)) user32.InvalidateRect(hwndChart, null, 0);
          break;
      }
      return 0;
    case WM_DESTROY:
      // Kill the timers, remove the tray icon and delete the font here (owned
      // by this window). The callbacks and DLLs MUST stay alive: the message
      // loop is still dispatching, and we're executing inside a WNDPROC.
      for (const timer of [ID_ANIMATE_TIMER, ID_RESTORE_TIMER, ID_CLOCK_TIMER, ID_SAMPLE_TIMER]) user32.KillTimer(hwnd, timer);
      removeTrayIcon();
      if (hFont) {
        gdi32.DeleteObject(hFont);
        hFont = null;
      }
      user32.PostQuitMessage(0);
      return 0;
  }
  // Messages that `break` still need default processing (e.g. WM_SIZE).
  // Without this, title-bar / system commands stop working.
  return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
}

// ============================================================================
// Creation
// ============================================================================

function createControlsPage(hwndPage) {
  controlsPage = { hwnd: hwndPage, title: "Controls", layout: () => layoutControls() };
  pages.push(controlsPage);

  // Controls are created in tab order: left column, then right column.
  // Buttons
  createSection("Buttons", 70, 0);
  const hwndButton = createControl(0, "BUTTON", "Push", BS_PUSHBUTTON | WS_TABSTOP | WS_GROUP, { ...cell(0, 4), y: 26, h: 28 }, ID_BUTTON);
  createControl(0, "BUTTON", "Default", BS_DEFPUSHBUTTON | WS_TABSTOP, { ...cell(1, 4), y: 26, h: 28 }, ID_DEFAULT);
  const hwndMinimize = createControl(0, "BUTTON", "Minimize", BS_PUSHBUTTON | WS_TABSTOP, { ...cell(2, 4), y: 26, h: 28 }, ID_MINIMIZE);
  createControl(0, "BUTTON", "Count: 0", BS_PUSHBUTTON | WS_TABSTOP, { ...cell(3, 4), y: 26, h: 28 }, ID_COUNTER);

  // Text input
  createSection("Text Input", 70, 0);
  const hwndTextInput = createControl(WS_EX_CLIENTEDGE, "EDIT", "", ES_AUTOHSCROLL | WS_TABSTOP | WS_GROUP, { x: INSET, y: 26, w: FILL, h: 26 }, ID_TEXT_INPUT);

  // Options: the checkbox animates the value; the radio buttons are one group
  // (WS_GROUP on the first, and on the next control after the last).
  createSection("Options", 90, 0);
  hwndAnimate = createControl(0, "BUTTON", "Animate the value", BS_AUTOCHECKBOX | WS_TABSTOP | WS_GROUP, { x: INSET, y: 24, w: 200, h: 24 }, ID_ANIMATE);
  const hwndRadio1 = createControl(0, "BUTTON", "Choice A", BS_AUTORADIOBUTTON | WS_TABSTOP | WS_GROUP, { x: INSET, y: 54, w: 120, h: 24 }, ID_RADIO1);
  createControl(0, "BUTTON", "Choice B", BS_AUTORADIOBUTTON, { x: INSET + 130, y: 54, w: 120, h: 24 }, ID_RADIO2);
  user32.SendMessageW(hwndRadio1, BM_SETCHECK, BST_CHECKED, 0);

  // Value: trackbar, and a numeric edit with an up-down control.
  createSection("Value", 106, 0);
  hwndTrack = createControl(0, "msctls_trackbar32", null, TBS_AUTOTICKS | WS_TABSTOP | WS_GROUP, { x: INSET - 4, y: 22, w: (w) => FILL(w) + 8, h: 32 }, ID_TRACKBAR);
  user32.SendMessageW(hwndTrack, TBM_SETRANGE, 1, MAKELONG(0, 100));
  user32.SendMessageW(hwndTrack, TBM_SETTICFREQ, 10, 0);
  hwndSpinEdit = createControl(WS_EX_CLIENTEDGE, "EDIT", "0", ES_NUMBER | WS_TABSTOP | WS_GROUP, { x: INSET, y: 64, w: 90, h: 26 }, ID_SPIN_EDIT);
  // Placed by UDM_SETBUDDY (UDS_ALIGNRIGHT), not by layoutControls().
  hwndSpin = user32.CreateWindowExW(0, "msctls_updown32", null, WS_CHILD | WS_VISIBLE | UDS_SETBUDDYINT | UDS_ALIGNRIGHT | UDS_ARROWKEYS | UDS_NOTHOUSANDS, 0, 0, 0, 0, hwndPage, ID_SPIN, hInstance, null);
  user32.SendMessageW(hwndSpin, UDM_SETRANGE32, 0, 100);

  // Combo box
  createSection("Combo Box", 70, 1);
  // A combo box's height includes its drop-down list.
  const hwndCombobox = createControl(0, "COMBOBOX", null, CBS_DROPDOWNLIST | CBS_HASSTRINGS | WS_VSCROLL | WS_TABSTOP | WS_GROUP, { x: INSET, y: 26, w: FILL, h: 200 }, ID_COMBOBOX);
  for (const text of ["First option", "Second option", "Third option"]) SendMessageStrW(hwndCombobox, CB_ADDSTRING, 0, text);
  user32.SendMessageW(hwndCombobox, CB_SETCURSEL, 0, 0);

  // List box
  createSection("List Box", 150, 1);
  const hwndListBox = createControl(WS_EX_CLIENTEDGE, "LISTBOX", null, LBS_NOTIFY | LBS_SORT | LBS_HASSTRINGS | WS_VSCROLL | WS_TABSTOP | WS_GROUP, { x: INSET, y: 24, w: FILL, h: 112 }, ID_LISTBOX);
  for (const text of ["Item C", "Item A", "Item B", "Item E", "Item D"]) SendMessageStrW(hwndListBox, LB_ADDSTRING, 0, text);

  // Progress bar and chart: they follow the value
  createSection("Progress (follows the value)", 70, 1);
  hwndProgressBar = createControl(0, "msctls_progress32", null, PBS_SMOOTH, { x: INSET, y: 32, w: FILL, h: 20 }, ID_PROGRESSBAR);
  user32.SendMessageW(hwndProgressBar, PBM_SETRANGE32, 0, 100);
  createSection("History (GDI, double-buffered)", 140, 1);
  hwndChart = createControl(WS_EX_CLIENTEDGE, "NodeCtypesChart", null, 0, { x: INSET, y: 26, w: FILL, h: 100 });

  // Tooltips: a top-level popup window owned by the main window.
  const hwndTooltip = user32.CreateWindowExW(WS_EX_TOPMOST, "tooltips_class32", null, WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, hwndMain, null, hInstance, null);
  user32.SendMessageW(hwndTooltip, TTM_SETMAXTIPWIDTH, 0, 300);
  const SendMessageToolW = WINFUNCTYPE(LRESULT, HWND, UINT, WPARAM, POINTER(TOOLINFOW))(["SendMessageW", user32]);
  function addTooltip(target, text) {
    const ti = new TOOLINFOW();
    ti.cbSize = sizeof(TOOLINFOW);
    ti.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    ti.hwnd = hwndPage;
    ti.uId = target;
    // LPWSTR (c_wchar_p) field: plain JS string auto-converts to a wide-char
    // buffer and is kept alive on `ti` for the duration of this call (Python
    // ctypes `_objects` parity). Windows copies the text during TTM_ADDTOOLW.
    ti.lpszText = text;
    SendMessageToolW(hwndTooltip, TTM_ADDTOOLW, 0, ti);
  }
  addTooltip(hwndButton, "Push button: prints a message");
  addTooltip(hwndMinimize, "Minimizes the window and restores it after 2 seconds");
  addTooltip(hwndTrack, "Trackbar: sets the value of the spin control, the progress bar and the chart");
  addTooltip(hwndSpinEdit, "Numeric edit: type 0-100 or use the arrows");
  addTooltip(hwndTextInput, "Text input: every change is printed (EN_CHANGE)");
  addTooltip(hwndChart, "Right-click the page for a menu");
}

function createFilesPage(hwndPage) {
  pages.push({ hwnd: hwndPage, title: "Files", layout: () => layoutFiles() });
  hwndTree = createChild(WS_EX_CLIENTEDGE, "SysTreeView32", null, TVS_HASBUTTONS | TVS_LINESATROOT | TVS_SHOWSELALWAYS | TVS_FULLROWSELECT | WS_TABSTOP, hwndPage);
  hwndList = createChild(WS_EX_CLIENTEDGE, "SysListView32", null, LVS_REPORT | LVS_SHOWSELALWAYS | LVS_SHAREIMAGELISTS | LVS_OWNERDATA | WS_TABSTOP, hwndPage);
  // The Explorer theme: the selection and hover look of File Explorer.
  uxtheme.SetWindowTheme(hwndTree, "Explorer", null);
  uxtheme.SetWindowTheme(hwndList, "Explorer", null);
  user32.SendMessageW(hwndTree, TVM_SETEXTENDEDSTYLE, TVS_EX_DOUBLEBUFFER, TVS_EX_DOUBLEBUFFER);
  const extended = LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_HEADERDRAGDROP | LVS_EX_LABELTIP;
  user32.SendMessageW(hwndList, LVM_SETEXTENDEDLISTVIEWSTYLE, extended, extended);
  // The system image lists: the same icons as File Explorer.
  user32.SendMessageW(hwndTree, TVM_SETIMAGELIST, TVSIL_NORMAL, smallImages);
  user32.SendMessageW(hwndList, LVM_SETIMAGELIST, LVSIL_SMALL, smallImages);
  user32.SendMessageW(hwndList, LVM_SETIMAGELIST, LVSIL_NORMAL, largeImages);
  COLUMNS.forEach((column, i) => {
    const col = new LVCOLUMNW();
    col.mask = LVCF_FMT | LVCF_WIDTH | LVCF_TEXT;
    col.fmt = column.right ? LVCFMT_RIGHT : 0;
    col.cx = px(column.width);
    col.pszText = column.title;
    SendMessagePtrW(hwndList, LVM_INSERTCOLUMNW, i, byref(col));
  });

  // Roots: the user's folder and the drives.
  const roots = [process.env.USERPROFILE];
  const drives = Number(kernel32.GetLogicalDrives());
  for (let i = 0; i < 26; i++) {
    const root = `${String.fromCharCode(65 + i)}:\\`;
    if (drives & (1 << i) && kernel32.GetDriveTypeW(root) !== DRIVE_NO_ROOT_DIR) roots.push(root);
  }
  let home = null;
  for (const root of roots.filter(Boolean)) {
    const info = fileInfo(root, SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_DISPLAYNAME);
    const open = fileInfo(root, SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_OPENICON).icon;
    const item = insertTreeItem(TVI_ROOT, 0, info.name || root, root, info.icon, open);
    home ??= item;
  }
  if (home) {
    user32.SendMessageW(hwndTree, TVM_EXPAND, TVE_EXPAND, home);
    user32.SendMessageW(hwndTree, TVM_SELECTITEM, TVGN_CARET, home); // TVN_SELCHANGEDW lists it
  }
}

function createDatePage(hwndPage) {
  pages.push({ hwnd: hwndPage, title: "Date and time", layout: () => layoutDate() });
  dateLabels.push(createChild(0, "STATIC", "Date", SS_LEFT, hwndPage), createChild(0, "STATIC", "Time", SS_LEFT, hwndPage));
  hwndDate = createChild(0, "SysDateTimePick32", null, DTS_SHORTDATEFORMAT | WS_TABSTOP, hwndPage);
  hwndTime = createChild(0, "SysDateTimePick32", null, DTS_TIMEFORMAT | DTS_UPDOWN | WS_TABSTOP, hwndPage);
  hwndCalendar = createChild(0, "SysMonthCal32", null, MCS_WEEKNUMBERS | WS_TABSTOP, hwndPage);
  hwndSummary = createChild(0, "STATIC", "", SS_LEFT, hwndPage);
  updateDateSummary();
}

function createControlsDemo() {
  console.log("Creating Windows Controls Demo...");
  hInstance = kernel32.GetModuleHandleW(null);
  hIconSmall = stockIcon(SIID_DESKTOPPC, SHGSI_ICON | SHGSI_SMALLICON);
  hIconBig = stockIcon(SIID_DESKTOPPC, SHGSI_ICON);
  smallImages = fileInfo("C:\\", SHGFI_SYSICONINDEX | SHGFI_SMALLICON).result;
  largeImages = fileInfo("C:\\", SHGFI_SYSICONINDEX | SHGFI_LARGEICON).result;

  registerClass("WindowsControlsDemoClass", WindowProc, COLOR_BTNFACE + 1);
  registerClass("NodeCtypesDemoPage", PageProc, COLOR_BTNFACE + 1);
  registerClass("NodeCtypesChart", ChartProc, null);

  // WS_EX_CONTROLPARENT: Tab moves through the controls of the pages
  // (IsDialogMessageW in the message loop).
  dpi = user32.GetDpiForSystem();
  hwndMain = user32.CreateWindowExW(WS_EX_CONTROLPARENT, "WindowsControlsDemoClass", "Windows Controls Showcase Demo", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, px(WINDOW_W), px(WINDOW_H), null, null, hInstance, null);
  if (!hwndMain) throw WinError(get_last_error());
  dpi = user32.GetDpiForWindow(hwndMain); // the monitor the window opened on
  hFont = createMessageFont();

  createMenus();
  createToolbar();
  hwndStatus = createChild(0, "msctls_statusbar32", null, SBARS_SIZEGRIP, hwndMain);
  // WS_CLIPSIBLINGS and the bottom of the Z order: the pages paint over the tab control.
  hwndTab = createChild(0, "SysTabControl32", null, WS_CLIPSIBLINGS | WS_TABSTOP, hwndMain);
  const creators = [createControlsPage, createFilesPage, createDatePage];
  creators.forEach((create, i) => {
    const hwndPage = user32.CreateWindowExW(WS_EX_CONTROLPARENT, "NodeCtypesDemoPage", null, WS_CHILD | (create === createControlsPage ? WS_VSCROLL : 0), 0, 0, 0, 0, hwndMain, null, hInstance, null);
    create(hwndPage);
    const item = new TCITEMW();
    item.mask = TCIF_TEXT;
    item.pszText = pages[i].title;
    SendMessagePtrW(hwndTab, TCM_INSERTITEMW, i, byref(item));
  });
  user32.SetWindowPos(hwndTab, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

  // Files dropped from Explorer, also when this process runs elevated (UIPI).
  shell32.DragAcceptFiles(hwndMain, 1);
  for (const message of [WM_DROPFILES, WM_COPYDATA, WM_COPYGLOBALDATA]) user32.ChangeWindowMessageFilterEx(hwndMain, message, MSGFLT_ALLOW, null);

  darkTitle = systemUsesDarkTheme();
  applyTitleBar();
  setListView(LV_VIEW_DETAILS);
  addTrayIcon();
  ready = true;
  layoutMain();
  setValue(0, "init");
  showPage(0);
  setStatus(0, "Ready — drop files on the window to list them");
  setStatus(2, new Date().toLocaleTimeString());
  user32.SetTimer(hwndMain, ID_CLOCK_TIMER, 1000, null);
  user32.SetTimer(hwndMain, ID_SAMPLE_TIMER, 100, null);

  user32.ShowWindow(hwndMain, SW_SHOW);
  user32.UpdateWindow(hwndMain);
  console.log(`Window created at ${dpi} DPI, visual styles ${visualStyles ? "on" : "off"}`);

  // Message loop. GetMessageW returns 0 for WM_QUIT and -1 on error.
  // TranslateAcceleratorW handles the menu shortcuts; IsDialogMessageW handles
  // Tab / arrow keys / Enter for the controls.
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
  console.log("Message loop ended");

  // Post-loop cleanup (safe: no more dispatch into the callbacks).
  user32.DestroyAcceleratorTable(hAccel);
  user32.DestroyIcon(hIconSmall);
  user32.DestroyIcon(hIconBig);
  for (const callback of callbacks) callback.release();
  ole32.OleUninitialize();
  if (visualStyles) {
    kernel32.DeactivateActCtx(0, actCtxCookie.value);
    kernel32.ReleaseActCtx(hActCtx);
  }
  for (const library of [user32, kernel32, comctl32, gdi32, shell32, ole32, advapi32, dwmapi, uxtheme, ntdll]) library.close();
}

try {
  createControlsDemo();
} catch (err) {
  console.error(err);
}
