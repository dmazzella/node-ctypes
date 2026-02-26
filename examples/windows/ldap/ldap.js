// LDAP — reusable LDAP wrapper for node-ctypes
// Uses wldap32.dll to query LDAP directories via the Windows LDAP C API
//
// https://learn.microsoft.com/en-us/windows/win32/api/winldap/ns-winldap-ldap
//
// This module provides QueryBegin, QueryEnd, Query, FindObjects and Modify
// using standard DLL exports from wldap32.dll.
//
// Usage:
//   import { Ldap, SCOPE } from "./ldap/ldap.js";
//
//   // Query with Windows integrated auth
//   const users = Ldap.query(
//     "(&(objectClass=user)(objectCategory=person))",
//     "LDAP://DC=example,DC=com",
//     SCOPE.SUBTREE,
//     ["cn", "sAMAccountName", "mail"]
//   );
//
//   // Query with explicit credentials
//   const results = Ldap.query(
//     "(objectClass=computer)",
//     "LDAP://DC=example,DC=com",
//     SCOPE.SUBTREE,
//     [],
//     { username: "admin", password: "secret", domain: "EXAMPLE" }
//   );
//
//   Ldap.close();

import { WinDLL, Structure, byref, sizeof, readValue, ptrToBuffer, addressof, create_unicode_buffer, wstring_at, c_void_p, c_void, c_uint32, c_int32, POINTER_SIZE } from "node-ctypes";

// ─── LDAP Constants ─────────────────────────────────────────────────

export const SCOPE = Object.freeze({
  BASE: 0x00,
  ONELEVEL: 0x01,
  SUBTREE: 0x02,
});

export const OUTPUT_TYPE = Object.freeze({
  FLAT: 0, // flat array of objects (default)
  TREE: 1, // tree structure organized by OU path
});

export const MOD_OP = Object.freeze({
  ADD: 0x00, // add values to attribute
  DELETE: 0x01, // delete values (or entire attribute if no values)
  REPLACE: 0x02, // replace attribute values
});

const LDAP_PORT = 389;
const LDAP_VERSION3 = 3;
const LDAP_OPT_OFF = 0x00;
const LDAP_OPT_VERSION = 0x11;
const LDAP_OPT_REFERRALS = 0x08;
const LDAP_AUTH_NEGOTIATE = 0x0486;
const LDAP_SUCCESS = 0x00;
const SEC_WINNT_AUTH_IDENTITY_UNICODE = 0x02;

// ─── AD Attribute Syntax OIDs ───────────────────────────────────────
// https://learn.microsoft.com/en-us/windows/win32/adschema/syntaxes
//
// Loaded dynamically from the schema (CN=Schema,CN=Configuration,DC=…)
// to replicate ADSI's ADS_SEARCH_COLUMN.dwADsType type detection.

const AD_SYNTAX = Object.freeze({
  DN_STRING: "2.5.5.1",
  OBJECT_ID: "2.5.5.2",
  CASE_STRING: "2.5.5.3",
  CASE_IGNORE: "2.5.5.4",
  PRINT_STRING: "2.5.5.5",
  NUMERIC_STRING: "2.5.5.6",
  DN_BINARY: "2.5.5.7",
  BOOLEAN: "2.5.5.8",
  INTEGER: "2.5.5.9",
  OCTET_STRING: "2.5.5.10",
  TIME: "2.5.5.11",
  UNICODE_STRING: "2.5.5.12",
  ADDRESS: "2.5.5.13",
  DN_WITH_STRING: "2.5.5.14",
  NT_SEC_DESC: "2.5.5.15",
  LARGE_INTEGER: "2.5.5.16",
  SID: "2.5.5.17",
});

// ─── Schema cache ───────────────────────────────────────────────────

let _schemaCache = null; // Map<lowerAttrName, syntaxOID>
let _loadingSchema = false; // recursion guard: ensureSchema → query → ensureSchema

// Large Integer attributes that represent FILETIME — needed even WITH schema,
// because the schema only tells us "large integer", not "this is a date"
const LARGE_INT_DATE_ATTRIBUTES = new Set(["accountExpires", "badPasswordTime", "lastLogonTimestamp", "lastLogon", "lastLogoff", "lockoutTime", "pwdLastSet"]);

// ─── Structures ─────────────────────────────────────────────────────

class LDAP_BERVAL extends Structure {
  static _fields_ = [
    ["bv_len", c_uint32],
    ["bv_val", c_void_p],
  ];
}

class SEC_WINNT_AUTH_IDENTITY_W extends Structure {
  static _fields_ = [
    ["User", c_void_p],
    ["UserLength", c_uint32],
    ["Domain", c_void_p],
    ["DomainLength", c_uint32],
    ["Password", c_void_p],
    ["PasswordLength", c_uint32],
    ["Flags", c_uint32],
  ];
}

// ─── Lazy-loaded DLLs ───────────────────────────────────────────────

let _wldap32 = null;
let _advapi32 = null;
let _ole32 = null;
let _kernel32 = null;

function wldap32() {
  if (!_wldap32) {
    _wldap32 = new WinDLL("wldap32.dll");

    // Connection management
    _wldap32.ldap_initW.argtypes = [c_void_p, c_uint32];
    _wldap32.ldap_initW.restype = c_void_p;

    _wldap32.ldap_set_optionW.argtypes = [c_void_p, c_uint32, c_void_p];
    _wldap32.ldap_set_optionW.restype = c_uint32;

    _wldap32.ldap_bind_sW.argtypes = [c_void_p, c_void_p, c_void_p, c_uint32];
    _wldap32.ldap_bind_sW.restype = c_uint32;

    _wldap32.ldap_unbind.argtypes = [c_void_p];
    _wldap32.ldap_unbind.restype = c_uint32;

    // Search
    _wldap32.ldap_search_sW.argtypes = [c_void_p, c_void_p, c_uint32, c_void_p, c_void_p, c_uint32, c_void_p];
    _wldap32.ldap_search_sW.restype = c_uint32;

    // Result iteration
    _wldap32.ldap_count_entries.argtypes = [c_void_p, c_void_p];
    _wldap32.ldap_count_entries.restype = c_uint32;

    _wldap32.ldap_first_entry.argtypes = [c_void_p, c_void_p];
    _wldap32.ldap_first_entry.restype = c_void_p;

    _wldap32.ldap_next_entry.argtypes = [c_void_p, c_void_p];
    _wldap32.ldap_next_entry.restype = c_void_p;

    // DN
    _wldap32.ldap_get_dnW.argtypes = [c_void_p, c_void_p];
    _wldap32.ldap_get_dnW.restype = c_void_p;

    // Attribute iteration
    _wldap32.ldap_first_attributeW.argtypes = [c_void_p, c_void_p, c_void_p];
    _wldap32.ldap_first_attributeW.restype = c_void_p;

    _wldap32.ldap_next_attributeW.argtypes = [c_void_p, c_void_p, c_void_p];
    _wldap32.ldap_next_attributeW.restype = c_void_p;

    // Values
    _wldap32.ldap_get_values_lenW.argtypes = [c_void_p, c_void_p, c_void_p];
    _wldap32.ldap_get_values_lenW.restype = c_void_p;

    _wldap32.ldap_count_values_len.argtypes = [c_void_p];
    _wldap32.ldap_count_values_len.restype = c_uint32;

    // Cleanup
    _wldap32.ldap_value_free_len.argtypes = [c_void_p];
    _wldap32.ldap_value_free_len.restype = c_uint32;

    _wldap32.ldap_memfreeW.argtypes = [c_void_p];
    _wldap32.ldap_memfreeW.restype = c_void;

    _wldap32.ldap_msgfree.argtypes = [c_void_p];
    _wldap32.ldap_msgfree.restype = c_uint32;

    _wldap32.ber_free.argtypes = [c_void_p, c_int32];
    _wldap32.ber_free.restype = c_void;

    _wldap32.ber_bvfree.argtypes = [c_void_p];
    _wldap32.ber_bvfree.restype = c_void;

    // Paged search
    _wldap32.ldap_search_ext_sW.argtypes = [c_void_p, c_void_p, c_uint32, c_void_p, c_void_p, c_uint32, c_void_p, c_void_p, c_void_p, c_uint32, c_void_p];
    _wldap32.ldap_search_ext_sW.restype = c_uint32;

    _wldap32.ldap_create_page_controlW.argtypes = [c_void_p, c_uint32, c_void_p, c_uint32, c_void_p];
    _wldap32.ldap_create_page_controlW.restype = c_uint32;

    _wldap32.ldap_parse_resultW.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p, c_void_p, c_void_p, c_void_p, c_int32];
    _wldap32.ldap_parse_resultW.restype = c_uint32;

    _wldap32.ldap_parse_page_controlW.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p];
    _wldap32.ldap_parse_page_controlW.restype = c_uint32;

    _wldap32.ldap_control_freeW.argtypes = [c_void_p];
    _wldap32.ldap_control_freeW.restype = c_uint32;

    _wldap32.ldap_controls_freeW.argtypes = [c_void_p];
    _wldap32.ldap_controls_freeW.restype = c_uint32;

    // Modify
    _wldap32.ldap_modify_sW.argtypes = [c_void_p, c_void_p, c_void_p];
    _wldap32.ldap_modify_sW.restype = c_uint32;

    // Error
    _wldap32.LdapGetLastError.argtypes = [];
    _wldap32.LdapGetLastError.restype = c_uint32;
  }
  return _wldap32;
}

function advapi32() {
  if (!_advapi32) {
    _advapi32 = new WinDLL("advapi32.dll");
    _advapi32.ConvertSidToStringSidW.argtypes = [c_void_p, c_void_p];
    _advapi32.ConvertSidToStringSidW.restype = c_int32;
  }
  return _advapi32;
}

function ole32() {
  if (!_ole32) {
    _ole32 = new WinDLL("ole32.dll");
    _ole32.StringFromGUID2.argtypes = [c_void_p, c_void_p, c_int32];
    _ole32.StringFromGUID2.restype = c_int32;
  }
  return _ole32;
}

function kernel32() {
  if (!_kernel32) {
    _kernel32 = new WinDLL("kernel32.dll");
    _kernel32.LocalFree.argtypes = [c_void_p];
    _kernel32.LocalFree.restype = c_void_p;
  }
  return _kernel32;
}

// ─── Error helper ───────────────────────────────────────────────────

function check(rc, fn) {
  if (rc !== LDAP_SUCCESS) {
    throw new Error(`${fn} failed (LDAP error 0x${rc.toString(16)})`);
  }
}

// ─── Pointer / memory helpers ───────────────────────────────────────

/** Build a NULL-terminated array of wide-string pointers for LDAP attr list. */
function buildAttrList(properties) {
  if (!properties || properties.length === 0) return null;

  const bufs = properties.map((p) => create_unicode_buffer(p));
  const ptrArray = Buffer.alloc((properties.length + 1) * POINTER_SIZE);

  for (let i = 0; i < bufs.length; i++) {
    const addr = addressof(bufs[i]);
    if (POINTER_SIZE === 8) {
      ptrArray.writeBigUInt64LE(addr, i * POINTER_SIZE);
    } else {
      ptrArray.writeUInt32LE(Number(addr), i * POINTER_SIZE);
    }
  }
  // Keep references so GC doesn't collect the string buffers
  ptrArray._refs = bufs;
  return ptrArray;
}

/** Read a null-terminated wide string from a native pointer address. */
function readWideString(addr) {
  if (!addr || addr === 0n) return null;
  return wstring_at(addr);
}

/** Read a berval struct from the given address and return its data as a Buffer. */
function readBervalData(bervalAddr) {
  const bvSize = sizeof(LDAP_BERVAL);
  const buf = ptrToBuffer(bervalAddr, bvSize);
  const bv = new LDAP_BERVAL(buf);
  const len = bv.bv_len;
  const valAddr = bv.bv_val;

  if (!valAddr || valAddr === 0n || len === 0) return Buffer.alloc(0);
  return Buffer.from(ptrToBuffer(valAddr, len));
}

// ─── Value conversion helpers ───────────────────────────────────────

/** Convert a binary SID buffer to its string form (S-1-5-21-…). */
function sidToString(sidBuffer) {
  const api = advapi32();
  const k32 = kernel32();

  // Copy SID bytes into a native buffer
  const sidBuf = Buffer.alloc(sidBuffer.length);
  sidBuffer.copy(sidBuf);

  const strSidPtr = new c_void_p();
  const ok = api.ConvertSidToStringSidW(sidBuf, byref(strSidPtr));
  if (!ok) return null;

  const addr = strSidPtr.value;
  if (!addr || addr === 0n) return null;

  const str = wstring_at(addr);
  k32.LocalFree(addr);
  return str;
}

/** Convert a 16-byte GUID buffer to its string form ({XXXXXXXX-…}). */
function guidToString(guidBuffer) {
  if (guidBuffer.length < 16) return null;

  const api = ole32();
  const outBuf = create_unicode_buffer(39); // 38 chars + NUL

  const guidBuf = Buffer.alloc(16);
  guidBuffer.copy(guidBuf, 0, 0, 16);

  const len = api.StringFromGUID2(guidBuf, outBuf, 39);
  if (len === 0) return null;

  return wstring_at(outBuf).replace(/\0+$/, "");
}

/** Parse LDAP Generalized Time → ISO 8601 string. */
function parseGeneralizedTime(str) {
  if (!str || str.length < 14) return str;
  const y = str.substring(0, 4);
  const m = str.substring(4, 6);
  const d = str.substring(6, 8);
  const H = str.substring(8, 10);
  const M = str.substring(10, 12);
  const S = str.substring(12, 14);
  return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
}

/** Convert a Windows FILETIME (BigInt, 100-ns ticks since 1601-01-01) → ISO date. */
function fileTimeToDate(ft) {
  if (ft === 0n) return "No value set";
  if (ft === 0x7fffffffffffffffn || ft < 0n) return "Never Expires";

  // 11 644 473 600 000 ms difference between 1601 and 1970
  const EPOCH_DIFF = 11644473600000n;
  const ms = ft / 10000n - EPOCH_DIFF;

  try {
    const date = new Date(Number(ms));
    if (isNaN(date.getTime())) return ft.toString();
    return date.toISOString();
  } catch {
    return ft.toString();
  }
}

/**
 * Interpret a raw berval buffer according to the attribute's AD syntax.
 *
 * When the schema cache is loaded (via ensureSchema), uses the attribute's
 * syntax OID from CN=Schema,CN=Configuration — equivalent to ADSI's
 * ADS_SEARCH_COLUMN.dwADsType.
 *
 * - SID (2.5.5.17)           → "S-1-5-21-…"   (via ConvertSidToStringSidW)
 * - objectGUID               → "{XXXXXXXX-…}"  (via StringFromGUID2)
 * - OCTET_STRING (2.5.5.10)  → raw Buffer
 * - NT_SEC_DESC (2.5.5.15)   → raw Buffer
 * - BOOLEAN (2.5.5.8)        → true / false
 * - INTEGER (2.5.5.9)        → number
 * - LARGE_INTEGER (2.5.5.16) → string (or ISO date for known FILETIME attrs)
 * - TIME (2.5.5.11)          → ISO 8601 string
 * - Default (strings)        → UTF-8 decoded string
 */
function interpretValue(attrName, rawBuffer) {
  const lower = attrName.toLowerCase();
  const syntax = _schemaCache?.get(lower);

  // ── GUID: always needs special conversion (schema reports OCTET_STRING) ──
  if (lower === "objectguid") {
    return guidToString(rawBuffer) || rawBuffer.toString("hex");
  }

  // ── SID (2.5.5.17) ──
  if (syntax === AD_SYNTAX.SID || lower === "objectsid") {
    return sidToString(rawBuffer) || rawBuffer.toString("hex");
  }

  // ── Binary blobs ──
  if (syntax === AD_SYNTAX.OCTET_STRING || syntax === AD_SYNTAX.NT_SEC_DESC) {
    return rawBuffer;
  }

  // ── Boolean ──
  if (syntax === AD_SYNTAX.BOOLEAN) {
    return rawBuffer.toString("utf8").replace(/\0+$/, "") === "TRUE";
  }

  // ── Decode as UTF-8 for all remaining types ──
  let str;
  try {
    str = rawBuffer.toString("utf8").replace(/\0+$/, "");
  } catch {
    return rawBuffer.toString("hex");
  }

  // ── Integer ──
  if (syntax === AD_SYNTAX.INTEGER) {
    const n = parseInt(str, 10);
    return isNaN(n) ? str : n;
  }

  // ── Large Integer (may be FILETIME) ──
  if (syntax === AD_SYNTAX.LARGE_INTEGER) {
    if (LARGE_INT_DATE_ATTRIBUTES.has(attrName)) {
      try {
        return fileTimeToDate(BigInt(str));
      } catch {
        return str;
      }
    }
    return str;
  }

  // ── Generalized Time ──
  if (syntax === AD_SYNTAX.TIME) {
    return parseGeneralizedTime(str);
  }

  return str;
}

// ─── LDAP path parser ───────────────────────────────────────────────

/**
 * Parse a base path like "LDAP://server/DC=example,DC=com"
 * or "LDAP://DC=example,DC=com" into { host, baseDn }.
 */
function parseLdapPath(basePath) {
  let raw = basePath;
  if (raw.startsWith("LDAP://")) raw = raw.substring(7);

  let host = null;
  let baseDn = raw;

  // "server.domain.com/DC=…" pattern
  const slash = raw.indexOf("/");
  if (slash !== -1 && !raw.substring(0, slash).includes("=")) {
    host = raw.substring(0, slash);
    baseDn = raw.substring(slash + 1);
  }

  // Derive host from DC components when not specified explicitly
  if (!host) {
    const dcParts = [];
    const re = /DC=([^,]+)/gi;
    let m;
    while ((m = re.exec(baseDn)) !== null) dcParts.push(m[1]);
    if (dcParts.length > 0) host = dcParts.join(".");
  }

  return { host, baseDn };
}

// ─── ParsePathComponents ─────────────────────────────────────────────

/**
 * Extract the OU/CN path components from a distinguished name,
 * excluding the leaf (first RDN) and the DC= tail.
 * Returns the components in root→leaf order (reversed).
 *
 * E.g. "CN=John,OU=Staff,OU=Paris,DC=example,DC=com"
 *   → ["Paris", "Staff"]
 */
export function parsePathComponents(dn) {
  const components = [];

  // Find where DC= components begin
  const dcPos = dn.search(/DC=/i);
  const limit = dcPos === -1 ? dn.length : dcPos;

  let first = true;
  let pos = 0;
  while (pos < limit) {
    const eq = dn.indexOf("=", pos);
    if (eq === -1 || eq >= limit) break;

    const valStart = eq + 1;
    let comma = dn.indexOf(",", valStart);
    if (comma === -1 || comma >= limit) comma = limit;

    if (first) {
      first = false; // skip the leaf RDN
    } else {
      components.push(dn.substring(valStart, comma));
    }

    pos = comma < limit ? comma + 1 : limit;
  }

  components.reverse();
  return components;
}

// ─── Tree building (OUTPUT_TYPE.TREE) ───────────────────────────────

/** Simple string hash (matches std::hash<std::string> in spirit). */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Add _path, title, id metadata to an object for tree display.
 */
function prepareObjectForTree(obj, dn, ouPath) {
  obj._path = ouPath;
  if (obj.title && Array.isArray(obj.title) && obj.title.length > 0) {
    obj.title = obj.title[0];
  }
  if (!obj.title) {
    obj.title = dn;
  }
  if (!obj.id) {
    obj.id = hashString(dn);
  }
}

/**
 * Convert a flat array of LDAP objects into a tree organized by OU path.
 *
 * Intermediate OU nodes: { id, title, _path, children: [] }
 * Leaf objects: { ...attrs, _path, title, id }
 *
 * @param {object[]} flatResults - Flat array from findObjects / query
 * @returns {object[]} Tree structure
 */
export function toTree(flatResults) {
  const tree = [];
  const pathCache = new Map();

  for (const obj of flatResults) {
    const dnArr = obj.distinguishedName;
    if (!dnArr || !Array.isArray(dnArr) || dnArr.length === 0) {
      tree.push(obj);
      continue;
    }

    const dn = dnArr[0];
    const ouPath = parsePathComponents(dn);
    prepareObjectForTree(obj, dn, ouPath);

    let current = tree;
    let pathKey = "";
    const currentPath = [];

    for (const child of ouPath) {
      pathKey += "/" + child;
      currentPath.push(child);

      const cached = pathCache.get(pathKey);
      if (cached) {
        current = cached;
      } else {
        let found = current.find((node) => node.title === child);
        if (!found) {
          found = {
            id: hashString(child),
            title: child,
            _path: [...currentPath],
            children: [],
          };
          current.push(found);
        }
        current = found.children;
        pathCache.set(pathKey, current);
      }
    }

    current.push(obj);
  }

  return tree;
}

// ─── Sorting ────────────────────────────────────────────────────────

/**
 * Sort key: containers (nodes with children/title) sort before leaves.
 */
function extractSortKey(node) {
  if (node.distinguishedName && Array.isArray(node.distinguishedName) && node.distinguishedName.length > 0) {
    return "1" + node.distinguishedName[0];
  }
  if (node.title && typeof node.title === "string") {
    return "0" + node.title;
  }
  return "";
}

/**
 * Sort a flat array of LDAP objects by distinguishedName.
 */
export function sortByDN(array) {
  if (!Array.isArray(array) || array.length <= 1) return array;
  return array.sort((a, b) => extractSortKey(a).localeCompare(extractSortKey(b)));
}

/**
 * Recursively sort a tree (from toTree) — containers first, then leaves,
 * both alphabetically.
 */
export function sortTreeByDN(array) {
  if (!Array.isArray(array) || array.length <= 1) return array;

  for (const node of array) {
    if (node.children && Array.isArray(node.children)) {
      sortTreeByDN(node.children);
    }
  }

  array.sort((a, b) => extractSortKey(a).localeCompare(extractSortKey(b)));
  return array;
}

// ─── Internal: connect + bind helper ────────────────────────────────

/**
 * Open an LDAP connection and authenticate.
 * Returns the LDAP session handle (ld).
 */
function ldapConnect(host, options = {}) {
  const ldap = wldap32();

  const hostBuf = host ? create_unicode_buffer(host) : null;
  const ld = ldap.ldap_initW(hostBuf, options.port || LDAP_PORT);
  if (!ld || ld === 0n) {
    throw new Error(`ldap_initW failed: could not connect to ${host || "default"}`);
  }

  try {
    const version = new c_uint32(LDAP_VERSION3);
    let rc = ldap.ldap_set_optionW(ld, LDAP_OPT_VERSION, byref(version));
    check(rc, "ldap_set_optionW(LDAP_OPT_VERSION)");

    const referrals = new c_uint32(LDAP_OPT_OFF);
    rc = ldap.ldap_set_optionW(ld, LDAP_OPT_REFERRALS, byref(referrals));
    check(rc, "ldap_set_optionW(LDAP_OPT_REFERRALS)");

    if (options.username && options.password) {
      const userBuf = create_unicode_buffer(options.username);
      const passBuf = create_unicode_buffer(options.password);
      const domainBuf = options.domain ? create_unicode_buffer(options.domain) : null;

      const auth = new SEC_WINNT_AUTH_IDENTITY_W();
      auth.User = addressof(userBuf);
      auth.UserLength = options.username.length;
      auth.Password = addressof(passBuf);
      auth.PasswordLength = options.password.length;
      if (domainBuf) {
        auth.Domain = addressof(domainBuf);
        auth.DomainLength = options.domain.length;
      } else {
        auth.Domain = 0n;
        auth.DomainLength = 0;
      }
      auth.Flags = SEC_WINNT_AUTH_IDENTITY_UNICODE;

      rc = ldap.ldap_bind_sW(ld, null, byref(auth), LDAP_AUTH_NEGOTIATE);
      auth._refs = { userBuf, passBuf, domainBuf };
    } else {
      rc = ldap.ldap_bind_sW(ld, null, null, LDAP_AUTH_NEGOTIATE);
    }
    check(rc, "ldap_bind_sW");

    return ld;
  } catch (err) {
    try {
      ldap.ldap_unbind(ld);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Build a NULL-terminated array with a single control pointer (for server controls). */
function buildControlsArray(controlPtr) {
  const arr = Buffer.alloc(2 * POINTER_SIZE); // [controlPtr, NULL]
  if (POINTER_SIZE === 8) {
    arr.writeBigUInt64LE(controlPtr, 0);
  } else {
    arr.writeUInt32LE(Number(controlPtr), 0);
  }
  return arr;
}

// ─── Schema loader ──────────────────────────────────────────────────

/**
 * Load AD attribute schema so interpretValue can use syntax OIDs
 * instead of hardcoded attribute-name sets.
 *
 * Queries CN=Schema,CN=Configuration,DC=… for all attributeSchema objects,
 * building a Map<lowerAttrName, syntaxOID> cached for the session lifetime.
 *
 * Has a recursion guard: ensureSchema → query → ensureSchema is a no-op
 * on the second call because _loadingSchema is already true.
 */
function ensureSchema(basePath, options) {
  if (_schemaCache || _loadingSchema) return;
  _loadingSchema = true;

  try {
    const { baseDn } = parseLdapPath(basePath);
    const dcPart = baseDn.match(/DC=.*/i)?.[0];
    if (!dcPart) return;

    const schemaDn = `CN=Schema,CN=Configuration,${dcPart}`;
    const schemaPath = `LDAP://${schemaDn}`;

    const attrs = query("(objectClass=attributeSchema)", schemaPath, SCOPE.ONELEVEL, ["lDAPDisplayName", "attributeSyntax"], { ...options, maxObjects: -1 });

    _schemaCache = new Map();
    for (const attr of attrs) {
      const name = attr.lDAPDisplayName?.[0];
      const syntax = attr.attributeSyntax?.[0];
      if (name && syntax) {
        _schemaCache.set(name.toLowerCase(), syntax);
      }
    }
  } catch (err) {
    console.warn("Warning: could not load AD schema:", err.message);
  } finally {
    _loadingSchema = false;
  }
}

// ─── Core functions ─────────────────────────────────────────────────

/**
 * Open an LDAP connection, authenticate, and execute a search.
 *
 * @param {string|null} host     - LDAP server hostname (null = auto-detect from baseDn)
 * @param {string}      baseDn   - Search base distinguished name
 * @param {number}      scope    - SCOPE.BASE | SCOPE.ONELEVEL | SCOPE.SUBTREE
 * @param {string}      filter   - LDAP search filter
 * @param {string[]}    properties - Attributes to return (empty = all)
 * @param {object}      [options]
 * @param {number}      [options.port=389]
 * @param {string}      [options.username]
 * @param {string}      [options.password]
 * @param {string}      [options.domain]
 * @returns {{ ld: BigInt, searchResult: BigInt }}
 */
export function queryBegin(host, baseDn, scope, filter, properties, options = {}) {
  const ldap = wldap32();
  const ld = ldapConnect(host, options);

  try {
    const baseDnBuf = create_unicode_buffer(baseDn);
    const filterBuf = create_unicode_buffer(filter);
    const attrList = buildAttrList(properties);
    const resultPtr = new c_void_p();

    const rc = ldap.ldap_search_sW(ld, baseDnBuf, scope, filterBuf, attrList, 0, byref(resultPtr));
    check(rc, "ldap_search_sW");

    return { ld, searchResult: resultPtr.value };
  } catch (err) {
    try {
      ldap.ldap_unbind(ld);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Iterate over search results and build an array of objects.
 *
 * Each result object has attributes as keys, values as arrays (multi-valued).
 * Special handling for objectSid, objectGUID, date/time, and boolean attributes.
 *
 * @param {BigInt}  ld           - LDAP connection handle
 * @param {BigInt}  searchResult - Search result handle from queryBegin
 * @param {number}  [maxObjects=-1] - Max objects to return (-1 = unlimited)
 * @returns {object[]}
 */
export function findObjects(ld, searchResult, maxObjects = -1) {
  const ldap = wldap32();
  const results = [];

  let entry = ldap.ldap_first_entry(ld, searchResult);

  while (entry && entry !== 0n) {
    const obj = {};

    // ── Distinguished name ──
    const dnPtr = ldap.ldap_get_dnW(ld, entry);
    if (dnPtr && dnPtr !== 0n) {
      const dn = readWideString(dnPtr);
      if (dn) obj.distinguishedName = [dn];
      ldap.ldap_memfreeW(dnPtr);
    }

    // ── Attribute iteration ──
    const berElem = new c_void_p();
    let attrPtr = ldap.ldap_first_attributeW(ld, entry, byref(berElem));

    while (attrPtr && attrPtr !== 0n) {
      const attrName = readWideString(attrPtr);
      if (!attrName) {
        attrPtr = ldap.ldap_next_attributeW(ld, entry, berElem.value);
        continue;
      }

      // Get attribute values (berval array)
      const attrBuf = create_unicode_buffer(attrName);
      const valuesPtr = ldap.ldap_get_values_lenW(ld, entry, attrBuf);

      if (valuesPtr && valuesPtr !== 0n) {
        const count = ldap.ldap_count_values_len(valuesPtr);
        const values = [];

        if (count > 0) {
          // valuesPtr → array of berval* pointers
          const ptrBuf = ptrToBuffer(valuesPtr, count * POINTER_SIZE);

          for (let i = 0; i < count; i++) {
            const bervalAddr = readValue(ptrBuf, c_void_p, i * POINTER_SIZE);
            if (!bervalAddr || bervalAddr === 0n) break;

            const rawData = readBervalData(bervalAddr);
            if (rawData.length > 0) {
              values.push(interpretValue(attrName, rawData));
            }
          }
        }

        if (values.length > 0) {
          obj[attrName] = values;
        }

        ldap.ldap_value_free_len(valuesPtr);
      }

      attrPtr = ldap.ldap_next_attributeW(ld, entry, berElem.value);
    }

    // Free BerElement
    if (berElem.value && berElem.value !== 0n) {
      ldap.ber_free(berElem.value, 0);
    }

    results.push(obj);

    if (maxObjects !== -1 && results.length >= maxObjects) break;

    entry = ldap.ldap_next_entry(ld, entry);
  }

  return results;
}

/**
 * Release search results and close the LDAP connection.
 *
 * @param {BigInt} ld           - LDAP connection handle
 * @param {BigInt} searchResult - Search result handle
 */
export function queryEnd(ld, searchResult) {
  const ldap = wldap32();

  if (searchResult && searchResult !== 0n) {
    ldap.ldap_msgfree(searchResult);
  }
  if (ld && ld !== 0n) {
    ldap.ldap_unbind(ld);
  }
}

// ─── LDAPModW builder ────────────────────────────────────────────────
//
// LDAPModW layout (x64): mod_op(4) + pad(4) + mod_type(8) + mod_vals(8) = 24
// LDAPModW layout (x86): mod_op(4) + mod_type(4) + mod_vals(4) = 12

const LDAPMOD_SIZE = POINTER_SIZE === 8 ? 24 : 12;
const LDAPMOD_OFF_TYPE = POINTER_SIZE === 8 ? 8 : 4;
const LDAPMOD_OFF_VALS = POINTER_SIZE === 8 ? 16 : 8;

function writePtr(buf, offset, ptr) {
  if (POINTER_SIZE === 8) {
    buf.writeBigUInt64LE(typeof ptr === "bigint" ? ptr : BigInt(ptr), offset);
  } else {
    buf.writeUInt32LE(Number(ptr), offset);
  }
}

/**
 * Build a single LDAPModW struct as a Buffer.
 * @param {number} op     - MOD_OP.ADD | MOD_OP.DELETE | MOD_OP.REPLACE
 * @param {string} attr   - Attribute name
 * @param {string[]} [values] - Values (omit or empty for DELETE of entire attribute)
 * @returns {Buffer} The LDAPModW struct (with ._refs to prevent GC)
 */
function buildLdapMod(op, attr, values) {
  const mod = Buffer.alloc(LDAPMOD_SIZE);

  // mod_op
  mod.writeUInt32LE(op, 0);

  // mod_type — wide string pointer
  const attrBuf = create_unicode_buffer(attr);
  writePtr(mod, LDAPMOD_OFF_TYPE, addressof(attrBuf));

  // mod_vals — NULL-terminated array of wide string pointers
  let valsArray = null;
  const refs = [attrBuf];

  if (values && values.length > 0) {
    valsArray = Buffer.alloc((values.length + 1) * POINTER_SIZE); // +1 for NULL terminator
    for (let i = 0; i < values.length; i++) {
      const valBuf = create_unicode_buffer(String(values[i]));
      refs.push(valBuf);
      writePtr(valsArray, i * POINTER_SIZE, addressof(valBuf));
    }
    // Last slot is already 0 (NULL) from Buffer.alloc
    writePtr(mod, LDAPMOD_OFF_VALS, addressof(valsArray));
    refs.push(valsArray);
  } else {
    // NULL pointer — delete entire attribute or no values
    writePtr(mod, LDAPMOD_OFF_VALS, 0n);
  }

  mod._refs = refs;
  return mod;
}

/**
 * Build the NULL-terminated array of LDAPModW* for ldap_modify_sW.
 * @param {Array<{op: number, attr: string, values?: string[]}>} modifications
 * @returns {Buffer}
 */
function buildModsArray(modifications) {
  const mods = modifications.map((m) => buildLdapMod(m.op, m.attr, m.values));
  const arr = Buffer.alloc((mods.length + 1) * POINTER_SIZE);

  for (let i = 0; i < mods.length; i++) {
    writePtr(arr, i * POINTER_SIZE, addressof(mods[i]));
  }
  // Last slot is NULL from Buffer.alloc

  arr._refs = mods;
  return arr;
}

// ─── Modify ──────────────────────────────────────────────────────────

/**
 * Modify attributes of an LDAP object.
 *
 * @param {string} dn            - Distinguished name of the object to modify
 * @param {Array<{op: number, attr: string, values?: string[]}>} modifications
 *   Each element:
 *     - op:     MOD_OP.ADD | MOD_OP.DELETE | MOD_OP.REPLACE
 *     - attr:   Attribute name (e.g. "mail", "telephoneNumber")
 *     - values: Array of string values (omit for DELETE of entire attribute)
 * @param {string} basePath      - "LDAP://DC=example,DC=com" (used for connection)
 * @param {object} [options]     - Same connection options as query()
 */
export function modify(dn, modifications, basePath, options = {}) {
  const ldap = wldap32();
  const { host } = parseLdapPath(basePath);
  const ld = ldapConnect(options.host || host, options);

  try {
    const dnBuf = create_unicode_buffer(dn);
    const modsArray = buildModsArray(modifications);

    const rc = ldap.ldap_modify_sW(ld, dnBuf, modsArray);
    check(rc, "ldap_modify_sW");
  } finally {
    ldap.ldap_unbind(ld);
  }
}

/**
 * High-level query function with automatic paging.
 * Connects, authenticates, and iterates through ALL pages of results.
 *
 * @param {string}   filter      - LDAP filter, e.g. "(objectClass=user)"
 * @param {string}   basePath    - "LDAP://DC=example,DC=com" or "LDAP://server/DC=…"
 * @param {number}   [scope]     - SCOPE.BASE | SCOPE.ONELEVEL | SCOPE.SUBTREE
 * @param {string[]} [properties] - Attributes to return ([] = all)
 * @param {object}   [options]
 * @param {string}   [options.host]       - Override LDAP server hostname
 * @param {number}   [options.port=389]   - LDAP port
 * @param {string}   [options.username]   - Explicit username
 * @param {string}   [options.password]   - Explicit password
 * @param {string}   [options.domain]     - NT domain for NEGOTIATE auth
 * @param {number}   [options.pageSize=1000] - Page size for paged results
 * @param {number}   [options.maxObjects=-1] - Limit results (-1 = unlimited)
 * @param {number}   [options.outputType=OUTPUT_TYPE.FLAT] - FLAT=flat array, TREE=tree by OU path
 * @param {function} [options.onObject] - Callback invoked per-object
 * @returns {object[]} Array (FLAT) or tree (TREE) of LDAP objects
 */
export function query(filter, basePath, scope = SCOPE.SUBTREE, properties = [], options = {}) {
  ensureSchema(basePath, options);

  const ldap = wldap32();
  const { host, baseDn } = parseLdapPath(basePath);
  const pageSize = options.pageSize || 1000;
  const maxObjects = options.maxObjects || -1;

  const ld = ldapConnect(options.host || host, options);

  try {
    const baseDnBuf = create_unicode_buffer(baseDn);
    const filterBuf = create_unicode_buffer(filter);
    const attrList = buildAttrList(properties);
    const allResults = [];

    // Cookie for paging — starts as NULL (empty berval)
    let cookiePtr = null; // berval* for the cookie

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 1. Create page control
      const pageControlPtr = new c_void_p();
      let rc = ldap.ldap_create_page_controlW(ld, pageSize, cookiePtr, 1, byref(pageControlPtr));
      check(rc, "ldap_create_page_controlW");

      // 2. Build server controls array: [pageControl, NULL]
      const serverControls = buildControlsArray(pageControlPtr.value);

      // 3. Paged search
      const resultPtr = new c_void_p();
      rc = ldap.ldap_search_ext_sW(
        ld,
        baseDnBuf,
        scope,
        filterBuf,
        attrList,
        0, // attrsonly
        serverControls, // server controls
        null, // client controls
        null, // timeout
        0, // sizelimit (0 = server default)
        byref(resultPtr),
      );
      check(rc, "ldap_search_ext_sW");

      // 4. Process this page of results
      const pageResults = findObjects(ld, resultPtr.value, maxObjects === -1 ? -1 : maxObjects - allResults.length);
      allResults.push(...pageResults);

      // 5. Parse server controls from result to get the cookie for next page
      const returnedControlsPtr = new c_void_p();
      const returnCode = new c_uint32();
      rc = ldap.ldap_parse_resultW(ld, resultPtr.value, byref(returnCode), null, null, null, byref(returnedControlsPtr), 0);

      // Free search result
      ldap.ldap_msgfree(resultPtr.value);
      // Free page control
      ldap.ldap_control_freeW(pageControlPtr.value);

      if (rc !== LDAP_SUCCESS || !returnedControlsPtr.value || returnedControlsPtr.value === 0n) {
        break;
      }

      // 6. Extract cookie from returned controls
      const totalCount = new c_uint32();
      const newCookiePtr = new c_void_p(); // will receive berval*
      rc = ldap.ldap_parse_page_controlW(ld, returnedControlsPtr.value, byref(totalCount), byref(newCookiePtr));

      // Free returned server controls
      ldap.ldap_controls_freeW(returnedControlsPtr.value);

      if (rc !== LDAP_SUCCESS) break;

      // 7. Check if cookie is empty (no more pages)
      if (!newCookiePtr.value || newCookiePtr.value === 0n) break;

      // Read cookie berval to check bv_len
      const cookieBuf = ptrToBuffer(newCookiePtr.value, sizeof(LDAP_BERVAL));
      const cookieBv = new LDAP_BERVAL(cookieBuf);
      if (cookieBv.bv_len === 0) {
        // free the empty cookie berval
        ldap.ber_bvfree(newCookiePtr.value);
        break;
      }

      // Free the previous cookie before moving to the next one
      if (cookiePtr) {
        ldap.ber_bvfree(cookiePtr);
      }
      cookiePtr = newCookiePtr.value;

      // Check maxObjects limit
      if (maxObjects !== -1 && allResults.length >= maxObjects) {
        allResults.length = maxObjects;
        break;
      }
    }

    // Free the last cookie if the loop exited with one still allocated
    if (cookiePtr) {
      ldap.ber_bvfree(cookiePtr);
    }

    // ── Output type handling ──
    const outputType = options.outputType ?? OUTPUT_TYPE.FLAT;
    const onObject = typeof options.onObject === "function" ? options.onObject : null;

    if (outputType === OUTPUT_TYPE.TREE) {
      const tree = toTree(allResults);
      sortTreeByDN(tree);

      if (onObject) {
        const walk = (nodes) => {
          for (const node of nodes) {
            onObject(node);
            if (node.children && Array.isArray(node.children)) {
              walk(node.children);
            }
          }
        };
        walk(tree);
      }

      return tree;
    }

    // FLAT mode — flat sorted array
    sortByDN(allResults);

    if (onObject) {
      for (const obj of allResults) {
        onObject(obj);
      }
    }

    return allResults;
  } finally {
    ldap.ldap_unbind(ld);
  }
}

// ─── Ldap — static façade ───────────────────────────────────────────

export class Ldap {
  /**
   * Query an LDAP directory.
   * @see query() for full parameter documentation.
   */
  static query(filter, basePath, scope = SCOPE.SUBTREE, properties = [], options = {}) {
    return query(filter, basePath, scope, properties, options);
  }

  /**
   * Modify attributes of an LDAP object.
   * @see modify() for full parameter documentation.
   */
  static modify(dn, modifications, basePath, options = {}) {
    return modify(dn, modifications, basePath, options);
  }

  /** Release all shared DLL handles. */
  static close() {
    _schemaCache = null;
    if (_wldap32) {
      _wldap32.close();
      _wldap32 = null;
    }
    if (_advapi32) {
      _advapi32.close();
      _advapi32 = null;
    }
    if (_ole32) {
      _ole32.close();
      _ole32 = null;
    }
    if (_kernel32) {
      _kernel32.close();
      _kernel32 = null;
    }
  }
}

export default Ldap;
