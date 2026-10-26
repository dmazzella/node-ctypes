import { contextBridge, ipcRenderer } from "electron";
import { READ_NATIVE_CLOCK, type NativeClockApi } from "./native-clock-api";

const api: NativeClockApi = {
  read: () => ipcRenderer.invoke(READ_NATIVE_CLOCK),
};

contextBridge.exposeInMainWorld("nativeClock", api);
