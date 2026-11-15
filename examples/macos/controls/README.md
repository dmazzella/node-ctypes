---
title: Controls (macOS)
---

# macOS Controls Showcase

A small Cocoa (AppKit) application written in JavaScript, in the style of a Python ctypes script driving the Objective-C runtime: menu bar, toolbar and status bar, a tab view with the common controls, a file browser and date/time pickers, an alert with a progress bar, a menu bar status item with notifications, and the system appearance. It is the macOS counterpart of the [Windows Controls](../../windows/controls/README.md) demo.

**Platform:** macOS 11 or later (Apple Silicon and Intel) · **Demo:** [demo_controls.js](demo_controls.js)

## Run

```bash
node examples/macos/controls/demo_controls.js
```

Interact with the window: events are printed to the console. Closing the window (or ⌘Q) ends the run loop and the script cleans up.

## How it works

- **Messages:** every call is `objc_msgSend` cast to the C prototype of the method, `CFUNCTYPE(restype, id, SEL, ...argtypes)(["objc_msgSend", libobjc])`, as `SendMessageW` is typed several ways in the Windows demo. `msgSend()` picks `objc_msgSend_stret` on Intel for structures larger than 16 bytes.
- **Classes at runtime:** `NodeCtypesController` (target, delegate and data source of everything), `NodeCtypesFlippedView` and `NodeCtypesChart` are created with `objc_allocateClassPair` / `class_addMethod` / `objc_registerClassPair`; their methods are JavaScript callbacks with the method's signature and type encoding.
- **One "window procedure":** all the `- (void)method:(id)arg` messages (actions, timers, notifications such as `windowDidResize:` or `controlTextDidChange:`) share one implementation, `ControllerProc`, that dispatches on `sel_getName(_cmd)`. Data sources and delegates with other signatures have their own.
- **Run loop:** `[NSApp run]` blocks the Node.js event loop like the Win32 message loop does, so the timers are `NSTimer`s, added in the common run loop modes so they also fire during menus, live resize and modal alerts. `windowWillClose:` calls `[NSApp stop:]` and posts an application-defined event so that `run` returns.

### Controls page

- Push buttons (the default one answers to Return), a text field whose changes are printed, a checkbox and radio buttons, a pop-up button and a one-column `NSTableView` as a list.
- The slider, the number field with its stepper, the progress bar and a live chart share one value (0-100); "Animate the value" moves it with a timer, with a spinner while it runs.
- The chart is an `NSView` subclass drawn with `NSBezierPath`, `NSRectFill` and `drawAtPoint:withAttributes:`, with semantic colors (accent, separator, text background) that follow light and dark mode.
- The layout follows the window size: two columns that share the width, one column below 820 points, in a scroll view with a flipped document view. Right-click the page for a menu.

### Files page

- An `NSOutlineView` (source list style) of the home folder, the startup disk and the mounted volumes, read lazily when a folder is expanded, and an `NSTableView` whose cells are asked for by AppKit (`tableView:objectValueForTableColumn:row:`), only for the visible rows; icons and kinds are read when a row is first shown.
- Folders are read with `contentsOfDirectoryAtURL:includingPropertiesForKeys:options:error:`, and the properties with `getResourceValue:forKey:error:` (an out parameter through `byref(c_void_p)`). Icons come from `NSWorkspace iconForFile:`.
- Click a column header to sort (with the sort indicator), double-click a folder to open it or a file to open it in its application, right-click for Open, Show in Finder, Show Hidden Files and Refresh.
- Drop files from the Finder on the window to list them: the window registers `NSPasteboardTypeFileURL` and forwards `draggingEntered:` / `performDragOperation:` to its delegate. File → Open Folder… uses `NSOpenPanel`.

### Date and time page

A date picker, a time picker, a graphical calendar and an analog clock kept in sync, with the selection formatted by `NSDateFormatter` (full and short styles) and `NSRelativeDateTimeFormatter` in the user's locale.

### Application parts

- **Menus:** application, File, Edit, View, Tools, Window and Help menus with key equivalents (⌘O, ⌘R, ⇧⌘., ⌘L, ⌘T, ⌘N, ⌘?). The Edit menu is what makes ⌘C / ⌘V / ⌘A work in the text fields; standard items have a nil target and go up the responder chain. AppKit adds the window list and the Help search field.
- **Toolbar:** `NSToolbar` with its delegate and SF Symbols (`imageWithSystemSymbolName:accessibilityDescription:`); the Animate item switches between play and pause.
- **Status bar:** the current folder or state, the value and a clock.
- **Alert** (Tools → Alert with Progress…): `NSAlert` with an accessory view (progress bar and speed), a suppression checkbox and a help button (`alertShowHelp:`). The progress is driven by a timer during `runModal`; "Restart the Progress" is retargeted to the controller, so it keeps the alert open. About uses the standard About panel with the macOS version read as an `NSOperatingSystemVersion` structure returned by value.
- **Status item:** an `NSStatusItem` in the menu bar with a template SF Symbol and a menu. Notifications are a transient `NSPopover` under it, closed after a few seconds, with a Dock badge and `requestUserAttention:` when the application is in the background. They appear when the animation reaches 100, from Tools → Show a Notification, or when the alert closes with its checkbox selected.

## Native look

- **Activation:** `node` is a command-line tool; `setActivationPolicy:NSApplicationActivationPolicyRegular` gives it a Dock icon, a menu bar and windows that can become key.
- **Appearance:** the controls follow the system light / dark setting; View → Appearance forces Light or Dark with `NSAppearance appearanceNamed:`. View → Keep on Top uses the floating window level; full screen comes with the Resizable style.
- **Retina:** AppKit works in points and draws at the backing scale factor (printed at startup); the chart is vector drawing and needs no scaling code.
- **Keyboard:** `setAutorecalculatesKeyViewLoop:` makes Tab follow the layout (with full keyboard access enabled in System Settings, also through buttons and pop-ups).

## node-ctypes features used

`CFUNCTYPE` prototypes bound to the same export (`objc_msgSend`) with different signatures · `CFUNCTYPE` callbacks as Objective-C method implementations (`class_addMethod`), with `BOOL`, `NSInteger`, `NSUInteger` and object results · structures passed and returned by value (`NSRect`, `NSPoint`, `NSSize`, `NSOperatingSystemVersion`) · nested structures · `c_void_p.in_dll()` for exported `NSString` constants (`NSRunLoopCommonModes`, `NSURLIsDirectoryKey`, `NSAppearanceNameDarkAqua`, …) · out parameters with `byref(c_void_p)` · `CGFloat` / `double` arguments · architecture-dependent types (`BOOL` is `bool` on Apple Silicon and `signed char` on Intel; `NSTextAlignmentRight` is 2 on Apple Silicon and 1 on Intel)

Cocoa memory management is manual here: objects created with `alloc`/`init` or kept by the script are retained and released explicitly; the run loop drains its own autorelease pools, and one pool (`objc_autoreleasePoolPush`) covers the setup.
