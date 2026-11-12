import type { NativeSystemSnapshot } from "./native-system-api";

export interface NativeSystem {
  read(): NativeSystemSnapshot;
  close(): void;
}

interface MemoryReading {
  total: bigint;
  available: bigint;
}

// Memory and uptime from the operating system, with Python ctypes
// idioms: Structure subclasses named and laid out as in C, argtypes/restype set
// on the library's function attributes, errcheck turning failures into errors.
export async function createNativeSystem(): Promise<NativeSystem> {
  const { CDLL, POINTER, Structure, WinDLL, WinError, byref, c_char_p, c_int, c_int32, c_long, c_size_t, c_time_t, c_uint, c_uint32, c_uint64, c_ulong, c_ulonglong, c_ushort, c_void_p, find_library, sizeof, wintypes } = await import("node-ctypes");
  const libraries: { close(): void }[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (let i = libraries.length - 1; i >= 0; i--) libraries[i].close();
  };

  try {
    let memoryApi: string;
    let uptimeApi: string;
    let memoryStructBytes: number;
    let readMemory: () => MemoryReading;
    let readUptime: () => number;

    if (process.platform === "win32") {
      const { BOOL, DWORD } = wintypes;
      const kernel32 = new WinDLL("kernel32.dll", { use_last_error: true });
      libraries.push(kernel32);

      // <sysinfoapi.h>
      class MEMORYSTATUSEX extends Structure {
        static _fields_ = [
          ["dwLength", DWORD],
          ["dwMemoryLoad", DWORD],
          ["ullTotalPhys", c_ulonglong],
          ["ullAvailPhys", c_ulonglong],
          ["ullTotalPageFile", c_ulonglong],
          ["ullAvailPageFile", c_ulonglong],
          ["ullTotalVirtual", c_ulonglong],
          ["ullAvailVirtual", c_ulonglong],
          ["ullAvailExtendedVirtual", c_ulonglong],
        ];
        declare dwLength: number;
        declare ullTotalPhys: bigint;
        declare ullAvailPhys: bigint;
      }
      // def errcheck(result, func, args): if not result: raise WinError(get_last_error())
      const errcheckBool = (result: number) => {
        if (!result) throw WinError(kernel32.get_last_error());
        return result;
      };

      kernel32.GlobalMemoryStatusEx.argtypes = [POINTER(MEMORYSTATUSEX)];
      kernel32.GlobalMemoryStatusEx.restype = BOOL;
      kernel32.GlobalMemoryStatusEx.errcheck = errcheckBool;
      kernel32.GetTickCount64.argtypes = [];
      kernel32.GetTickCount64.restype = c_ulonglong;

      memoryStructBytes = sizeof(MEMORYSTATUSEX);
      memoryApi = "GlobalMemoryStatusEx(MEMORYSTATUSEX)";
      uptimeApi = "GetTickCount64";
      readMemory = () => {
        const status = new MEMORYSTATUSEX();
        // The API checks the structure version the caller was built with.
        status.dwLength = sizeof(MEMORYSTATUSEX);
        kernel32.GlobalMemoryStatusEx(byref(status));
        return { total: status.ullTotalPhys, available: status.ullAvailPhys };
      };
      readUptime = () => Number(kernel32.GetTickCount64()) / 1000;
    } else {
      const libcName = find_library("c");
      if (!libcName) throw new Error("The platform C runtime could not be located.");
      const libc = new CDLL(libcName, { use_errno: true });
      libraries.push(libc);
      // Returns 0 on success, -1 and errno on failure.
      const errcheckZero = (result: number, func: { funcName?: string }) => {
        if (result !== 0) throw new Error(`${func.funcName ?? "native call"} failed with errno ${libc.get_errno()}.`);
        return result;
      };

      if (process.platform === "darwin") {
        // <sys/_types/_timeval.h>
        class struct_timeval extends Structure {
          static _fields_ = [
            ["tv_sec", c_time_t],
            ["tv_usec", c_int32],
          ];
          declare tv_sec: bigint;
          declare tv_usec: number;
        }
        // <mach/vm_statistics.h> (natural_t is 32 bits)
        class struct_vm_statistics64 extends Structure {
          static _fields_ = [
            ["free_count", c_uint32],
            ["active_count", c_uint32],
            ["inactive_count", c_uint32],
            ["wire_count", c_uint32],
            ["zero_fill_count", c_uint64],
            ["reactivations", c_uint64],
            ["pageins", c_uint64],
            ["pageouts", c_uint64],
            ["faults", c_uint64],
            ["cow_faults", c_uint64],
            ["lookups", c_uint64],
            ["hits", c_uint64],
            ["purges", c_uint64],
            ["purgeable_count", c_uint32],
            ["speculative_count", c_uint32],
            ["decompressions", c_uint64],
            ["compressions", c_uint64],
            ["swapins", c_uint64],
            ["swapouts", c_uint64],
            ["compressor_page_count", c_uint32],
            ["throttled_count", c_uint32],
            ["external_page_count", c_uint32],
            ["internal_page_count", c_uint32],
            ["total_uncompressed_pages_in_compressor", c_uint64],
          ];
          declare free_count: number;
          declare inactive_count: number;
          declare speculative_count: number;
        }

        libc.sysctlbyname.argtypes = [c_char_p, c_void_p, POINTER(c_size_t), c_void_p, c_size_t];
        libc.sysctlbyname.restype = c_int;
        libc.sysctlbyname.errcheck = errcheckZero;
        libc.mach_host_self.argtypes = [];
        libc.mach_host_self.restype = c_uint;
        libc.host_statistics64.argtypes = [c_uint, c_int, POINTER(struct_vm_statistics64), POINTER(c_uint)];
        libc.host_statistics64.restype = c_int;
        const HOST_VM_INFO64 = 4;
        const KERN_SUCCESS = 0;

        // An integer sysctl of 4 or 8 bytes, read into a zeroed 64-bit value (little endian).
        const sysctlInteger = (name: string): bigint => {
          const value = new c_uint64(0n);
          const size = new c_size_t(sizeof(c_uint64));
          libc.sysctlbyname(name, byref(value), byref(size), null, 0);
          return BigInt(value.value);
        };
        const host = libc.mach_host_self();
        const total = sysctlInteger("hw.memsize");
        const pageSize = sysctlInteger("hw.pagesize");
        memoryStructBytes = sizeof(struct_vm_statistics64);
        memoryApi = "host_statistics64(HOST_VM_INFO64) + sysctlbyname(hw.memsize)";
        uptimeApi = "sysctlbyname(kern.boottime)";
        readMemory = () => {
          const vmstat = new struct_vm_statistics64();
          // HOST_VM_INFO64_COUNT: the structure size in 32-bit integers.
          const count = new c_uint(sizeof(struct_vm_statistics64) / sizeof(c_uint));
          const status = libc.host_statistics64(host, HOST_VM_INFO64, byref(vmstat), byref(count));
          if (status !== KERN_SUCCESS) throw new Error(`host_statistics64 failed with kern_return_t ${status}.`);
          // Free pages exclude the speculative ones; inactive pages are reclaimable.
          const pages = BigInt(vmstat.free_count) + BigInt(vmstat.inactive_count) + BigInt(vmstat.speculative_count);
          return { total, available: pages * pageSize };
        };
        readUptime = () => {
          const boottime = new struct_timeval();
          const size = new c_size_t(sizeof(struct_timeval));
          libc.sysctlbyname("kern.boottime", byref(boottime), byref(size), null, 0);
          return Date.now() / 1000 - (Number(boottime.tv_sec) + boottime.tv_usec / 1e6);
        };
      } else {
        // <sys/sysinfo.h>; the trailing padding is at most 8 bytes.
        class struct_sysinfo extends Structure {
          static _fields_ = [
            ["uptime", c_long],
            ["loads_1", c_ulong],
            ["loads_5", c_ulong],
            ["loads_15", c_ulong],
            ["totalram", c_ulong],
            ["freeram", c_ulong],
            ["sharedram", c_ulong],
            ["bufferram", c_ulong],
            ["totalswap", c_ulong],
            ["freeswap", c_ulong],
            ["procs", c_ushort],
            ["pad", c_ushort],
            ["totalhigh", c_ulong],
            ["freehigh", c_ulong],
            ["mem_unit", c_uint],
            ["_f", c_uint64],
          ];
          declare uptime: bigint | number;
          declare totalram: bigint | number;
          declare freeram: bigint | number;
          declare bufferram: bigint | number;
          declare mem_unit: number;
        }

        libc.sysinfo.argtypes = [POINTER(struct_sysinfo)];
        libc.sysinfo.restype = c_int;
        libc.sysinfo.errcheck = errcheckZero;
        const sysinfo = () => {
          const info = new struct_sysinfo();
          libc.sysinfo(byref(info));
          return info;
        };
        memoryStructBytes = sizeof(struct_sysinfo);
        memoryApi = "sysinfo(struct sysinfo): free + buffers";
        uptimeApi = "sysinfo(struct sysinfo)";
        readMemory = () => {
          const info = sysinfo();
          const unit = BigInt(info.mem_unit || 1);
          return { total: BigInt(info.totalram) * unit, available: (BigInt(info.freeram) + BigInt(info.bufferram)) * unit };
        };
        readUptime = () => Number(sysinfo().uptime);
      }
    }

    return {
      read() {
        if (closed) throw new Error("The native system reader has been closed.");
        const memory = readMemory();
        const totalMemoryBytes = Number(memory.total);
        const availableMemoryBytes = Number(memory.available);
        if (!(totalMemoryBytes > 0) || availableMemoryBytes < 0 || availableMemoryBytes > totalMemoryBytes) {
          throw new Error(`The operating system reported inconsistent memory values (${memory.available} of ${memory.total} bytes available).`);
        }
        return {
          totalMemoryBytes,
          availableMemoryBytes,
          uptimeSeconds: readUptime(),
          memoryApi,
          uptimeApi,
          memoryStructBytes,
          sampledAt: Date.now(),
        };
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
