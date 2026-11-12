export const READ_NATIVE_CPU = "node-ctypes:read-cpu";

export interface CoreUsage {
  /** The instance name as the operating system reports it (e.g. "0,3" on Windows, "cpu3" on Linux). */
  name: string;
  percent: number;
}

export interface NativeCpuSnapshot {
  /** Busy share of all processors, in percent; null until two samples exist. */
  totalPercent: number | null;
  /** One entry per logical processor; empty until two samples exist. */
  cores: CoreUsage[];
  /** The native calls behind the values. */
  api: string;
  sampledAt: number;
}

export interface NativeCpuApi {
  read(): Promise<NativeCpuSnapshot>;
}
