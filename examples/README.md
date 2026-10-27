---
title: Examples
children:
  - ./cross-platform/electron-app/README.md
  - ./cross-platform/python/README.md
  - ./cross-platform/smartcard/README.md
  - ./cross-platform/cryptoki/README.md
  - ./macos/accessibility/README.md
  - ./windows/com/README.md
  - ./windows/controls/README.md
  - ./windows/ldap/README.md
  - ./windows/registry/README.md
  - ./windows/tray/README.md
---

# Examples

Real-world programs built with node-ctypes, written in the style of Python ctypes code. Most folders hold a reusable library, `demo_*.js` scripts and a README; the Electron example is a complete React desktop application.

| Example                                                   | Platforms                                                 | What it shows                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Electron + React](cross-platform/electron-app/README.md) | macOS and Windows verified; Linux implementation included | Native system clock and process ID, typed sandboxed IPC, automatic synchronized native-memory mirrors, and ASAR packaging without an Electron-specific addon rebuild                                                                                |
| [Embedded Python](cross-platform/python/README.md)        | Windows, macOS, Linux                                     | CPython loaded through its C API: code, modules and packages, callbacks, JavaScript objects by reference, shared memory with typed arrays and numpy, Temporal dates, threads, workers, asyncio, async iterators and cancellation in both directions |
| [Smart card (PC/SC)](cross-platform/smartcard/README.md)  | Windows, macOS, Linux                                     | Reader enumeration, card connection, ATR and APDU exchange (`winscard`, `PCSC.framework`, `libpcsclite`)                                                                                                                                            |
| [Cryptoki (PKCS #11)](cross-platform/cryptoki/README.md) | Windows verified; macOS ARM64 build included | Python-shaped PKCS #11 2.40-3.2 binding; temporary SoftHSM token, login, RSA, ECDSA, AES and SHA-256 |
| [Accessibility](macos/accessibility/README.md)            | macOS                                                     | UI automation with the Accessibility API: find elements, read and set values, press buttons, browser content                                                                                                                                        |
| [COM automation](windows/com/README.md)                   | Windows                                                   | comtypes-like vtable dispatch: shell shortcuts (`IShellLinkW`) and Active Directory (`IDirectorySearch`)                                                                                                                                            |
| [Controls](windows/controls/README.md)                    | Windows                                                   | A window with the common Win32 controls and a message loop                                                                                                                                                                                          |
| [LDAP](windows/ldap/README.md)                            | Windows                                                   | Directory queries and changes with `wldap32` (paged search, schema-aware values)                                                                                                                                                                    |
| [Registry](windows/registry/README.md)                    | Windows                                                   | Read and write registry keys and values with `advapi32`                                                                                                                                                                                             |
| [System tray](windows/tray/README.md)                     | Windows                                                   | Tray icon with a Fluent-style popup menu drawn with GDI                                                                                                                                                                                             |

## Running

The examples import `node-ctypes` by name. From a clone of this repository, build it once and run them from the repository root:

```bash
npm install && npm run build
node examples/cross-platform/python/demo_python_basics.js
```

From your own project, `npm install node-ctypes` and copy the example folder.
The [Electron app](cross-platform/electron-app/README.md) has its own install/dev/build commands
and uses the local checkout as a linked dependency.

For the basics of the API (functions, structures, pointers, callbacks), see the [Quick start](../README.md#quick-start) and the guides of the main README.
