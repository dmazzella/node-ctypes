/**
 * demo_accessibility_fse.js — FSE login page automation demo
 *
 * Demonstrates the full node-ctypes Accessibility API against a real browser
 * page (Safari → https://fse.intranet.bit4id.com/MyStartingPage?action=login):
 *
 *   - getWebArea()        find browser web content via AXChildrenInNavigationOrder
 *   - AXFrame / AXPosition  CGRect/CGPoint decoded from AXValueRef (not raw bigints)
 *   - findChildren()      recursive element search inside the web page
 *   - setValue/setFocus   fill form fields
 *   - press()             click Login button (opt-in via --submit)
 *
 * Run:
 *   node examples/macos/demo_accessibility_fse.js
 *   node examples/macos/demo_accessibility_fse.js --user myuser --pass mypass
 *   node examples/macos/demo_accessibility_fse.js --user myuser --pass mypass --submit
 *
 * Prerequisites:
 *   - Safari open with the FSE login page in an active tab
 *   - Accessibility permissions granted to your terminal / VS Code
 */

import { execFileSync } from "child_process";

import { AXApplication, isAccessibilityEnabled, requestAccessibility, close } from "./accessibility/accessibility.js";

// ─── CLI args ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { user: null, pass: null, submit: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--user":
        opts.user = args[++i];
        break;
      case "--pass":
        opts.pass = args[++i];
        break;
      case "--submit":
        opts.submit = true;
        break;
    }
  }
  return opts;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a label map for form fields from the web area.
 * For each AXStaticText, finds the nearest AXTextField below it (same x column)
 * and stores label → field frame key.
 * Returns a Map<"x,y" → label string>.
 */
function buildLabelMap(webArea) {
  const map = new Map();
  const staticTexts = webArea.findChildren({ role: "AXStaticText" });
  const textFields = webArea.findChildren({ role: "AXTextField" });

  for (const st of staticTexts) {
    const stFrame = st.getAttribute("AXFrame");
    if (!stFrame) continue;
    const label = st.value || st.title || "";
    if (!label) continue;

    // MoinMoin layout: label and field are on the same row (same y ± 5px),
    // with the label to the left of the field (stFrame.x < tfFrame.x).
    let best = null;
    let bestDx = Infinity;
    for (const tf of textFields) {
      const tfFrame = tf.getAttribute("AXFrame");
      if (!tfFrame) continue;
      const dy = Math.abs(tfFrame.y - stFrame.y);
      const dx = tfFrame.x - stFrame.x;
      if (dy <= 5 && dx > 0 && dx < bestDx) {
        bestDx = dx;
        best = tfFrame;
      }
    }
    if (best) map.set(`${best.x},${best.y}`, label);
  }
  return map;
}

/** Format a CGRect frame object for display. */
function fmtFrame(f) {
  if (!f || typeof f !== "object") return "n/a";
  return `(${f.x}, ${f.y})  ${f.width}×${f.height}`;
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs();

  // ── 1. Permissions ────────────────────────────────────────────────
  console.log("[1] Accessibility permissions...");
  if (!isAccessibilityEnabled()) {
    requestAccessibility();
    console.error("    Not trusted. Grant access in:");
    console.error("    System Settings → Privacy & Security → Accessibility");
    process.exit(1);
  }
  console.log("    OK\n");

  // ── 2. Find Safari PID ────────────────────────────────────────────
  console.log("[2] Finding Safari process...");
  let safariPid;
  try {
    safariPid = parseInt(execFileSync("pgrep", ["-x", "Safari"], { encoding: "utf8" }).trim(), 10);
  } catch {
    console.error("    Safari not running. Open Safari with the FSE login page and retry.");
    process.exit(1);
  }
  if (!safariPid || isNaN(safariPid)) {
    console.error("    Could not read Safari PID.");
    process.exit(1);
  }
  console.log(`    PID: ${safariPid}\n`);

  const app = new AXApplication(safariPid);

  // ── 3. List windows and find the login window ─────────────────────
  console.log("[3] Safari windows:");
  const windows = app.getWindows();
  for (const [i, win] of windows.entries()) {
    console.log(`    [${i}] "${win.title}"`);
  }
  console.log();

  const loginWin = windows.find((w) => w.title && (w.title.includes("Login") || w.title.includes("Bit4id"))) ?? windows[0];

  if (!loginWin) {
    console.error("    No window found. Open the FSE login page in Safari.");
    app.dispose();
    close();
    process.exit(1);
  }
  console.log(`    Target: "${loginWin.title}"\n`);

  // ── 4. Locate the AXWebArea ───────────────────────────────────────
  console.log("[4] Locating AXWebArea...");
  console.log("    (traverses AXChildren + AXChildrenInNavigationOrder)");
  const webArea = app.getWebArea(loginWin);
  if (!webArea) {
    console.error("    AXWebArea not found — is the page fully loaded?");
    app.dispose();
    close();
    process.exit(1);
  }
  console.log(`    Found: "${webArea.title || webArea.description || "(no title)"}"\n`);

  // ── 5. Inspect form elements ──────────────────────────────────────
  console.log("[5] Form elements:");

  const allFields = webArea.findChildren({ role: "AXTextField" });

  // The first field is the Safari/wiki search bar — skip it
  const formFields = allFields.filter((f) => f.title !== "Search:" && f.description !== "campo di ricerca smart");

  const labelMap = buildLabelMap(webArea);

  console.log(`\n    Text fields (${formFields.length}):`);
  for (const [i, f] of formFields.entries()) {
    const frame = f.getAttribute("AXFrame");
    const label = (frame && labelMap.get(`${frame.x},${frame.y}`)) || f.title || f.description || "";
    const pos = f.getAttribute("AXPosition");
    const settable = f.isAttributeSettable("AXValue");
    console.log(`\n    [${i}] label    : "${label}"`);
    console.log(`        value    : "${f.value ?? ""}"`);
    console.log(`        settable : ${settable}`);
    console.log(`        position : (${pos?.x}, ${pos?.y})`);
    console.log(`        frame    : ${fmtFrame(frame)}`);
  }

  const buttons = webArea.findChildren({ role: "AXButton" });
  console.log(`\n    Buttons (${buttons.length}):`);
  for (const btn of buttons) {
    console.log(`      title="${btn.title || "(no title)"}"  frame: ${fmtFrame(btn.getAttribute("AXFrame"))}`);
  }
  console.log();

  // ── 6. Fill form ──────────────────────────────────────────────────
  if (opts.user !== null || opts.pass !== null) {
    console.log("[6] Filling form...");

    const [usernameField, passwordField] = formFields;

    if (opts.user !== null && usernameField) {
      usernameField.setFocus();
      usernameField.setValue(opts.user);
      const readBack = usernameField.value ?? "";
      const ok = readBack === opts.user;
      console.log(`    username → "${readBack}" ${ok ? "✓" : "✗ (expected: " + opts.user + ")"}`);
    }

    if (opts.pass !== null && passwordField) {
      passwordField.setFocus();
      passwordField.setValue(opts.pass);
      // Password fields return bullet chars — verify length as proxy
      const readBack = passwordField.value ?? "";
      const ok = readBack.length === opts.pass.length;
      console.log(`    password → ${readBack.length} chars ${ok ? "✓" : "✗"}`);
    }
    console.log();
  } else {
    console.log("[6] Skipped — pass --user and/or --pass to fill the form\n");
  }

  // ── 7. Submit ─────────────────────────────────────────────────────
  const loginBtn = webArea.findChild({ role: "AXButton", title: "Login" });

  if (opts.submit) {
    if (!loginBtn) {
      console.error("[7] Login button not found — cannot submit.");
    } else {
      console.log("[7] Pressing Login button...");
      loginBtn.press();
      console.log("    Done.\n");
    }
  } else {
    if (loginBtn) {
      console.log(`[7] Ready to submit. Pass --submit to click the Login button.`);
      console.log(`    Button frame: ${fmtFrame(loginBtn.getAttribute("AXFrame"))}\n`);
    } else {
      console.log("[7] Login button not found in page.\n");
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────
  app.dispose();
  close();
  console.log("Done.");
}

try {
  main();
} catch (err) {
  console.error("\nError:", err.message);
  if (err.code !== undefined) {
    console.error("AXError code:", err.code, `(${err.axErrorName ?? "?"})`);
  }
  close();
  process.exit(1);
}
