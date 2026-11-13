// IADs interface definitions for comtypes
//
// References:
//   https://learn.microsoft.com/en-us/windows/win32/api/iads/nn-iads-iads

import { wintypes } from "node-ctypes";
const { LONG, LPVOID } = wintypes;
import { COMInterface, STDMETHOD, HRESULT, IDispatch } from "../comtypes.js";

// ═══════════════════════════════════════════════════════════════════════
// IADs — the properties of one directory object (e.g. the RootDSE)
// ═══════════════════════════════════════════════════════════════════════
// vtable: IDispatch (7) + 13 own methods = 20 slots
//
// BSTR arguments are real BSTRs (SysAllocString): IADs reads their length
// prefix. VARIANT* arguments point to a VARIANT (16 bytes, 24 on 64-bit).

export const IADs = COMInterface({
  name: "IADs",
  iid: "{FD8256D0-FD15-11CE-ABC4-02608C9E7553}",
  extends: IDispatch,
  methods: [
    // slots 7–12: get_Name, get_Class, get_GUID, get_ADsPath, get_Parent, get_Schema (BSTR*)
    STDMETHOD(HRESULT, "get_Name", [LPVOID]),
    STDMETHOD(HRESULT, "get_Class", [LPVOID]),
    STDMETHOD(HRESULT, "get_GUID", [LPVOID]),
    STDMETHOD(HRESULT, "get_ADsPath", [LPVOID]),
    STDMETHOD(HRESULT, "get_Parent", [LPVOID]),
    STDMETHOD(HRESULT, "get_Schema", [LPVOID]),
    // slot 13: GetInfo() — load the property cache
    STDMETHOD(HRESULT, "GetInfo"),
    // slot 14: SetInfo() — write the property cache
    STDMETHOD(HRESULT, "SetInfo"),
    // slot 15: Get(BSTR bstrName, VARIANT* pvProp)
    STDMETHOD(HRESULT, "Get", [LPVOID, LPVOID]),
    // slot 16: Put(BSTR bstrName, VARIANT vProp) — a VARIANT by value is passed by address on x64
    STDMETHOD(HRESULT, "Put", [LPVOID, LPVOID]),
    // slot 17: GetEx(BSTR bstrName, VARIANT* pvProp)
    STDMETHOD(HRESULT, "GetEx", [LPVOID, LPVOID]),
    // slot 18: PutEx(LONG lnControlCode, BSTR bstrName, VARIANT vProp)
    STDMETHOD(HRESULT, "PutEx", [LONG, LPVOID, LPVOID]),
    // slot 19: GetInfoEx(VARIANT vProperties, LONG lnReserved)
    STDMETHOD(HRESULT, "GetInfoEx", [LPVOID, LONG]),
  ],
});

// E_ADS_PROPERTY_NOT_FOUND — IADs::Get of a property the object does not have
export const E_ADS_PROPERTY_NOT_FOUND = 0x8000500d | 0;
