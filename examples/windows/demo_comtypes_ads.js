// demo_comtypes_ads — Active Directory search using IDirectorySearch
//
// Queries Active Directory via ADsOpenObject + IDirectorySearch.
// HRESULT-returning COM methods auto-throw on failure (parity with Python
// comtypes), so the demo reads like straight-line code.
//
// Usage:
//   node examples/windows/demo_comtypes_ads.js --base "LDAP://DC=contoso,DC=com" \
//        --filter "(objectClass=user)" --attributes "sAMAccountName,displayName,mail"

import { WinDLL, OleDLL, Structure, Union, POINTER, array, byref, ptrToBuffer, create_unicode_buffer, wstring_at } from "node-ctypes";
import { CoInitializeEx, CoUninitialize, COMPointer, HRESULT, SUCCEEDED } from "./comtypes/comtypes.js";
import { BOOL, BYTE, DWORD, HANDLE, INT, LONG, LONGLONG, LPBYTE, LPCWSTR, LPVOID, LPWSTR, PVOID, WORD } from "./wintypes.js";
import {
  IDirectorySearch,
  ADS_SEARCHPREF_PAGESIZE,
  ADS_SEARCHPREF_SEARCH_SCOPE,
  ADS_SEARCHPREF_ASYNCHRONOUS,
  ADS_SEARCHPREF_CHASE_REFERRALS,
  ADS_SEARCHPREF_CACHE_RESULTS,
  ADS_SCOPE_BASE,
  ADS_SCOPE_ONELEVEL,
  ADS_SCOPE_SUBTREE,
  ADS_CHASE_REFERRALS_ALWAYS,
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
  S_ADS_NOMORE_ROWS,
  S_ADS_NOMORE_COLUMNS,
} from "./comtypes/interfaces/directorysearch.js";
// Reuse the flat → tree helpers from the LDAP demo (OU-path based grouping).
import { OUTPUT_TYPE, toTree, sortByDN, sortTreeByDN } from "./ldap/ldap.js";

// ─── Native libs ─────────────────────────────────────────────────────
// activeds is loaded via OleDLL so ADsOpenObject (HRESULT) auto-throws on
// failure — no manual checkHR needed at the call-site.

const activeds = new OleDLL("activeds.dll");
const advapi32 = new WinDLL("advapi32.dll");
const kernel32 = new WinDLL("kernel32.dll");
const ole32 = new WinDLL("ole32.dll");

// HRESULT ADsOpenObject(LPCWSTR lpszPathName, LPCWSTR lpszUserName,
//                       LPCWSTR lpszPassword, DWORD dwReserved, REFIID riid,
//                       void** ppObject);
activeds.ADsOpenObject.argtypes = [LPCWSTR, LPCWSTR, LPCWSTR, DWORD, LPVOID, LPVOID];
activeds.ADsOpenObject.restype = HRESULT;

// HRESULT FreeADsMem(void* pMem); — technically DOCS say BOOL but header
// declares HRESULT. Keep BOOL for the "success=non-zero" usage pattern.
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

// ─── Constants ───────────────────────────────────────────────────────

const ADS_SECURE_AUTHENTICATION = 0x1;

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

// ─── Value conversion helpers ────────────────────────────────────────

/** Convert a binary SID buffer to its string form (S-1-5-…). */
function sidToString(sidBuffer) {
  const sidBuf = Buffer.from(sidBuffer); // native-allocated copy
  const strSidPtr = Buffer.alloc(8); // receives LPWSTR
  const ok = advapi32.ConvertSidToStringSidW(sidBuf, strSidPtr);
  if (!ok) return sidBuffer.toString("hex");

  const addr = strSidPtr.readBigUInt64LE(0);
  if (!addr) return sidBuffer.toString("hex");

  const str = wstring_at(addr);
  kernel32.LocalFree(addr);
  return str;
}

/** Convert a 16-byte GUID buffer to its string form "{XXXXXXXX-...}". */
function guidToString(guidBuffer) {
  if (guidBuffer.length < 16) return guidBuffer.toString("hex");

  const guidBuf = Buffer.from(guidBuffer.subarray(0, 16));
  const outBuf = create_unicode_buffer(39);
  const len = ole32.StringFromGUID2(guidBuf, outBuf, 39);
  if (len === 0) return guidBuffer.toString("hex");

  // wstring_at stops at the first NUL — no manual trim needed.
  return wstring_at(outBuf);
}

// ─── ADsOpenObject wrapper ───────────────────────────────────────────

function ADsOpenObject(path, interfaceDef, username = null, password = null, authFlags = ADS_SECURE_AUTHENTICATION) {
  // OleDLL + HRESULT auto-throws on failure — no checkHR needed.
  // Path/user/password are LPCWSTR and accept plain JS strings directly
  // (Python-ctypes parity via c_wchar_p keepalive).
  const ppv = Buffer.alloc(8);
  activeds.ADsOpenObject(path, username, password, authFlags, byref(interfaceDef._iid), ppv);
  const addr = ppv.readBigUInt64LE(0);
  return new COMPointer(addr, interfaceDef);
}

// ─── Detect domain base DN from environment ─────────────────────────

function detectBasePath() {
  // Use USERDNSDOMAIN (e.g. "corp.example.com") → "LDAP://DC=corp,DC=example,DC=com"
  const dnsDomain = process.env.USERDNSDOMAIN;
  if (dnsDomain) {
    const dcParts = dnsDomain
      .split(".")
      .map((p) => `DC=${p}`)
      .join(",");
    return `LDAP://${dcParts}`;
  }

  const userDomain = process.env.USERDOMAIN;
  if (userDomain) return `LDAP://DC=${userDomain}`;

  return null;
}

// ─── CLI argument parsing ───────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--base":
        opts.basePath = args[++i];
        break;
      case "--user":
        opts.username = args[++i];
        break;
      case "--pass":
        opts.password = args[++i];
        break;
      case "--filter":
        opts.filter = args[++i];
        break;
      case "--scope": {
        const scope = args[++i].toLowerCase();
        switch (scope) {
          case "base":
            opts.scope = ADS_SCOPE_BASE;
            break;
          case "onelevel":
            opts.scope = ADS_SCOPE_ONELEVEL;
            break;
          case "subtree":
            opts.scope = ADS_SCOPE_SUBTREE;
            break;
          default:
            console.error(`Unknown scope: ${scope}`);
            process.exit(1);
        }
        break;
      }
      case "--page-size":
        opts.pageSize = parseInt(args[++i], 10);
        break;
      case "--attributes":
        opts.attributes = args[++i];
        break;
      case "--tree":
        opts.outputType = OUTPUT_TYPE.TREE;
        break;
      case "--debug":
        opts.debug = true;
        break;
    }
  }

  return opts;
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  const basePath = opts.basePath || detectBasePath();

  if (!basePath) {
    console.error("Error: Could not detect domain. Use --base to specify the LDAP path.");
    console.error('  Example: node demo_comtypes_ads.js --base "LDAP://DC=example,DC=com"');
    process.exit(1);
  }

  console.log(`ADS Demo — base: ${basePath}`);

  const searchFilter = opts.filter || "(&(objectClass=user)(objectCategory=person))";
  const attrList = opts.attributes ? opts.attributes.split(",") : ["distinguishedName", "cn", "displayName", "userPrincipalName", "givenName", "sn", "mail", "objectSid", "objectGUID", "jpegPhoto"];
  const scope = opts.scope ?? ADS_SCOPE_SUBTREE;
  const pageSize = opts.pageSize || 1000;
  const username = opts.username || null;
  const password = opts.password || null;

  CoInitializeEx();

  let directorySearch;
  try {
    // Bind to AD using ADsOpenObject
    directorySearch = ADsOpenObject(basePath, IDirectorySearch, username, password);

    // Set search preferences. All COM methods with HRESULT restype auto-throw
    // on failure (vtable errcheck installed by comtypes.js).
    const dwNumPrefs = 5;
    const searchPrefs = array(ADS_SEARCHPREF_INFO, dwNumPrefs).create([
      { dwSearchPref: ADS_SEARCHPREF_PAGESIZE, vValue: { dwType: ADSTYPE_INTEGER, Value: { Integer: pageSize } } },
      { dwSearchPref: ADS_SEARCHPREF_SEARCH_SCOPE, vValue: { dwType: ADSTYPE_INTEGER, Value: { Integer: scope } } },
      { dwSearchPref: ADS_SEARCHPREF_ASYNCHRONOUS, vValue: { dwType: ADSTYPE_BOOLEAN, Value: { Boolean: 1 } } },
      { dwSearchPref: ADS_SEARCHPREF_CHASE_REFERRALS, vValue: { dwType: ADSTYPE_INTEGER, Value: { Integer: ADS_CHASE_REFERRALS_ALWAYS } } },
      { dwSearchPref: ADS_SEARCHPREF_CACHE_RESULTS, vValue: { dwType: ADSTYPE_BOOLEAN, Value: { Boolean: 0 } } },
    ]);

    directorySearch.SetSearchPreference(searchPrefs, dwNumPrefs);

    // Execute search. attrPtrArray is a NULL-terminated array of LPWSTR; the
    // `array(LPCWSTR, N).create([...])` helper builds it from plain strings.
    const hSearchOut = Buffer.alloc(8);
    const attrPtrArray = attrList.length ? array(LPCWSTR, attrList.length).create(attrList) : null;
    directorySearch.ExecuteSearch(searchFilter, attrPtrArray, attrList.length ? attrList.length : -1, byref(hSearchOut));
    const hSearch = hSearchOut.readBigUInt64LE(0);

    console.time("Enumerating rows");

    const rows = [];
    const pszColumn = Buffer.alloc(8);
    const col = new ADS_SEARCH_COLUMN();
    let hr;

    while (SUCCEEDED((hr = directorySearch.GetNextRow(hSearch))) && hr !== S_ADS_NOMORE_ROWS) {
      const row = {};

      while (SUCCEEDED((hr = directorySearch.GetNextColumnName(hSearch, pszColumn))) && hr !== S_ADS_NOMORE_COLUMNS) {
        const colNameAddr = pszColumn.readBigUInt64LE(0);
        if (SUCCEEDED(directorySearch.GetColumn(hSearch, colNameAddr, col))) {
          const values = [];
          const colName = wstring_at(colNameAddr);

          switch (col.dwADsType) {
            // LPWSTR union fields auto-convert to a JS string on read (the
            // c_wchar_p reader calls readWString). NULL → null.
            case ADSTYPE_DN_STRING: {
              for (let i = 0; i < col.dwNumValues; i++) {
                values.push(col.pADsValues[i].Value.DNString);
              }
              break;
            }
            case ADSTYPE_CASE_EXACT_STRING:
            case ADSTYPE_CASE_IGNORE_STRING:
            case ADSTYPE_PRINTABLE_STRING:
            case ADSTYPE_NUMERIC_STRING:
            case ADSTYPE_TYPEDNAME:
            case ADSTYPE_FAXNUMBER:
            case ADSTYPE_PATH:
            case ADSTYPE_OBJECT_CLASS: {
              for (let i = 0; i < col.dwNumValues; i++) {
                values.push(col.pADsValues[i].Value.CaseIgnoreString);
              }
              break;
            }
            case ADSTYPE_INTEGER: {
              for (let i = 0; i < col.dwNumValues; i++) {
                values.push(col.pADsValues[i].Value.Integer);
              }
              break;
            }
            case ADSTYPE_BOOLEAN: {
              for (let i = 0; i < col.dwNumValues; i++) {
                values.push(col.pADsValues[i].Value.Boolean !== 0);
              }
              break;
            }
            case ADSTYPE_LARGE_INTEGER: {
              const isFileTime = colName === "lastLogon" || colName === "lastLogonTimestamp" || colName === "lastLogoff" || colName === "pwdLastSet" || colName === "badPasswordTime";

              for (let i = 0; i < col.dwNumValues; i++) {
                const qp = col.pADsValues[i].Value.LargeInteger.QuadPart;
                if (isFileTime) {
                  // FILETIME: 100-ns ticks since 1601-01-01 UTC → ISO 8601.
                  const jsTime = Number(qp) / 10000 - 11644473600000;
                  values.push(new Date(jsTime).toISOString());
                } else {
                  values.push(qp);
                }
              }
              break;
            }
            case ADSTYPE_OCTET_STRING: {
              for (let i = 0; i < col.dwNumValues; i++) {
                const { dwLength, lpValue } = col.pADsValues[i].Value.OctetString;
                if (lpValue && lpValue !== 0n && dwLength > 0) {
                  const rawBuf = Buffer.from(ptrToBuffer(lpValue, Number(dwLength)));
                  if (colName.toLowerCase() === "objectsid") {
                    values.push(sidToString(rawBuf));
                  } else if (colName.toLowerCase() === "objectguid") {
                    values.push(guidToString(rawBuf));
                  } else {
                    values.push(rawBuf);
                  }
                }
              }
              break;
            }
            case ADSTYPE_UTC_TIME: {
              for (let i = 0; i < col.dwNumValues; i++) {
                const st = col.pADsValues[i].Value.UTCTime;
                const date = new Date(Date.UTC(st.wYear, st.wMonth - 1, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds));
                values.push(date.toISOString());
              }
              break;
            }
            default:
              values.push(`<unsupported type ${col.dwADsType}>`);
          }

          row[colName] = values;
          directorySearch.FreeColumn(col);
        }
        activeds.FreeADsMem(colNameAddr);
      }
      rows.push(row);
    }

    console.timeEnd("Enumerating rows");

    // Output-type handling: flat sorted array (default) or tree grouped by
    // OU path. Same semantics as demo_ldap — reusing the exported helpers.
    const outputType = opts.outputType ?? OUTPUT_TYPE.FLAT;
    let output;
    if (outputType === OUTPUT_TYPE.TREE) {
      output = toTree(rows);
      sortTreeByDN(output);
    } else {
      output = rows;
      sortByDN(output);
    }

    if (opts.debug) {
      console.dir(output, { depth: null });
    }

    console.log(`Enumerated ${rows.length} row(s) — output: ${outputType === OUTPUT_TYPE.TREE ? "tree" : "flat"}`);

    directorySearch.AbandonSearch(hSearch);
    directorySearch.CloseSearchHandle(hSearch);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    if (directorySearch) directorySearch.Release();
    CoUninitialize();

    activeds.close();
    advapi32.close();
    kernel32.close();
    ole32.close();
  }
}

main();
