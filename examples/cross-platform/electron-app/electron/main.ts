import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createNativeClock, type NativeClock } from "./native-clock";
import { createNativeCpu, type NativeCpu } from "./native-cpu";
import { READ_NATIVE_CPU } from "./native-cpu-api";
import { READ_NATIVE_CLOCK } from "./native-clock-api";
import { createNativeRuntime, type NativeRuntime } from "./native-runtime";
import { READ_NATIVE_RUNTIME } from "./native-runtime-api";
import { createNativeSystem, type NativeSystem } from "./native-system";
import { READ_NATIVE_SYSTEM } from "./native-system-api";

const directory = path.dirname(fileURLToPath(import.meta.url));
const devServer = process.env.VITE_DEV_SERVER_URL;
let window: BrowserWindow | null = null;
let runtime: NativeRuntime | undefined;
let clock: NativeClock | undefined;
let cpu: NativeCpu | undefined;
let system: NativeSystem | undefined;
console.info(`Electron ${process.versions.electron}: starting main process ${process.pid}.`);

async function createWindow() {
  const current = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#0b1117",
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window = current;
  current.on("closed", () => {
    if (window === current) window = null;
  });
  current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  current.webContents.on("will-navigate", (event, url) => {
    if (url !== current.webContents.getURL()) event.preventDefault();
  });
  if (devServer) await current.loadURL(devServer);
  else await current.loadFile(path.join(directory, "../dist/index.html"));
}

// One read-only IPC operation, answered only to this window's main frame.
function handleRead<T>(channel: string, name: string, read: () => T | undefined) {
  ipcMain.handle(channel, (event) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error(`Untrusted native ${name} request.`);
    try {
      const value = read();
      if (value === undefined) throw new Error(`The native ${name} reader is not initialized.`);
      return value;
    } catch (error) {
      console.error(`Native ${name} read failed:`, error);
      throw error;
    }
  });
}

function reportStartupError(error: unknown) {
  console.error("Electron native clock startup failed:", error);
  dialog.showErrorBox("node-ctypes could not start", error instanceof Error ? error.message : String(error));
  app.exit(1);
}

app
  .whenReady()
  .then(async () => {
    console.info("Electron is ready; initializing the native readers.");
    runtime = await createNativeRuntime(app.isPackaged);
    clock = await createNativeClock();
    system = await createNativeSystem();
    // Opening the PDH query on Windows takes a few hundred milliseconds, once.
    cpu = await createNativeCpu();
    console.info("Native readers initialized; opening the React window.");
    handleRead(READ_NATIVE_RUNTIME, "runtime", () => runtime?.read());
    handleRead(READ_NATIVE_CLOCK, "clock", () => clock?.read());
    handleRead(READ_NATIVE_SYSTEM, "system", () => system?.read());
    handleRead(READ_NATIVE_CPU, "CPU", () => cpu?.read());
    await createWindow();
  })
  .catch(reportStartupError);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (clock && BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupError);
});
app.on("will-quit", () => {
  for (const channel of [READ_NATIVE_RUNTIME, READ_NATIVE_CLOCK, READ_NATIVE_SYSTEM, READ_NATIVE_CPU]) ipcMain.removeHandler(channel);
  runtime?.close();
  clock?.close();
  system?.close();
  cpu?.close();
});
