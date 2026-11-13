// demo_com_active_directory — Active Directory search through ADSI (COM)
//
// Queries Active Directory with ./ads.js: ADsOpenObject + IDirectorySearch,
// vtable dispatch through ./comtypes.js, values typed by ADSI. HRESULT
// failures throw automatically (parity with Python comtypes).
//
// Usage:
//   node examples/windows/com/demo_com_active_directory.js --base "LDAP://DC=contoso,DC=com" \
//        --filter "(objectClass=user)" --attributes "sAMAccountName,displayName,mail"

import { WinDLL, POINTER, byref, create_unicode_buffer } from "node-ctypes";
import { wintypes } from "node-ctypes";
import { Ads, SCOPE } from "./ads.js";
// Reuse the flat → tree helpers from the LDAP demo (OU-path based grouping).
import { OUTPUT_TYPE, toTree, sortByDN, sortTreeByDN } from "../ldap/ldap.js";
const { BOOL, DWORD, INT, LPWSTR } = wintypes;

// BOOL GetComputerNameExW(COMPUTER_NAME_FORMAT NameType, LPWSTR lpBuffer, LPDWORD nSize);
const kernel32 = new WinDLL("kernel32.dll");
kernel32.GetComputerNameExW.argtypes = [INT, LPWSTR, POINTER(DWORD)];
kernel32.GetComputerNameExW.restype = BOOL;
const ComputerNameDnsDomain = 2;

// ─── Detect domain base DN from environment ─────────────────────────

function detectBasePath() {
  // The user's logon domain (e.g. "corp.example.com"), set in interactive
  // sessions; otherwise the DNS domain of the computer. USERDOMAIN is the
  // NetBIOS name, not a DNS name: it cannot build the DN.
  const dnsDomain = process.env.USERDNSDOMAIN || computerDnsDomain();
  if (!dnsDomain) return null;
  const dcParts = dnsDomain
    .split(".")
    .map((p) => `DC=${p}`)
    .join(",");
  return `LDAP://${dcParts}`;
}

/** GetComputerNameExW(ComputerNameDnsDomain): "" when the computer is not in a domain. */
function computerDnsDomain() {
  const name = create_unicode_buffer(256);
  const size = new DWORD(256);
  return kernel32.GetComputerNameExW(ComputerNameDnsDomain, name, byref(size)) ? name.value : "";
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
        const scope = args[++i].toUpperCase();
        if (!(scope in SCOPE)) {
          console.error(`Unknown scope: ${scope.toLowerCase()}`);
          process.exit(1);
        }
        opts.scope = SCOPE[scope];
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
    console.error('  Example: node demo_com_active_directory.js --base "LDAP://DC=example,DC=com"');
    process.exit(1);
  }

  console.log(`ADS Demo — base: ${basePath}`);

  const searchFilter = opts.filter || "(&(objectClass=user)(objectCategory=person))";
  const attributes = opts.attributes ? opts.attributes.split(",") : ["distinguishedName", "cn", "displayName", "userPrincipalName", "givenName", "sn", "mail", "objectSid", "objectGUID", "jpegPhoto"];

  try {
    console.time("Enumerating rows");
    const rows = Ads.search(searchFilter, basePath, opts.scope ?? SCOPE.SUBTREE, attributes, {
      username: opts.username,
      password: opts.password,
      pageSize: opts.pageSize || 1000,
    });
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
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    Ads.close();
    kernel32.close();
  }
}

main();
