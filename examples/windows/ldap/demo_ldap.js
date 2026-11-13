// LDAP Demo — using the reusable Ldap wrapper
// Demonstrates: query (paged, high level) and queryBegin / findObjects /
// queryEnd (low level). Ldap.modify() is shown in the README: this demo only
// reads the directory.
//
// Run on a domain-joined Windows machine:
//   node examples/windows/ldap/demo_ldap.js
//
// With explicit credentials:
//   node examples/windows/ldap/demo_ldap.js --user admin --pass secret --domain EXAMPLE
//
// With a custom base path:
//   node examples/windows/ldap/demo_ldap.js --base "LDAP://DC=corp,DC=example,DC=com"

import { WinDLL, POINTER, byref, create_unicode_buffer } from "node-ctypes";
import { wintypes } from "node-ctypes";
import { Ldap, SCOPE, OUTPUT_TYPE, queryBegin, findObjects, queryEnd } from "./ldap.js";
const { BOOL, DWORD, INT, LPWSTR } = wintypes;

// ─── CLI argument parsing ───────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--base":
        opts.basePath = args[++i];
        break;
      case "--host":
        opts.host = args[++i];
        break;
      case "--user":
        opts.username = args[++i];
        break;
      case "--pass":
        opts.password = args[++i];
        break;
      case "--domain":
        opts.domain = args[++i];
        break;
      case "--max":
        opts.maxObjects = parseInt(args[++i], 10);
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

// ─── Detect domain base DN ──────────────────────────────────────────

const kernel32 = new WinDLL("kernel32.dll");
// BOOL GetComputerNameExW(COMPUTER_NAME_FORMAT NameType, LPWSTR lpBuffer, LPDWORD nSize);
kernel32.GetComputerNameExW.argtypes = [INT, LPWSTR, POINTER(DWORD)];
kernel32.GetComputerNameExW.restype = BOOL;
const ComputerNameDnsDomain = 2;

/** GetComputerNameExW(ComputerNameDnsDomain): "" when the computer is not in a domain. */
function computerDnsDomain() {
  const name = create_unicode_buffer(256);
  const size = new DWORD(256);
  return kernel32.GetComputerNameExW(ComputerNameDnsDomain, name, byref(size)) ? name.value : "";
}

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

// ─── Main demo ──────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();
  const basePath = opts.basePath || detectBasePath();

  if (!basePath) {
    console.error("Error: Could not detect domain. Use --base to specify the LDAP path.");
    console.error('  Example: node demo_ldap.js --base "LDAP://DC=example,DC=com"');
    process.exit(1);
  }

  console.log(`LDAP Demo — base: ${basePath}`);

  const queryOpts = {};
  if (opts.username) queryOpts.username = opts.username;
  if (opts.password) queryOpts.password = opts.password;
  if (opts.domain) queryOpts.domain = opts.domain;
  if (opts.host) queryOpts.host = opts.host;
  if (opts.maxObjects) queryOpts.maxObjects = opts.maxObjects;
  if (opts.outputType) queryOpts.outputType = opts.outputType;
  if (opts.debug) queryOpts.debug = opts.debug;

  // ── 1. Query users (high-level API, paged, signed and sealed) ────

  console.log("\n[1] Querying users (Ldap.query) ...");

  const userFilter = "(&(objectClass=user)(objectCategory=person))";
  const properties = ["distinguishedName", "cn", "displayName", "userPrincipalName", "givenName", "sn", "mail", "objectSid", "objectGUID", "jpegPhoto"];

  console.time("Query time");
  const users = Ldap.query(userFilter, basePath, SCOPE.SUBTREE, properties, queryOpts);
  console.timeEnd("Query time");

  // In TREE mode `users` is the tree root (top-level OU nodes). Count leaves
  // recursively so the display matches the real record count.
  const countLeaves = (nodes) => nodes.reduce((n, node) => n + (Array.isArray(node.children) ? countLeaves(node.children) : 1), 0);
  const total = opts.outputType === OUTPUT_TYPE.TREE ? countLeaves(users) : users.length;
  console.log(`\n  Retrieved ${total} user(s) — output: ${opts.outputType === OUTPUT_TYPE.TREE ? "tree" : "flat"}`);

  if (opts.debug) {
    console.dir(users, { depth: null });
  }

  // ── 2. Low-level API (queryBegin / findObjects / queryEnd) ───────

  console.log("\n[2] Low-level API (queryBegin → findObjects → queryEnd) ...");

  const baseDn = basePath.replace(/^LDAP:\/\/(?:[^/=]+\/)?/, "");
  const { ld, searchResult } = queryBegin(queryOpts.host || null, baseDn, SCOPE.SUBTREE, "(objectClass=organizationalUnit)", ["ou", "description", "distinguishedName"], queryOpts);
  try {
    const ous = findObjects(ld, searchResult, 10);
    console.log(`  First ${ous.length} OU(s):`);
    for (const ou of ous) console.log(`    ${ou.distinguishedName?.[0]}`);
  } finally {
    queryEnd(ld, searchResult);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  Ldap.close();
  kernel32.close();
  console.log("\nDone.");
}

try {
  main();
} catch (err) {
  console.error("Error:", err.message);
  Ldap.close();
  process.exit(1);
}
