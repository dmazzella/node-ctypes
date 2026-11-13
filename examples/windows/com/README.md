---
title: COM automation
---

# COM Automation (comtypes)

A small port of Python's comtypes: COM interfaces declared with `STDMETHOD`, vtable dispatch through `WINFUNCTYPE`, `CoCreateInstance`, `QueryInterface` and HRESULT errors raised automatically.

**Platform:** Windows · **Library:** [comtypes.js](comtypes.js), interfaces in `interfaces/`, Active Directory searches in [ads.js](ads.js) · **Requires:** for Active Directory, a domain-joined machine (or `--base` / `--host` / `--user` / `--pass`)

## Run

```bash
# Create a .lnk shortcut to notepad.exe with IShellLinkW + IPersistFile, then read it back
node examples/windows/com/demo_com_shortcut.js

# Search Active Directory with ADsOpenObject + IDirectorySearch
node examples/windows/com/demo_com_active_directory.js
node examples/windows/com/demo_com_active_directory.js --base "LDAP://DC=contoso,DC=com" --filter "(objectClass=user)" --attributes "sAMAccountName,mail" --tree

# Browse Active Directory in a window: tree, objects, attributes, search
node examples/windows/com/demo_com_active_directory_explorer.js
node examples/windows/com/demo_com_active_directory_explorer.js --host dc01.contoso.com --user admin --pass secret --domain CONTOSO
```

| Option (Active Directory)             | Description                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `--base <path>`                       | LDAP base path (default: `USERDNSDOMAIN`, or the DNS domain of the computer) |
| `--user <name>` / `--pass <password>` | Explicit credentials                                                         |
| `--filter <filter>`                   | LDAP filter (default: users)                                                 |
| `--scope base\|onelevel\|subtree`     | Search scope                                                                 |
| `--attributes a,b,c`                  | Attributes to read                                                           |
| `--page-size <n>`                     | Page size                                                                    |
| `--tree`                              | Group results by OU path                                                     |
| `--debug`                             | Print the results                                                            |

The Active Directory demos use [ads.js](ads.js); the search demo also reuses the tree helpers of [../ldap/ldap.js](../ldap/ldap.js).

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

Active Directory searches with [ads.js](ads.js), same arguments and result shape as [../ldap/ldap.js](../ldap/ldap.js) (attribute name → array of values):

```javascript
import { Ads, SCOPE } from "./ads.js";

const users = Ads.search("(&(objectClass=user)(objectCategory=person))", "LDAP://DC=corp,DC=example,DC=com", SCOPE.SUBTREE, ["cn", "mail", "objectSid"]);
console.log(users[0].cn, users[0].objectSid); // ["Alice"] ["S-1-5-21-…"]
Ads.close();
```

Values are typed by ADSI (`ADS_SEARCH_COLUMN.dwADsType`): strings, signed integers, booleans, large integers (`bigint`, ISO dates for the FILETIME attributes such as `pwdLastSet`), UTC times, octet strings (`Buffer`; SIDs and GUIDs as strings). Sessions are signed and sealed (`ADS_USE_SIGNING | ADS_USE_SEALING`), referrals are not chased, `maxObjects` stops the search early (`AbandonSearch`), and the first bound object stays open until `Ads.close()` so that ADSI reuses the connection.

`Ads.rootDse(["namingContexts", "configurationNamingContext"], server)` reads attributes of the RootDSE (the naming contexts of the server, its DNS name, ...): the RootDSE cannot be searched, so they are read one by one with `IADs::Get` (`interfaces/iads.js`), a `BSTR` name (`SysAllocString`) in and a `VARIANT` out (`VariantClear`); a multi-valued attribute such as `namingContexts` is a `SAFEARRAY` of `VARIANT`s (`SafeArrayGetElement`). Same result shape: attribute name → array of values.

`AdsWorker` runs the searches in a worker thread (with its own COM apartment), so that the calling thread never waits on the network: `await worker.searchAsync(...)` in a Node.js program. A thread running a Win32 message loop, where the Node.js event loop does not turn, creates it with `{ notify: { hwnd, message } }`: the worker posts that window message after each reply, and the window procedure takes the replies with `worker.take()` (`receiveMessageOnPort`). COM errors carry the method and the system message (`COM error 0x8007203E in IDirectorySearch::GetNextRow: The search filter cannot be recognized`).

## Active Directory Explorer

[demo_com_active_directory_explorer.js](demo_com_active_directory_explorer.js) is a Win32 browser of Active Directory: the domain as a tree of containers, the objects of the selected container, every attribute of the selected object, and a search box. The directory is read with [ads.js](ads.js); the domain is `USERDNSDOMAIN`, or the DNS domain of the computer, unless `--base` gives it. It only reads the directory.

- **Tree:** the domain and its containers (organizational units, containers, builtin domain), read when a node is expanded. Selecting one lists its objects and shows its attributes.
- **Base DN:** the list above the search box has the naming contexts of the server (RootDSE `namingContexts`): domain, configuration, schema, domain and forest DNS zones; choosing one browses it (Ctrl+O opens the list). The partitions are separate: a search in the domain does not enter the configuration, where the public key services are (certification authorities, enrollment services, certificate templates) — choose Configuration to search there, e.g. `(objectClass=pKIEnrollmentService)`.
- **Objects:** name, type, description and location, containers first; click a column to sort. Selecting an object shows its attributes; double-clicking a container opens it.
- **Attributes:** every attribute, one row per value, decoded by type (SIDs, GUIDs, dates, booleans, binary data). Double-click a distinguished name (`member`, `memberOf`, `manager`, `directReports`, ...) to open that object: the tree expands down to its container and selects it. A DN in another naming context (`objectCategory`: the schema) switches the base DN first.
- **Search:** in the selected container and below. Text uses Ambiguous Name Resolution (`(anr=...)`: name, account, display name, first and last name, Exchange addresses), plus the e-mail address and the user principal name, which ANR does not cover (`(mail=text*)`, `(userPrincipalName=text*)`); text starting with `(` is an LDAP filter, e.g. `(&(objectClass=computer)(operatingSystem=*Server*))`. Up to 2000 results in the list; when there are more, the tree locates all of them (up to 50000), read again with their distinguished names only. The tree shows where they are: it expands down to every container with results (one level read at a time, up to 200 containers), the containers with results below them are bold, with their number (`TVIS_BOLD`, "Staff (12)"), and selecting a result expands the tree down to its container and highlights it (`TVGN_DROPHILITE`, the selection — the container searched — does not change). Emptying the search box ends the search: the marks go, the containers the search expanded collapse again (those expanded by hand stay open), and the list shows the selected container.
- **Context menus:** open, copy a distinguished name or a value (clipboard), refresh.
- **Keys:** Ctrl+O base DN, Ctrl+F search, Enter run the search, F5 refresh, Alt+Up parent container, Tab between the panes. Drag the splitters to resize the panes.

Disabled accounts have the disabled icon (`userAccountControl` flag `ACCOUNTDISABLE`).

- **Icons:** `DsGetIcon` (dsuiext.dll) returns the icon of each Active Directory class, normal, open or disabled, as "Active Directory Users and Computers" shows them; they are collected in one image list (`ImageList_Create`, `ImageList_ReplaceIcon`) at the small-icon size of the window's DPI.
- **Panes:** a TreeView read lazily (`TVN_ITEMEXPANDINGW`) and two virtual ListViews (`LVS_OWNERDATA`): only the item counts are sent, the visible cells are written into the list view's own buffers on `LVN_GETDISPINFOW`.
- **Loading:** the searches run in an `AdsWorker`, so the window never blocks. While a pane loads it shows skeleton rows — rounded gray bars with a wave of brightness, drawn with `NM_CUSTOMDRAW` (`CDRF_SKIPDEFAULT`) — and an expanding tree node shows a skeleton child. A load shorter than 150 ms keeps the previous content instead of flashing a skeleton; replies that arrive late (another container or search selected meanwhile) are dropped.
- **Window:** Common Controls 6 visual styles (activation context), per-monitor DPI, the Explorer theme on the tree and lists, splitters (`SetCapture`, resize cursors), title bar following the light / dark setting.
- **Clipboard:** `CF_UNICODETEXT` in `GlobalAlloc` memory handed to `SetClipboardData`.

## node-ctypes features used

`WINFUNCTYPE(...)(address)` for vtable methods · `cast(ptr, POINTER(POINTER(c_void_p)))` to read the vtable · `OleDLL` + `HRESULT` · `errcheck` · `Structure` / `Union` (`GUID`, `ADSVALUE`, `VARIANT`) · `BSTR` as a raw pointer (`SysAllocString`, `SysStringLen`, `wstring_at(ptr, length)`) · arrays of structures · `POINTER(T)` fields · `byref()` output parameters · `create_unicode_buffer().value` · in the explorer: a `WINFUNCTYPE` window procedure · notification structures read with `cast(lParam, POINTER(NMHDR)).contents` and written back through the same view (`NMLVDISPINFOW`, `MINMAXINFO`) · `memmove` into buffers owned by Windows (list cells, clipboard) · `TVINSERTSTRUCTW` with negative pseudo-handles (`TVI_ROOT`, `TVI_LAST`) as `c_ssize_t` · an array of `ACCEL` for the accelerator table · typed prototypes for the same export (`WINFUNCTYPE(...)(["SendMessageW", user32])`) · `use_last_error` with `WinError(get_last_error())`
