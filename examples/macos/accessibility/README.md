---
title: Accessibility (macOS)
---

# macOS Accessibility (AX API)

A wrapper of the macOS Accessibility API (`AXUIElement` in ApplicationServices, with CoreFoundation) for UI automation: find windows and elements, read and write attributes, press buttons and perform other actions, navigate the element tree and reach the web content of browsers. It is the macOS counterpart of Microsoft UI Automation.

**Platform:** macOS · **Library:** [accessibility.js](accessibility.js) · **Requires:** the Accessibility permission for the terminal or the application running Node.js (System Settings → Privacy & Security → Accessibility); `requestAccessibility()` shows the system prompt

## Run

```bash
node examples/macos/accessibility/demo_accessibility.js --pid $(pgrep -x TextEdit)
node examples/macos/accessibility/demo_accessibility.js --pid $(pgrep -x TextEdit) --tree --depth 4
node examples/macos/accessibility/demo_accessibility.js --pid $(pgrep -x Safari) --set-value "Hello" --set-value-role AXTextField --set-value-placeholder "Search"
node examples/macos/accessibility/demo_accessibility.js --pid $(pgrep -x Safari) --press "Submit"
```

The demo lists the windows of the application, then its text fields and buttons (or the element tree), sets a value or presses a button when asked, and prints the focused element of the system.

| Option                                         | Description                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `--pid <pid>`                                  | The application (required)                                                            |
| `--title <title>`                              | The window (default: the first one)                                                   |
| `--tree`, `--depth <n>`                        | Print the element tree, down to `n` levels                                            |
| `--set-value <text>`                           | Set the value of the first element matching the `--set-value-*` options (one or more) |
| `--set-value-role`, `--set-value-subrole`      | Match `AXRole` (`AXTextField`), `AXSubrole` (`AXSecureTextField`)                     |
| `--set-value-title`, `--set-value-description` | Match `AXTitle`, `AXDescription`                                                      |
| `--set-value-identifier`                       | Match `AXIdentifier`, set by the developer: the most stable                           |
| `--set-value-placeholder`, `--set-value-help`  | Match `AXPlaceholderValue`, `AXHelp`                                                  |
| `--set-value-url`, `--set-value-enabled`       | Match `AXURL`; only enabled elements                                                  |
| `--press <title>`                              | Press the button with this title                                                      |

## Use the library

```javascript
import { AXApplication, AXRoles, isAccessibilityEnabled, requestAccessibility, close } from "./accessibility.js";

if (!isAccessibilityEnabled()) {
  requestAccessibility(); // the macOS permission prompt
  process.exit(1);
}

const app = new AXApplication(pid);
const win = app.findWindowByTitle("My App");
win.findChild({ role: AXRoles.TextField, placeholder: "Email" }).setValue("Hello from node-ctypes");
win.findChild({ role: "AXButton", title: "Submit" }).press();
console.log(win.getAttribute("AXFrame")); // { x, y, width, height }

app.dispose();
close();
```

Browsers render the page in another process: its root, the `AXWebArea`, is reached through `AXChildrenInNavigationOrder` rather than `AXChildren`. `app.getWebArea()` (or `element.findWebArea()`) finds it; from there the usual methods work:

```javascript
const page = new AXApplication(safariPid).getWebArea();
page.findChild({ role: "AXTextField", placeholder: "Email" }).setValue("me@example.com");
page.findChild({ role: "AXButton", title: "Login" }).press();
```

### API

| Class / function         | Members                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new AXApplication(pid)` | `getWindows()`, `findWindowByTitle(title)`, `getFocusedWindow()`, `getMainWindow()`, `getWebArea(win?)`, `getElementAtPosition(x, y)` (screen coordinates), `setMessagingTimeout(seconds)`, `dispose()`                                                                                   |
| `new AXSystem()`         | `getFocusedElement()` (in any application), `dispose()`                                                                                                                                                                                                                                   |
| `AXElement` attributes   | `getAttribute(name)`, `setAttribute(name, value)`, `isAttributeSettable(name)`, `getAttributeNames()`, `getParameterizedAttribute(name, parameter)`, `getParameterizedAttributeNames()`, `getPid()`                                                                                       |
| `AXElement` properties   | `role`, `subrole`, `title`, `value`, `description`, `roleDescription`, `identifier`, `placeholder`, `help`, `url`, `enabled`, `focused`, `selectedText`, `selectedTextRange`, `numberOfCharacters`, `insertionPointLineNumber`, `isMain`, `isMinimized`, `isModal`, `frontmost`, `hidden` |
| `AXElement` tree         | `getChildren()`, `getNavigationChildren()`, `getParent()`, `getTopLevelElement()`, `getSiblings()`, `getNextSibling()`, `getPreviousSibling()`                                                                                                                                            |
| `AXElement` search       | `findChild(criteria)` (depth first, the first match), `findChildren(criteria)`, `findWebArea()`                                                                                                                                                                                           |
| `AXElement` actions      | `setValue(text)`, `setFocus()`, `press()`, `confirm()`, `cancel()`, `raise()`, `increment()`, `decrement()`, `showMenu()`, `performAction(name)`, `getActionNames()`, `getActionDescription(name)`, `dispose()`                                                                           |
| Functions                | `isAccessibilityEnabled()`, `requestAccessibility()`, `close()`                                                                                                                                                                                                                           |
| Constants                | `AXRoles`, `AXSubroles`, `AXActions`, `AXNotifications`, `AXAttributes` (the `kAX*` names, e.g. `AXRoles.TextField` is `"AXTextField"`), the `kAXError*` codes and `AX_ERROR_NAMES`                                                                                                       |

The search criteria are ANDed: `role`, `subrole`, `title`, `description`, `value`, `identifier`, `placeholder`, `help`, `enabled`, `url`.

## Behavior

- **Values:** `getAttribute()` converts by CoreFoundation type (`CFGetTypeID`): `CFString` → string, `CFBoolean` → boolean, `CFNumber` → number, `CFArray` → array (its UI elements as `AXElement`), and `AXValueRef` structures through `AXValueGetValue`: `CGRect` → `{ x, y, width, height }` (`AXFrame`), `CGPoint` → `{ x, y }` (`AXPosition`), `CGSize` → `{ width, height }` (`AXSize`), `CFRange` → `{ location, length }`. `setAttribute()` accepts strings, booleans, numbers and those objects (`AXValueCreate`).
- **Errors:** failures throw `AXError` with `code` and `axErrorName`. `getAttribute()` returns `null` instead for the soft failures: no value, attribute unsupported, `kAXErrorFailure`, and `kAXErrorCannotComplete` (an element temporarily unavailable, an application in the background).
- **Memory:** `kAX*` names are `#define` macros, not symbols: their `CFString`s are created once and cached until `close()`. Child elements are retained (`CFRetain`) before the array that holds them is released; `dispose()` releases an element.
- **Hit testing and timeouts** take C `float` arguments (`AXUIElementCopyElementAtPosition`, `AXUIElementSetMessagingTimeout`), not `double`.
- **Not covered:** notifications (`AXObserver` with a run loop source), OR / NOT search criteria, text ranges as objects.

## node-ctypes features used

`CDLL` on framework binaries · `argtypes` / `restype` declarations, including `c_float` arguments · `Structure` with nested structures (`CGRect`, `CGPoint`, `CGSize`, `CFRange`) filled through `byref()` by `AXValueGetValue` and passed to `AXValueCreate` · out parameters with `byref(c_void_p)` and `byref(c_int64)` / `byref(c_double)` · `c_void_p.in_dll()` for `kCFBooleanTrue` and `kAXTrustedCheckOptionPrompt`, and `addressof()` of the `kCFTypeDictionaryKeyCallBacks` structures · `create_string_buffer()` for `CFStringGetCString`
