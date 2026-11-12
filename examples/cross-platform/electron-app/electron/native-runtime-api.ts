export const READ_NATIVE_RUNTIME = "node-ctypes:read-runtime";

/** What the application runs on: read once, at startup. */
export interface NativeRuntimeInfo {
  ctypesVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
  architecture: string;
  /** Whether node-ctypes exposes native memory as external buffers (otherwise synchronized mirrors). */
  externalBuffers: boolean;
  isPackaged: boolean;
  /** The process ID from the operating system, and Node's. */
  nativePid: number;
  mainPid: number;
  pidApi: string;
}

export interface NativeRuntimeApi {
  read(): Promise<NativeRuntimeInfo>;
}
