---
title: Controls
---

# Windows Controls Showcase

Creates a window with the common Win32 controls (buttons, checkbox, radio buttons, edit box, combo box, list box, progress bar, trackbar, up-down, tooltips), with scrolling and a message loop, in the style of a Python ctypes GUI script.

**Platform:** Windows · **Demo:** [demo_controls.js](demo_controls.js)

## Run

```bash
node examples/windows/controls/demo_controls.js
```

Interact with the controls: events are printed to the console. Closing the window ends the message loop.

## node-ctypes features used

`WINFUNCTYPE` window procedure assigned to a `Structure` field (`WNDCLASSEX.lpfnWndProc`) · `wintypes` structures (`POINT`, `RECT`, `MSG`) · `POINTER(T)` argtypes · typed prototypes for the same export (`WINFUNCTYPE(...)(["SendMessageW", user32])`) · `c_wchar_p` fields kept alive with the structure · `create_unicode_buffer().value` · `byref()`
