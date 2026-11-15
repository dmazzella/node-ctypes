// demo_tray.js — FluentTray demo for macOS (mirrors C++ fluent-tray API)
// The same script as the Windows demo: a status item in the menu bar with a
// native menu. The icons are the .ico files of the Windows example.
//
// Usage:  node examples/macos/tray/demo_tray.js

import { FluentTray } from "./tray.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const assets = join(__dirname, "..", "..", "windows", "tray", "assets");

async function main() {
  const tray = new FluentTray();

  // Initialize the status item.
  if (!tray.create_tray("demo", join(assets, "icon.ico"))) throw new Error("Cannot create the status item");

  // Add menus in order from the top.
  tray.add_menu("Home", join(assets, "fa-home.ico"), false, () => {
    console.log("Home clicked");
    return true;
  });

  tray.add_separator();

  tray.add_menu("Download", join(assets, "fa-download.ico"), false, () => {
    console.log("Download clicked");
    return true;
  });

  tray.add_menu("Insight", join(assets, "fa-line-chart.ico"), false, () => {
    console.log("Insight clicked");
    return true;
  });

  // A submenu (an extension of this port): hover it or press Right.
  const reports = tray.add_submenu("Reports", join(assets, "fa-line-chart.ico"));
  for (const period of ["Daily", "Weekly", "Monthly"]) {
    reports.add_menu(period, "", false, () => {
      console.log(`Report: ${period}`);
      return true;
    });
  }
  reports.add_separator();
  // Submenus nest.
  const exportAs = reports.add_submenu("Export as", join(assets, "fa-download.ico"));
  for (const format of ["CSV", "JSON", "PDF"]) {
    exportAs.add_menu(format, "", false, () => {
      console.log(`Export as ${format}`);
      return true;
    });
  }

  tray.add_separator();

  tray.add_menu(
    "Coffee",
    join(assets, "fa-coffee.ico"),
    true,
    () => {
      console.log("Coffee: ON");
      return true;
    },
    () => {
      console.log("Coffee: OFF");
      return true;
    },
  );

  tray.add_menu(
    "Desktop",
    join(assets, "fa-desktop.ico"),
    true,
    () => {
      console.log("Desktop: ON");
      return true;
    },
    () => {
      console.log("Desktop: OFF");
      return true;
    },
  );

  tray.add_separator();

  tray.add_menu("Exit", join(assets, "fa-sign-out.ico"), false, () => {
    console.log("Exiting...");
    tray.stop();
    return false; // returning false also triggers stop
  });

  // Start the event loop: AppKit events are pumped between Node.js tasks.
  console.log("Tray running. Click the icon in the menu bar to open the menu.");
  await tray.update_with_loop();
  console.log("Done.");
}

main().catch(console.error);
