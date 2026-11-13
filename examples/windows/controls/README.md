---
title: Controls
---

# Windows Controls Showcase

A small Win32 application written in JavaScript, in the style of a Python ctypes GUI script: menu bar, toolbar and status bar, a tab control with the common controls, a file browser and date/time controls, a task dialog, a notification area icon and a Windows 11 title bar.

**Platform:** Windows · **Demo:** [demo_controls.js](demo_controls.js)

## Run

```bash
node examples/windows/controls/demo_controls.js
```

Interact with the window: events are printed to the console. Closing the window (or File → Exit) ends the message loop.

### Controls page

- The trackbar, the numeric edit with its up-down control, the progress bar and a live chart share one value (0-100); "Animate the value" moves it with a timer.
- The chart is a custom window class painted with GDI (`Polygon`, `Polyline`, `DrawTextW`), double-buffered with a memory bitmap and `BitBlt`.
- Tab, Shift+Tab and the arrow keys move through the controls (`IsDialogMessageW`); Enter presses the default button. Right-click opens a context menu.
- The layout follows the window size: two columns that share the width, one column below 860 DIPs, and the page scrolls when it is taller than the window. `WM_GETMINMAXINFO` keeps the window at least one column wide; the controls move together with `DeferWindowPos`.

### Files page

- A TreeView of the user's folder and the drives, read lazily on expansion (`TVN_ITEMEXPANDINGW`), and a virtual ListView (`LVS_OWNERDATA`): only the item count is sent, each visible cell is written into the list view's own buffer on `LVN_GETDISPINFOW`. Folders are read with `FindFirstFileW` / `FindNextFileW`.
- The icons are the system image lists (`SHGetFileInfoW`), the controls use the Explorer theme (`SetWindowTheme`). Click a column header to sort (with the arrow in the header), double-click a folder to open it, right-click for the view modes.
- Drop files from File Explorer on the window to list them (`DragAcceptFiles`, `WM_DROPFILES`; `ChangeWindowMessageFilterEx` lets them through when the process is elevated). File → Browse opens the folder dialog (`SHBrowseForFolderW`).

### Date and time page

A date picker, a time picker and a month calendar kept in sync (`DTN_DATETIMECHANGE`, `MCN_SELCHANGE`), with the selection formatted by `GetDateFormatEx` / `GetTimeFormatEx` in the user's locale.

### Application parts

- **Menus and shortcuts:** File, View, Tools and Help, with accelerators (Ctrl+O, F5, Ctrl+M, Ctrl+T, Ctrl+N, F1: `CreateAcceleratorTableW`, `TranslateAcceleratorW`).
- **Toolbar:** modern stock icons from `SHGetStockIconInfo` in the system image list; "Animate" is a check button kept in sync with the checkbox and the menu.
- **Status bar:** the current folder or state, the value and a clock.
- **Task dialog** (Tools → Task dialog): `TaskDialogIndirect` with command links, radio buttons, a verification checkbox, expandable details and a footer link. Its progress bar is driven by a JavaScript callback (`TDN_TIMER`); "Restart the progress" keeps the dialog open by returning `S_FALSE`. Help → About uses `TaskDialog` and `RtlGetVersion`.
- **Notification area icon:** `Shell_NotifyIconW` with `NOTIFYICON_VERSION_4`; click it to restore the window, right-click for a menu. A notification appears when the animation reaches 100, from Tools → Show a notification, or when the task dialog closes with its checkbox selected.

## Native look

- **Visual styles:** `node.exe` has no manifest requesting Common Controls 6, so the demo activates the one embedded in `shell32.dll` (resource 124) with `CreateActCtxW` / `ActivateActCtx` before loading `comctl32.dll`. Without it the controls are drawn in the classic style, and task dialogs are unavailable.
- **DPI:** the process is per-monitor DPI aware (`SetProcessDpiAwarenessContext`). The layout is defined at 96 DPI and scaled with `GetDpiForWindow`, the font is the system message font for that DPI (`SystemParametersInfoForDpi`), and `WM_DPICHANGED` rescales everything when the window moves to a monitor with another scale.
- **Windows 11 title bar:** dark when the system uses the dark theme (`AppsUseLightTheme`, read with `RegGetValueW`, updated on `WM_SETTINGCHANGE`), with the Mica backdrop (`DwmSetWindowAttribute`); both can be toggled from the View menu. The controls themselves keep the light theme.

## node-ctypes features used

`WINFUNCTYPE` window procedures (three window classes) and a task dialog callback · structures with one-byte packing (`_pack_ = 1`) and `Union` fields (`TASKDIALOGCONFIG`) · nested structures (`NONCLIENTMETRICSW`, `NMTREEVIEWW`, `NOTIFYICONDATAW` with its `GUID`) and `WCHAR` array fields assigned from strings · arrays of structures (`TBBUTTON`, `ACCEL`, `POINT`, `TASKDIALOG_BUTTON`) · notifications read with `cast(lParam, POINTER(NMHDR)).contents`, and written back through the same view (`MINMAXINFO`, `NMLVDISPINFOW`) · `memmove` into a buffer owned by Windows · `addressof()` for strings referenced by address · typed prototypes for the same export (`WINFUNCTYPE(...)(["SendMessageW", user32])`) · `wstring_at()` · `c_wchar_p` fields kept alive with the structure · `use_last_error` with `WinError(get_last_error())`

All the structure sizes match the Windows SDK headers on 64-bit Windows.
