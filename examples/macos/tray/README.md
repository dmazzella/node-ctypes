---
title: Menu bar extra (macOS)
---

# Menu Bar Extra (status item)

A status item in the macOS menu bar with a popup menu that never blocks Node.js (icons, separators, toggles, nested submenus, keyboard, light/dark appearance). It is the macOS port of the [Windows system tray](../../windows/tray/README.md) example, with the same API, mirroring the C++ [pit-ray/fluent-tray](https://github.com/pit-ray/fluent-tray); `add_submenu()` is an extension of this port.

**Platform:** macOS 11 or later (Apple Silicon and Intel) · **Library:** [tray.js](tray.js) · **Icons:** the `.ico` files of [../../windows/tray/assets](../../windows/tray/assets)

## Run

```bash
node examples/macos/tray/demo_tray.js
```

Click the icon in the menu bar to open the menu; "Exit" stops the demo. Hover "Reports" (or press Right) to open its submenu, which contains another one. [demo_tray.js](demo_tray.js) is the Windows demo with only the path of the icons changed.

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

`new FluentTray({ template_icons: false })` keeps the colors of the menu icons; by default they are template images. Items can be added after `create_tray()`: a menu is measured again each time it opens. `create_tray(name, icon, false)` gives the menus square corners.

## Behavior

- **Never blocking:** an `NSMenu` would run a modal tracking loop on the main thread, which is the JavaScript thread, for as long as it is open. So, like the Windows version, the menus are windows of the library: each one is a borderless, non-activating `NSPanel` (it can take the keys without activating the application, so the frontmost one keeps its focus) at the pop-up menu level, with an `NSVisualEffectView` of the "menu" material and rounded corners, and a view whose `drawRect:` is JavaScript. Their mouse and key events go through `update()` like any other event: Node.js timers, I/O and promises keep running while a menu is open, and the callbacks are called from `update()`.
- **Event loop:** `update()` dispatches every pending AppKit event (`nextEventMatchingMask:untilDate:inMode:dequeue:` with `distantPast`, then `sendEvent:`), the macOS counterpart of `PeekMessageW` / `DispatchMessageW`, inside an autorelease pool, and never waits. `update_with_loop()` waits `sleep_ms` between updates with `setTimeout` (unlike `[NSApp run]`, which blocks); with the default 1 ms it uses a few percent of a CPU core when idle, `update_with_loop(16)` much less.
- **Drawing:** each row is drawn with the menu font (`menuFontOfSize:`) and semantic colors (`labelColor`, `selectedContentBackgroundColor` for the highlight, `selectedMenuItemTextColor`, `tertiaryLabelColor`, `separatorColor`), resolved for the panel's light or dark appearance and drawn again when it changes. Check marks and submenu arrows are SF Symbols.
- **Icons:** `NSImage initWithContentsOfFile:` reads the `.ico` files through ImageIO. Menu icons are 16 points high, the status item icon 18; AppKit draws the image of the file that suits the screen's backing scale (Retina). Menu icons are template images, tinted with the text color of their row (normal, highlighted or disabled), so the same monochrome icons work in light and dark mode. Without an icon file, the status item shows the application name.
- **Placement:** the menu opens under the status item, inside the visible frame of its screen; submenus open beside their item, or on the other side when there is no room.
- **Mouse and keyboard:** the status item opens and closes the menu on mouse down, like the other menu bar extras. Submenus open after a hover delay (a diagonal move towards an open submenu does not close it); Up/Down move the highlight, Right/Return open a submenu, Left/Escape close it, Return/Enter/Space run an item, Escape closes the menu. The menu closes on a click outside it (`NSEvent pressedMouseButtons` and `mouseLocation`, polled by `update()`) or when it stops being key. macOS gives the keyboard focus to a background process only after an interaction of the user, so the keys work after a real click on the status item.
- **Activation:** a command-line tool such as `node` starts with the "prohibited" activation policy and cannot show UI; `create_tray()` makes it an accessory application (no Dock icon, no menu bar of its own), unless the host already chose a policy.
- **Toggles:** a toggleable item flips its check mark and calls `callback` when checked, `unchecked_callback` when unchecked; a callback returning `false` stops the tray.
- **Cleanup:** `stop()` closes the menus and removes the status item; the panels, the images and the target are released by the next update. The runtime classes (`NodeCtypesTrayTarget`, `NodeCtypesTrayPanel`, `NodeCtypesTrayMenuView`) are shared by every tray of the process, and their method implementations stay alive with them. One implementation receives every mouse, key and action message and dispatches on the selector, like a window procedure.

## node-ctypes features used

`CFUNCTYPE` prototypes of `objc_msgSend` for each method signature · `CFUNCTYPE` callbacks as the implementations of Objective-C methods in subclasses of `NSObject`, `NSPanel` and `NSView` (`objc_allocateClassPair`, `class_addMethod`), with `sel_getName(_cmd)` to dispatch · `NSPoint`, `NSSize` and `NSRect` structures passed and returned by value (`NSRectFillUsingOperation`, `convertPoint:fromView:`, `bezierPathWithRoundedRect:xRadius:yRadius:`) · a `c_uint16` result (`keyCode`) · an `NSUInteger` argument as a `BigInt` (`NSEventMaskAny`) · `c_void_p.in_dll()` for `NSDefaultRunLoopMode` and the attribute names · `BOOL` as `c_bool` on Apple Silicon and `c_int8` on Intel · `objc_autoreleasePoolPush` / `objc_autoreleasePoolPop` around each update
