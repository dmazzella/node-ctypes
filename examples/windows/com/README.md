---
title: COM automation
---

# COM Automation (comtypes)

A small port of Python's comtypes: COM interfaces declared with `STDMETHOD`, vtable dispatch through `WINFUNCTYPE`, `CoCreateInstance`, `QueryInterface` and HRESULT errors raised automatically.

**Platform:** Windows · **Library:** [comtypes.js](comtypes.js), interfaces in `interfaces/` · **Requires:** for Active Directory, a domain-joined machine (or `--base` / `--user` / `--pass`)

## Run

```bash
# Create a .lnk shortcut to notepad.exe with IShellLinkW + IPersistFile, then read it back
node examples/windows/com/demo_com_shortcut.js

# Search Active Directory with ADsOpenObject + IDirectorySearch
node examples/windows/com/demo_com_active_directory.js
node examples/windows/com/demo_com_active_directory.js --base "LDAP://DC=contoso,DC=com" --filter "(objectClass=user)" --attributes "sAMAccountName,mail" --tree
```

| Option (Active Directory)             | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `--base <path>`                       | LDAP base path (default: from `USERDNSDOMAIN`) |
| `--user <name>` / `--pass <password>` | Explicit credentials                           |
| `--filter <filter>`                   | LDAP filter (default: users)                   |
| `--scope base\|onelevel\|subtree`     | Search scope                                   |
| `--attributes a,b,c`                  | Attributes to read                             |
| `--page-size <n>`                     | Page size                                      |
| `--tree`                              | Group results by OU path                       |
| `--debug`                             | Print the results                              |

The Active Directory demo reuses the tree helpers of [../ldap/ldap.js](../ldap/ldap.js).

## Use the library

```javascript
import { CoInitializeEx, CoUninitialize, CoCreateInstance } from "./comtypes.js";
import { IShellLinkW, CLSID_ShellLink } from "./interfaces/shelllink.js";
import { IPersistFile } from "./interfaces/persist.js";

CoInitializeEx();
const shellLink = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
shellLink.SetPath("C:\\Windows\\notepad.exe");
shellLink.SetDescription("My shortcut");
const persistFile = shellLink.QueryInterface(IPersistFile);
persistFile.Save("C:\\Temp\\notepad.lnk", 1);
persistFile.Release();
shellLink.Release();
CoUninitialize();
```

## node-ctypes features used

`WINFUNCTYPE(...)(address)` for vtable methods · `cast(ptr, POINTER(POINTER(c_void_p)))` to read the vtable · `OleDLL` + `HRESULT` · `errcheck` · `Structure` / `Union` (`GUID`, `ADSVALUE`) · arrays of structures · `POINTER(T)` fields · `byref()` output parameters · `create_unicode_buffer().value`
