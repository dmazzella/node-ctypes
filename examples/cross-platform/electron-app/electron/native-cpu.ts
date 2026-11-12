import type { CoreUsage, NativeCpuSnapshot } from "./native-cpu-api";

export interface NativeCpu {
  read(): NativeCpuSnapshot;
  close(): void;
}

interface Ticks {
  busy: number;
  total: number;
}

// Processor usage. Windows: PDH performance counters, which compute the
// percentages between two collections. macOS and Linux: cumulative time
// counters per processor, read twice; the usage is the busy share of the
// time elapsed between the two reads.
export async function createNativeCpu(): Promise<NativeCpu> {
  const c = await import("node-ctypes");
  const { ARRAY, CDLL, POINTER, Structure, Union, WinDLL, byref, c_char_p, c_double, c_int, c_longlong, c_size_t, c_uint, c_void_p, c_wchar_p, create_string_buffer, create_unicode_buffer, find_library, sizeof, wintypes } = c;
  const libraries: { close(): void }[] = [];
  let closed = false;
  let release: () => void = () => undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      release();
    } finally {
      for (let i = libraries.length - 1; i >= 0; i--) libraries[i].close();
    }
  };

  try {
    let api: string;
    let sample: () => { total: number | null; cores: CoreUsage[] };

    if (process.platform === "win32") {
      const { DWORD, HANDLE, HMODULE, LONG, LPCWSTR } = wintypes;
      const pdh = new WinDLL("pdh.dll");
      const kernel32 = new WinDLL("kernel32.dll");
      libraries.push(pdh, kernel32);

      // <pdh.h>
      const PDH_STATUS = LONG;
      const PDH_HQUERY = HANDLE;
      const PDH_HCOUNTER = HANDLE;
      const PDH_FMT_DOUBLE = 0x00000200;
      const PDH_MORE_DATA = 0x800007d2 | 0;
      const PDH_CSTATUS_NEW_DATA = 1;
      class PDH_FMT_COUNTERVALUE_UNION extends Union {
        static _fields_ = [
          ["longValue", LONG],
          ["doubleValue", c_double],
          ["largeValue", c_longlong],
          ["AnsiStringValue", c_char_p],
          ["WideStringValue", c_wchar_p],
        ];
      }
      class PDH_FMT_COUNTERVALUE extends Structure {
        static _anonymous_ = ["u"];
        static _fields_ = [
          ["CStatus", DWORD],
          ["u", PDH_FMT_COUNTERVALUE_UNION],
        ];
        declare CStatus: number | bigint;
        declare doubleValue: number;
      }
      class PDH_FMT_COUNTERVALUE_ITEM_W extends Structure {
        static _fields_ = [
          ["szName", c_wchar_p],
          ["FmtValue", PDH_FMT_COUNTERVALUE],
        ];
        declare szName: string | null;
        declare FmtValue: PDH_FMT_COUNTERVALUE;
      }

      // PDH_STATUS is not a GetLastError code: its text comes from pdh.dll's messages.
      const FORMAT_MESSAGE_FROM_HMODULE = 0x800;
      const FORMAT_MESSAGE_FROM_SYSTEM = 0x1000;
      const FORMAT_MESSAGE_IGNORE_INSERTS = 0x200;
      kernel32.GetModuleHandleW.argtypes = [LPCWSTR];
      kernel32.GetModuleHandleW.restype = HMODULE;
      kernel32.FormatMessageW.argtypes = [DWORD, c_void_p, DWORD, DWORD, c_void_p, DWORD, c_void_p];
      kernel32.FormatMessageW.restype = DWORD;
      const pdhMessage = (status: number) => {
        const text = create_unicode_buffer(512);
        const flags = FORMAT_MESSAGE_FROM_HMODULE | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS;
        const length = kernel32.FormatMessageW(flags, kernel32.GetModuleHandleW("pdh.dll"), status >>> 0, 0, text, 512, null);
        return Number(length) > 0 ? String(text.value).trim() : `PDH status 0x${(status >>> 0).toString(16)}`;
      };
      // def errcheck(result, func, args): if result not in (ERROR_SUCCESS, PDH_MORE_DATA): raise ...
      // (LONG results are BigInt in node-ctypes.)
      const errcheckPdh = (result: bigint | number, func: { funcName?: string }) => {
        const status = Number(result);
        if (status !== 0 && status !== PDH_MORE_DATA) throw new Error(`${func.funcName ?? "PDH"} failed: ${pdhMessage(status)}`);
        return status;
      };

      pdh.PdhOpenQueryW.argtypes = [LPCWSTR, c_size_t, POINTER(PDH_HQUERY)];
      pdh.PdhOpenQueryW.restype = PDH_STATUS;
      pdh.PdhOpenQueryW.errcheck = errcheckPdh;
      pdh.PdhAddEnglishCounterW.argtypes = [PDH_HQUERY, LPCWSTR, c_size_t, POINTER(PDH_HCOUNTER)];
      pdh.PdhAddEnglishCounterW.restype = PDH_STATUS;
      pdh.PdhAddEnglishCounterW.errcheck = errcheckPdh;
      pdh.PdhCollectQueryData.argtypes = [PDH_HQUERY];
      pdh.PdhCollectQueryData.restype = PDH_STATUS;
      pdh.PdhCollectQueryData.errcheck = errcheckPdh;
      pdh.PdhGetFormattedCounterArrayW.argtypes = [PDH_HCOUNTER, DWORD, POINTER(DWORD), POINTER(DWORD), c_void_p];
      pdh.PdhGetFormattedCounterArrayW.restype = PDH_STATUS;
      pdh.PdhGetFormattedCounterArrayW.errcheck = errcheckPdh;
      pdh.PdhCloseQuery.argtypes = [PDH_HQUERY];
      pdh.PdhCloseQuery.restype = PDH_STATUS;

      // One query for the whole application; the English counter path works on
      // every Windows language. "*": every processor, and "_Total".
      const COUNTER_PATH = "\\Processor Information(*)\\% Processor Utility";
      const query = new PDH_HQUERY();
      pdh.PdhOpenQueryW(null, 0, byref(query));
      release = () => pdh.PdhCloseQuery(query.value);
      const counter = new PDH_HCOUNTER();
      pdh.PdhAddEnglishCounterW(query.value, COUNTER_PATH, 0, byref(counter));
      // A rate needs two collections: this is the first.
      pdh.PdhCollectQueryData(query.value);

      api = `PdhGetFormattedCounterArrayW ${COUNTER_PATH}`;
      sample = () => {
        pdh.PdhCollectQueryData(query.value);
        // Called twice: the first returns PDH_MORE_DATA and the size of the buffer.
        const size = new DWORD(0);
        const count = new DWORD(0);
        pdh.PdhGetFormattedCounterArrayW(counter.value, PDH_FMT_DOUBLE, byref(size), byref(count), null);
        const buffer = create_string_buffer(Number(size.value));
        pdh.PdhGetFormattedCounterArrayW(counter.value, PDH_FMT_DOUBLE, byref(size), byref(count), buffer);
        // The names point inside the same buffer, which stays alive while they are read.
        const items = ARRAY(PDH_FMT_COUNTERVALUE_ITEM_W, Number(count.value)).from_buffer(buffer);
        let total: number | null = null;
        const cores: CoreUsage[] = [];
        for (let i = 0; i < Number(count.value); i++) {
          const item = items[i] as PDH_FMT_COUNTERVALUE_ITEM_W;
          const name = item.szName ?? "";
          if (Number(item.FmtValue.CStatus) > PDH_CSTATUS_NEW_DATA) continue;
          const percent = item.FmtValue.doubleValue;
          if (name === "_Total") total = percent;
          else if (!name.endsWith("_Total")) cores.push({ name, percent });
        }
        // "group,processor": in numeric order.
        const order = (name: string) => name.split(",").map(Number);
        cores.sort((a, b) => {
          const [ga, pa] = order(a.name);
          const [gb, pb] = order(b.name);
          return ga - gb || pa - pb;
        });
        return { total, cores };
      };
    } else {
      const libcName = find_library("c");
      if (!libcName) throw new Error("The platform C runtime could not be located.");
      const libc = new CDLL(libcName, { use_errno: true });
      libraries.push(libc);
      let readTicks: () => Map<string, Ticks>;

      if (process.platform === "darwin") {
        // <mach/mach_init.h>: mach_task_self() reads this variable.
        class mach_port_t_variable extends Structure {
          static _fields_ = [["port", c_uint]];
          declare port: number;
        }
        libc.mach_host_self.argtypes = [];
        libc.mach_host_self.restype = c_uint;
        libc.host_processor_info.argtypes = [c_uint, c_int, POINTER(c_uint), POINTER(c_void_p), POINTER(c_uint)];
        libc.host_processor_info.restype = c_int;
        libc.vm_deallocate.argtypes = [c_uint, c_size_t, c_size_t];
        libc.vm_deallocate.restype = c_int;
        const PROCESSOR_CPU_LOAD_INFO = 2;
        // <mach/machine.h>: CPU_STATE_USER, CPU_STATE_SYSTEM, CPU_STATE_IDLE, CPU_STATE_NICE.
        const CPU_STATE_MAX = 4;
        const [USER, SYSTEM, IDLE, NICE] = [0, 1, 2, 3];
        const host = libc.mach_host_self();
        const task = mach_port_t_variable.in_dll(libc, "mach_task_self_").port;
        api = "host_processor_info(PROCESSOR_CPU_LOAD_INFO) + vm_deallocate";
        readTicks = () => {
          const processors = new c_uint(0);
          const info = new c_void_p();
          const infoCount = new c_uint(0);
          const status = libc.host_processor_info(host, PROCESSOR_CPU_LOAD_INFO, byref(processors), byref(info), byref(infoCount));
          if (status !== 0) throw new Error(`host_processor_info failed with kern_return_t ${status}.`);
          const address = info.value;
          if (address === null) throw new Error("host_processor_info returned no processor information.");
          // The kernel allocated the array in this task: it is freed with vm_deallocate.
          try {
            const ticks = ARRAY(c_int, Number(infoCount.value)).from_address(address);
            const result = new Map<string, Ticks>();
            for (let cpu = 0; cpu < Number(processors.value); cpu++) {
              const at = (state: number) => Number(ticks[cpu * CPU_STATE_MAX + state]) >>> 0;
              const busy = at(USER) + at(SYSTEM) + at(NICE);
              result.set(String(cpu), { busy, total: busy + at(IDLE) });
            }
            return result;
          } finally {
            libc.vm_deallocate(task, address, Number(infoCount.value) * sizeof(c_int));
          }
        };
      } else {
        // Linux has no system call for this: the kernel exposes the counters in
        // /proc/stat, read here with C stdio (libc.close/read would be the
        // library's own methods in node-ctypes, not the C functions).
        libc.fopen.argtypes = [c_char_p, c_char_p];
        libc.fopen.restype = c_void_p;
        libc.fread.argtypes = [c_void_p, c_size_t, c_size_t, c_void_p];
        libc.fread.restype = c_size_t;
        libc.fclose.argtypes = [c_void_p];
        libc.fclose.restype = c_int;
        const buffer = create_string_buffer(64 * 1024);
        api = "/proc/stat, read with fopen/fread/fclose";
        readTicks = () => {
          const file = libc.fopen("/proc/stat", "r");
          if (file === null || file === 0n) throw new Error(`fopen("/proc/stat") failed with errno ${libc.get_errno()}.`);
          let length = 0;
          try {
            for (;;) {
              const n = Number(libc.fread(c.addressof(buffer) + BigInt(length), 1, buffer.length - length, file));
              length += n;
              if (n === 0 || length >= buffer.length) break;
            }
          } finally {
            libc.fclose(file);
          }
          const result = new Map<string, Ticks>();
          // "cpu" (all) and "cpuN": user nice system idle iowait irq softirq steal ...
          for (const line of buffer.toString("latin1", 0, length).split("\n")) {
            const [name, ...fields] = line.trim().split(/\s+/);
            if (!name?.startsWith("cpu")) continue;
            const [user, nice, system, idle, iowait, irq, softirq, steal] = fields.slice(0, 8).map(Number);
            const idleAll = idle + iowait;
            const total = user + nice + system + idleAll + irq + softirq + steal;
            result.set(name === "cpu" ? "_Total" : name, { busy: total - idleAll, total });
          }
          return result;
        };
      }

      // The first reading: the usage is computed from the next one.
      let previous = readTicks();
      sample = () => {
        const next = readTicks();
        const percent = (name: string) => {
          const before = previous.get(name);
          const after = next.get(name);
          if (!before || !after || after.total <= before.total) return null;
          return (100 * (after.busy - before.busy)) / (after.total - before.total);
        };
        const cores: CoreUsage[] = [];
        let busy = 0;
        let total = 0;
        for (const [name, after] of next) {
          if (name === "_Total") continue;
          const value = percent(name);
          if (value !== null) cores.push({ name, percent: value });
          const before = previous.get(name);
          if (before) {
            busy += after.busy - before.busy;
            total += after.total - before.total;
          }
        }
        // Before `previous` moves on: percent() compares with it.
        const overall = next.has("_Total") ? percent("_Total") : total > 0 ? (100 * busy) / total : null;
        previous = next;
        return { total: overall, cores };
      };
    }

    return {
      read() {
        if (closed) throw new Error("The native CPU reader has been closed.");
        const { total, cores } = sample();
        return { totalPercent: total, cores, api, sampledAt: Date.now() };
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
