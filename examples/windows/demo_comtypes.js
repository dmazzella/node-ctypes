// demo_comtypes — COM automation demo using node-ctypes comtypes
//
// Creates a Windows shortcut (.lnk) to notepad.exe using
// IShellLinkW + IPersistFile, entirely through COM vtable dispatch.
//
// HRESULT failures throw automatically (OleDLL parity); no manual checkHR
// calls needed at the call-site.
//
// Usage:
//   node examples/windows/demo_comtypes.js

import { create_unicode_buffer, wstring_at } from "node-ctypes";
import { CoInitializeEx, CoUninitialize, CoCreateInstance } from "./comtypes/comtypes.js";
import { IPersistFile } from "./comtypes/interfaces/persist.js";
import { IShellLinkW, CLSID_ShellLink } from "./comtypes/interfaces/shelllink.js";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const lnkPath = join(tmpdir(), "node_ctypes_test.lnk");

console.log("═══════════════════════════════════════════════════════════");
console.log(" comtypes demo — IShellLinkW + IPersistFile");
console.log("═══════════════════════════════════════════════════════════\n");

// [1] Initialize COM
CoInitializeEx();
console.log("[1] COM initialized\n");

// [2] Create ShellLink object, requesting IShellLinkW interface
const shellLink = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
console.log(`[2] ShellLink created`);
console.log(`    ptr  = 0x${shellLink.ptr.toString(16)}`);
console.log(`    iface = ${shellLink._interface._name}`);
console.log(`    vtable slots = ${shellLink._interface._allMethods.length}\n`);

// [3] Set link properties via vtable dispatch.
// HRESULT return values auto-throw on failure (Python comtypes parity).
shellLink.SetPath("C:\\Windows\\notepad.exe");
console.log(`[3] SetPath("C:\\Windows\\notepad.exe")`);

shellLink.SetDescription("Notepad — created by node-ctypes comtypes");
console.log(`    SetDescription("Notepad — created by node-ctypes comtypes")`);

shellLink.SetWorkingDirectory("C:\\Windows");
console.log(`    SetWorkingDirectory("C:\\Windows")`);

shellLink.SetArguments("");
console.log(`    SetArguments("")\n`);

// [4] QueryInterface for IPersistFile
const persistFile = shellLink.QueryInterface(IPersistFile);
console.log(`[4] QueryInterface(IPersistFile)`);
console.log(`    ptr  = 0x${persistFile.ptr.toString(16)}`);
console.log(`    iface = ${persistFile._interface._name}`);
console.log(`    vtable slots = ${persistFile._interface._allMethods.length}\n`);

// [5] Save .lnk file
//     IPersistFile::Save(pszFileName, fRemember)
persistFile.Save(lnkPath, 1);
console.log(`[5] Saved: ${lnkPath}\n`);

// [6] Verify: read back the link target
{
  const shellLink2 = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
  const pf2 = shellLink2.QueryInterface(IPersistFile);

  pf2.Load(lnkPath, 0);

  // GetPath(pszFile, cch, pfd, fFlags)
  const pathBuf = create_unicode_buffer(260);
  shellLink2.GetPath(pathBuf, 260, null, 0);
  // wstring_at(buf) stops at the first null — no manual trim needed.
  console.log(`[6] Verified — link target: "${wstring_at(pathBuf)}"`);

  const descBuf = create_unicode_buffer(1024);
  shellLink2.GetDescription(descBuf, 1024);
  console.log(`    description: "${wstring_at(descBuf)}"`);

  pf2.Release();
  shellLink2.Release();
}

// [7] Cleanup
persistFile.Release();
shellLink.Release();

if (existsSync(lnkPath)) {
  unlinkSync(lnkPath);
  console.log(`\n[7] Cleaned up ${lnkPath}`);
}

CoUninitialize();
console.log("    COM uninitialized");
console.log("\n    Done!");
