// Simple Registry Read/Write Demo
// Demonstrates creating a key, setting a string value, reading it back, and deleting it.
// NOW USING PYTHON-STYLE INSTANTIABLE TYPES!

import { WinDLL, create_unicode_buffer, byref, wstring_at, c_uint32, c_uint, c_void_p } from "node-ctypes";

// Registry handle
const HKEY_CURRENT_USER = 0x80000001;

// Access masks
const KEY_READ = 0x00020019;
const KEY_WRITE = 0x00020006;

// Key options
const REG_OPTION_NON_VOLATILE = 0x00000000;

// Value types (REG_*)
const REG_SZ = 0x00000001;
const REG_DWORD = 0x00000004;
const REG_MULTI_SZ = 0x00000007;

// RegGetValue() flags (RRF_RT_*)
const RRF_RT_REG_SZ = 0x00000002;
const RRF_RT_REG_DWORD = 0x00000010;
const RRF_RT_REG_MULTI_SZ = 0x00000020;

const advapi32 = new WinDLL("advapi32.dll");

// Function prototypes using Python-like argtypes/restype syntax
advapi32.RegCreateKeyExW.argtypes = [c_uint, c_void_p, c_uint, c_void_p, c_uint, c_uint, c_void_p, c_void_p, c_void_p];
advapi32.RegCreateKeyExW.restype = c_uint;

advapi32.RegSetValueExW.argtypes = [c_uint, c_void_p, c_uint, c_uint, c_void_p, c_uint];
advapi32.RegSetValueExW.restype = c_uint;

advapi32.RegGetValueW.argtypes = [c_uint, c_void_p, c_void_p, c_uint, c_void_p, c_void_p, c_void_p];
advapi32.RegGetValueW.restype = c_uint;

advapi32.RegCloseKey.argtypes = [c_uint];
advapi32.RegCloseKey.restype = c_uint;

advapi32.RegDeleteKeyW.argtypes = [c_uint, c_void_p];
advapi32.RegDeleteKeyW.restype = c_uint;

advapi32.RegDeleteValueW.argtypes = [c_uint, c_void_p];
advapi32.RegDeleteValueW.restype = c_uint;

function checkRc(rc, name) {
  if (rc !== 0) {
    throw new Error(`${name} failed with code 0x${rc.toString(16)}`);
  }
}

async function main() {
  const subKey = "Software\\node_ctypes_demo";
  const valueName = "TestValue";
  const valueData = "Hello from node-ctypes";

  const lpSubKey = create_unicode_buffer(subKey);

  // =========================================================================
  // PYTHON-STYLE OUTPUT PARAMETERS!
  // Instead of: const phkResultBuf = create_string_buffer(4);
  // Now:        const phkResult = new c_uint32();
  // =========================================================================
  const phkResult = new c_uint32();
  const lpdwDisposition = new c_uint32();

  // Create or open the key
  const rcCreate = advapi32.RegCreateKeyExW(
    HKEY_CURRENT_USER,
    lpSubKey,
    0,
    null,
    REG_OPTION_NON_VOLATILE,
    KEY_WRITE | KEY_READ,
    null,
    byref(phkResult), // <-- Python-style byref()!
    byref(lpdwDisposition),
  );
  checkRc(rcCreate, "RegCreateKeyExW");

  // Access value directly via .value property!
  const openedKey = phkResult.value;
  console.log(`Opened key handle: 0x${openedKey.toString(16)}`);

  // Set string value
  const lpValueName = create_unicode_buffer(valueName);
  const lpData = create_unicode_buffer(valueData);

  const rcSet = advapi32.RegSetValueExW(openedKey, lpValueName, 0, REG_SZ, lpData, lpData.length);
  checkRc(rcSet, "RegSetValueExW");
  console.log(`Wrote REG_SZ '${valueName}' = '${valueData}' to HKCU\\${subKey}`);

  // Read it back using RegGetValueW
  const pdwType = new c_uint32();
  const pcbData = new c_uint32(0); // Initialize with value

  // First call to get required size
  const ERROR_MORE_DATA = 0xea;
  let rcGet = advapi32.RegGetValueW(openedKey, null, lpValueName, RRF_RT_REG_SZ, byref(pdwType), null, byref(pcbData));
  if (rcGet !== 0 && rcGet !== ERROR_MORE_DATA) {
    throw new Error(`RegGetValueW size query failed (rc=0x${rcGet.toString(16)})`);
  }

  const needed = pcbData.value; // <-- Direct .value access!
  if (!needed) {
    throw new Error("RegGetValueW returned zero size; aborting");
  }

  const outBuf = create_unicode_buffer(Math.ceil(needed / 2));

  rcGet = advapi32.RegGetValueW(openedKey, null, lpValueName, RRF_RT_REG_SZ, byref(pdwType), outBuf, byref(pcbData));
  checkRc(rcGet, "RegGetValueW");

  const readBack = wstring_at(outBuf);
  console.log(`Read back value: '${readBack.replace(/\0+$/, "")}'`);

  // --- REG_DWORD example (even cleaner!) ---
  const dwordNameBuf = create_unicode_buffer("TestDword");
  const dwordValue = new c_uint32(0x12345678); // <-- Create with value!

  const rcSetDword = advapi32.RegSetValueExW(
    openedKey,
    dwordNameBuf,
    0,
    REG_DWORD,
    byref(dwordValue), // <-- Direct byref of typed value!
    4,
  );
  checkRc(rcSetDword, "RegSetValueExW(REG_DWORD)");
  console.log(`Wrote DWORD 'TestDword' = 0x${dwordValue.value.toString(16)}`);

  // Read back DWORD
  const outDword = new c_uint32();
  const sizeDword = new c_uint32(4);
  const typeDword = new c_uint32();

  let rcGetD = advapi32.RegGetValueW(openedKey, null, dwordNameBuf, RRF_RT_REG_DWORD, byref(typeDword), byref(outDword), byref(sizeDword));
  checkRc(rcGetD, "RegGetValueW(REG_DWORD)");
  console.log(`Read back DWORD: 0x${outDword.value.toString(16)}`);

  // Cleanup
  advapi32.RegDeleteValueW(openedKey, dwordNameBuf);
  const rcDelVal = advapi32.RegDeleteValueW(openedKey, lpValueName);
  checkRc(rcDelVal, "RegDeleteValueW");
  console.log(`Deleted value '${valueName}'`);

  const rcClose = advapi32.RegCloseKey(openedKey);
  checkRc(rcClose, "RegCloseKey");

  const rcDelKey = advapi32.RegDeleteKeyW(HKEY_CURRENT_USER, lpSubKey);
  if (rcDelKey === 0) {
    console.log(`Deleted key HKCU\\${subKey}`);
  } else {
    console.log(`Could not delete key (code 0x${rcDelKey.toString(16)})`);
  }

  advapi32.close();
}

main().catch((err) => {
  console.error("Error:", err);
});
