// FluentTray — menu bar extra (status item) class for node-ctypes on macOS
// The macOS port of ../../windows/tray/tray.js, inspired by pit-ray/fluent-tray
// (https://github.com/pit-ray/fluent-tray). Same API: create_tray, add_menu,
// add_separator, add_submenu, update, update_with_loop, stop.
// Extension of this port: add_submenu() for nested menus.
//
// Like the Windows version, the menus are windows of this script, not NSMenu:
// an NSMenu runs a modal tracking loop on the main thread (the JavaScript
// thread) for as long as it is open. Each menu is a non-activating NSPanel
// with a "menu" NSVisualEffectView and a view drawn by JavaScript (text,
// icons, check marks, highlight, submenu arrows); its mouse and keyboard
// events come through update(), which pumps the pending AppKit events
// (nextEventMatchingMask: and sendEvent:) like PeekMessageW / DispatchMessageW
// and never waits. Node.js timers, I/O and promises keep running between two
// updates, also while a menu is open.
//
// The icons are .ico files (or any image NSImage reads), drawn as template
// images tinted with the menu's text color; the colors follow the light / dark
// appearance and AppKit draws at the screen's backing scale (Retina).

import { CDLL, CFUNCTYPE, Structure, c_bool, c_char_p, c_double, c_int8, c_long, c_uint16, c_ulong, c_void, c_void_p } from "node-ctypes";

// ─── Objective-C types and constants ────────────────────────────────

const id = c_void_p;
const SEL = c_void_p;
const Class = c_void_p;
// BOOL is a C bool on Apple Silicon, a signed char on Intel.
const BOOL = process.arch === "arm64" ? c_bool : c_int8;
const NSInteger = c_long;
const NSUInteger = c_ulong;
const CGFloat = c_double;
const YES = true;
const NO = false;
const nil = null;

const NSApplicationActivationPolicyAccessory = 1; // no Dock icon, no menu bar: a menu bar extra
const NSApplicationActivationPolicyProhibited = 2; // the default of a command-line tool
const NSVariableStatusItemLength = -1;
const NSEventMaskAny = 0xffffffffffffffffn; // NSUIntegerMax
const NSEventMaskLeftMouseDown = 1 << 1;
const NSEventMaskRightMouseDown = 1 << 3;
// Panels
const NSWindowStyleMaskBorderless = 0;
const NSWindowStyleMaskNonactivatingPanel = 1 << 7; // key without activating the application
const NSBackingStoreBuffered = 2;
const NSPopUpMenuWindowLevel = 101;
const NSWindowCollectionBehaviorCanJoinAllSpaces = 1 << 0;
const NSWindowCollectionBehaviorTransient = 1 << 3;
const NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8;
const NSVisualEffectMaterialMenu = 5;
const NSVisualEffectBlendingModeBehindWindow = 0;
const NSVisualEffectStateActive = 1;
const NSViewWidthSizable = 2;
const NSViewHeightSizable = 16;
const NSTrackingMouseEnteredAndExited = 0x01;
const NSTrackingMouseMoved = 0x02;
const NSTrackingActiveAlways = 0x80;
const NSTrackingInVisibleRect = 0x200;
const NSCompositingOperationSourceOver = 2;
const NSCompositingOperationSourceAtop = 5;
// Key codes (kVK_*)
const kVK_Return = 0x24;
const kVK_Space = 0x31;
const kVK_Escape = 0x35;
const kVK_ANSI_KeypadEnter = 0x4c;
const kVK_LeftArrow = 0x7b;
const kVK_RightArrow = 0x7c;
const kVK_DownArrow = 0x7d;
const kVK_UpArrow = 0x7e;

// Menu metrics, in points (macOS menus).
const MENU_ICON_SIZE = 16; // AppKit picks the .ico image for the backing scale
const TRAY_ICON_SIZE = 18;
const PADDING_Y = 5; // above the first and below the last row
const ROW_HEIGHT = 22;
const SEPARATOR_HEIGHT = 11;
const SIDE = 10; // left and right margins of the content
const HIGHLIGHT_INSET = 5; // the highlight is inset from the window's edges
const CHECK_COLUMN = 18;
const ICON_COLUMN = MENU_ICON_SIZE + 6;
const ARROW_COLUMN = 16;
const TITLE_GAP = 24; // between the longest title and the arrow column
const MIN_WIDTH = 140;
const CORNER_RADIUS = 8;
const SUBMENU_OVERLAP = 4;
const SUBMENU_DELAY_MS = 200; // hover delay before a submenu opens or closes

class NSPoint extends Structure {
  static _fields_ = [
    ["x", CGFloat],
    ["y", CGFloat],
  ];
}

class NSSize extends Structure {
  static _fields_ = [
    ["width", CGFloat],
    ["height", CGFloat],
  ];
}

class NSRect extends Structure {
  static _fields_ = [
    ["origin", NSPoint],
    ["size", NSSize],
  ];
}

const NSMakeRect = (x, y, width, height) => new NSRect(new NSPoint(x, y), new NSSize(width, height));
const pointInRect = (p, r) => p.x >= r.origin.x && p.x < r.origin.x + r.size.width && p.y >= r.origin.y && p.y < r.origin.y + r.size.height;

// ─── Libraries and the Objective-C runtime ──────────────────────────

const libobjc = new CDLL("/usr/lib/libobjc.A.dylib");
const foundation = new CDLL("/System/Library/Frameworks/Foundation.framework/Foundation");
const appkit = new CDLL("/System/Library/Frameworks/AppKit.framework/AppKit");

function prototype(fn, restype, argtypes) {
  fn.restype = restype;
  fn.argtypes = argtypes;
}

prototype(libobjc.objc_getClass, Class, [c_char_p]);
prototype(libobjc.sel_registerName, SEL, [c_char_p]);
prototype(libobjc.sel_getName, c_char_p, [SEL]);
prototype(libobjc.objc_allocateClassPair, Class, [Class, c_char_p, NSUInteger]);
prototype(libobjc.objc_registerClassPair, c_void, [Class]);
prototype(libobjc.class_addMethod, BOOL, [Class, SEL, c_void_p, c_char_p]);
prototype(libobjc.objc_autoreleasePoolPush, c_void_p, []);
prototype(libobjc.objc_autoreleasePoolPop, c_void, [c_void_p]);
prototype(appkit.NSRectFillUsingOperation, c_void, [NSRect, NSUInteger]);

const selectors = new Map();
function sel(name) {
  let selector = selectors.get(name);
  if (selector === undefined) selectors.set(name, (selector = libobjc.sel_registerName(name)));
  return selector;
}
const cls = (name) => libobjc.objc_getClass(name);

/**
 * objc_msgSend cast to a method's prototype: (receiver, selector, ...args).
 * Python: CFUNCTYPE(restype, c_void_p, c_void_p, ...)(("objc_msgSend", libobjc)).
 */
function msgSend(restype, ...argtypes) {
  const fn = CFUNCTYPE(restype, id, SEL, ...argtypes)(["objc_msgSend", libobjc]);
  return (receiver, selector, ...args) => fn(receiver, sel(selector), ...args);
}

const send = msgSend(id);
const sendId = msgSend(id, id);
const sendIdId = msgSend(id, id, id);
const sendStr = msgSend(id, c_char_p);
const sendDouble = msgSend(id, CGFloat);
const sendRect = msgSend(id, NSRect);
const sendSize = msgSend(id, NSSize);
const setId = msgSend(c_void, id);
const setIdId = msgSend(c_void, id, id);
const setBool = msgSend(c_void, BOOL);
const setInt = msgSend(c_void, NSInteger);
const setDouble = msgSend(c_void, CGFloat);
const setSel = msgSend(c_void, SEL);
const setSize = msgSend(c_void, NSSize);
const getBool = msgSend(BOOL);
const getIntRaw = msgSend(NSInteger);
const getInt = (receiver, selector) => Number(getIntRaw(receiver, selector));
const getSize = msgSend(NSSize);
const getRect = msgSend(NSRect);
const getPoint = msgSend(NSPoint);
const getKeyCode = msgSend(c_uint16);
const sendActionOn = msgSend(NSInteger, NSUInteger);
const nextEvent = msgSend(id, NSUInteger, id, id, BOOL); // nextEventMatchingMask:untilDate:inMode:dequeue:
const initPanel = msgSend(id, NSRect, NSUInteger, NSUInteger, BOOL); // initWithContentRect:styleMask:backing:defer:
const setFrameDisplay = msgSend(c_void, NSRect, BOOL);
const initTrackingArea = msgSend(id, NSRect, NSUInteger, id, id); // initWithRect:options:owner:userInfo:
const convertPoint = msgSend(NSPoint, NSPoint, id); // convertPoint:fromView:
const drawAtPoint = msgSend(c_void, NSPoint, id); // drawAtPoint:withAttributes:
const sizeWithAttributes = msgSend(NSSize, id);
const roundedRect = msgSend(id, NSRect, CGFloat, CGFloat); // bezierPathWithRoundedRect:xRadius:yRadius:
const drawImage = msgSend(c_void, NSRect, NSRect, NSUInteger, CGFloat, BOOL, id); // drawInRect:fromRect:operation:fraction:respectFlipped:hints:

const NSDefaultRunLoopMode = c_void_p.in_dll(foundation, "NSDefaultRunLoopMode").value;
const NSFontAttributeName = c_void_p.in_dll(appkit, "NSFontAttributeName").value;
const NSForegroundColorAttributeName = c_void_p.in_dll(appkit, "NSForegroundColorAttributeName").value;

/** An autoreleased NSString. */
const ns = (text) => sendStr(cls("NSString"), "stringWithUTF8String:", text);
const release = (object) => object && send(object, "release");
const alloc = (className) => send(cls(className), "alloc");
const color = (name) => send(cls("NSColor"), name);
const ZERO_RECT = NSMakeRect(0, 0, 0, 0);

function attributes(font, textColor) {
  const dictionary = send(cls("NSMutableDictionary"), "dictionary");
  setIdId(dictionary, "setObject:forKey:", font, NSFontAttributeName);
  if (textColor) setIdId(dictionary, "setObject:forKey:", textColor, NSForegroundColorAttributeName);
  return dictionary;
}

/** Draw a template image in `rect` (flipped view), tinted with `tint`; other images as they are. */
function drawIcon(image, rect, tint) {
  if (!image) return;
  if (!tint || !getBool(image, "isTemplate")) {
    drawImage(image, "drawInRect:fromRect:operation:fraction:respectFlipped:hints:", rect, ZERO_RECT, NSCompositingOperationSourceOver, 1, YES, nil);
    return;
  }
  // The shape of the image, filled with the color (source atop), in an image of its own.
  const { width, height } = rect.size;
  const tinted = sendSize(alloc("NSImage"), "initWithSize:", new NSSize(width, height));
  send(tinted, "lockFocus");
  const bounds = NSMakeRect(0, 0, width, height);
  drawImage(image, "drawInRect:fromRect:operation:fraction:respectFlipped:hints:", bounds, ZERO_RECT, NSCompositingOperationSourceOver, 1, NO, nil);
  send(tint, "set");
  appkit.NSRectFillUsingOperation(bounds, NSCompositingOperationSourceAtop);
  send(tinted, "unlockFocus");
  drawImage(tinted, "drawInRect:fromRect:operation:fraction:respectFlipped:hints:", rect, ZERO_RECT, NSCompositingOperationSourceOver, 1, YES, nil);
  release(tinted);
}

/** An SF Symbol, fitted in a box of `size` points centered at (x, cy). */
function drawSymbol(name, x, cy, size, tint) {
  const image = sendIdId(cls("NSImage"), "imageWithSystemSymbolName:accessibilityDescription:", ns(name), nil);
  if (!image) return;
  const { width, height } = getSize(image, "size");
  const scale = Math.min(size / width, size / height);
  drawIcon(image, NSMakeRect(x + (size - width * scale) / 2, cy - (height * scale) / 2, width * scale, height * scale), tint);
}

// ─── Runtime classes, shared by every tray of the process ───────────

// The implementations find the tray of the object that received the message.
// They live as long as the classes (Objective-C classes cannot be removed).
const owners = new Map(); // status target, panel or view (BigInt) → { tray, level }
const implementations = [];

const IMP_v = CFUNCTYPE(c_void, id, SEL);
const IMP_v_id = CFUNCTYPE(c_void, id, SEL, id);
const IMP_B = CFUNCTYPE(BOOL, id, SEL);
const IMP_B_id = CFUNCTYPE(BOOL, id, SEL, id);

function defineClass(name, superclass, methods) {
  if (cls(name)) return;
  const newClass = libobjc.objc_allocateClassPair(cls(superclass), name, 0);
  for (const [selector, types, implementation] of methods) {
    implementations.push(implementation);
    libobjc.class_addMethod(newClass, sel(selector), implementation, types);
  }
  libobjc.objc_registerClassPair(newClass);
}

/** Every mouse, key and action message, like a window procedure: (selector, receiver, event). */
function EventProc(self, _cmd, event) {
  const owner = owners.get(self);
  if (owner) owner.tray._onEvent(libobjc.sel_getName(_cmd), owner.level, event);
}

function defineClasses() {
  const eventProc = IMP_v_id(EventProc);
  const yes = IMP_B(() => YES);
  defineClass("NodeCtypesTrayTarget", "NSObject", [["statusClicked:", "v@:@", eventProc]]);
  // Only the root menu becomes key (it receives the keys); submenus never do.
  defineClass("NodeCtypesTrayPanel", "NSPanel", [
    ["canBecomeKeyWindow", "B@:", IMP_B((self) => owners.get(self)?.level === 0)],
    ["canBecomeMainWindow", "B@:", IMP_B(() => NO)],
  ]);
  defineClass("NodeCtypesTrayMenuView", "NSView", [
    ...["mouseMoved:", "mouseEntered:", "mouseExited:", "mouseDown:", "mouseUp:", "rightMouseDown:", "rightMouseUp:", "keyDown:"].map((selector) => [selector, "v@:@", eventProc]),
    ["drawRect:", "v@:{CGRect={CGPoint=dd}{CGSize=dd}}", IMP_v((self) => owners.get(self)?.tray._draw(owners.get(self).level))],
    ["isFlipped", "B@:", yes],
    ["acceptsFirstResponder", "B@:", yes],
    ["acceptsFirstMouse:", "B@:@", IMP_B_id(() => YES)], // a click acts at once, the panel being key or not
    ["viewDidChangeEffectiveAppearance", "v@:", IMP_v((self) => setBool(self, "setNeedsDisplay:", YES))],
  ]);
}

// ─── TrayStatus enum (mirrors C++) ──────────────────────────────────

export const TrayStatus = Object.freeze({
  RUNNING: "RUNNING",
  SHOULD_STOP: "SHOULD_STOP",
  FAILED: "FAILED",
  STOPPED: "STOPPED",
});

// ─── Menus ──────────────────────────────────────────────────────────

const ITEM_NORMAL = 0;
const ITEM_SEPARATOR = 1;

/** A menu and its panel (created the first time it is shown). */
class Menu {
  items = [];
  panel = null;
  view = null;
  hovered = -1;
  open = -1; // the item whose submenu is open
  layout = null; // { width, height, rows: [{ top, height }], columns }
}

/**
 * Builds a menu: the tray's own menu and the submenus returned by
 * add_submenu() have the same methods.
 */
export class FluentMenu {
  #menu;

  constructor(menu = new Menu()) {
    this.#menu = menu;
  }

  /**
   * Add a menu item.
   * @param {string} label
   * @param {string} [icon_path]  Path to an image file (.ico, .png, .pdf, ...)
   * @param {boolean} [toggleable=false]
   * @param {function(): boolean} [callback]  Returning false stops the tray
   * @param {function(): boolean} [unchecked_callback]
   * @returns {boolean}
   */
  add_menu(label = "", icon_path = "", toggleable = false, callback = null, unchecked_callback = null) {
    this.#menu.items.push({
      type: ITEM_NORMAL,
      label,
      iconPath: icon_path,
      checkable: toggleable,
      checked: false,
      enabled: true,
      onClick: callback,
      onUncheck: unchecked_callback,
      submenu: null,
    });
    return true;
  }

  /** Add a separator line under the last menu item added. */
  add_separator() {
    this.#menu.items.push({ type: ITEM_SEPARATOR });
  }

  /**
   * Add an item that opens a submenu (on hover, click or the Right key).
   * @param {string} label
   * @param {string} [icon_path]
   * @returns {FluentMenu} The submenu, to add its items
   */
  add_submenu(label = "", icon_path = "") {
    const submenu = new Menu();
    this.add_menu(label, icon_path);
    this.#menu.items.at(-1).submenu = submenu;
    return new FluentMenu(submenu);
  }

  /** Number of menu items (excluding separators). */
  count_menus() {
    return this.#menu.items.filter((m) => m.type === ITEM_NORMAL).length;
  }

  /** Iterator over menu items. */
  *[Symbol.iterator]() {
    for (const m of this.#menu.items) if (m.type === ITEM_NORMAL) yield m;
  }
}

// ─── FluentTray class ───────────────────────────────────────────────

export class FluentTray {
  #root = new Menu();
  #builder = new FluentMenu(this.#root);
  #chain = []; // open menus: the root, then each open submenu
  #keyLevel = 0; // the menu of the chain that the keyboard drives
  #pending = null; // hover timer (setTimeout) of a submenu to open or close
  #status = TrayStatus.STOPPED;
  #app = null;
  #statusItem = null;
  #target = null;
  #panels = []; // every panel created: released by stop()
  #images = new Map(); // path → NSImage (retained)
  #templateIcons;

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.template_icons=true] Menu icons are template images:
   *   drawn in the menu's text color (light, dark, highlighted, disabled).
   *   Use false for colored icons.
   */
  constructor(opts = {}) {
    this.#templateIcons = opts.template_icons ?? true;
  }

  // ── Public API (mirrors C++ FluentTray) ───────────────────────────

  /**
   * Initialize the status item in the menu bar.
   * @param {string} app_name  Tooltip text
   * @param {string} [icon_path]  Path to an image file; the name is shown without one
   * @param {boolean} [round_corner=true]
   * @returns {boolean}
   */
  create_tray(app_name, icon_path = "", round_corner = true) {
    const pool = libobjc.objc_autoreleasePoolPush();
    try {
      this.#app = send(cls("NSApplication"), "sharedApplication");
      // A command-line tool cannot show UI: become an accessory application
      // (no Dock icon), unless the host already chose a policy.
      if (getInt(this.#app, "activationPolicy") === NSApplicationActivationPolicyProhibited) {
        setInt(this.#app, "setActivationPolicy:", NSApplicationActivationPolicyAccessory);
      }
      send(this.#app, "finishLaunching");
      defineClasses();
      this.#cornerRadius = round_corner ? CORNER_RADIUS : 0;

      this.#target = send(alloc("NodeCtypesTrayTarget"), "init");
      owners.set(this.#target, { tray: this, level: -1 });
      const statusBar = send(cls("NSStatusBar"), "systemStatusBar");
      this.#statusItem = send(sendDouble(statusBar, "statusItemWithLength:", NSVariableStatusItemLength), "retain");
      if (!this.#statusItem) return this.#fail();
      const button = send(this.#statusItem, "button");
      const image = icon_path ? this.#image(icon_path, TRAY_ICON_SIZE, false) : null;
      if (image) setId(button, "setImage:", image);
      else setId(button, "setTitle:", ns(app_name));
      setId(button, "setToolTip:", ns(app_name));
      // The button sends statusClicked: on mouse down (left or right), as the
      // menu bar extras open their menus.
      setId(button, "setTarget:", this.#target);
      setSel(button, "setAction:", sel("statusClicked:"));
      sendActionOn(button, "sendActionOn:", NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown);

      this.#status = TrayStatus.RUNNING;
      return true;
    } finally {
      libobjc.objc_autoreleasePoolPop(pool);
    }
  }

  /**
   * Add a menu item.
   * @param {string} label
   * @param {string} [icon_path]
   * @param {boolean} [toggleable=false]
   * @param {function(): boolean} [callback]
   * @param {function(): boolean} [unchecked_callback]
   * @returns {boolean}
   */
  add_menu(label = "", icon_path = "", toggleable = false, callback = null, unchecked_callback = null) {
    return this.#builder.add_menu(label, icon_path, toggleable, callback, unchecked_callback);
  }

  /** Add a separator line under the last menu item added. */
  add_separator() {
    this.#builder.add_separator();
  }

  /**
   * Add an item that opens a submenu.
   * @param {string} label
   * @param {string} [icon_path]
   * @returns {FluentMenu} The submenu: add_menu, add_separator, add_submenu
   */
  add_submenu(label = "", icon_path = "") {
    return this.#builder.add_submenu(label, icon_path);
  }

  /**
   * Single update iteration: dispatch the pending AppKit events, without
   * waiting. Returns false on failure.
   * @returns {boolean}
   */
  update() {
    if (this.#status === TrayStatus.FAILED) return false;
    if (this.#status === TrayStatus.SHOULD_STOP) {
      this.#dispose();
      this.#status = TrayStatus.STOPPED;
    }
    if (this.#status === TrayStatus.STOPPED) return true;

    // Objects autoreleased by AppKit and by this script are freed after each
    // update: outside [NSApp run], nobody else drains a pool.
    const pool = libobjc.objc_autoreleasePoolPush();
    try {
      const distantPast = send(cls("NSDate"), "distantPast");
      for (;;) {
        const event = nextEvent(this.#app, "nextEventMatchingMask:untilDate:inMode:dequeue:", NSEventMaskAny, distantPast, NSDefaultRunLoopMode, YES);
        if (!event) break;
        setId(this.#app, "sendEvent:", event);
        if (this.#status !== TrayStatus.RUNNING) break;
      }
      if (this.#chain.length && this.#shouldDismiss()) this.#hideAll();
    } finally {
      libobjc.objc_autoreleasePoolPop(pool);
    }
    return true;
  }

  /**
   * Create a message loop to update the tray.
   * @param {number} [sleep_ms=1]
   * @returns {Promise<boolean>}
   */
  async update_with_loop(sleep_ms = 1) {
    while (this.#status !== TrayStatus.STOPPED) {
      if (!this.update()) return false;
      if (this.#status === TrayStatus.STOPPED) break;
      await new Promise((r) => setTimeout(r, sleep_ms));
    }
    return true;
  }

  /** Exit the tray successfully: the panels and the images are released by the next update. */
  stop() {
    if (this.#status !== TrayStatus.RUNNING) return;
    this.#hideAll();
    setId(send(cls("NSStatusBar"), "systemStatusBar"), "removeStatusItem:", this.#statusItem);
    this.#status = TrayStatus.SHOULD_STOP;
  }

  /** @returns {TrayStatus} */
  status() {
    return this.#status;
  }

  /** @returns {bigint} The NSStatusItem (the HWND of the Windows version). */
  window_handle() {
    return this.#statusItem;
  }

  /** Number of menu items (excluding separators). */
  count_menus() {
    return this.#builder.count_menus();
  }

  /** Iterator over menu items. */
  *[Symbol.iterator]() {
    yield* this.#builder;
  }

  // ── Private: panels ───────────────────────────────────────────────

  #cornerRadius = CORNER_RADIUS;
  #wasKey = false; // the root menu has been key since it was shown

  #fail() {
    this.#status = TrayStatus.FAILED;
    return false;
  }

  /** An NSImage of an icon file, `height` points high (cached, retained); null if it cannot be read. */
  #image(path, height, template) {
    const key = `${path}|${height}|${template}`;
    if (!this.#images.has(key)) {
      // initWithContentsOfFile: reads .ico through ImageIO, with every size
      // of the file: AppKit draws the best one for the screen's backing scale.
      const image = sendId(alloc("NSImage"), "initWithContentsOfFile:", ns(path));
      if (image) {
        const { width: w, height: h } = getSize(image, "size");
        setSize(image, "setSize:", new NSSize(h ? (w * height) / h : height, height));
        setBool(image, "setTemplate:", template);
      }
      this.#images.set(key, image);
    }
    return this.#images.get(key);
  }

  /**
   * The panel of a menu: borderless, non-activating (it takes the keys
   * without activating this application, so the frontmost one keeps its
   * focus), above the other windows, on every Space and over full-screen
   * applications. Its content is the "menu" material, with rounded corners.
   */
  #ensurePanel(menu, level) {
    if (menu.panel) return;
    const panel = initPanel(alloc("NodeCtypesTrayPanel"), "initWithContentRect:styleMask:backing:defer:", NSMakeRect(0, 0, 100, 100), NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel, NSBackingStoreBuffered, NO);
    setBool(panel, "setReleasedWhenClosed:", NO);
    setBool(panel, "setHidesOnDeactivate:", NO);
    setBool(panel, "setOpaque:", NO);
    setId(panel, "setBackgroundColor:", color("clearColor"));
    setBool(panel, "setHasShadow:", YES);
    setInt(panel, "setLevel:", NSPopUpMenuWindowLevel);
    setInt(panel, "setCollectionBehavior:", NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorFullScreenAuxiliary);
    setBool(panel, "setAcceptsMouseMovedEvents:", YES);

    const effect = sendRect(alloc("NSVisualEffectView"), "initWithFrame:", NSMakeRect(0, 0, 100, 100));
    setInt(effect, "setMaterial:", NSVisualEffectMaterialMenu);
    setInt(effect, "setBlendingMode:", NSVisualEffectBlendingModeBehindWindow);
    setInt(effect, "setState:", NSVisualEffectStateActive);
    setBool(effect, "setWantsLayer:", YES);
    setDouble(send(effect, "layer"), "setCornerRadius:", this.#cornerRadius);
    setBool(send(effect, "layer"), "setMasksToBounds:", YES);
    setId(panel, "setContentView:", effect);
    release(effect);

    const view = sendRect(alloc("NodeCtypesTrayMenuView"), "initWithFrame:", NSMakeRect(0, 0, 100, 100));
    setInt(view, "setAutoresizingMask:", NSViewWidthSizable | NSViewHeightSizable);
    // Mouse moves, enters and exits, also while this application is not active.
    const options = NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveAlways | NSTrackingInVisibleRect;
    const area = initTrackingArea(alloc("NSTrackingArea"), "initWithRect:options:owner:userInfo:", ZERO_RECT, options, view, nil);
    setId(view, "addTrackingArea:", area);
    release(area);
    setId(effect, "addSubview:", view);
    release(view);
    setId(panel, "setInitialFirstResponder:", view);

    menu.panel = panel;
    menu.view = view;
    owners.set(panel, { tray: this, level });
    owners.set(view, { tray: this, level });
    this.#panels.push(menu);
  }

  /** Rows and size of a menu, measured with the menu font. */
  #measure(menu) {
    const font = sendDouble(cls("NSFont"), "menuFontOfSize:", 0);
    const attrs = attributes(font, null);
    const items = menu.items;
    const columns = {
      check: items.some((item) => item.type === ITEM_NORMAL && item.checkable),
      icon: items.some((item) => item.type === ITEM_NORMAL && item.iconPath && this.#image(item.iconPath, MENU_ICON_SIZE, this.#templateIcons)),
      arrow: items.some((item) => item.submenu),
    };
    let titleWidth = 0;
    let top = PADDING_Y;
    const rows = items.map((item) => {
      const height = item.type === ITEM_SEPARATOR ? SEPARATOR_HEIGHT : ROW_HEIGHT;
      if (item.type === ITEM_NORMAL) titleWidth = Math.max(titleWidth, sizeWithAttributes(ns(item.label), "sizeWithAttributes:", attrs).width);
      const row = { top, height };
      top += height;
      return row;
    });
    const titleX = SIDE + (columns.check ? CHECK_COLUMN : 0) + (columns.icon ? ICON_COLUMN : 0);
    const width = Math.ceil(Math.max(MIN_WIDTH, titleX + titleWidth + TITLE_GAP + (columns.arrow ? ARROW_COLUMN : 0) + SIDE));
    menu.layout = { width, height: top + PADDING_Y, rows, columns, titleX, font };
  }

  /** Show a menu with its top-left corner at (x, top) in screen coordinates, inside the visible frame of `screen`. */
  #show(menu, level, x, top, screen, flipX = null) {
    this.#ensurePanel(menu, level);
    this.#measure(menu);
    const { width, height } = menu.layout;
    const visible = getRect(screen, "visibleFrame");
    const minX = visible.origin.x + 4;
    const maxX = visible.origin.x + visible.size.width - 4;
    // A submenu that does not fit on the right opens on the left of its parent.
    if (x + width > maxX) x = flipX !== null ? flipX - width : maxX - width;
    x = Math.max(minX, x);
    let y = top - height;
    if (y < visible.origin.y + 4) y = visible.origin.y + 4;
    menu.hovered = -1;
    menu.open = -1;
    setFrameDisplay(menu.panel, "setFrame:display:", NSMakeRect(x, y, width, height), YES);
    setBool(menu.view, "setNeedsDisplay:", YES);
    if (level === 0) setId(menu.panel, "makeKeyAndOrderFront:", nil);
    else setId(menu.panel, "orderFront:", nil);
    send(menu.panel, "invalidateShadow"); // the shadow follows the rounded corners
    this.#chain[level] = menu;
  }

  /** The root menu, under the status item. */
  #showRoot() {
    const button = send(this.#statusItem, "button");
    const window = send(button, "window");
    const frame = getRect(window, "frame");
    this.#show(this.#root, 0, frame.origin.x, frame.origin.y - 2, send(window, "screen"));
    this.#keyLevel = 0;
    this.#wasKey = false;
    setBool(button, "highlight:", YES);
  }

  /** Open the submenu of item `index` of the menu at `level`, beside the item. */
  #openSubmenu(level, index) {
    const parent = this.#chain[level];
    const item = parent.items[index];
    if (!item?.submenu) return;
    this.#closeFrom(level + 1);
    const frame = getRect(parent.panel, "frame");
    const row = parent.layout.rows[index];
    const top = frame.origin.y + frame.size.height - row.top + PADDING_Y;
    this.#show(item.submenu, level + 1, frame.origin.x + frame.size.width - SUBMENU_OVERLAP, top, send(parent.panel, "screen"), frame.origin.x + SUBMENU_OVERLAP);
    parent.open = index;
    parent.hovered = index;
    this.#redraw(level);
  }

  /** Close the menus from `level` down. */
  #closeFrom(level) {
    for (const menu of this.#chain.splice(level)) setId(menu.panel, "orderOut:", nil);
    if (this.#chain[level - 1]) this.#chain[level - 1].open = -1;
    this.#keyLevel = Math.min(this.#keyLevel, Math.max(0, level - 1));
  }

  #hideAll() {
    this.#cancelPending();
    if (!this.#chain.length) return;
    this.#closeFrom(0);
    this.#keyLevel = 0;
    setBool(send(this.#statusItem, "button"), "highlight:", NO);
  }

  /**
   * Dismiss when the root menu stops being key (another application took the
   * focus) or a mouse button is down outside the menus and the status item,
   * like a click elsewhere (polled: no event tap is needed). The menu may
   * never become key: macOS lets a background process take the keyboard
   * focus only after an interaction of the user.
   */
  #shouldDismiss() {
    if (getBool(this.#root.panel, "isKeyWindow")) this.#wasKey = true;
    else if (this.#wasKey) return true;
    if (!getInt(cls("NSEvent"), "pressedMouseButtons")) return false;
    const mouse = getPoint(cls("NSEvent"), "mouseLocation");
    const statusWindow = send(send(this.#statusItem, "button"), "window");
    return !pointInRect(mouse, getRect(statusWindow, "frame")) && !this.#chain.some((menu) => pointInRect(mouse, getRect(menu.panel, "frame")));
  }

  #redraw(level) {
    const menu = this.#chain[level];
    if (menu) setBool(menu.view, "setNeedsDisplay:", YES);
  }

  #cancelPending() {
    clearTimeout(this.#pending);
    this.#pending = null;
  }

  // ── Private: drawing ──────────────────────────────────────────────

  /** drawRect: of the menu at `level`: highlight, check mark, icon, title and submenu arrow of each row. */
  _draw(level) {
    const menu = this.#chain[level];
    if (!menu?.layout) return;
    const { width, rows, columns, titleX, font } = menu.layout;
    // Semantic colors, resolved for the view's appearance (light or dark).
    menu.items.forEach((item, i) => {
      const { top, height } = rows[i];
      const cy = top + height / 2;
      if (item.type === ITEM_SEPARATOR) {
        send(color("separatorColor"), "setFill");
        appkit.NSRectFillUsingOperation(NSMakeRect(SIDE, Math.round(cy), width - 2 * SIDE, 1), NSCompositingOperationSourceOver);
        return;
      }
      const highlighted = i === menu.hovered && item.enabled;
      if (highlighted) {
        send(color("selectedContentBackgroundColor"), "setFill");
        send(roundedRect(cls("NSBezierPath"), "bezierPathWithRoundedRect:xRadius:yRadius:", NSMakeRect(HIGHLIGHT_INSET, top, width - 2 * HIGHLIGHT_INSET, height), 5, 5), "fill");
      }
      const text = color(!item.enabled ? "tertiaryLabelColor" : highlighted ? "selectedMenuItemTextColor" : "labelColor");
      let x = SIDE;
      if (columns.check) {
        if (item.checked) drawSymbol("checkmark", x, cy, 12, text);
        x += CHECK_COLUMN;
      }
      if (columns.icon) {
        const image = item.iconPath ? this.#image(item.iconPath, MENU_ICON_SIZE, this.#templateIcons) : null;
        if (image) {
          const size = getSize(image, "size");
          drawIcon(image, NSMakeRect(x + (MENU_ICON_SIZE - size.width) / 2, cy - size.height / 2, size.width, size.height), text);
        }
      }
      const attrs = attributes(font, text);
      const label = ns(item.label);
      const textHeight = sizeWithAttributes(label, "sizeWithAttributes:", attrs).height;
      drawAtPoint(label, "drawAtPoint:withAttributes:", new NSPoint(titleX, cy - textHeight / 2), attrs);
      if (item.submenu) drawSymbol("chevron.right", width - SIDE - 10, cy, 10, highlighted ? text : color("secondaryLabelColor"));
    });
  }

  // ── Private: events ───────────────────────────────────────────────

  /** The row under the mouse of an event, in the menu at `level`; -1 for none. */
  #hitTest(level, event) {
    const menu = this.#chain[level];
    if (!menu?.layout) return -1;
    const point = convertPoint(menu.view, "convertPoint:fromView:", getPoint(event, "locationInWindow"), nil);
    if (point.x < 0 || point.x >= menu.layout.width) return -1;
    return menu.layout.rows.findIndex((row) => point.y >= row.top && point.y < row.top + row.height);
  }

  /** Mouse, key and status item messages (EventProc). */
  _onEvent(selector, level, event) {
    switch (selector) {
      case "statusClicked:":
        if (this.#chain.length) this.#hideAll();
        else this.#showRoot();
        return;
      case "mouseEntered:":
      case "mouseMoved:":
        return this.#onHover(level, this.#hitTest(level, event));
      case "mouseExited:": {
        const menu = this.#chain[level];
        if (!menu) return;
        // The item of an open submenu stays highlighted.
        menu.hovered = menu.open;
        this.#redraw(level);
        return;
      }
      case "mouseUp:":
      case "rightMouseUp:":
        return this.#activate(level, this.#hitTest(level, event), false);
      case "keyDown:":
        return this.#onKey(getKeyCode(event, "keyCode"));
    }
    // mouseDown: / rightMouseDown: are handled on the button release.
  }

  #onHover(level, index) {
    const menu = this.#chain[level];
    if (!menu) return;
    // In a submenu: its parents highlight the items that opened it.
    this.#cancelPending();
    for (let i = 0; i < level; i++) {
      if (this.#chain[i].hovered !== this.#chain[i].open) {
        this.#chain[i].hovered = this.#chain[i].open;
        this.#redraw(i);
      }
    }
    this.#keyLevel = level;
    const item = menu.items[index];
    const selectable = item && item.type === ITEM_NORMAL && item.enabled;
    const next = selectable ? index : -1;
    if (next !== menu.hovered) {
      menu.hovered = next;
      this.#redraw(level);
    }
    // After the hover delay: open the submenu of the item, or close the one
    // of another item (a diagonal move towards a submenu does not close it).
    if (next !== menu.open) {
      this.#pending = setTimeout(() => {
        this.#pending = null;
        if (this.#chain[level] !== menu || menu.hovered !== next) return;
        if (item?.submenu && next >= 0) this.#openSubmenu(level, next);
        else this.#closeFrom(level + 1);
      }, SUBMENU_DELAY_MS);
    }
  }

  /** Run item `index` of the menu at `level`: a submenu opens; a toggle flips; false stops the tray. */
  #activate(level, index, fromKeyboard) {
    const menu = this.#chain[level];
    const item = menu?.items[index];
    if (!item || item.type !== ITEM_NORMAL || !item.enabled) return;
    if (item.submenu) {
      this.#cancelPending();
      this.#openSubmenu(level, index);
      if (fromKeyboard) this.#moveTo(level + 1, 0, 1);
      return;
    }
    this.#hideAll();
    let result = true;
    if (item.checkable) {
      item.checked = !item.checked;
      if (!item.checked && item.onUncheck) result = item.onUncheck();
      else if (item.onClick) result = item.onClick();
    } else if (item.onClick) {
      result = item.onClick();
    }
    if (result === false) this.stop();
  }

  /** Highlight the next selectable item from `start` in direction `step` (wrapping), in the menu at `level`. */
  #moveTo(level, start, step) {
    const menu = this.#chain[level];
    if (!menu) return;
    const count = menu.items.length;
    for (let n = 0, i = start; n < count; n++, i = (i + step + count) % count) {
      const item = menu.items[i];
      if (item.type === ITEM_NORMAL && item.enabled) {
        if (menu.open >= 0 && menu.open !== i) this.#closeFrom(level + 1);
        menu.hovered = i;
        this.#keyLevel = level;
        this.#redraw(level);
        return;
      }
    }
  }

  /** Arrows move and open / close submenus; Return, Enter and Space run; Escape closes. */
  #onKey(keyCode) {
    this.#cancelPending();
    const level = this.#keyLevel;
    const menu = this.#chain[level];
    if (!menu) return;
    switch (keyCode) {
      case kVK_DownArrow:
        return this.#moveTo(level, menu.hovered < 0 ? 0 : menu.hovered + 1, 1);
      case kVK_UpArrow:
        return this.#moveTo(level, menu.hovered < 0 ? menu.items.length - 1 : menu.hovered - 1, -1);
      case kVK_RightArrow:
        if (menu.items[menu.hovered]?.submenu) this.#activate(level, menu.hovered, true);
        return;
      case kVK_LeftArrow:
        if (level > 0) this.#closeFrom(level);
        return;
      case kVK_Escape:
        if (level > 0) this.#closeFrom(level);
        else this.#hideAll();
        return;
      case kVK_Return:
      case kVK_ANSI_KeypadEnter:
      case kVK_Space:
        return this.#activate(level, menu.hovered, true);
    }
  }

  #dispose() {
    this.#cancelPending();
    for (const menu of this.#panels) {
      owners.delete(menu.panel);
      owners.delete(menu.view);
      setId(menu.panel, "orderOut:", nil);
      release(menu.panel);
      menu.panel = menu.view = null;
    }
    this.#panels = [];
    release(this.#statusItem);
    for (const image of this.#images.values()) release(image);
    this.#images.clear();
    owners.delete(this.#target);
    release(this.#target);
    this.#statusItem = this.#target = null;
  }
}

export default FluentTray;
