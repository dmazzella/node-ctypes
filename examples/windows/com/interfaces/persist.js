// IPersist and IPersistFile interface definitions for comtypes
//
// References:
//   https://learn.microsoft.com/en-us/windows/win32/api/objidl/nn-objidl-ipersist
//   https://learn.microsoft.com/en-us/windows/win32/api/objidl/nn-objidl-ipersistfile

import { wintypes } from "node-ctypes";
const { DWORD, LONG, LPVOID, LPCWSTR } = wintypes;
import { COMInterface, STDMETHOD, HRESULT, IUnknown, GUID } from "../comtypes.js";

export const IID_IPersist = new GUID("{0000010C-0000-0000-C000-000000000046}");
export const IID_IPersistFile = new GUID("{0000010B-0000-0000-C000-000000000046}");

export const IPersist = COMInterface({
  name: "IPersist",
  iid: "{0000010C-0000-0000-C000-000000000046}",
  extends: IUnknown,
  methods: [STDMETHOD(HRESULT, "GetClassID", [LPVOID])],
});

export const IPersistFile = COMInterface({
  name: "IPersistFile",
  iid: "{0000010B-0000-0000-C000-000000000046}",
  extends: IPersist,
  methods: [STDMETHOD(HRESULT, "IsDirty"), STDMETHOD(HRESULT, "Load", [LPCWSTR, DWORD]), STDMETHOD(HRESULT, "Save", [LPCWSTR, LONG]), STDMETHOD(HRESULT, "SaveCompleted", [LPCWSTR]), STDMETHOD(HRESULT, "GetCurFile", [LPVOID])],
});
