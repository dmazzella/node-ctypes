// demo_tray.js — FluentTray demo (mirrors C++ fluent-tray API)
//
// Usage:  node examples/windows/demo_tray.js

import { FluentTray } from "./tray/tray.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const assets = join(__dirname, "tray", "assets");

async function main() {
  const tray = new FluentTray();

  // Initialize the tray icon.
  tray.create_tray("demo", join(assets, "icon.ico"));

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

  // Start message loop
  console.log("Tray running. Click the icon to open the menu.");
  await tray.update_with_loop();
  console.log("Done.");
}

main().catch(console.error);
