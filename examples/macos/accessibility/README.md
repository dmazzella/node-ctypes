# macOS Accessibility API Wrapper for node-ctypes

A JavaScript wrapper around the macOS Accessibility API (ApplicationServices framework) using node-ctypes. This is the **macOS equivalent of Microsoft UI Automation (UIA)**.

## What it does

- Find windows by title, focused window, or main window
- Search for UI elements (text fields, buttons, checkboxes, etc.) with rich criteria
- Read/write element attributes (value, title, role, focused, etc.)
- Read element geometry: `AXFrame` → `{ x, y, width, height }`, `AXPosition` → `{ x, y }`, `AXSize` → `{ width, height }`
- Perform actions (press buttons, confirm dialogs, raise windows)
- Navigate the element tree: parent, children, siblings, top-level element
- Recursive element tree traversal
- **Browser web content** (Safari, Chrome): access the `AXWebArea` via `getWebArea()` / `findWebArea()`
- Check and request accessibility permissions

## Comparison: Microsoft UIA vs macOS AX API

| Task | Microsoft UIA (C#) | macOS AX API (node-ctypes) |
|------|-------------------|---------------------------|
| Set text field value | `ValuePattern.SetValue("text")` | `element.setValue("text")` |
| Read value | `ValuePattern.Current.Value` | `element.value` |
| Press button | `InvokePattern.Invoke()` | `element.press()` |
| Focus element | `element.SetFocus()` | `element.setFocus()` |
| Find by role | `FindFirst(TreeScope.Descendants, condition)` | `parent.findChild({ role: "AXButton" })` |
| Find window | `AutomationElement.FromHandle(hwnd)` | `app.findWindowByTitle("Title")` |
| Get element bounds | `element.Current.BoundingRectangle` | `element.getAttribute("AXFrame")` → `{ x, y, width, height }` |
| Automate browser page | `IUIAutomation + UIA_WebControlTypeId` | `app.getWebArea()` → `AXElement` |
| Navigate to parent | `TreeWalker.GetParent(element)` | `element.getParent()` |
| Navigate to siblings | `TreeWalker.GetNextSibling(element)` | `element.getNextSibling()` / `element.getPreviousSibling()` |

## Prerequisites

- **macOS only** (darwin)
- **Accessibility permissions** must be granted to your terminal app (Terminal, iTerm2, etc.) in:
  System Settings > Privacy & Security > Accessibility

## Quick Start

### Native app

```javascript
import {
  AXApplication,
  isAccessibilityEnabled,
  requestAccessibility,
  close,
} from "./accessibility/accessibility.js";

if (!isAccessibilityEnabled()) {
  requestAccessibility(); // Shows macOS permission dialog
  process.exit(1);
}

const app = new AXApplication(pid);
const win = app.findWindowByTitle("My App");

const textField = win.findChild({ role: "AXTextField" });
textField.setValue("Hello from node-ctypes");

const button = win.findChild({ role: "AXButton", title: "Submit" });
button.press();

app.dispose();
close();
```

### Browser (Safari / Chrome)

```javascript
const app = new AXApplication(safariPid);

// getWebArea() traverses AXChildrenInNavigationOrder to reach web content
const webArea = app.getWebArea();

// From here, use findChild/findChildren as with any native element
const usernameField = webArea.findChild({ role: "AXTextField", placeholder: "Email" });
usernameField.setFocus();
usernameField.setValue("myuser");

const loginBtn = webArea.findChild({ role: "AXButton", title: "Login" });
loginBtn.press();

app.dispose();
close();
```

### Reading element geometry

```javascript
const frame = element.getAttribute("AXFrame");
// { x: 315, y: 240, width: 241, height: 21 }

const pos = element.getAttribute("AXPosition");
// { x: 315, y: 240 }

const size = element.getAttribute("AXSize");
// { width: 241, height: 21 }
```

### Tree navigation

```javascript
const parent = element.getParent();
const siblings = element.getSiblings();
const next = element.getNextSibling();
const prev = element.getPreviousSibling();
const window = element.getTopLevelElement();
```

## Demo Scripts

### General demo

```bash
# List windows and UI elements for TextEdit
node examples/macos/demo_accessibility.js --pid $(pgrep -x TextEdit)

# Print the full element tree (max depth 4)
node examples/macos/demo_accessibility.js --pid $(pgrep -x TextEdit) --tree --depth 4

# Set a text field value by role + placeholder
node examples/macos/demo_accessibility.js --pid $(pgrep -x Safari) \
  --set-value "Hello" --set-value-role AXTextField --set-value-placeholder "Search"

# Press a button by title
node examples/macos/demo_accessibility.js --pid $(pgrep -x Safari) --press "Submit"
```

**Options:**

| Option | Description |
|--------|-------------|
| `--pid <PID>` | **(required)** Process ID of the target application |
| `--title <title>` | Window title to find (defaults to first window) |
| `--tree` | Print the full element tree instead of summary |
| `--depth <N>` | Maximum depth for `--tree` (default: unlimited) |
| `--set-value <text>` | Value to set (requires at least one targeting option below) |
| `--set-value-role <role>` | Match by `AXRole` (e.g. `AXTextField`) |
| `--set-value-subrole <subrole>` | Match by `AXSubrole` (e.g. `AXSecureTextField`) |
| `--set-value-title <title>` | Match by `AXTitle` |
| `--set-value-description <desc>` | Match by `AXDescription` |
| `--set-value-identifier <id>` | Match by `AXIdentifier` (developer-set, most stable) |
| `--set-value-placeholder <text>` | Match by `AXPlaceholderValue` |
| `--set-value-help <text>` | Match by `AXHelp` (tooltip) |
| `--set-value-enabled` | Only match enabled elements |
| `--set-value-url <url>` | Match by `AXURL` (links/web content) |
| `--press <button>` | Press a button by its title |

### FSE / browser login demo

Demonstrates `getWebArea()`, `AXFrame`/`AXPosition` decoding, and form automation
against a real Safari page.

```bash
# Inspect form elements (no fill)
node examples/macos/demo_accessibility_fse.js

# Fill username and password fields (no submit)
node examples/macos/demo_accessibility_fse.js --user myuser --pass mypass

# Fill and submit
node examples/macos/demo_accessibility_fse.js --user myuser --pass mypass --submit
```

**Options:**

| Option | Description |
|--------|-------------|
| `--user <username>` | Username to fill |
| `--pass <password>` | Password to fill |
| `--submit` | Click the Login button after filling |

## API Reference

### `isAccessibilityEnabled()` → `boolean`

Check if the current process has accessibility permissions.

### `requestAccessibility()` → `boolean`

Request accessibility permissions. Shows the macOS system dialog if not already trusted.

### `new AXApplication(pid)`

Create an accessibility client for an application.

| Method | Returns | Description |
|--------|---------|-------------|
| `getWindows()` | `AXElement[]` | All windows |
| `findWindowByTitle(title)` | `AXElement \| null` | Find window by exact title |
| `getFocusedWindow()` | `AXElement \| null` | Currently focused window |
| `getMainWindow()` | `AXElement \| null` | Main window |
| `getWebArea(win?)` | `AXElement \| null` | Find `AXWebArea` in `win` (or first window). Searches both `AXChildren` and `AXChildrenInNavigationOrder` — required for Safari/Chrome |
| `getElementAtPosition(x, y)` | `AXElement \| null` | Hit-test global screen coordinates; returns the topmost element at that point |
| `setMessagingTimeout(seconds)` | `void` | Set per-application messaging timeout (0 = system default) |
| `dispose()` | `void` | Release resources |

### `new AXSystem()`

System-wide accessibility element.

| Method | Returns | Description |
|--------|---------|-------------|
| `getFocusedElement()` | `AXElement \| null` | Focused element across all apps |
| `dispose()` | `void` | Release resources |

### `AXElement`

Wraps an AXUIElementRef.

**Attribute Access:**

| Method / Property | Description |
|-------------------|-------------|
| `.role` | Element role (e.g., `"AXButton"`, `"AXTextField"`) |
| `.subrole` | Element subrole (e.g., `"AXSecureTextField"`, `"AXSearchField"`) |
| `.title` | Element title |
| `.value` | Element value |
| `.description` | Accessibility description |
| `.identifier` | Developer-set identifier (`AXIdentifier`) — stable across runs, preferred for automation |
| `.enabled` | Whether the element is enabled |
| `.focused` | Whether the element is focused |
| `.url` | URL for links and web content (`AXURL`) |
| `.help` | Tooltip / help text (`AXHelp`) |
| `.placeholder` | Placeholder value (text fields) |
| `.selectedText` | Currently selected text |
| `.selectedTextRange` | Selected text range → `{ location, length }` |
| `.numberOfCharacters` | Character count of text content |
| `.insertionPointLineNumber` | Line number of the insertion point |
| `.isMain` | Whether this is the main window |
| `.isMinimized` | Whether this window is minimized |
| `.isModal` | Whether this is a modal window/sheet |
| `.frontmost` | Whether this application is frontmost |
| `.hidden` | Whether this application is hidden |
| `getAttribute(name)` | Read any attribute by name. Geometry attributes (`AXFrame`, `AXPosition`, `AXSize`) return JS objects automatically |
| `setAttribute(name, value)` | Set any attribute (string, boolean, number, or geometry object `{x,y}` / `{width,height}` / `{location,length}`) |
| `isAttributeSettable(name)` | Check if an attribute can be modified |
| `getAttributeNames()` | List all supported attribute names |
| `getParameterizedAttributeNames()` | List all supported parameterized attribute names |
| `getParameterizedAttribute(attr, param)` | Read a parameterized attribute. `param` may be a number, string, `AXElement`, or geometry/range object (e.g. `{location, length}` for `AXStringForRange`) |
| `getPid()` | PID of the process that owns this element |

**Tree Navigation:**

| Method | Returns | Description |
|--------|---------|-------------|
| `getChildren()` | `AXElement[]` | Direct children via `AXChildren` |
| `getNavigationChildren()` | `AXElement[]` | Children via `AXChildrenInNavigationOrder` (browser tabs, web views) |
| `getParent()` | `AXElement \| null` | Parent element via `AXParent` |
| `getTopLevelElement()` | `AXElement \| null` | Top-level element (usually the window) via `AXTopLevelUIElement` |
| `getSiblings()` | `AXElement[]` | All siblings (other children of the same parent) |
| `getNextSibling()` | `AXElement \| null` | Next sibling in parent's children |
| `getPreviousSibling()` | `AXElement \| null` | Previous sibling in parent's children |

**Search:**

`findChild` and `findChildren` accept any combination of the following criteria (all are AND-matched):

| Criterion | AX Attribute | Notes |
|-----------|-------------|-------|
| `role` | `AXRole` | e.g. `"AXTextField"`, `"AXButton"` |
| `subrole` | `AXSubrole` | e.g. `"AXSecureTextField"`, `"AXSearchField"` |
| `title` | `AXTitle` | Exact match |
| `description` | `AXDescription` | Exact match |
| `value` | `AXValue` | Exact match |
| `identifier` | `AXIdentifier` | Developer-set ID — most stable for automation |
| `placeholder` | `AXPlaceholderValue` | Useful when title/description are absent |
| `help` | `AXHelp` | Tooltip text |
| `enabled` | `AXEnabled` | `true` / `false` |
| `url` | `AXURL` | For links and web content |

```javascript
// All criteria are combined with AND
win.findChild({ role: "AXTextField", placeholder: "Email" });
win.findChild({ role: "AXTextField", subrole: "AXSecureTextField" });
win.findChild({ role: "AXButton", enabled: true, title: "OK" });
win.findChild({ identifier: "login-submit-btn" });
```

| Method | Description |
|--------|-------------|
| `findChild(criteria)` | Recursive depth-first search, returns first match |
| `findChildren(criteria)` | Recursive depth-first search, returns all matches |
| `findWebArea()` | Find first `AXWebArea` descendant, searching both `AXChildren` and `AXChildrenInNavigationOrder` |

**Actions:**

| Method | Description |
|--------|-------------|
| `setValue(text)` | Set AXValue (for text fields) |
| `setFocus()` | Focus this element |
| `press()` | Press (for buttons) |
| `confirm()` | Confirm action |
| `cancel()` | Cancel action |
| `raise()` | Raise (for windows) |
| `increment()` | Increment (for sliders/steppers) |
| `decrement()` | Decrement (for sliders/steppers) |
| `showMenu()` | Show context menu |
| `getActionNames()` | List all supported action names |
| `getActionDescription(name)` | Human-readable description of an action |
| `performAction(name)` | Perform any action by name |

**Lifecycle:**

| Method | Description |
|--------|-------------|
| `dispose()` | Release the underlying AXUIElementRef |

### `close()`

Release all framework handles and cached strings. Call when done with the module.

## Geometry Attributes

`AXFrame`, `AXPosition`, and `AXSize` are backed by `AXValueRef` (opaque structs).
They are automatically decoded by `getAttribute()`:

| Attribute | Type | JS result |
|-----------|------|-----------|
| `AXFrame` | `CGRect` | `{ x, y, width, height }` |
| `AXPosition` | `CGPoint` | `{ x, y }` |
| `AXSize` | `CGSize` | `{ width, height }` |
| `AXVisibleCharacterRange` | `CFRange` | `{ location, length }` |

## Browser Web Content (Safari / Chrome)

Modern browsers render web content in a separate process. The `AXWebArea` element —
which is the root of the page's accessibility tree — is **not** reachable via
`AXChildren` on the window. It is exposed instead via `AXChildrenInNavigationOrder`
on an intermediate container group.

`getWebArea()` and `findWebArea()` handle this automatically. Once you have the
`AXWebArea`, all standard methods (`findChild`, `findChildren`, `getAttribute`, etc.)
work normally:

```
Window
  └─ AXSplitGroup
       └─ AXTabGroup
            └─ AXGroup              ← AXChildren returns this, no web content
                 └─ AXGroup         ← AXChildrenInNavigationOrder reaches here
                      └─ AXScrollArea
                           └─ AXWebArea   ← getWebArea() returns this
                                └─ ... page elements ...
```

## Exported Constants

The module exports four constant dictionaries for use with APIs that accept name strings:

```javascript
import { AXRoles, AXSubroles, AXActions, AXNotifications, AXAttributes } from "./accessibility/accessibility.js";

// Instead of magic strings:
element.findChild({ role: AXRoles.TextField });       // "AXTextField"
element.performAction(AXActions.ShowMenu);             // "AXShowMenu"
element.getAttribute(AXAttributes.SelectedTextRange); // "AXSelectedTextRange"
```

| Export | Description |
|--------|-------------|
| `AXRoles` | All role strings (`AXButton`, `AXTextField`, `AXWebArea`, …) |
| `AXSubroles` | All subrole strings (`AXSecureTextField`, `AXDialog`, `AXLandmarkMain`, …) |
| `AXActions` | All action strings (`AXPress`, `AXIncrement`, `AXShowMenu`, …) |
| `AXNotifications` | All notification strings (`AXValueChanged`, `AXWindowCreated`, …) |
| `AXAttributes` | Common attribute strings (`AXValue`, `AXFrame`, `AXSelectedText`, …) |

## Common AX Roles

| Role | Description |
|------|-------------|
| `AXWindow` | Window |
| `AXButton` | Button |
| `AXTextField` | Single-line text field |
| `AXTextArea` | Multi-line text area |
| `AXStaticText` | Static label text |
| `AXCheckBox` | Checkbox |
| `AXRadioButton` | Radio button |
| `AXSlider` | Slider control |
| `AXGroup` | Group container |
| `AXMenuBar` | Menu bar |
| `AXMenuItem` | Menu item |
| `AXToolbar` | Toolbar |
| `AXScrollArea` | Scroll area |
| `AXWebArea` | Browser web content root |
| `AXTable` | Table |
| `AXList` | List |

## Common AX Actions

| Action | Description |
|--------|-------------|
| `AXPress` | Press a button or clickable element |
| `AXConfirm` | Confirm a dialog |
| `AXCancel` | Cancel a dialog |
| `AXRaise` | Bring a window to front |
| `AXIncrement` | Increment a slider/stepper |
| `AXDecrement` | Decrement a slider/stepper |
| `AXShowMenu` | Show context menu |

## Architecture

The module is structured in 6 layers:

1. **Framework Loading** — lazy `CDLL` initialization for ApplicationServices and CoreFoundation
2. **CoreFoundation Helpers** — CFString creation/reading, `CFRelease`, type detection (`CFGetTypeID`), `cfStringArrayToJs()`
3. **Function Bindings** — 17 CoreFoundation + 20 ApplicationServices C functions
4. **Type Conversion** — `cfToJs()` dispatches by CF type ID; `axValueToJs()` decodes `AXValueRef` structs (CGRect/CGPoint/CGSize/CFRange) via `AXValueGetValue`; `jsToAXValue()` creates `AXValueRef` from JS geometry objects via `AXValueCreate`
5. **JS Wrapper Classes** — `AXElement`, `AXApplication`, `AXSystem`
6. **Exported Constants** — `AXRoles`, `AXSubroles`, `AXActions`, `AXNotifications`, `AXAttributes`

### Key Design Decisions

- **kAX\* constants** are `#define` macros (not exported symbols) — created at runtime via `CFStringCreateWithCString` and cached
- **All CF types** treated as `c_void_p` (opaque pointers) for FFI
- **Memory management**: `CFRetain` child elements before releasing parent arrays; `try/finally` for `CFRelease`
- **Type auto-detection**: `cfToJs()` uses `CFGetTypeID` to convert CFString → string, CFBoolean → boolean, CFNumber → number, CFArray → array, AXValueRef → geometry object
- **`kAXErrorCannotComplete`** is treated as a soft fail (returns `null`) — it occurs when an element is temporarily unavailable (app in background, no focused element, etc.)
- **Browser traversal**: `_findWebArea()` uses a `Set<bigint>` to guard against cycles and checks `AXChildrenInNavigationOrder` when `AXChildren` is empty

## AXError Codes

| Code | Name | Notes |
|------|------|-------|
| 0 | kAXErrorSuccess | |
| -25200 | kAXErrorFailure | Treated as soft fail in `getAttribute` |
| -25201 | kAXErrorIllegalArgument | |
| -25202 | kAXErrorInvalidUIElement | |
| -25204 | kAXErrorCannotComplete | Treated as soft fail in `getAttribute` |
| -25205 | kAXErrorAttributeUnsupported | Treated as soft fail in `getAttribute` |
| -25206 | kAXErrorActionUnsupported | |
| -25211 | kAXErrorAPIDisabled | |
| -25212 | kAXErrorNoValue | Treated as soft fail in `getAttribute` |

---

## Roadmap

Comparison with Microsoft UI Automation (UIA) highlights what is currently missing.
The items below are planned in rough priority order.

### High priority

#### AXObserver — Event / notification system

The biggest gap vs UIA. UIA exposes `AddAutomationEventHandler`, `AddPropertyChangedEventHandler`, and `AddStructureChangedEventHandler`. The macOS equivalent is `AXObserver`, which allows subscribing to events like `AXValueChanged`, `AXFocusedUIElementChanged`, `AXWindowCreated`, `AXTitleChanged`, etc.

Planned API:

```javascript
// Subscribe to events on an element
const observer = app.createObserver((element, notification) => {
  console.log(`${notification} on ${element.role}: ${element.value}`);
});
observer.addNotification(textField, "AXValueChanged");
observer.addNotification(win, "AXFocusedUIElementChanged");
observer.start(); // integrates with CFRunLoop

// Cleanup
observer.stop();
observer.dispose();
```

Requires: `AXObserverCreate`, `AXObserverAddNotification`, `AXObserverRemoveNotification`, `AXObserverGetRunLoopSource`, and `CFRunLoopAddSource` / `CFRunLoopRun` FFI bindings.

---

### Medium priority

#### OR / NOT logic in `findChild` / `findChildren`

Currently all criteria in `findChild({ ... })` are combined with AND. UIA has composable `Condition` objects (`AndCondition`, `OrCondition`, `NotCondition`).

Planned API:

```javascript
import { or, not } from "./accessibility/accessibility.js";

// Find first element that is AXTextField OR AXTextArea
win.findChild(or({ role: "AXTextField" }, { role: "AXTextArea" }));

// Find enabled buttons only
win.findChildren({ role: "AXButton", ...not({ enabled: false }) });
```

#### ScrollIntoView / ScrollPattern

UIA has `ScrollItemPattern.ScrollIntoView()`. The AX API exposes `AXScrollToVisible` as an action on elements and scroll-related attributes (`AXScrollBar`, `AXHorizontalScrollBar`, `AXVerticalScrollBar`, `AXContents`).

Planned additions:
- `element.scrollIntoView()` — performs `AXScrollToVisible`
- `element.getScrollBars()` — returns horizontal/vertical scroll bar elements
- `setAttribute("AXScrollPosition", { x, y })` support

---

### Low priority

#### TextRange — structured text manipulation

UIA's `TextPattern` with `TextRange` provides: precise selection of character/word/line ranges, finding text, per-character attribute inspection. The AX API has the raw building blocks (`AXSelectedTextRange`, `AXStringForRange`, `AXBoundsForRange`, `AXLineForIndex`, etc.) but they are not yet wrapped in a convenient `TextRange` class.

Planned API:

```javascript
const textPattern = element.getTextPattern();
const range = textPattern.rangeFromString("Hello"); // finds "Hello" in the text
range.select();
console.log(range.getText());
console.log(range.getBounds()); // { x, y, width, height }
```

#### Property caching (CacheRequest)

UIA's `CacheRequest` batches multiple property reads in a single cross-process round-trip. Each `getAttribute()` call currently makes a separate IPC call. For tree traversal over large UIs, this can be slow.

A future `AXElement.snapshot(attrs)` method could pre-fetch a set of attributes at once by reading all named attributes in a loop before returning, reducing the number of round-trips for known-access patterns.
