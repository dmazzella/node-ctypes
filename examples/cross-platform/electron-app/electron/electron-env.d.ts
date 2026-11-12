/// <reference types="vite-plugin-electron/electron-env" />

interface Window {
  nativeRuntime: import("./native-runtime-api").NativeRuntimeApi;
  nativeClock: import("./native-clock-api").NativeClockApi;
  nativeSystem: import("./native-system-api").NativeSystemApi;
  nativeCpu: import("./native-cpu-api").NativeCpuApi;
}
