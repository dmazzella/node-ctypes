/// <reference types="vite-plugin-electron/electron-env" />

interface Window {
  nativeClock: import("./native-clock-api").NativeClockApi;
}
