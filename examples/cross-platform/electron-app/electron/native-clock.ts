import type { NativeClockSnapshot } from "./native-clock-api";

export interface NativeClock {
  read(): NativeClockSnapshot;
  close(): void;
}

export async function createNativeClock(): Promise<NativeClock> {
  const c = await import("node-ctypes");
  const libcName = process.platform === "win32" ? "msvcrt.dll" : c.find_library("c");
  if (!libcName) throw new Error("The platform C runtime could not be located.");
  const libc = new c.CDLL(libcName, { use_errno: true });
  const libraries = [libc];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (let i = libraries.length - 1; i >= 0; i--) libraries[i].close();
  };

  try {
    libc.malloc.argtypes = [c.c_size_t];
    libc.malloc.restype = c.c_void_p;
    libc.free.argtypes = [c.c_void_p];
    libc.free.restype = null;
    let clockApi: string;
    let allocationBytes: number;
    let readEpoch: (address: bigint) => bigint;

    if (process.platform === "win32") {
      const { DWORD } = c.wintypes;
      const kernel32 = new c.WinDLL("kernel32.dll");
      libraries.push(kernel32);
      // <minwinbase.h>
      class FILETIME extends c.Structure {
        static _fields_ = [
          ["dwLowDateTime", DWORD],
          ["dwHighDateTime", DWORD],
        ];
        declare dwLowDateTime: number;
        declare dwHighDateTime: number;
      }
      kernel32.GetSystemTimePreciseAsFileTime.argtypes = [c.POINTER(FILETIME)];
      kernel32.GetSystemTimePreciseAsFileTime.restype = null;
      allocationBytes = c.sizeof(FILETIME);
      clockApi = "GetSystemTimePreciseAsFileTime";
      readEpoch = (address) => {
        const view = FILETIME.from_address(address);
        kernel32.GetSystemTimePreciseAsFileTime(c.byref(view));
        const ticks = (BigInt(view.dwHighDateTime) << 32n) | BigInt(view.dwLowDateTime);
        return (ticks - 116444736000000000n) * 100n;
      };
    } else {
      // <time.h>
      class struct_timespec extends c.Structure {
        static _fields_ = [
          ["tv_sec", c.c_time_t],
          ["tv_nsec", c.c_long],
        ];
        declare tv_sec: bigint;
        declare tv_nsec: bigint;
      }
      libc.clock_gettime.argtypes = [c.c_int, c.POINTER(struct_timespec)];
      libc.clock_gettime.restype = c.c_int;
      libc.clock_gettime.errcheck = (result: number) => {
        if (result !== 0) throw new Error(`clock_gettime failed with errno ${libc.get_errno()}.`);
        return result;
      };
      const CLOCK_REALTIME = 0;
      allocationBytes = c.sizeof(struct_timespec);
      clockApi = "clock_gettime(CLOCK_REALTIME)";
      readEpoch = (address) => {
        const view = struct_timespec.from_address(address);
        libc.clock_gettime(CLOCK_REALTIME, c.byref(view));
        if (view.tv_nsec < 0n || view.tv_nsec >= 1000000000n) throw new Error("The native clock returned invalid nanoseconds.");
        return view.tv_sec * 1000000000n + view.tv_nsec;
      };
    }

    return {
      read() {
        if (closed) throw new Error("The native clock has been closed.");
        const address = libc.malloc(allocationBytes);
        if (address === null || address === 0n) throw new Error("malloc could not allocate native clock memory.");
        try {
          c.memset(address, 0, allocationBytes);
          const epoch = readEpoch(address);
          const raw = c.string_at(address, allocationBytes);
          if (raw === null) throw new Error("The native clock allocation could not be read.");
          return {
            isoTime: new Date(Number(epoch / 1000000n)).toISOString(),
            epochNanoseconds: epoch.toString(),
            clockApi,
            rawHex: Buffer.from(raw, "latin1").toString("hex"),
            allocationBytes,
          };
        } finally {
          libc.free(address);
        }
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
