// ads — Active Directory searches through ADSI (COM) for node-ctypes
//
// ADsOpenObject binds an ADSI object for an LDAP path and returns its
// IDirectorySearch interface (vtable dispatch through ./comtypes.js);
// ExecuteSearch / GetNextRow / GetColumn read the results, already typed by
// ADSI (ADS_SEARCH_COLUMN.dwADsType): strings, integers, booleans, large
// integers, octet strings, UTC times.
//
// Usage:
//   import { Ads, SCOPE } from "./ads.js";
//
//   const users = Ads.search("(&(objectClass=user)(objectCategory=person))", "LDAP://DC=corp,DC=example,DC=com", SCOPE.SUBTREE, ["cn", "mail", "objectSid"]);
//   console.log(users[0].cn, users[0].objectSid); // arrays of values
//   Ads.close();
//
// Ads.rootDse(attributes) reads the RootDSE (namingContexts, ...) with IADs::Get.
//
// The results have the same shape as ../ldap/ldap.js: one object per entry,
// attribute name → array of values, distinguishedName always included.
//
// AdsWorker runs the searches in a worker thread (its own COM apartment), so
// that the calling thread is never blocked by the network:
//   const ads = new AdsWorker();
//   const users = await ads.searchAsync(filter, basePath, SCOPE.SUBTREE, ["cn"]);
// A thread running a Win32 message loop (no Node.js event loop meanwhile)
// passes { notify: { hwnd, message } }: the worker posts that window message
// after each reply, and the window procedure takes the replies with take().

import { Worker, MessageChannel, isMainThread, receiveMessageOnPort, workerData } from "node:worker_threads";
import { WinDLL, OleDLL, Structure, Union, POINTER, array, byref, memmove, create_string_buffer, create_unicode_buffer, wstring_at, c_void_p } from "node-ctypes";
import { wintypes } from "node-ctypes";
import { CoInitializeEx, CoUninitialize, COMPointer, HRESULT, SUCCEEDED } from "./comtypes.js";
import {
  IDirectorySearch,
  ADS_SEARCHPREF_PAGESIZE,
  ADS_SEARCHPREF_SEARCH_SCOPE,
  ADS_SEARCHPREF_SIZE_LIMIT,
  ADS_SEARCHPREF_CHASE_REFERRALS,
  ADS_SEARCHPREF_CACHE_RESULTS,
  ADS_SCOPE_BASE,
  ADS_SCOPE_ONELEVEL,
  ADS_SCOPE_SUBTREE,
  ADS_CHASE_REFERRALS_NEVER,
  ADSTYPE_INTEGER,
  ADSTYPE_BOOLEAN,
  ADSTYPE_DN_STRING,
  ADSTYPE_CASE_EXACT_STRING,
  ADSTYPE_CASE_IGNORE_STRING,
  ADSTYPE_PRINTABLE_STRING,
  ADSTYPE_NUMERIC_STRING,
  ADSTYPE_TYPEDNAME,
  ADSTYPE_FAXNUMBER,
  ADSTYPE_PATH,
  ADSTYPE_OBJECT_CLASS,
  ADSTYPE_OCTET_STRING,
  ADSTYPE_LARGE_INTEGER,
  ADSTYPE_UTC_TIME,
  ADSTYPE_NT_SECURITY_DESCRIPTOR,
  S_ADS_NOMORE_ROWS,
  S_ADS_NOMORE_COLUMNS,
} from "./interfaces/directorysearch.js";
import { IADs, E_ADS_PROPERTY_NOT_FOUND } from "./interfaces/iads.js";
const { BOOL, DWORD, HANDLE, INT, LONG, LONGLONG, LPBYTE, LPCWSTR, LPVOID, LPWSTR, PVOID, SHORT, UINT, WORD } = wintypes;

export const SCOPE = Object.freeze({
  BASE: ADS_SCOPE_BASE,
  ONELEVEL: ADS_SCOPE_ONELEVEL,
  SUBTREE: ADS_SCOPE_SUBTREE,
});

// ADS_AUTHENTICATION_ENUM: Kerberos / NTLM, with the session signed and sealed
// (as ../ldap/ldap.js does with LDAP_OPT_SIGN / LDAP_OPT_ENCRYPT); a server
// bind when the path names the server.
const ADS_SECURE_AUTHENTICATION = 0x1;
const ADS_USE_SIGNING = 0x40;
const ADS_USE_SEALING = 0x80;
const ADS_SERVER_BIND = 0x200;

// Large integers that are FILETIMEs (100-ns ticks since 1601-01-01).
const FILETIME_ATTRIBUTES = new Set(["accountexpires", "badpasswordtime", "lastlogon", "lastlogoff", "lastlogontimestamp", "lockouttime", "pwdlastset"]);
// Octet strings that are SIDs or GUIDs.
const SID_ATTRIBUTES = new Set(["objectsid", "sidhistory", "securityidentifier", "tokengroups"]);
const GUID_ATTRIBUTES = new Set(["objectguid", "schemaidguid", "attributesecurityguid"]);

// ─── Native libs ─────────────────────────────────────────────────────
// activeds is loaded via OleDLL so ADsOpenObject (HRESULT) auto-throws on
// failure — no manual checkHR needed at the call-site.

const activeds = new OleDLL("activeds.dll");
const advapi32 = new WinDLL("advapi32.dll");
const kernel32 = new WinDLL("kernel32.dll");
const ole32 = new WinDLL("ole32.dll");
const oleaut32 = new OleDLL("oleaut32.dll");

// HRESULT ADsOpenObject(LPCWSTR lpszPathName, LPCWSTR lpszUserName,
//                       LPCWSTR lpszPassword, DWORD dwReserved, REFIID riid,
//                       void** ppObject);
activeds.ADsOpenObject.argtypes = [LPCWSTR, LPCWSTR, LPCWSTR, DWORD, LPVOID, LPVOID];
activeds.ADsOpenObject.restype = HRESULT;

// BOOL FreeADsMem(void* pMem);
activeds.FreeADsMem.argtypes = [LPVOID];
activeds.FreeADsMem.restype = BOOL;

// BOOL ConvertSidToStringSidW(PSID Sid, LPWSTR* StringSid);
advapi32.ConvertSidToStringSidW.argtypes = [LPVOID, LPVOID];
advapi32.ConvertSidToStringSidW.restype = BOOL;

// HLOCAL LocalFree(HLOCAL hMem); — HLOCAL is a HANDLE alias.
kernel32.LocalFree.argtypes = [HANDLE];
kernel32.LocalFree.restype = HANDLE;

// int StringFromGUID2(REFGUID rguid, LPOLESTR lpsz, int cchMax);
ole32.StringFromGUID2.argtypes = [LPVOID, LPWSTR, INT];
ole32.StringFromGUID2.restype = INT;

// BSTR SysAllocString(const OLECHAR*); void SysFreeString(BSTR);
// UINT SysStringLen(BSTR); HRESULT VariantClear(VARIANTARG*);
// A BSTR is returned as a raw pointer: IADs reads its length prefix.
oleaut32.SysAllocString.argtypes = [LPCWSTR];
oleaut32.SysAllocString.restype = PVOID;
oleaut32.SysFreeString.argtypes = [PVOID];
oleaut32.SysFreeString.restype = null;
oleaut32.SysStringLen.argtypes = [PVOID];
oleaut32.SysStringLen.restype = UINT;
oleaut32.VariantClear.argtypes = [LPVOID];
oleaut32.VariantClear.restype = HRESULT;
// HRESULT SafeArrayGetLBound / SafeArrayGetUBound(SAFEARRAY*, UINT nDim, LONG*);
// HRESULT SafeArrayGetElement(SAFEARRAY*, LONG* rgIndices, void* pv);
oleaut32.SafeArrayGetLBound.argtypes = [PVOID, UINT, LPVOID];
oleaut32.SafeArrayGetLBound.restype = HRESULT;
oleaut32.SafeArrayGetUBound.argtypes = [PVOID, UINT, LPVOID];
oleaut32.SafeArrayGetUBound.restype = HRESULT;
oleaut32.SafeArrayGetElement.argtypes = [PVOID, LPVOID, LPVOID];
oleaut32.SafeArrayGetElement.restype = HRESULT;

// ─── ADSI structures (from Iads.h) ───────────────────────────────────
//
// ADSVALUE contains a union whose largest members are 16 bytes on x64
// (ADS_OCTET_STRING, SYSTEMTIME, ADS_PROV_SPECIFIC, ADS_EMAIL, ADS_HOLD,
// ADS_BACKLINK).

// typedef struct { DWORD dwLength; LPBYTE lpValue; }
class ADS_OCTET_STRING extends Structure {
  static _fields_ = [
    ["dwLength", DWORD],
    ["lpValue", LPBYTE],
  ];
}

// SYSTEMTIME (ADS_UTC_TIME) — 8 x WORD = 16 bytes
class SYSTEMTIME extends Structure {
  static _fields_ = [
    ["wYear", WORD],
    ["wMonth", WORD],
    ["wDayOfWeek", WORD],
    ["wDay", WORD],
    ["wHour", WORD],
    ["wMinute", WORD],
    ["wSecond", WORD],
    ["wMilliseconds", WORD],
  ];
}

// LARGE_INTEGER (ADS_LARGE_INTEGER) — 8 bytes signed
class LARGE_INTEGER extends Structure {
  static _fields_ = [["QuadPart", LONGLONG]];
}

// ADS_TIMESTAMP — { DWORD WholeSeconds; DWORD EventID; }
class ADS_TIMESTAMP extends Structure {
  static _fields_ = [
    ["WholeSeconds", DWORD],
    ["EventID", DWORD],
  ];
}

// ADS_BACKLINK — { DWORD RemoteID; LPWSTR ObjectName; }
class ADS_BACKLINK extends Structure {
  static _fields_ = [
    ["RemoteID", DWORD],
    ["ObjectName", LPWSTR],
  ];
}

// ADS_HOLD — { LPWSTR ObjectName; DWORD Amount; }
class ADS_HOLD extends Structure {
  static _fields_ = [
    ["ObjectName", LPWSTR],
    ["Amount", DWORD],
  ];
}

// ADS_EMAIL — { LPWSTR Address; DWORD Type; }
class ADS_EMAIL extends Structure {
  static _fields_ = [
    ["Address", LPWSTR],
    ["Type", DWORD],
  ];
}

// ADSVALUE union — all members from Iads.h. Largest members are 16 bytes.
class ADSVALUE_DATA extends Union {
  static _fields_ = [
    ["DNString", LPWSTR],
    ["CaseExactString", LPWSTR],
    ["CaseIgnoreString", LPWSTR],
    ["PrintableString", LPWSTR],
    ["NumericString", LPWSTR],
    ["Boolean", DWORD],
    ["Integer", DWORD],
    ["OctetString", ADS_OCTET_STRING], // { DWORD, LPBYTE } = 16 bytes on x64
    ["UTCTime", SYSTEMTIME], // 8 x WORD = 16 bytes
    ["LargeInteger", LARGE_INTEGER], // 8 bytes
    ["ClassName", LPWSTR],
    ["ProviderSpecific", ADS_OCTET_STRING], // same layout as OctetString
    ["pCaseIgnoreList", PVOID],
    ["pOctetList", PVOID],
    ["pPath", PVOID],
    ["pPostalAddress", PVOID],
    ["Timestamp", ADS_TIMESTAMP], // { DWORD, DWORD } = 8 bytes
    ["BackLink", ADS_BACKLINK], // { DWORD, LPWSTR } = 16 bytes on x64
    ["pTypedName", PVOID],
    ["Hold", ADS_HOLD], // { LPWSTR, DWORD } = 16 bytes on x64
    ["pNetAddress", PVOID],
    ["pReplicaPointer", PVOID],
    ["pFaxNumber", PVOID],
    ["Email", ADS_EMAIL], // { LPWSTR, DWORD } = 16 bytes on x64
    ["SecurityDescriptor", ADS_OCTET_STRING], // same layout as OctetString
    ["pDNWithBinary", PVOID],
    ["pDNWithString", PVOID],
  ];
}

class ADSVALUE extends Structure {
  static _fields_ = [
    ["dwType", DWORD],
    ["Value", ADSVALUE_DATA],
  ];
}

class ADS_SEARCHPREF_INFO extends Structure {
  static _fields_ = [
    ["dwSearchPref", DWORD],
    ["vValue", ADSVALUE],
    ["dwStatus", DWORD],
  ];
}

// typedef struct ads_search_column {
//   LPWSTR      pszAttrName;
//   ADSTYPE     dwADsType;
//   PADSVALUE   pADsValues;
//   DWORD       dwNumValues;
//   HANDLE      hReserved;
// };
class ADS_SEARCH_COLUMN extends Structure {
  static _fields_ = [
    ["pszAttrName", LPWSTR],
    ["dwADsType", DWORD],
    ["pADsValues", POINTER(ADSVALUE)],
    ["dwNumValues", DWORD],
    ["hReserved", HANDLE],
  ];
}

// Search preference (Python: ADS_SEARCHPREF_INFO(pref, ADSVALUE(type, ADSVALUE_DATA(**value))))
function searchPref(dwSearchPref, dwType, value) {
  return new ADS_SEARCHPREF_INFO(dwSearchPref, new ADSVALUE(dwType, new ADSVALUE_DATA(value)));
}

// ─── VARIANT (oaidl.h), as IADs::Get returns the properties ─────────
//
// { VARTYPE vt; WORD wReserved1..3; union { ... } } — 16 bytes, 24 on 64-bit
// (the largest member, BRECORD, is two pointers).

const VT_I4 = 3;
const VT_BSTR = 8;
const VT_BOOL = 11;
const VT_VARIANT = 12;
const VT_ARRAY = 0x2000;

class VARIANT_DATA extends Union {
  static _fields_ = [
    ["lVal", INT],
    ["boolVal", SHORT],
    ["bstrVal", PVOID],
    ["parray", PVOID], // SAFEARRAY*
    ["record", array(PVOID, 2)], // BRECORD: the size of the union
  ];
}

class VARIANT extends Structure {
  static _fields_ = [
    ["vt", WORD],
    ["wReserved1", WORD],
    ["wReserved2", WORD],
    ["wReserved3", WORD],
    ["data", VARIANT_DATA],
  ];
}

/**
 * The value of a VARIANT: strings, numbers and booleans, an array of them for
 * a multi-valued property (VT_ARRAY | VT_VARIANT); undefined for other types.
 */
function variantValue(variant) {
  switch (variant.vt) {
    case VT_BSTR:
      return variant.data.bstrVal ? wstring_at(variant.data.bstrVal, oleaut32.SysStringLen(variant.data.bstrVal)) : "";
    case VT_I4:
      return variant.data.lVal;
    case VT_BOOL:
      return variant.data.boolVal !== 0; // VARIANT_TRUE is -1
    case VT_ARRAY | VT_VARIANT: {
      // A SAFEARRAY of VARIANTs, one dimension: each element copied out
      // (SafeArrayGetElement), read, then cleared.
      const psa = variant.data.parray;
      const lower = new LONG();
      const upper = new LONG();
      oleaut32.SafeArrayGetLBound(psa, 1, byref(lower));
      oleaut32.SafeArrayGetUBound(psa, 1, byref(upper));
      const values = [];
      const element = new VARIANT();
      for (let i = Number(lower.value); i <= Number(upper.value); i++) {
        oleaut32.SafeArrayGetElement(psa, byref(new LONG(i)), byref(element));
        const value = variantValue(element);
        oleaut32.VariantClear(byref(element));
        if (value !== undefined) values.push(value);
      }
      return values;
    }
    default:
      return undefined;
  }
}

// ─── Value conversion ────────────────────────────────────────────────

/** Copy `length` bytes at a pointer into a Buffer (Python: string_at(ptr, length)). */
function bytesAt(ptr, length) {
  const data = create_string_buffer(length);
  memmove(data, ptr, length);
  return data.raw;
}

/** Convert a binary SID buffer to its string form (S-1-5-…). */
function sidToString(sidBuffer) {
  const strSid = new c_void_p(); // receives LPWSTR
  if (!advapi32.ConvertSidToStringSidW(sidBuffer, byref(strSid)) || !strSid.value) return sidBuffer.toString("hex");
  const str = wstring_at(strSid.value);
  kernel32.LocalFree(strSid.value);
  return str;
}

/** Convert a 16-byte GUID buffer to its string form "{XXXXXXXX-...}". */
function guidToString(guidBuffer) {
  if (guidBuffer.length < 16) return guidBuffer.toString("hex");
  const outBuf = create_unicode_buffer(39);
  if (ole32.StringFromGUID2(guidBuffer, outBuf, 39) === 0) return guidBuffer.toString("hex");
  return outBuf.value;
}

/** A FILETIME large integer as an ISO date (0: not set; the maximum: never). */
function fileTimeToString(ticks) {
  if (ticks === 0n) return "No value set";
  if (ticks === 0x7fffffffffffffffn || ticks < 0n) return "Never Expires";
  return new Date(Number(ticks / 10000n - 11644473600000n)).toISOString();
}

/** The values of a column, as JavaScript values chosen by the ADSI type. */
function columnValues(column, name) {
  const lower = name.toLowerCase();
  const count = Number(column.dwNumValues);
  const values = [];
  for (let i = 0; i < count; i++) {
    const value = column.pADsValues[i].Value;
    // DWORD fields are BigInt; the ADSTYPE_* constants are numbers.
    switch (Number(column.dwADsType)) {
      // LPWSTR union fields auto-convert to a JS string on read.
      case ADSTYPE_DN_STRING:
        values.push(value.DNString);
        break;
      case ADSTYPE_CASE_EXACT_STRING:
      case ADSTYPE_CASE_IGNORE_STRING:
      case ADSTYPE_PRINTABLE_STRING:
      case ADSTYPE_NUMERIC_STRING:
      case ADSTYPE_TYPEDNAME:
      case ADSTYPE_FAXNUMBER:
      case ADSTYPE_PATH:
      case ADSTYPE_OBJECT_CLASS:
        values.push(value.CaseIgnoreString);
        break;
      case ADSTYPE_INTEGER:
        values.push(Number(value.Integer) | 0); // Active Directory integers are signed 32-bit
        break;
      case ADSTYPE_BOOLEAN:
        values.push(Boolean(Number(value.Boolean)));
        break;
      case ADSTYPE_LARGE_INTEGER: {
        const ticks = BigInt(value.LargeInteger.QuadPart);
        values.push(FILETIME_ATTRIBUTES.has(lower) ? fileTimeToString(ticks) : ticks);
        break;
      }
      case ADSTYPE_OCTET_STRING:
      case ADSTYPE_NT_SECURITY_DESCRIPTOR: {
        // lpValue is an LPBYTE (POINTER(BYTE)): null when NULL
        const { dwLength, lpValue } = Number(column.dwADsType) === ADSTYPE_OCTET_STRING ? value.OctetString : value.SecurityDescriptor;
        const raw = lpValue && Number(dwLength) > 0 ? bytesAt(lpValue, Number(dwLength)) : Buffer.alloc(0);
        if (SID_ATTRIBUTES.has(lower)) values.push(sidToString(raw));
        else if (GUID_ATTRIBUTES.has(lower)) values.push(guidToString(raw));
        else values.push(raw);
        break;
      }
      case ADSTYPE_UTC_TIME: {
        const st = value.UTCTime;
        values.push(new Date(Date.UTC(st.wYear, st.wMonth - 1, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds)).toISOString());
        break;
      }
      default:
        values.push(`<ADSTYPE ${column.dwADsType}>`);
    }
  }
  return values;
}

// ─── Paths and binding ───────────────────────────────────────────────

/**
 * The ADsPath of a distinguished name: "LDAP://[server/]DN". "/" is a
 * separator in ADsPaths, so it is escaped inside the DN.
 */
export function adsPath(dn, server = null) {
  const escaped = dn.replace(/\//g, "\\/");
  return server ? `LDAP://${server}/${escaped}` : `LDAP://${escaped}`;
}

let comInitialized = false;
// ADSI keeps an LDAP connection open while an object bound with the same
// server and credentials is alive: one object is kept until close(), so the
// next searches reuse the connection instead of binding again.
let keepAlive = null;

/** Bind an ADSI object and return the given interface of it. */
function openObject(path, options, iface) {
  if (!comInitialized) {
    CoInitializeEx();
    comInitialized = true;
  }
  const serverBind = /^LDAP:\/\/[^/=]+\//i.test(path) ? ADS_SERVER_BIND : 0;
  const flags = ADS_SECURE_AUTHENTICATION | (options.encrypt === false ? 0 : ADS_USE_SIGNING | ADS_USE_SEALING) | serverBind;
  const user = options.username ? (options.domain ? `${options.domain}\\${options.username}` : options.username) : null;
  // OleDLL + HRESULT auto-throws on failure — no checkHR needed. Path, user
  // and password are LPCWSTR and accept plain JS strings directly.
  const ppv = new c_void_p();
  activeds.ADsOpenObject(path, user, options.password ?? null, flags, byref(iface._iid), byref(ppv));
  return new COMPointer(ppv.value, iface);
}

// ─── RootDSE ─────────────────────────────────────────────────────────

/**
 * Read attributes of the RootDSE: the naming contexts of the server
 * (namingContexts, defaultNamingContext, configurationNamingContext, schemaNamingContext,
 * ...), its DNS name. The RootDSE cannot be searched (no IDirectorySearch):
 * its attributes are read one by one with IADs::Get, as VARIANTs.
 *
 * @param {string[]} attributes - Attribute names; missing ones are left out
 * @param {string}   [server]   - Host name (default: a server of the logon domain)
 * @param {object}   [options]  - Credentials and encrypt, as search()
 * @returns {object} attribute name → array of values, as a search result
 */
export function rootDse(attributes, server = null, options = {}) {
  const object = openObject(server ? `LDAP://${server}/RootDSE` : "LDAP://RootDSE", options, IADs);
  const row = {};
  const variant = new VARIANT();
  try {
    for (const name of attributes) {
      const bstrName = oleaut32.SysAllocString(name);
      try {
        object.Get(bstrName, byref(variant));
      } catch (error) {
        if (error.hresult === E_ADS_PROPERTY_NOT_FOUND) continue;
        throw error;
      } finally {
        oleaut32.SysFreeString(bstrName);
      }
      const value = variantValue(variant);
      oleaut32.VariantClear(byref(variant)); // frees the BSTR or the SAFEARRAY
      if (value !== undefined) row[name] = Array.isArray(value) ? value : [value];
    }
    return row;
  } finally {
    object.Release();
  }
}

// ─── Search ──────────────────────────────────────────────────────────

/**
 * Search the directory.
 *
 * @param {string}   filter      - LDAP filter, e.g. "(objectClass=user)"
 * @param {string}   basePath    - "LDAP://DC=example,DC=com" or "LDAP://server/DC=…"
 * @param {number}   [scope]     - SCOPE.BASE | SCOPE.ONELEVEL | SCOPE.SUBTREE
 * @param {string[]} [attributes] - Attributes to return ([] = all)
 * @param {object}   [options]
 * @param {string}   [options.username]   - Explicit user (with options.domain: DOMAIN\user)
 * @param {string}   [options.password]
 * @param {string}   [options.domain]
 * @param {number}   [options.pageSize=1000] - Page size (ADSI pages transparently)
 * @param {number}   [options.maxObjects=-1] - Limit results (-1 = unlimited)
 * @param {boolean}  [options.encrypt=true]  - Sign and seal the session
 * @returns {object[]} One object per entry: attribute name → array of values
 */
export function search(filter, basePath, scope = SCOPE.SUBTREE, attributes = [], options = {}) {
  const maxObjects = options.maxObjects > 0 ? options.maxObjects : -1;
  const directorySearch = openObject(basePath, options, IDirectorySearch);
  let hSearch = null; // ADS_SEARCH_HANDLE, closed in finally
  let complete = false;
  try {
    // Never chase referrals (other partitions, other domains): no surprise
    // waits on servers that are not reachable.
    const prefs = [
      searchPref(ADS_SEARCHPREF_PAGESIZE, ADSTYPE_INTEGER, { Integer: options.pageSize || 1000 }),
      searchPref(ADS_SEARCHPREF_SEARCH_SCOPE, ADSTYPE_INTEGER, { Integer: scope }),
      searchPref(ADS_SEARCHPREF_CHASE_REFERRALS, ADSTYPE_INTEGER, { Integer: ADS_CHASE_REFERRALS_NEVER }),
      searchPref(ADS_SEARCHPREF_CACHE_RESULTS, ADSTYPE_BOOLEAN, { Boolean: 0 }),
    ];
    if (maxObjects > 0) prefs.push(searchPref(ADS_SEARCHPREF_SIZE_LIMIT, ADSTYPE_INTEGER, { Integer: maxObjects }));
    directorySearch.SetSearchPreference(array(ADS_SEARCHPREF_INFO, prefs.length)(...prefs), prefs.length);

    // The attribute names are an array of LPWSTR (Python: (LPCWSTR * n)(*names));
    // NULL and (DWORD)-1 request all of them.
    const names = attributes.length && !attributes.some((a) => a.toLowerCase() === "distinguishedname") ? [...attributes, "distinguishedName"] : attributes;
    const attrNames = names.length ? array(LPCWSTR, names.length)(...names) : null;
    const hSearchOut = new HANDLE();
    directorySearch.ExecuteSearch(filter, attrNames, names.length || 0xffffffff, byref(hSearchOut));
    hSearch = hSearchOut.value;

    const rows = [];
    const pszColumn = new c_void_p();
    const column = new ADS_SEARCH_COLUMN();
    let hr;
    while (SUCCEEDED((hr = directorySearch.GetNextRow(hSearch))) && hr !== S_ADS_NOMORE_ROWS) {
      const row = {};
      while (SUCCEEDED((hr = directorySearch.GetNextColumnName(hSearch, byref(pszColumn)))) && hr !== S_ADS_NOMORE_COLUMNS) {
        const nameAddr = pszColumn.value;
        const name = wstring_at(nameAddr);
        // ADsPath is added by ADSI to every row: not a directory attribute.
        if (name.toLowerCase() !== "adspath" && SUCCEEDED(directorySearch.GetColumn(hSearch, nameAddr, column))) {
          try {
            row[name] = columnValues(column, name);
          } finally {
            directorySearch.FreeColumn(column);
          }
        }
        activeds.FreeADsMem(nameAddr);
      }
      rows.push(row);
      if (maxObjects > 0 && rows.length >= maxObjects) return rows;
    }
    complete = true;
    return rows;
  } finally {
    if (hSearch !== null) {
      // A search stopped early asks the server to drop the remaining pages.
      if (!complete) directorySearch.AbandonSearch(hSearch);
      directorySearch.CloseSearchHandle(hSearch);
    }
    if (keepAlive === null) keepAlive = directorySearch;
    else directorySearch.Release();
  }
}

// ─── Ads — static façade ────────────────────────────────────────────

export class Ads {
  /**
   * Search the directory.
   * @see search() for full parameter documentation.
   */
  static search(filter, basePath, scope = SCOPE.SUBTREE, attributes = [], options = {}) {
    return search(filter, basePath, scope, attributes, options);
  }

  /**
   * Read attributes of the RootDSE.
   * @see rootDse() for full parameter documentation.
   */
  static rootDse(attributes, server = null, options = {}) {
    return rootDse(attributes, server, options);
  }

  /** Release the kept connection and uninitialize COM. */
  static close() {
    keepAlive?.Release();
    keepAlive = null;
    if (comInitialized) CoUninitialize();
    comInitialized = false;
  }
}

// ─── AdsWorker — searches in a worker thread ─────────────────────────

/** Values arrive through structured clone: a Buffer becomes a Uint8Array. */
function revive(rows) {
  for (const row of rows) {
    for (const [name, values] of Object.entries(row)) {
      row[name] = values.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v));
    }
  }
  return rows;
}

export class AdsWorker {
  #worker;
  #port;
  #nextId = 1;
  #pending = new Map(); // id → { resolve, reject }: searchAsync

  /**
   * @param {object} [options]
   * @param {{ hwnd: bigint, message: number }} [options.notify] - Window message
   *   posted after each reply (take() mode); without it, searchAsync() resolves
   *   through the Node.js event loop.
   */
  constructor({ notify = null } = {}) {
    const { port1, port2 } = new MessageChannel();
    this.#port = port1;
    this.#worker = new Worker(new URL(import.meta.url), { workerData: { adsWorker: true, port: port2, notify }, transferList: [port2] });
    this.#worker.unref(); // only pending searchAsync() calls keep Node.js alive
    if (!notify) {
      port1.on("message", (reply) => {
        const pending = this.#pending.get(reply.id);
        this.#pending.delete(reply.id);
        if (this.#pending.size === 0) port1.unref();
        if (reply.error) pending?.reject(new Error(reply.error));
        else pending?.resolve(revive(reply.rows));
      });
      port1.unref();
    }
  }

  /**
   * Start a search (same arguments as search()); its reply is taken with take().
   * @returns {number} The id of the search, found again in its reply
   */
  search(filter, basePath, scope = SCOPE.SUBTREE, attributes = [], options = {}) {
    return this.#post("search", [filter, basePath, scope, attributes, options]);
  }

  /**
   * Start a RootDSE read (same arguments as rootDse()); its reply, taken with
   * take(), has one row.
   * @returns {number} The id of the read, found again in its reply
   */
  rootDse(attributes, server = null, options = {}) {
    return this.#post("rootDse", [attributes, server, options]);
  }

  /** A search as a promise (Node.js event loop). */
  searchAsync(filter, basePath, scope = SCOPE.SUBTREE, attributes = [], options = {}) {
    return this.#promise(this.search(filter, basePath, scope, attributes, options));
  }

  /** A RootDSE read as a promise (Node.js event loop): attribute → array of values. */
  async rootDseAsync(attributes, server = null, options = {}) {
    return (await this.#promise(this.rootDse(attributes, server, options)))[0];
  }

  #post(op, args) {
    const id = this.#nextId++;
    this.#port.postMessage({ id, op, args });
    return id;
  }

  #promise(id) {
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#port.ref();
    });
  }

  /**
   * The next reply, without the event loop (receiveMessageOnPort):
   * { id, rows } or { id, error }; undefined when none is waiting.
   */
  take() {
    const reply = receiveMessageOnPort(this.#port)?.message;
    if (reply?.rows) revive(reply.rows);
    return reply;
  }

  /** Stop the worker after the searches already started. */
  close() {
    this.#port.postMessage({ close: true });
    this.#port.close();
  }
}

// The worker side: one request at a time, in the order received.
if (!isMainThread && workerData?.adsWorker) {
  const { port, notify } = workerData;
  const user32 = new WinDLL("user32.dll");
  user32.PostMessageW.argtypes = [LPVOID, DWORD, LPVOID, LPVOID];
  user32.PostMessageW.restype = BOOL;
  port.on("message", (request) => {
    if (request.close) {
      Ads.close();
      port.close();
      return;
    }
    let reply;
    try {
      reply = { id: request.id, rows: request.op === "rootDse" ? [rootDse(...request.args)] : search(...request.args) };
    } catch (error) {
      reply = { id: request.id, error: error.message };
    }
    port.postMessage(reply);
    if (notify) user32.PostMessageW(notify.hwnd, notify.message, null, null);
  });
}

export default Ads;
