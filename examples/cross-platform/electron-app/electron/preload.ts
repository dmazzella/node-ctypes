import { contextBridge, ipcRenderer } from "electron";
import { READ_NATIVE_CLOCK, type NativeClockApi } from "./native-clock-api";
import { READ_NATIVE_CPU, type NativeCpuApi } from "./native-cpu-api";
import { READ_NATIVE_RUNTIME, type NativeRuntimeApi } from "./native-runtime-api";
import { READ_NATIVE_SYSTEM, type NativeSystemApi } from "./native-system-api";

const runtime: NativeRuntimeApi = {
  read: () => ipcRenderer.invoke(READ_NATIVE_RUNTIME),
};
const clock: NativeClockApi = {
  read: () => ipcRenderer.invoke(READ_NATIVE_CLOCK),
};
const cpu: NativeCpuApi = {
  read: () => ipcRenderer.invoke(READ_NATIVE_CPU),
};
const system: NativeSystemApi = {
  read: () => ipcRenderer.invoke(READ_NATIVE_SYSTEM),
};

contextBridge.exposeInMainWorld("nativeRuntime", runtime);
contextBridge.exposeInMainWorld("nativeClock", clock);
contextBridge.exposeInMainWorld("nativeSystem", system);
contextBridge.exposeInMainWorld("nativeCpu", cpu);
