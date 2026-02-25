---
title: Examples
---

# Examples

Real-world examples demonstrating node-ctypes capabilities.

## Quick Start

### Call a C function

```javascript
import { CDLL, c_int } from 'node-ctypes';

const libc = new CDLL('libc.so.6');  // Linux
// const libc = new CDLL('msvcrt.dll');  // Windows
// const libc = new CDLL('libc.dylib');  // macOS

const abs_func = libc.abs;
abs_func.argtypes = [c_int];
abs_func.restype = c_int;
console.log(abs_func(-42));  // 42
```

### Define a struct

```javascript
import { Structure, c_int } from 'node-ctypes';

class Point extends Structure {
    static _fields_ = [["x", c_int], ["y", c_int]];
}

const p = new Point(10, 20);
console.log(p.x, p.y);  // 10 20
```

### Use pointers

```javascript
import { POINTER, pointer, c_int32 } from 'node-ctypes';

const x = new c_int32(42);
const p = pointer(x);
console.log(p.contents);  // 42

p.contents = 100;
console.log(x.value);  // 100
```

### Callbacks with qsort

```javascript
import { CDLL, callback, c_int32, c_void, c_void_p, c_size_t,
         readValue, writeValue, create_string_buffer } from 'node-ctypes';

const libc = new CDLL('msvcrt.dll');

const compare = callback(
    (a, b) => readValue(a, c_int32) - readValue(b, c_int32),
    c_int32, [c_void_p, c_void_p]
);

const qsort = libc.func('qsort', c_void, [c_void_p, c_size_t, c_size_t, c_void_p]);

const arr = create_string_buffer(5 * 4);
[5, 2, 8, 1, 9].forEach((v, i) => writeValue(arr, c_int32, v, i * 4));
qsort(arr, 5, 4, compare.pointer);

console.log(readValue(arr, c_int32, 0));  // 1 (sorted!)
compare.release();
```

### Variadic functions (sprintf)

```javascript
import { CDLL, c_int, c_void_p, c_char_p, string_at } from 'node-ctypes';

const libc = new CDLL('msvcrt.dll');
const sprintf = libc.func('sprintf', c_int, [c_void_p, c_char_p]);

const buf = Buffer.alloc(256);
sprintf(buf, 'Hello %s! %d', 'World', 42);
console.log(string_at(buf));  // "Hello World! 42"
```

---

## Windows API Examples

### Windows Controls Showcase

A GUI demo creating a window with common Win32 controls (buttons, checkboxes, listbox, combo box, progress bar, etc.) using `user32.dll` and `kernel32.dll`.

Source: [windows/demo_controls.js](windows/demo_controls.js)

```bash
node examples/windows/demo_controls.js
```

### Windows Registry

Read/write registry values using `advapi32.dll`. Demonstrates `RegOpenKeyExW`, `RegSetValueExW`, `RegQueryValueExW`, `RegDeleteValueW`, `RegDeleteKeyW`.

Source: [windows/demo_registry.js](windows/demo_registry.js) | Library: [windows/registry/registry.js](windows/registry/registry.js)

```javascript
import { Registry, HKEY } from "./registry/registry.js";

Registry.setValue(HKEY.CURRENT_USER, "Software\\myapp", "Name", "Hello");
const val = Registry.getValue(HKEY.CURRENT_USER, "Software\\myapp", "Name");
console.log(val);  // "Hello"
```

### System Tray

Create a system tray icon with context menu using `shell32.dll` and `user32.dll`. Inspired by [pit-ray/fluent-tray](https://github.com/pit-ray/fluent-tray).

Source: [windows/demo_tray.js](windows/demo_tray.js) | Library: [windows/tray/tray.js](windows/tray/tray.js)

```javascript
import { FluentTray } from "./tray/tray.js";

const tray = new FluentTray();
tray.create_tray("myapp", "icon.ico");
tray.add_menu("Home", "home.ico", false, () => { console.log("Home"); return true; });
tray.add_separator();
tray.add_menu("Exit", null, false, () => false);
tray.status();
```

### COM Automation (IShellLinkW)

Create Windows shortcuts (.lnk) through COM vtable dispatch using `WINFUNCTYPE`, `CoCreateInstance`, `IShellLinkW`, and `IPersistFile`.

Source: [windows/demo_comtypes.js](windows/demo_comtypes.js) | Library: [windows/comtypes/comtypes.js](windows/comtypes/comtypes.js)

```javascript
import { CoInitializeEx, CoCreateInstance } from "./comtypes/comtypes.js";
import { IShellLinkW, CLSID_ShellLink } from "./comtypes/interfaces/shelllink.js";

CoInitializeEx();
const shellLink = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
shellLink.SetPath("C:\\Windows\\notepad.exe");
shellLink.SetDescription("My shortcut");
// ... save via IPersistFile
```

### LDAP Directory Queries

Query Active Directory using `wldap32.dll`. Supports bind, search, modify, and tree display.

Source: [windows/demo_ldap.js](windows/demo_ldap.js) | Library: [windows/ldap/ldap.js](windows/ldap/ldap.js)

```bash
node examples/windows/demo_ldap.js
node examples/windows/demo_ldap.js --user admin --pass secret --domain EXAMPLE
```

---

## Cross-Platform Example

### Smart Card (PC/SC)

Interact with smart cards using the PC/SC API — `winscard.dll` on Windows, `libpcsclite` on macOS/Linux. Demonstrates context establishment, reader enumeration, card connection, and APDU exchange.

Source: [demo_scard.js](demo_scard.js) | Library: [scard.js](scard.js)

```javascript
import { establish_context, SCOPE_USER } from "./scard.js";

const context = establish_context(SCOPE_USER);
const readers = context.list_readers();
console.log("Readers:", readers);
```
