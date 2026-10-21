---
title: Registry
---

# Windows Registry

A small registry API on `advapi32.dll`: read and write string and DWORD values, open and delete keys. Failures are raised by an `errcheck` on the `LSTATUS` results.

**Platform:** Windows · **Library:** [registry.js](registry.js) · **Used by:** [../tray/tray.js](../tray/tray.js) (dark mode detection)

## Run

```bash
node examples/windows/registry/demo_registry.js
```

The demo writes and then deletes `HKEY_CURRENT_USER\Software\node_ctypes_demo`.

## Use the library

```javascript
import { Registry, HKEY } from "./registry.js";

Registry.setValue(HKEY.CURRENT_USER, "Software\\myapp", "Name", "Hello");
console.log(Registry.getValue(HKEY.CURRENT_USER, "Software\\myapp", "Name")); // "Hello"

const key = Registry.openKey(HKEY.CURRENT_USER, "Software\\myapp", { write: true });
key.setDword("Count", 123);
console.log(key.getDword("Count")); // 123
key.close();
Registry.deleteKey(HKEY.CURRENT_USER, "Software\\myapp");
```

## node-ctypes features used

`wintypes` pointer types (`LPDWORD`, `PHKEY`, `LPBYTE` = `POINTER(T)`) · `DWORD()` / `HKEY()` instances with `byref()` and `.value`, as in Python · `cast(buffer, LPBYTE)` · `errcheck` · `create_unicode_buffer().value`
