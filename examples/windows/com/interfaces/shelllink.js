// IShellLinkW and IPersistFile interface definitions for comtypes
//
// References:
//   https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
//   https://learn.microsoft.com/en-us/windows/win32/api/objidl/nn-objidl-ipersistfile

import { wintypes } from "node-ctypes";
const { INT, DWORD, LPVOID, LPCWSTR } = wintypes;
import { COMInterface, STDMETHOD, HRESULT, IUnknown } from "../comtypes.js";

// Re-export IPersist/IPersistFile from their dedicated module for convenience
// when importing everything shell-link-related from a single entry point.
export { IPersist, IPersistFile } from "./persist.js";

// ═══════════════════════════════════════════════════════════════════════
// IShellLinkW — Shell Link (Unicode)
// ═══════════════════════════════════════════════════════════════════════
// vtable: IUnknown (3) + 18 own methods = 21 slots

export const IShellLinkW = COMInterface({
  name: "IShellLinkW",
  iid: "{000214F9-0000-0000-C000-000000000046}",
  extends: IUnknown,
  methods: [
    // slot 3: GetPath(pszFile, cch, pfd, fFlags)
    STDMETHOD(HRESULT, "GetPath", [LPCWSTR, INT, LPVOID, DWORD]),
    // slot 4: GetIDList(ppidl)
    STDMETHOD(HRESULT, "GetIDList", [LPVOID]),
    // slot 5: SetIDList(pidl)
    STDMETHOD(HRESULT, "SetIDList", [LPVOID]),
    // slot 6: GetDescription(pszName, cch)
    STDMETHOD(HRESULT, "GetDescription", [LPVOID, INT]),
    // slot 7: SetDescription(pszName)
    STDMETHOD(HRESULT, "SetDescription", [LPCWSTR]),
    // slot 8: GetWorkingDirectory(pszDir, cch)
    STDMETHOD(HRESULT, "GetWorkingDirectory", [LPVOID, INT]),
    // slot 9: SetWorkingDirectory(pszDir)
    STDMETHOD(HRESULT, "SetWorkingDirectory", [LPCWSTR]),
    // slot 10: GetArguments(pszArgs, cch)
    STDMETHOD(HRESULT, "GetArguments", [LPVOID, INT]),
    // slot 11: SetArguments(pszArgs)
    STDMETHOD(HRESULT, "SetArguments", [LPCWSTR]),
    // slot 12: GetHotkey(pwHotkey)
    STDMETHOD(HRESULT, "GetHotkey", [LPVOID]),
    // slot 13: SetHotkey(wHotkey)
    STDMETHOD(HRESULT, "SetHotkey", [DWORD]),
    // slot 14: GetShowCmd(piShowCmd)
    STDMETHOD(HRESULT, "GetShowCmd", [LPVOID]),
    // slot 15: SetShowCmd(iShowCmd)
    STDMETHOD(HRESULT, "SetShowCmd", [INT]),
    // slot 16: GetIconLocation(pszIconPath, cch, piIcon)
    STDMETHOD(HRESULT, "GetIconLocation", [LPVOID, INT, LPVOID]),
    // slot 17: SetIconLocation(pszIconPath, iIcon)
    STDMETHOD(HRESULT, "SetIconLocation", [LPCWSTR, INT]),
    // slot 18: SetRelativePath(pszPathRel, dwReserved)
    STDMETHOD(HRESULT, "SetRelativePath", [LPCWSTR, DWORD]),
    // slot 19: Resolve(hwnd, fFlags)
    STDMETHOD(HRESULT, "Resolve", [LPVOID, DWORD]),
    // slot 20: SetPath(pszFile)
    STDMETHOD(HRESULT, "SetPath", [LPCWSTR]),
  ],
});

// CLSID_ShellLink
export const CLSID_ShellLink = "{00021401-0000-0000-C000-000000000046}";

// Flags for GetPath
export const SLGP_SHORTPATH = 0x1;
export const SLGP_UNCPRIORITY = 0x2;
export const SLGP_RAWPATH = 0x4;
