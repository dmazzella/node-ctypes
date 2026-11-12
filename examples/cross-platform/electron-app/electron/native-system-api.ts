export const READ_NATIVE_SYSTEM = "node-ctypes:read-system";

export interface NativeSystemSnapshot {
  /** Physical memory, in bytes. */
  totalMemoryBytes: number;
  /** Memory available to applications, in bytes, as the native API reports it. */
  availableMemoryBytes: number;
  uptimeSeconds: number;
  /** The native functions behind each value. */
  memoryApi: string;
  uptimeApi: string;
  /** Size of the C structure filled by the memory call. */
  memoryStructBytes: number;
  /** When the sample was taken (milliseconds since the Unix epoch). */
  sampledAt: number;
}

export interface NativeSystemApi {
  read(): Promise<NativeSystemSnapshot>;
}
