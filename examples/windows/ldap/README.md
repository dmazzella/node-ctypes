---
title: LDAP
---

# LDAP Directory Queries

A wrapper of the Windows LDAP client (`wldap32.dll`): bind with the current or explicit credentials, paged search, modify, and results as a flat list or as a tree by OU path. Attribute values are decoded with the Active Directory schema (SIDs, GUIDs, dates, ...).

**Platform:** Windows · **Library:** [ldap.js](ldap.js) · **Requires:** a domain-joined machine, or `--base` / `--host` / credentials

## Run

```bash
node examples/windows/ldap/demo_ldap.js
node examples/windows/ldap/demo_ldap.js --user admin --pass secret --domain EXAMPLE
node examples/windows/ldap/demo_ldap.js --base "LDAP://DC=corp,DC=example,DC=com" --tree
```

| Option                         | Description                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `--base <path>`                | LDAP base path (default: `USERDNSDOMAIN`, or the DNS domain of the computer) |
| `--host <server>`              | LDAP server                                                                  |
| `--user`, `--pass`, `--domain` | Explicit credentials                                                         |
| `--max <n>`                    | Maximum number of objects                                                    |
| `--tree`                       | Group results by OU path                                                     |
| `--debug`                      | Print the results                                                            |

## Use the library

```javascript
import { Ldap, SCOPE, MOD_OP } from "./ldap.js";

const users = Ldap.query("(&(objectClass=user)(objectCategory=person))", "LDAP://DC=corp,DC=example,DC=com", SCOPE.SUBTREE, ["cn", "mail", "objectSid"]);
console.log(users[0].cn, users[0].objectSid);

Ldap.modify("CN=Alice,OU=Users,DC=corp,DC=example,DC=com", [{ op: MOD_OP.REPLACE, attr: "mail", values: ["alice@example.com"] }], "LDAP://DC=corp,DC=example,DC=com");
Ldap.close();
```

The demo only reads the directory: `Ldap.modify()` is shown here.

Connections are signed and sealed (`LDAP_OPT_SIGN`, `LDAP_OPT_ENCRYPT`) after the Negotiate bind, as domain controllers requiring LDAP signing expect; pass `{ encrypt: false }` to turn it off. `ldap_connect` opens the connection with a timeout (`{ timeout }` in seconds, default 10). Errors carry the LDAP message (`ldap_err2stringW`) and the code (`error.ldapError`); paged searches free their results, controls and cookies also when a page fails.

## node-ctypes features used

`Structure` with `c_wchar_p` fields (`LDAPModW`, `SEC_WINNT_AUTH_IDENTITY_W`) · arrays of `c_wchar_p` and of `POINTER(LDAPModW)` · `POINTER(POINTER(LDAP_BERVAL))` results indexed like Python (`vals[i].contents`) · `from_address()` · `memmove` from an address · `byref()` output parameters · option values passed as a pointer-sized integer (`LDAP_OPT_ON`)
