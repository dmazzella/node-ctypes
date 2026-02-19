// LDAP Demo — using the reusable Ldap wrapper
// Demonstrates: query, queryBegin, findObjects, queryEnd, modify, parsePathComponents
//
// Run on a domain-joined Windows machine:
//   node examples/windows/demo_ldap.js
//
// With explicit credentials:
//   node examples/windows/demo_ldap.js --user admin --pass secret --domain EXAMPLE
//
// With a custom base path:
//   node examples/windows/demo_ldap.js --base "LDAP://DC=corp,DC=example,DC=com"

import { Ldap, SCOPE, OUTPUT_TYPE, MOD_OP, query, queryBegin, findObjects, queryEnd, modify, parsePathComponents, toTree, sortByDN, sortTreeByDN } from "./ldap/ldap.js";

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

// ─── Detect domain base DN from environment ─────────────────────────

function detectBasePath() {
  // Use USERDNSDOMAIN environment variable (e.g. "corp.example.com")
  const dnsDomain = process.env.USERDNSDOMAIN;
  if (dnsDomain) {
    const dcParts = dnsDomain
      .split(".")
      .map((p) => `DC=${p}`)
      .join(",");
    return `LDAP://${dcParts}`;
  }

  // Fallback to LOGONSERVER + USERDOMAIN
  const userDomain = process.env.USERDOMAIN;
  if (userDomain) {
    return `LDAP://DC=${userDomain}`;
  }

  return null;
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
  // ── 1. Query users (high-level API) ──────────────────────────────

  console.log("\n[1] Querying users (Ldap.query) ...");

  const userFilter = "(&(objectClass=user)(objectCategory=person))";
  const scope = SCOPE.SUBTREE;
  const properties = ["distinguishedName", "cn", "displayName", "userPrincipalName", "givenName", "sn", "mail", "objectSid", "objectGUID", "jpegPhoto"];

  console.time("Query time");
  const users = Ldap.query(userFilter, basePath, scope, properties, queryOpts);
  console.timeEnd("Query time");

  console.log(`\n  Retrieved ${users.length} user(s).`);

  if (opts.debug) {
    console.log(users);
  }

  // // ── 2. Low-level API demo (queryBegin / findObjects / queryEnd) ──

  // console.log("\n[2] Low-level API demo (queryBegin → findObjects → queryEnd) ...");

  // const { ld, searchResult } = queryBegin(queryOpts.host || null, basePath.replace(/^LDAP:\/\//, ""), SCOPE.SUBTREE, "(&(objectClass=organizationalUnit))", ["ou", "description", "distinguishedName"], queryOpts);

  // try {
  //   const ous = findObjects(ld, searchResult, 10);
  //   console.log(`\n  Retrieved ${ous.length} OU(s).`);
  //   if (opts.debug) {
  //     console.log(ous);
  //   }
  // } finally {
  //   queryEnd(ld, searchResult);
  // }

  // // ── 3. Modify attributes ──────────────────────────────────────

  // console.log("\n[3] Modifying user attributes ...");

  // const targetDn = "CN=John Doe,OU=Users,DC=example,DC=com";
  // Ldap.modify(targetDn, [
  //   { op: MOD_OP.REPLACE, attr: "mail", values: ["john.doe@example.com"] },
  //   { op: MOD_OP.ADD, attr: "telephoneNumber", values: ["+39 02 1234567"] },
  //   { op: MOD_OP.DELETE, attr: "facsimileTelephoneNumber" },
  // ], basePath, queryOpts);

  // console.log(`  Modified: ${targetDn}`);

  // ── Cleanup ──────────────────────────────────────────────────────

  Ldap.close();
  console.log("\nDone.");
}

try {
  main();
} catch (err) {
  console.error("Error:", err.message);
  Ldap.close();
  process.exit(1);
}
