---
title: Examples
children:
  - ./cross-platform/python/README.md
  - ./cross-platform/smartcard/README.md
  - ./macos/accessibility/README.md
  - ./windows/com/README.md
  - ./windows/controls/README.md
  - ./windows/ldap/README.md
  - ./windows/registry/README.md
  - ./windows/tray/README.md
---

# Examples

Real-world programs built with node-ctypes, written in the style of Python ctypes code. Each folder holds an example: its reusable library, one or more `demo_*.js` scripts and a README.

| Example                                                  | Platforms             | What it shows                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Embedded Python](cross-platform/python/README.md)       | Windows, macOS, Linux | CPython loaded through its C API: code, modules and packages, callbacks, JavaScript objects by reference, shared memory with typed arrays and numpy, Temporal dates, threads, workers, asyncio, async iterators and cancellation in both directions |
| [Smart card (PC/SC)](cross-platform/smartcard/README.md) | Windows, macOS, Linux | Reader enumeration, card connection, ATR and APDU exchange (`winscard`, `PCSC.framework`, `libpcsclite`)                                                                                                                                            |
| [Accessibility](macos/accessibility/README.md)           | macOS                 | UI automation with the Accessibility API: find elements, read and set values, press buttons, browser content                                                                                                                                        |
| [COM automation](windows/com/README.md)                  | Windows               | comtypes-like vtable dispatch: shell shortcuts (`IShellLinkW`) and Active Directory (`IDirectorySearch`)                                                                                                                                            |
| [Controls](windows/controls/README.md)                   | Windows               | A window with the common Win32 controls and a message loop                                                                                                                                                                                          |
| [LDAP](windows/ldap/README.md)                           | Windows               | Directory queries and changes with `wldap32` (paged search, schema-aware values)                                                                                                                                                                    |
| [Registry](windows/registry/README.md)                   | Windows               | Read and write registry keys and values with `advapi32`                                                                                                                                                                                             |
| [System tray](windows/tray/README.md)                    | Windows               | Tray icon with a Fluent-style popup menu drawn with GDI                                                                                                                                                                                             |

## Running

The examples import `node-ctypes` by name. From a clone of this repository, build it once and run them from the repository root:

```bash
npm install && npm run build
node examples/cross-platform/python/demo_python_basics.js
```

From your own project, `npm install node-ctypes` and copy the example folder.

For the basics of the API (functions, structures, pointers, callbacks), see the [Quick start](../README.md#quick-start) and the guides of the main README.
