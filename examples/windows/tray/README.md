---
title: System tray
---

# System Tray (Fluent menu)

A system tray icon with a Fluent-style popup menu (icons, separators, toggles, light/dark theme), drawn with GDI. The API mirrors the C++ [pit-ray/fluent-tray](https://github.com/pit-ray/fluent-tray).

**Platform:** Windows · **Library:** [tray.js](tray.js), icons in `assets/` · **Uses:** [../registry/registry.js](../registry/registry.js) to follow the Windows theme

## Run

```bash
node examples/windows/tray/demo_tray.js
```

Click the tray icon to open the menu; "Exit" stops the demo.

## Use the library

```javascript
import { FluentTray } from "./tray.js";

const tray = new FluentTray();
tray.create_tray("myapp", "icon.ico");
tray.add_menu("Home", "home.ico", false, () => {
  console.log("Home");
  return true;
});
tray.add_separator();
tray.add_menu("Exit", "", false, () => false); // returning false stops the loop
await tray.update_with_loop();
```

## node-ctypes features used

`WINFUNCTYPE` window procedure as a `Structure` field · `Structure` with `c_wchar * n` fields assigned as strings (`NOTIFYICONDATA.szTip`) · `wintypes` structures and pointer types (`POINT`, `RECT`, `MSG`, `LPRECT`, `LPMSG`) · `byref()` · `c_int` instance passed by reference (`DwmSetWindowAttribute`)
