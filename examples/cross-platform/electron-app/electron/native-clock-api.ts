export const READ_NATIVE_CLOCK = "node-ctypes:read-clock";

export interface NativeClockSnapshot {
  isoTime: string;
  epochNanoseconds: string;
  clockApi: string;
  rawHex: string;
  allocationBytes: number;
}

export interface NativeClockApi {
  read(): Promise<NativeClockSnapshot>;
}
