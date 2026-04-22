/**
 * demo_accessibility.js — macOS Accessibility API demo
 *
 * Demonstrates: finding windows, printing element trees,
 * searching UI elements, setting text field values, and pressing buttons.
 *
 * Run:
 *   node examples/macos/demo_accessibility.js --pid <PID>
 *   node examples/macos/demo_accessibility.js --pid <PID> --tree
 *   node examples/macos/demo_accessibility.js --pid <PID> --tree --depth 4
 *   node examples/macos/demo_accessibility.js --pid <PID> --title "Window Title"
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-role AXTextField
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-role AXTextField --set-value-title "Username"
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-role AXTextField --set-value-subrole AXSecureTextField
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-placeholder "Email"
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-identifier "login-email"
 *   node examples/macos/demo_accessibility.js --pid <PID> --set-value "Hello" --set-value-role AXTextField --set-value-enabled
 *   node examples/macos/demo_accessibility.js --pid <PID> --press "Submit"
 *
 * Prerequisite:
 *   Accessibility permissions must be granted to Terminal / iTerm / your app.
 *   The script will prompt for permission if not already granted.
 */

import { AXApplication, AXSystem, isAccessibilityEnabled, requestAccessibility, close } from "./accessibility/accessibility.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { depth: Infinity };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--pid":
        opts.pid = parseInt(args[++i], 10);
        break;
      case "--title":
        opts.title = args[++i];
        break;
      case "--set-value":
        opts.setValue = args[++i];
        break;
      case "--set-value-role":
        opts.setValueRole = args[++i];
        break;
      case "--set-value-title":
        opts.setValueTitle = args[++i];
        break;
      case "--set-value-description":
        opts.setValueDescription = args[++i];
        break;
      case "--set-value-identifier":
        opts.setValueIdentifier = args[++i];
        break;
      case "--set-value-placeholder":
        opts.setValuePlaceholder = args[++i];
        break;
      case "--set-value-help":
        opts.setValueHelp = args[++i];
        break;
      case "--set-value-subrole":
        opts.setValueSubrole = args[++i];
        break;
      case "--set-value-enabled":
        opts.setValueEnabled = true;
        break;
      case "--set-value-url":
        opts.setValueUrl = args[++i];
        break;
      case "--press":
        opts.press = args[++i];
        break;
      case "--tree":
        opts.tree = true;
        break;
      case "--depth":
        opts.depth = parseInt(args[++i], 10);
        break;
    }
  }

  if (
    opts.setValue !== undefined &&
    !opts.setValueRole &&
    !opts.setValueTitle &&
    !opts.setValueDescription &&
    !opts.setValueIdentifier &&
    !opts.setValuePlaceholder &&
    !opts.setValueHelp &&
    !opts.setValueSubrole &&
    opts.setValueEnabled === undefined &&
    !opts.setValueUrl
  ) {
    console.error("Error: --set-value requires at least one targeting option:");
    console.error("  --set-value-role <role>           e.g. AXTextField");
    console.error('  --set-value-title <title>         e.g. "Username"');
    console.error('  --set-value-description <desc>    e.g. "Search field"');
    console.error('  --set-value-identifier <id>       e.g. "login-email"');
    console.error('  --set-value-placeholder <text>    e.g. "Email"');
    console.error('  --set-value-help <text>           e.g. "Enter your password"');
    console.error("  --set-value-subrole <subrole>     e.g. AXSecureTextField");
    console.error("  --set-value-enabled               only match enabled elements");
    console.error('  --set-value-url <url>             e.g. "https://example.com"');
    process.exit(1);
  }

  return opts;
}

/**
 * Truncate a string for display.
 */
function trunc(s, max = 60) {
  if (typeof s !== "string") return String(s ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Recursively print the element tree with box-drawing characters.
 * Falls back to AXChildrenInNavigationOrder when AXChildren is empty
 * (required for browser web content).
 *
 * @param {import("./accessibility/accessibility.js").AXElement} element
 * @param {number} depth - current depth (0 = root)
 * @param {number} maxDepth - stop recursing beyond this depth
 * @param {string} prefix - line prefix for children
 * @param {boolean} isLast - whether this node is the last sibling
 */
function printTree(element, depth, maxDepth, prefix, isLast) {
  if (depth > maxDepth) return;

  const role = element.role || "?";
  const subrole = element.subrole;
  const title = element.title;
  const value = element.value;
  const desc = element.description;
  const identifier = element.identifier;
  const placeholder = element.placeholder;

  // Build the info string
  let info = role;
  if (subrole && subrole !== "AXUnknown") info += `/${subrole}`;
  if (title) info += `  title="${trunc(title)}"`;
  if (typeof value === "string" && value) info += `  value="${trunc(value)}"`;
  if (desc && desc !== title) info += `  desc="${trunc(desc)}"`;
  if (identifier) info += `  id="${trunc(identifier)}"`;
  if (placeholder) info += `  placeholder="${trunc(placeholder)}"`;

  if (depth === 0) {
    console.log(info);
  } else {
    const connector = isLast ? "└─ " : "├─ ";
    console.log(prefix + connector + info);
  }

  if (depth === maxDepth) return;

  // Prefer AXChildren; fall back to AXChildrenInNavigationOrder for browsers
  let children = element.getChildren();
  if (children.length === 0) children = element.getNavigationChildren();

  const childPrefix = depth === 0 ? "" : prefix + (isLast ? "   " : "│  ");
  for (let i = 0; i < children.length; i++) {
    printTree(children[i], depth + 1, maxDepth, childPrefix, i === children.length - 1);
  }
}

function main() {
  const opts = parseArgs();

  // 1. Check accessibility permissions
  console.log("[1] Checking accessibility permissions...");
  if (!isAccessibilityEnabled()) {
    console.log("    Not trusted. Requesting permission...");
    requestAccessibility();
    console.log("    Please grant accessibility permission in System Settings and re-run.");
    process.exit(1);
  }
  console.log("    Accessibility is enabled.");

  // 2. Connect to application
  if (!opts.pid) {
    console.error("Usage: node demo_accessibility.js --pid <PID> [--tree [--depth N]] [--title <title>] [--set-value <text> <targeting options>] [--press <button>]");
    console.error("\nTip: find a PID with `pgrep -x Safari` or `pgrep -x TextEdit`");
    process.exit(1);
  }

  console.log(`\n[2] Connecting to application (pid: ${opts.pid})...`);
  const app = new AXApplication(opts.pid);

  // 3. List windows
  console.log("\n[3] Listing windows...");
  const windows = app.getWindows();
  for (const win of windows) {
    console.log(`    Window: "${win.title}" (role: ${win.role})`);
  }

  if (windows.length === 0) {
    console.log("    No windows found.");
    app.dispose();
    close();
    return;
  }

  // 4. Find target window
  let win;
  if (opts.title) {
    console.log(`\n[4] Finding window: "${opts.title}"...`);
    win = app.findWindowByTitle(opts.title);
  } else {
    console.log(`\n[4] Using first window...`);
    win = windows[0];
  }

  if (!win) {
    console.log("    Window not found.");
    app.dispose();
    close();
    return;
  }
  console.log(`    Found: ${win}`);

  const allTextInputs = [...win.findChildren({ role: "AXTextField" }), ...win.findChildren({ role: "AXTextArea" })];
  const buttons = win.findChildren({ role: "AXButton" });

  // 5. Tree or element summary
  if (opts.tree) {
    const label = opts.depth < Infinity ? ` (max depth: ${opts.depth})` : "";
    console.log(`\n[5] Element tree${label}:\n`);
    printTree(win, 0, opts.depth, "", true);
    console.log();
  } else {
    console.log("\n[5] Searching for UI elements...");
    console.log(`    Found ${allTextInputs.length} text input(s):`);
    for (const tf of allTextInputs) {
      const settable = tf.isAttributeSettable("AXValue") ? "settable" : "read-only";
      const id = tf.identifier ? `  id="${tf.identifier}"` : "";
      const ph = tf.placeholder ? `  placeholder="${tf.placeholder}"` : "";
      console.log(`      - role: ${tf.role}, description: "${tf.description || ""}", value: "${tf.value || ""}"${id}${ph} (${settable})`);
    }
    console.log(`    Found ${buttons.length} button(s):`);
    for (const btn of buttons) {
      const id = btn.identifier ? `  id="${btn.identifier}"` : "";
      console.log(`      - title: "${btn.title || ""}", description: "${btn.description || ""}"${id}`);
    }
  }

  // 6. Set text field value (if requested)
  if (opts.setValue !== undefined) {
    const criteria = {};
    if (opts.setValueRole) criteria.role = opts.setValueRole;
    if (opts.setValueTitle) criteria.title = opts.setValueTitle;
    if (opts.setValueDescription) criteria.description = opts.setValueDescription;
    if (opts.setValueIdentifier) criteria.identifier = opts.setValueIdentifier;
    if (opts.setValuePlaceholder) criteria.placeholder = opts.setValuePlaceholder;
    if (opts.setValueHelp) criteria.help = opts.setValueHelp;
    if (opts.setValueSubrole) criteria.subrole = opts.setValueSubrole;
    if (opts.setValueEnabled !== undefined) criteria.enabled = opts.setValueEnabled;
    if (opts.setValueUrl) criteria.url = opts.setValueUrl;

    const target = win.findChild(criteria);
    const desc = [
      opts.setValueRole,
      opts.setValueSubrole ? `subrole="${opts.setValueSubrole}"` : null,
      opts.setValueTitle ? `title="${opts.setValueTitle}"` : null,
      opts.setValueDescription ? `desc="${opts.setValueDescription}"` : null,
      opts.setValueIdentifier ? `id="${opts.setValueIdentifier}"` : null,
      opts.setValuePlaceholder ? `placeholder="${opts.setValuePlaceholder}"` : null,
      opts.setValueHelp ? `help="${opts.setValueHelp}"` : null,
      opts.setValueEnabled !== undefined ? `enabled=${opts.setValueEnabled}` : null,
      opts.setValueUrl ? `url="${opts.setValueUrl}"` : null,
    ].filter(Boolean).join(" ");

    if (!target) {
      console.log(`\n[6] No element found matching ${desc} — skipping --set-value.`);
    } else {
      console.log(`\n[6] Setting value on ${desc}: "${opts.setValue}"...`);
      try {
        target.setFocus();
        target.setValue(opts.setValue);
        console.log(`    New value: "${target.value}"`);
      } catch (e) {
        console.log(`    Failed: ${e.message}`);
      }
    }
  }

  // 7. Press button (if requested)
  if (opts.press) {
    const target = buttons.find((b) => b.title === opts.press);
    if (target) {
      console.log(`\n[7] Pressing button "${opts.press}"...`);
      try {
        target.press();
        console.log("    Button pressed.");
      } catch (e) {
        console.log(`    Failed: ${e.message}`);
      }
    } else {
      console.log(`\n[7] Button "${opts.press}" not found.`);
    }
  }

  // 8. System-wide focused element
  console.log("\n[8] System-wide focused element...");
  const system = new AXSystem();
  const focused = system.getFocusedElement();
  if (focused) {
    console.log(`    Focused: ${focused}`);
    console.log(`    Role: ${focused.role}, Value: "${focused.value || ""}"`);
    focused.dispose();
  } else {
    console.log("    No focused element.");
  }
  system.dispose();

  // Cleanup
  app.dispose();
  close();
  console.log("\nDone.");
}

try {
  main();
} catch (err) {
  console.error("Error:", err.message);
  if (err.code !== undefined) {
    console.error("AXError code:", err.code, `(${err.axErrorName || "?"})`);
  }
  close();
  process.exit(1);
}
