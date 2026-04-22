// IDirectorySearch interface definitions for comtypes
//
// References:
//   https://learn.microsoft.com/en-us/windows/win32/api/iads/nn-iads-idirectorysearch

import { DWORD, LPCWSTR, LPVOID, HANDLE } from "../../wintypes.js";
import { COMInterface, STDMETHOD, HRESULT, IUnknown, GUID } from "../comtypes.js";

export const IID_IDirectorySearch = new GUID("{109BA8EC-92F0-11D0-A790-00C04FD8D5A8}");

// ═══════════════════════════════════════════════════════════════════════
// IDirectorySearch — Active Directory search interface
// ═══════════════════════════════════════════════════════════════════════
// vtable: IUnknown (3) + 10 own methods = 13 slots
//
// ADS_SEARCH_HANDLE is `HANDLE` (void* pointer-sized). For `ExecuteSearch`,
// pass (DWORD)-1 (= 0xFFFFFFFF) as dwNumberAttributes to request all attributes.

export const IDirectorySearch = COMInterface({
  name: "IDirectorySearch",
  iid: "{109BA8EC-92F0-11D0-A790-00C04FD8D5A8}",
  extends: IUnknown,
  methods: [
    // slot 3: SetSearchPreference(PADS_SEARCHPREF_INFO, DWORD)
    STDMETHOD(HRESULT, "SetSearchPreference", [LPVOID, DWORD]),
    // slot 4: ExecuteSearch(LPWSTR, LPWSTR*, DWORD, PADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "ExecuteSearch", [LPCWSTR, LPVOID, DWORD, LPVOID]),
    // slot 5: AbandonSearch(ADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "AbandonSearch", [HANDLE]),
    // slot 6: GetFirstRow(ADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "GetFirstRow", [HANDLE]),
    // slot 7: GetNextRow(ADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "GetNextRow", [HANDLE]),
    // slot 8: GetPreviousRow(ADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "GetPreviousRow", [HANDLE]),
    // slot 9: GetNextColumnName(ADS_SEARCH_HANDLE, LPWSTR*)
    STDMETHOD(HRESULT, "GetNextColumnName", [HANDLE, LPVOID]),
    // slot 10: GetColumn(ADS_SEARCH_HANDLE, LPWSTR, PADS_SEARCH_COLUMN)
    STDMETHOD(HRESULT, "GetColumn", [HANDLE, LPCWSTR, LPVOID]),
    // slot 11: FreeColumn(PADS_SEARCH_COLUMN)
    STDMETHOD(HRESULT, "FreeColumn", [LPVOID]),
    // slot 12: CloseSearchHandle(ADS_SEARCH_HANDLE)
    STDMETHOD(HRESULT, "CloseSearchHandle", [HANDLE]),
  ],
});

// ═══════════════════════════════════════════════════════════════════════
// ADS_SEARCHPREF_ENUM — search preference identifiers
// ═══════════════════════════════════════════════════════════════════════

export const ADS_SEARCHPREF_ASYNCHRONOUS = 0;
export const ADS_SEARCHPREF_DEREF_ALIASES = 1;
export const ADS_SEARCHPREF_SIZE_LIMIT = 2;
export const ADS_SEARCHPREF_TIME_LIMIT = 3;
export const ADS_SEARCHPREF_ATTRIBTYPES_ONLY = 4;
export const ADS_SEARCHPREF_SEARCH_SCOPE = 5;
export const ADS_SEARCHPREF_TIMEOUT = 6;
export const ADS_SEARCHPREF_PAGESIZE = 7;
export const ADS_SEARCHPREF_PAGED_TIME_LIMIT = 8;
export const ADS_SEARCHPREF_CHASE_REFERRALS = 9;
export const ADS_SEARCHPREF_SORT_ON = 10;
export const ADS_SEARCHPREF_CACHE_RESULTS = 11;
export const ADS_SEARCHPREF_DIRSYNC = 12;
export const ADS_SEARCHPREF_TOMBSTONE = 13;

// ═══════════════════════════════════════════════════════════════════════
// ADS_SCOPEENUM — search scope values
// ═══════════════════════════════════════════════════════════════════════

export const ADS_SCOPE_BASE = 0;
export const ADS_SCOPE_ONELEVEL = 1;
export const ADS_SCOPE_SUBTREE = 2;

// ═══════════════════════════════════════════════════════════════════════
// ADS_CHASE_REFERRALS_ENUM
// ═══════════════════════════════════════════════════════════════════════

export const ADS_CHASE_REFERRALS_NEVER = 0;
export const ADS_CHASE_REFERRALS_SUBORDINATE = 0x20;
export const ADS_CHASE_REFERRALS_EXTERNAL = 0x40;
export const ADS_CHASE_REFERRALS_ALWAYS = ADS_CHASE_REFERRALS_SUBORDINATE | ADS_CHASE_REFERRALS_EXTERNAL;

// ═══════════════════════════════════════════════════════════════════════
// ADSTYPEENUM — column value types (for ADS_SEARCH_COLUMN.dwADsType)
// ═══════════════════════════════════════════════════════════════════════

export const ADSTYPE_INVALID = 0;
export const ADSTYPE_DN_STRING = 1;
export const ADSTYPE_CASE_EXACT_STRING = 2;
export const ADSTYPE_CASE_IGNORE_STRING = 3;
export const ADSTYPE_PRINTABLE_STRING = 4;
export const ADSTYPE_NUMERIC_STRING = 5;
export const ADSTYPE_BOOLEAN = 6;
export const ADSTYPE_INTEGER = 7;
export const ADSTYPE_OCTET_STRING = 8;
export const ADSTYPE_UTC_TIME = 9;
export const ADSTYPE_LARGE_INTEGER = 10;
export const ADSTYPE_TYPEDNAME = 11;
export const ADSTYPE_FAXNUMBER = 12;
export const ADSTYPE_PATH = 13;
export const ADSTYPE_OBJECT_CLASS = 14;
export const ADSTYPE_NT_SECURITY_DESCRIPTOR = 25;

// S_ADS_NOMORE_ROWS — returned by GetNextRow/GetFirstRow when no more rows
export const S_ADS_NOMORE_ROWS = 0x00005012;
// S_ADS_NOMORE_COLUMNS — returned by GetNextColumnName when no more columns
export const S_ADS_NOMORE_COLUMNS = 0x00005013;
