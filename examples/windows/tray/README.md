---
title: System tray
---

# System Tray (Fluent menu)

A system tray icon with a Fluent-style popup menu (icons, separators, toggles, submenus, light/dark theme), drawn with GDI. The API mirrors the C++ [pit-ray/fluent-tray](https://github.com/pit-ray/fluent-tray); `add_submenu()` is an extension of this port.

**Platform:** Windows · **Library:** [tray.js](tray.js), icons in `assets/` · **Uses:** [../registry/registry.js](../registry/registry.js) to follow the Windows theme

## Run

```bash
node examples/windows/tray/demo_tray.js
```

Click the tray icon to open the menu; "Exit" stops the demo. Hover "Reports" (or press Right) to open its submenu, which contains another one.

## Use the library

```javascript
import { FluentTray } from "./tray.js";

const tray = new FluentTray();
tray.create_tray("myapp", "icon.ico");
tray.add_menu("Home", "home.ico", false, () => {
  console.log("Home");
  return true;
});
const more = tray.add_submenu("More", "more.ico"); // same methods: add_menu, add_separator, add_submenu
more.add_menu("About", "", false, () => true);
tray.add_separator();
tray.add_menu("Exit", "", false, () => false); // returning false stops the loop
await tray.update_with_loop();
```

`new FluentTray({ opacity })` makes the menus translucent (0-255, default 255: opaque); `message_id_offset` changes the tray callback message (`WM_APP + 25`).

## Behavior

- **Sharp at any scale:** only the menu windows are per-monitor DPI aware (`SetThreadDpiAwarenessContext` around `CreateWindowExW`: the process awareness stays as the application set it). Each menu is measured (`GetTextExtentPoint32W`) and drawn at the DPI of its monitor (`GetDpiForMonitor`), and the icons are loaded from the `.ico` files at that size.
- **Placement:** `CalculatePopupWindowPosition` keeps the menu in the work area of the monitor where the icon was clicked, with the taskbar on any side; submenus open beside their item, or on the other side when there is no room.
- **Mouse and keyboard:** submenus open after the system menu delay (`SPI_GETMENUSHOWDELAY`) like native menus; Up/Down move the highlight, Right/Enter open a submenu, Left/Escape close it, Enter/Space run an item, Escape closes the menu.
- **Notification icon:** `NOTIFYICON_VERSION_4` (left click, right click and keyboard selection, with the anchor point), added again when Explorer restarts (`TaskbarCreated`).
- **Theme:** light or dark like Windows (`AppsUseLightTheme`), updated on `WM_SETTINGCHANGE`.
- **Cleanup:** `stop()` removes the icon; the windows, the window class, the callback, the icons and the fonts are released when the loop ends.

## node-ctypes features used

`WINFUNCTYPE` window procedure as a `Structure` field · `Structure` with `c_wchar * n` fields assigned as strings (`NOTIFYICONDATA.szTip`) · `wintypes` structures and pointer types (`POINT`, `RECT`, `SIZE`, `MSG`, `LPRECT`, `LPMSG`) · an array of `POINT` for `Polyline` · pseudo-handles passed as `c_ssize_t` (`HWND_TOPMOST`, `DPI_AWARENESS_CONTEXT`) · `wstring_at()` for `WM_SETTINGCHANGE` · `byref()` · `c_int` instance passed by reference (`DwmSetWindowAttribute`)
