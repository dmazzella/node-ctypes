// demo_comtypes — COM automation demo using node-ctypes comtypes
//
// Creates a Windows shortcut (.lnk) to notepad.exe using
// IShellLinkW + IPersistFile, entirely through COM vtable dispatch.
//
// Usage:
//   node examples/windows/demo_comtypes.js

import { create_unicode_buffer, wstring_at } from "node-ctypes";
import { CoInitializeEx, CoUninitialize, CoCreateInstance, checkHR, IPersistFile } from "./comtypes/comtypes.js";
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

// [3] Set link properties via vtable dispatch
checkHR(shellLink.SetPath("C:\\Windows\\notepad.exe"), "SetPath");
console.log(`[3] SetPath("C:\\Windows\\notepad.exe")`);

checkHR(shellLink.SetDescription("Notepad — created by node-ctypes comtypes"), "SetDescription");
console.log(`    SetDescription("Notepad — created by node-ctypes comtypes")`);

checkHR(shellLink.SetWorkingDirectory("C:\\Windows"), "SetWorkingDirectory");
console.log(`    SetWorkingDirectory("C:\\Windows")`);

checkHR(shellLink.SetArguments(""), "SetArguments");
console.log(`    SetArguments("")\n`);

// [4] QueryInterface for IPersistFile
const persistFile = shellLink.QueryInterface(IPersistFile);
console.log(`[4] QueryInterface(IPersistFile)`);
console.log(`    ptr  = 0x${persistFile.ptr.toString(16)}`);
console.log(`    iface = ${persistFile._interface._name}`);
console.log(`    vtable slots = ${persistFile._interface._allMethods.length}\n`);

// [5] Save .lnk file
//     IPersistFile::Save(pszFileName, fRemember)
//     fRemember = 1 (TRUE)
checkHR(persistFile.Save(lnkPath, 1), "Save");
console.log(`[5] Saved: ${lnkPath}\n`);

// [6] Verify: read back the link target
//     Create a fresh ShellLink, load the .lnk, read GetPath
{
  const shellLink2 = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
  const pf2 = shellLink2.QueryInterface(IPersistFile);

  // IPersistFile::Load(pszFileName, dwMode=0 STGM_READ)
  checkHR(pf2.Load(lnkPath, 0), "Load");

  // GetPath(pszFile, cch, pfd, fFlags)
  const pathBuf = create_unicode_buffer(260);
  checkHR(shellLink2.GetPath(pathBuf, 260, null, 0), "GetPath");

  // Read the result string from the buffer (trim null padding)
  const targetPath = wstring_at(pathBuf, 260).replace(/\0+$/, "");
  console.log(`[6] Verified — link target: "${targetPath}"`);

  // GetDescription
  const descBuf = create_unicode_buffer(1024);
  checkHR(shellLink2.GetDescription(descBuf, 1024), "GetDescription");
  const desc = wstring_at(descBuf, 1024).replace(/\0+$/, "");
  console.log(`    description: "${desc}"`);

  pf2.Release();
  shellLink2.Release();
}

// [7] Cleanup
persistFile.Release();
shellLink.Release();

// Delete the temp .lnk
if (existsSync(lnkPath)) {
  unlinkSync(lnkPath);
  console.log(`\n[7] Cleaned up ${lnkPath}`);
}

CoUninitialize();
console.log("    COM uninitialized");
console.log("\n    Done!");
