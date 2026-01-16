/**
 * Windows GUI Example - Simple Window with Button
 * Demonstrates creating a basic GUI application using node-ctypes and Windows API
 */

import {
  WinDLL,
  struct,
  create_unicode_buffer,
  GetLastError,
} from "node-ctypes";

// Windows API constants
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
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

// Windows structures
const WNDCLASSEX = struct({
  cbSize: "uint",
  style: "uint",
  lpfnWndProc: "pointer",
  cbClsExtra: "int",
  cbWndExtra: "int",
  hInstance: "pointer",
  hIcon: "pointer",
  hCursor: "pointer",
  hbrBackground: "pointer",
  lpszMenuName: "pointer",
  lpszClassName: "pointer",
  hIconSm: "pointer",
});

const MSG = struct({
  hwnd: "pointer",
  message: "uint",
  wParam: "pointer", // Use pointer for 64-bit values
  lParam: "pointer",
  time: "uint",
  pt: struct({ x: "long", y: "long" }),
});

const POINT = struct({ x: "long", y: "long" });
const RECT = struct({
  left: "long",
  top: "long",
  right: "long",
  bottom: "long",
});

// Load Windows libraries
const user32 = new WinDLL("user32.dll");
const kernel32 = new WinDLL("kernel32.dll");

// Get required functions
const RegisterClassExW = user32.func("RegisterClassExW", "short", ["pointer"]);
const CreateWindowExW = user32.func("CreateWindowExW", "pointer", [
  "uint",
  "pointer",
  "pointer",
  "uint",
  "int",
  "int",
  "int",
  "int",
  "pointer",
  "pointer",
  "pointer",
  "pointer",
]);
const ShowWindow = user32.func("ShowWindow", "int", ["pointer", "int"]);
const UpdateWindow = user32.func("UpdateWindow", "int", ["pointer"]);
const GetMessageW = user32.func("GetMessageW", "int", [
  "pointer",
  "pointer",
  "uint",
  "uint",
]);
const TranslateMessage = user32.func("TranslateMessage", "int", ["pointer"]);
const DispatchMessageW = user32.func("DispatchMessageW", "pointer", [
  "pointer",
]);
const DefWindowProcW = user32.func("DefWindowProcW", "pointer", [
  "pointer",
  "uint",
  "pointer",
  "pointer",
]);
const PostQuitMessage = user32.func("PostQuitMessage", "void", ["int"]);
const LoadCursorW = user32.func("LoadCursorW", "pointer", ["pointer", "uint"]);
const GetModuleHandleW = kernel32.func("GetModuleHandleW", "pointer", [
  "pointer",
]);
const MessageBoxW = user32.func("MessageBoxW", "int", [
  "pointer",
  "pointer",
  "pointer",
  "uint",
]);

// Window procedure callback
let windowProcCallback = null;

function WindowProc(hwnd, msg, wParam, lParam) {
  console.log(
    `WindowProc called: msg=${msg}, wParam=${wParam}, lParam=${lParam}`,
  );
  switch (msg) {
    case WM_COMMAND:
      const controlId = Number(wParam) & 0xffff; // Extract low 16 bits for control ID
      console.log(`WM_COMMAND: controlId=${controlId}`);
      if (controlId === IDOK) {
        console.log("OK button clicked");
        MessageBoxW(
          null,
          create_unicode_buffer("Hello from node-ctypes GUI!"),
          create_unicode_buffer("Button Clicked"),
          0,
        );
      } else if (controlId === IDCANCEL) {
        console.log("Cancel button clicked");
        PostQuitMessage(0);
      }
      return 0n; // Return BigInt 0

    case WM_CLOSE:
      console.log("WM_CLOSE received");
      PostQuitMessage(0);
      return 0n;

    case WM_DESTROY:
      console.log("WM_DESTROY received");
      PostQuitMessage(0);
      return 0n;

    default:
      return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

async function createGUI() {
  console.log("Creating Windows GUI with node-ctypes...");

  try {
    // Get module handle
    const hInstance = GetModuleHandleW(null);
    console.log("Using hInstance:", hInstance);

    // Load cursor
    const hCursor = LoadCursorW(null, 32512); // IDC_ARROW

    // Create window class
    const className = create_unicode_buffer("NodeCTypesWindowClass");
    const windowClass = WNDCLASSEX.create();
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
    windowProcCallback = user32.callback(WindowProc, "pointer", [
      "pointer",
      "uint",
      "pointer",
      "pointer",
    ]);
    windowClass.lpfnWndProc = windowProcCallback.pointer;

    // Register window class
    const atom = RegisterClassExW(windowClass);
    console.log("RegisterClassExW result:", atom);
    if (!atom) {
      const error = GetLastError();
      throw new Error("Failed to register window class, error: " + error);
    }

    // Create main window
    const windowTitle = create_unicode_buffer("node-ctypes GUI Example");
    console.log("Creating window...");

    const hwnd = CreateWindowExW(
      0, // dwExStyle
      className, // lpClassName
      windowTitle, // lpWindowName
      WS_OVERLAPPEDWINDOW, // dwStyle
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
      console.log("CreateWindowExW failed with error:", error);
      throw new Error("Failed to create window, error: " + error);
    }

    console.log("Window created successfully, handle:", hwnd);

    // Create OK button
    const buttonText = create_unicode_buffer("Click Me!");
    const hwndButton = CreateWindowExW(
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
      console.log("Failed to create OK button");
    } else {
      console.log("OK button created");
    }

    // Create Cancel button
    const cancelText = create_unicode_buffer("Close");
    const hwndCancel = CreateWindowExW(
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
      console.log("Failed to create Cancel button");
    } else {
      console.log("Cancel button created");
    }

    // Show window
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);

    console.log("Window shown. Running message loop...");

    // Message loop
    const msg = MSG.create();
    let result;
    let messageCount = 0;

    while ((result = GetMessageW(msg, null, 0, 0)) > 0) {
      messageCount++;
      console.log(`Processing message ${messageCount}: ${msg.message}`);
      TranslateMessage(msg);
      DispatchMessageW(msg);
    }

    console.log("Message loop ended, total messages processed:", messageCount);
  } catch (error) {
    console.error("Error creating GUI:", error);
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
createGUI().catch(console.error);
