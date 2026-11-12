import type { NativeRuntimeInfo } from "./native-runtime-api";

export interface NativeRuntime {
  read(): NativeRuntimeInfo;
  close(): void;
}

// Versions and process identity, read once: the process ID comes from the
// operating system and must be the Electron main process's own.
export async function createNativeRuntime(isPackaged: boolean): Promise<NativeRuntime> {
  console.info("Loading node-ctypes.");
  const c = await import("node-ctypes");
  console.info(`node-ctypes ${c.Version.toString()}: external buffers ${c.EXTERNAL_BUFFERS}.`);
  const electronVersion = process.versions.electron;
  const chromeVersion = process.versions.chrome;
  if (!electronVersion || !chromeVersion) throw new Error("The native runtime reader must run in the Electron main process.");

  let library: { close(): void };
  let pidApi: string;
  let readPid: () => number;
  if (process.platform === "win32") {
    const { DWORD } = c.wintypes;
    const kernel32 = new c.WinDLL("kernel32.dll");
    library = kernel32;
    kernel32.GetCurrentProcessId.argtypes = [];
    kernel32.GetCurrentProcessId.restype = DWORD;
    pidApi = "GetCurrentProcessId";
    // DWORD results are BigInt in node-ctypes.
    readPid = () => Number(kernel32.GetCurrentProcessId());
  } else {
    const libcName = c.find_library("c");
    if (!libcName) throw new Error("The platform C runtime could not be located.");
    const libc = new c.CDLL(libcName);
    library = libc;
    libc.getpid.argtypes = [];
    libc.getpid.restype = c.c_int;
    pidApi = "getpid";
    readPid = () => Number(libc.getpid());
  }

  let info: NativeRuntimeInfo;
  try {
    const nativePid = readPid();
    if (nativePid !== process.pid) throw new Error("The native PID does not match the Electron main process.");
    info = {
      ctypesVersion: c.Version.toString(),
      electronVersion,
      nodeVersion: process.versions.node,
      chromeVersion,
      platform: process.platform,
      architecture: process.arch,
      externalBuffers: c.EXTERNAL_BUFFERS,
      isPackaged,
      nativePid,
      mainPid: process.pid,
      pidApi,
    };
  } finally {
    library.close();
  }
  return {
    read: () => info,
    close: () => undefined,
  };
}
