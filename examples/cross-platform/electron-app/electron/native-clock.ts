import type { NativeClockSnapshot } from "./native-clock-api";

export interface NativeClock {
  read(): NativeClockSnapshot;
  close(): void;
}

export async function createNativeClock(isPackaged: boolean): Promise<NativeClock> {
  console.info("Loading node-ctypes.");
  const c = await import("node-ctypes");
  console.info(`node-ctypes ${c.Version.toString()}: external buffers ${c.EXTERNAL_BUFFERS}.`);
  const electronVersion = process.versions.electron;
  const chromeVersion = process.versions.chrome;
  if (!electronVersion || !chromeVersion) throw new Error("The native clock must run in the Electron main process.");

  const runtimeName = process.platform === "win32" ? "msvcrt.dll" : c.find_library("c");
  if (!runtimeName) throw new Error("The platform C runtime could not be located.");
  const runtime = new c.CDLL(runtimeName, { use_errno: true });
  const libraries = [runtime];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (let i = libraries.length - 1; i >= 0; i--) libraries[i].close();
  };

  try {
    const malloc = runtime.func("malloc", c.c_void_p, [c.c_size_t]);
    const free = runtime.func("free", null, [c.c_void_p]);
    let clockApi: string;
    let allocationBytes: number;
    let readEpoch: (address: bigint) => bigint;
    let readPid: () => number;

    if (process.platform === "win32") {
      const kernel = new c.WinDLL("kernel32.dll");
      libraries.push(kernel);
      class FileTime extends c.Structure {
        static _fields_ = [
          ["low", c.c_uint32],
          ["high", c.c_uint32],
        ];
        declare low: number;
        declare high: number;
      }
      const getTime = kernel.func("GetSystemTimePreciseAsFileTime", null, [c.POINTER(FileTime)]);
      const getPid = kernel.func("GetCurrentProcessId", c.c_uint32, []);
      allocationBytes = c.sizeof(FileTime);
      clockApi = "GetSystemTimePreciseAsFileTime";
      readPid = () => getPid();
      readEpoch = (address) => {
        const view = FileTime.from_address(address);
        getTime(c.byref(view));
        const ticks = (BigInt(view.high) << 32n) | BigInt(view.low);
        return (ticks - 116444736000000000n) * 100n;
      };
    } else {
      class Timespec extends c.Structure {
        static _fields_ = [
          ["seconds", c.c_time_t],
          ["nanoseconds", c.c_long],
        ];
        declare seconds: bigint;
        declare nanoseconds: bigint;
      }
      const getTime = runtime.func("clock_gettime", c.c_int, [c.c_int, c.POINTER(Timespec)]);
      const getPid = runtime.func("getpid", c.c_int, []);
      allocationBytes = c.sizeof(Timespec);
      clockApi = "clock_gettime(CLOCK_REALTIME)";
      readPid = () => getPid();
      readEpoch = (address) => {
        const view = Timespec.from_address(address);
        if (getTime(0, c.byref(view)) !== 0) throw new Error(`clock_gettime failed with errno ${runtime.get_errno()}.`);
        if (view.nanoseconds < 0n || view.nanoseconds >= 1000000000n) throw new Error("The native clock returned invalid nanoseconds.");
        return view.seconds * 1000000000n + view.nanoseconds;
      };
    }

    return {
      read() {
        if (closed) throw new Error("The native clock has been closed.");
        const address = malloc(allocationBytes);
        if (address === null || address === 0n) throw new Error("malloc could not allocate native clock memory.");
        try {
          c.memset(address, 0, allocationBytes);
          const epoch = readEpoch(address);
          const nativePid = readPid();
          if (nativePid !== process.pid) throw new Error("The native PID does not match the Electron main process.");
          const raw = c.string_at(address, allocationBytes);
          if (raw === null) throw new Error("The native clock allocation could not be read.");
          return {
            isoTime: new Date(Number(epoch / 1000000n)).toISOString(),
            epochNanoseconds: epoch.toString(),
            clockApi,
            rawHex: Buffer.from(raw, "latin1").toString("hex"),
            allocationBytes,
            nativePid,
            mainPid: process.pid,
            ctypesVersion: c.Version.toString(),
            electronVersion,
            nodeVersion: process.versions.node,
            chromeVersion,
            platform: process.platform,
            architecture: process.arch,
            externalBuffers: c.EXTERNAL_BUFFERS,
            isPackaged,
          };
        } finally {
          free(address);
        }
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
