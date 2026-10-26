export const READ_NATIVE_CLOCK = "node-ctypes:read-clock";

export interface NativeClockSnapshot {
  isoTime: string;
  epochNanoseconds: string;
  clockApi: string;
  rawHex: string;
  allocationBytes: number;
  nativePid: number;
  mainPid: number;
  ctypesVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
  architecture: string;
  externalBuffers: boolean;
  isPackaged: boolean;
}

export interface NativeClockApi {
  read(): Promise<NativeClockSnapshot>;
}
