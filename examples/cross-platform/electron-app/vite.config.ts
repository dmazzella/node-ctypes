import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    react(),
    {
      name: "electron-content-security-policy",
      // React Refresh needs its inline preamble only in development.
      transformIndexHtml: (html) => html.replace("__SCRIPT_CSP__", command === "serve" ? "'self' 'unsafe-inline'" : "'self'"),
    },
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rolldownOptions: { external: ["node-ctypes"] },
          },
        },
      },
      preload: {
        input: path.join(directory, "electron/preload.ts"),
        vite: {
          build: {
            rolldownOptions: {
              output: { format: "cjs", entryFileNames: "preload.cjs" },
            },
          },
        },
      },
    }),
  ],
}));
