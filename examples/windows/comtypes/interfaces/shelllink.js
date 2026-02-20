// IShellLinkW and IPersistFile interface definitions for comtypes
//
// References:
//   https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
//   https://learn.microsoft.com/en-us/windows/win32/api/objidl/nn-objidl-ipersistfile

import { c_int32, c_uint32, c_void_p, c_wchar_p } from "node-ctypes";
import { COMInterface, STDMETHOD, HRESULT, IUnknown, IPersist, IPersistFile } from "../comtypes.js";

// Re-export IPersistFile (already defined in comtypes.js since it's common)
export { IPersist, IPersistFile };

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
    STDMETHOD(HRESULT, "GetPath", [c_wchar_p, c_int32, c_void_p, c_uint32]),
    // slot 4: GetIDList(ppidl)
    STDMETHOD(HRESULT, "GetIDList", [c_void_p]),
    // slot 5: SetIDList(pidl)
    STDMETHOD(HRESULT, "SetIDList", [c_void_p]),
    // slot 6: GetDescription(pszName, cch)
    STDMETHOD(HRESULT, "GetDescription", [c_void_p, c_int32]),
    // slot 7: SetDescription(pszName)
    STDMETHOD(HRESULT, "SetDescription", [c_wchar_p]),
    // slot 8: GetWorkingDirectory(pszDir, cch)
    STDMETHOD(HRESULT, "GetWorkingDirectory", [c_void_p, c_int32]),
    // slot 9: SetWorkingDirectory(pszDir)
    STDMETHOD(HRESULT, "SetWorkingDirectory", [c_wchar_p]),
    // slot 10: GetArguments(pszArgs, cch)
    STDMETHOD(HRESULT, "GetArguments", [c_void_p, c_int32]),
    // slot 11: SetArguments(pszArgs)
    STDMETHOD(HRESULT, "SetArguments", [c_wchar_p]),
    // slot 12: GetHotkey(pwHotkey)
    STDMETHOD(HRESULT, "GetHotkey", [c_void_p]),
    // slot 13: SetHotkey(wHotkey)
    STDMETHOD(HRESULT, "SetHotkey", [c_uint32]),
    // slot 14: GetShowCmd(piShowCmd)
    STDMETHOD(HRESULT, "GetShowCmd", [c_void_p]),
    // slot 15: SetShowCmd(iShowCmd)
    STDMETHOD(HRESULT, "SetShowCmd", [c_int32]),
    // slot 16: GetIconLocation(pszIconPath, cch, piIcon)
    STDMETHOD(HRESULT, "GetIconLocation", [c_void_p, c_int32, c_void_p]),
    // slot 17: SetIconLocation(pszIconPath, iIcon)
    STDMETHOD(HRESULT, "SetIconLocation", [c_wchar_p, c_int32]),
    // slot 18: SetRelativePath(pszPathRel, dwReserved)
    STDMETHOD(HRESULT, "SetRelativePath", [c_wchar_p, c_uint32]),
    // slot 19: Resolve(hwnd, fFlags)
    STDMETHOD(HRESULT, "Resolve", [c_void_p, c_uint32]),
    // slot 20: SetPath(pszFile)
    STDMETHOD(HRESULT, "SetPath", [c_wchar_p]),
  ],
});

// CLSID_ShellLink
export const CLSID_ShellLink = "{00021401-0000-0000-C000-000000000046}";

// Flags for GetPath
export const SLGP_SHORTPATH = 0x1;
export const SLGP_UNCPRIORITY = 0x2;
export const SLGP_RAWPATH = 0x4;
