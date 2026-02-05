/**
 * Windows GUI Example - Simple Window with Button
 * Demonstrates creating a basic GUI application using node-ctypes and Windows API
 */

import { WinDLL, Structure, create_unicode_buffer, byref, GetLastError, c_int, c_uint, c_long, c_short, c_void, c_void_p } from "node-ctypes";

// Windows API constants
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_VISIBLE = 0x10000000;
const WS_CHILD = 0x40000000;
const WS_TABSTOP = 0x00010000;
const BS_PUSHBUTTON = 0x00000001;
const WM_DESTROY = 0x0002;
const WM_COMMAND = 0x0111;
const WM_CLOSE = 0x0010;
const CW_USEDEFAULT = 0x80000000;
const SW_SHOW = 5;
const SW_HIDE = 0;
const IDCANCEL = 2;
const IDOK = 1;

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
    ["wParam", c_void_p], // Use pointer for 64-bit values
    ["lParam", c_void_p],
    ["time", c_uint],
    ["pt", POINT],
  ];
}

// Load Windows libraries
const user32 = new WinDLL("user32.dll");
const kernel32 = new WinDLL("kernel32.dll");

// Define function signatures (Python-like argtypes/restype syntax)
user32.RegisterClassExW.argtypes = [c_void_p];
user32.RegisterClassExW.restype = c_short;

user32.CreateWindowExW.argtypes = [c_uint, c_void_p, c_void_p, c_uint, c_int, c_int, c_int, c_int, c_void_p, c_void_p, c_void_p, c_void_p];
user32.CreateWindowExW.restype = c_void_p;

user32.ShowWindow.argtypes = [c_void_p, c_int];
user32.ShowWindow.restype = c_int;

user32.UpdateWindow.argtypes = [c_void_p];
user32.UpdateWindow.restype = c_int;

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

user32.MessageBoxW.argtypes = [c_void_p, c_void_p, c_void_p, c_uint];
user32.MessageBoxW.restype = c_int;

user32.DestroyWindow.argtypes = [c_void_p];
user32.DestroyWindow.restype = c_int;

kernel32.GetModuleHandleW.argtypes = [c_void_p];
kernel32.GetModuleHandleW.restype = c_void_p;

// Window procedure callback
let windowProcCallback = null;

function WindowProc(hwnd, msg, wParam, lParam) {
  switch (msg) {
    case WM_COMMAND:
      const controlId = Number(wParam) & 0xffff; // Extract low 16 bits for control ID
      if (controlId === IDOK) {
        user32.MessageBoxW(null, create_unicode_buffer("Hello from node-ctypes GUI!"), create_unicode_buffer("Button Clicked"), 0);
      } else if (controlId === IDCANCEL) {
        user32.PostQuitMessage(0);
      }
      return 0n; // Return BigInt 0

    case WM_CLOSE:
      user32.DestroyWindow(hwnd);
      return 0n;

    case WM_DESTROY:
      user32.PostQuitMessage(0);
      return 0n;

    default:
      return user32.DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

async function createGUI() {
  try {
    // Get module handle
    const hInstance = kernel32.GetModuleHandleW(null);

    // Load cursor
    const hCursor = user32.LoadCursorW(null, 32512); // IDC_ARROW

    // Create window class
    const className = create_unicode_buffer("NodeCTypesWindowClass");
    const windowClass = new WNDCLASSEX();
    windowClass.cbSize = WNDCLASSEX.size;
    windowClass.style = 0;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = hInstance;
    windowClass.hIcon = null;
    windowClass.hCursor = hCursor;
    windowClass.hbrBackground = 16; // COLOR_WINDOW + 1
    windowClass.lpszMenuName = null;
    windowClass.lpszClassName = className;
    windowClass.hIconSm = null;

    // Create window procedure callback
    windowProcCallback = user32.callback(WindowProc, c_void_p, [c_void_p, c_uint, c_void_p, c_void_p]);
    windowClass.lpfnWndProc = windowProcCallback.pointer;

    // Register window class
    const atom = user32.RegisterClassExW(byref(windowClass));
    if (!atom) {
      const error = GetLastError();
      throw new Error("Failed to register window class, error: " + error);
    }

    // Create main window
    const windowTitle = create_unicode_buffer("node-ctypes GUI Example");

    const hwnd = user32.CreateWindowExW(
      0, // dwExStyle
      className, // lpClassName
      windowTitle, // lpWindowName
      (WS_OVERLAPPEDWINDOW | WS_SYSMENU) & ~(WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_THICKFRAME), // dwStyle
      CW_USEDEFAULT, // x
      CW_USEDEFAULT, // y
      400, // nWidth
      300, // nHeight
      null, // hWndParent
      null, // hMenu
      hInstance, // hInstance
      null, // lpParam
    );

    if (!hwnd) {
      const error = GetLastError();
      throw new Error("Failed to create window, error: " + error);
    }

    // Create OK button
    const buttonText = create_unicode_buffer("Click Me!");
    const hwndButton = user32.CreateWindowExW(
      0, // dwExStyle
      create_unicode_buffer("BUTTON"), // lpClassName
      buttonText, // lpWindowName
      WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, // dwStyle
      150, // x
      100, // y
      100, // nWidth
      30, // nHeight
      hwnd, // hWndParent
      IDOK, // hMenu/ID
      hInstance, // hInstance
      null, // lpParam
    );

    if (!hwndButton) {
      throw new Error("Failed to create OK button");
    }

    // Create Cancel button
    const cancelText = create_unicode_buffer("Close");
    const hwndCancel = user32.CreateWindowExW(
      0, // dwExStyle
      create_unicode_buffer("BUTTON"), // lpClassName
      cancelText, // lpWindowName
      WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_PUSHBUTTON, // dwStyle
      150, // x
      140, // y
      100, // nWidth
      30, // nHeight
      hwnd, // hWndParent
      IDCANCEL, // hMenu/ID
      hInstance, // hInstance
      null, // lpParam
    );

    if (!hwndCancel) {
      throw new Error("Failed to create Cancel button");
    }

    // Show window
    user32.ShowWindow(hwnd, SW_SHOW);
    user32.UpdateWindow(hwnd);

    // Message loop
    const msg = new MSG();
    let result;
    let messageCount = 0;

    while ((result = user32.GetMessageW(byref(msg), null, 0, 0)) > 0) {
      messageCount++;
      user32.TranslateMessage(byref(msg));
      user32.DispatchMessageW(byref(msg));
    }
  } catch (error) {
    throw error;
  } finally {
    // Cleanup
    if (windowProcCallback) {
      windowProcCallback.release();
    }
    user32.close();
    kernel32.close();
  }
}

// Run the GUI example
createGUI().catch(() => {});
