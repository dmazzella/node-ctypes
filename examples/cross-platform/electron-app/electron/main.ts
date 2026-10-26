import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createNativeClock, type NativeClock } from "./native-clock";
import { READ_NATIVE_CLOCK } from "./native-clock-api";

const directory = path.dirname(fileURLToPath(import.meta.url));
const devServer = process.env.VITE_DEV_SERVER_URL;
let window: BrowserWindow | null = null;
let clock: NativeClock | undefined;
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

function reportStartupError(error: unknown) {
  console.error("Electron native clock startup failed:", error);
  dialog.showErrorBox("node-ctypes could not start", error instanceof Error ? error.message : String(error));
  app.exit(1);
}

app
  .whenReady()
  .then(async () => {
    console.info("Electron is ready; initializing the native clock.");
    clock = await createNativeClock(app.isPackaged);
    console.info("Native clock initialized; opening the React window.");
    ipcMain.handle(READ_NATIVE_CLOCK, (event) => {
      if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted native clock request.");
      try {
        if (!clock) throw new Error("The native clock is not initialized.");
        return clock.read();
      } catch (error) {
        console.error("Native clock read failed:", error);
        throw error;
      }
    });
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
  ipcMain.removeHandler(READ_NATIVE_CLOCK);
  clock?.close();
});
