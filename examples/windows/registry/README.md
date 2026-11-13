---
title: Registry
---

# Windows Registry

A small registry API on `advapi32.dll`: read and write values of every common type, open, create and delete keys. Failures are raised as `WinError` by an `errcheck` on the `LSTATUS` results, as Python's `OSError`.

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
Registry.deleteKey(HKEY.CURRENT_USER, "Software\\myapp", { recursive: true }); // with its subkeys
```

Values are converted by type, in both directions:

| Registry type   | JavaScript                                      |
| --------------- | ----------------------------------------------- |
| `REG_SZ`        | string                                          |
| `REG_EXPAND_SZ` | string, with the environment variables expanded |
| `REG_DWORD`     | number                                          |
| `REG_QWORD`     | bigint                                          |
| `REG_MULTI_SZ`  | array of strings                                |
| `REG_BINARY`    | Buffer (also other types when read)             |

`getValue` returns `undefined` for a missing value; `openKey` throws `WinError` 2 for a missing key (unless `{ create: true }`), `deleteValue` and `deleteKey` return `false`. A value that grows between the size query and the read is read again. The `HKEY` root keys are the SDK's sign-extended pseudo-handles (`BigInt`).

## node-ctypes features used

`wintypes` pointer types (`LPDWORD`, `PHKEY` = `POINTER(T)`) · `DWORD()` / `HKEY()` instances with `byref()` and `.value`, as in Python · `Buffer` and `create_unicode_buffer()` passed as `void*` data · `errcheck` raising `WinError(code)`
