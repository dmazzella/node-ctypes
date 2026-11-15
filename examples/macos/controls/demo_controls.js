// macOS Controls Showcase Demo
// A small Cocoa (AppKit) application written in JavaScript with node-ctypes,
// in the style of a Python ctypes script driving the Objective-C runtime:
//   - menu bar with key equivalents, toolbar with SF Symbols, status bar
//   - tab view with three pages: common controls (with a live chart drawn by
//     a custom NSView), a file browser (NSOutlineView + data-source NSTableView,
//     drag and drop) and date/time pickers
//   - an alert with a progress bar driven by a timer, a menu bar status item
//     with popover notifications
//   - system / light / dark appearance, Retina, full keyboard access
//
// Every Objective-C call is objc_msgSend cast to the C prototype of the method,
// and the classes (controller, flipped view, chart) are created at runtime with
// objc_allocateClassPair / class_addMethod, their methods JavaScript callbacks.
//
// Usage:
//   node examples/macos/controls/demo_controls.js

import { CDLL, CFUNCTYPE, Structure, byref, c_bool, c_char_p, c_double, c_int16, c_int8, c_long, c_ulong, c_void, c_void_p, sizeof } from "node-ctypes";

// Objective-C types. BOOL is a C bool on Apple Silicon, a signed char on Intel.
const id = c_void_p;
const SEL = c_void_p;
const Class = c_void_p;
const BOOL = process.arch === "arm64" ? c_bool : c_int8;
const NSInteger = c_long;
const NSUInteger = c_ulong;
const CGFloat = c_double;
const YES = true;
const NO = false;
const nil = null;
// Objective-C object pointers are BigInt (or null for nil).
const sameObject = (a, b) => a !== null && b !== null && BigInt(a) === BigInt(b);

// Windows
const NSWindowStyleMaskTitled = 1 << 0;
const NSWindowStyleMaskClosable = 1 << 1;
const NSWindowStyleMaskMiniaturizable = 1 << 2;
const NSWindowStyleMaskResizable = 1 << 3;
const NSBackingStoreBuffered = 2;
const NSNormalWindowLevel = 0;
const NSFloatingWindowLevel = 3;
const NSWindowToolbarStyleUnified = 3;
const NSToolbarDisplayModeIconAndLabel = 1;
// Application
const NSApplicationActivationPolicyRegular = 0;
const NSTerminateCancel = 0;
const NSEventTypeApplicationDefined = 15;
const NSInformationalRequest = 10;
const NSModalResponseOK = 1;
const NSAlertFirstButtonReturn = 1000;
const NSAlertStyleInformational = 1;
// Key equivalent modifiers
const NSEventModifierFlagShift = 1 << 17;
const NSEventModifierFlagControl = 1 << 18;
const NSEventModifierFlagOption = 1 << 19;
const NSEventModifierFlagCommand = 1 << 20;
// Views: autoresizing masks
const NSViewMinXMargin = 1;
const NSViewWidthSizable = 2;
const NSViewMaxYMargin = 32;
const NSViewHeightSizable = 16;
// Controls
const NSControlStateValueOff = 0;
const NSControlStateValueOn = 1;
const NSControlSizeSmall = 1;
const NSProgressIndicatorStyleBar = 0;
const NSProgressIndicatorStyleSpinning = 1;
const NSBezelBorder = 2;
const NSLineBreakByTruncatingMiddle = 5;
// NSTextAlignment uses the iOS values on Apple Silicon (Right = 2), not on Intel (Right = 1).
const NSTextAlignmentRight = process.arch === "arm64" ? 2 : 1;
// Tables and outlines
const NSTableViewStyleFullWidth = 1;
const NSTableViewStyleSourceList = 3;
const NSTableViewStylePlain = 4;
const NSSplitViewDividerStyleThin = 2;
// Date pickers and formatters
const NSDatePickerStyleTextFieldAndStepper = 0;
const NSDatePickerStyleClockAndCalendar = 1;
const NSDatePickerElementFlagHourMinuteSecond = 0x000e;
const NSDatePickerElementFlagYearMonthDay = 0x00e0;
const NSDateFormatterShortStyle = 1;
const NSDateFormatterMediumStyle = 2;
const NSDateFormatterFullStyle = 4;
// Status item, popover, drag and drop, files
const NSVariableStatusItemLength = -1;
const NSPopoverBehaviorTransient = 1;
const NSRectEdgeMinY = 1;
const NSDragOperationNone = 0;
const NSDragOperationCopy = 1;
const NSDirectoryEnumerationSkipsHiddenFiles = 1 << 2;
const NSVolumeEnumerationSkipHiddenVolumes = 1 << 1;

// Timers (seconds)
const ANIMATE_INTERVAL = 0.05;
const SAMPLE_INTERVAL = 0.1;
const CLOCK_INTERVAL = 1;
const RESTORE_DELAY = 2;
const NOTIFICATION_DURATION = 4;

// ============================================================================
// Foundation / CoreGraphics structures, passed and returned by value.
// CGFloat is a double and NSInteger a long on 64-bit macOS.
// ============================================================================

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

class NSOperatingSystemVersion extends Structure {
  static _fields_ = [
    ["majorVersion", NSInteger],
    ["minorVersion", NSInteger],
    ["patchVersion", NSInteger],
  ];
}

const NSMakePoint = (x, y) => new NSPoint(x, y);
const NSMakeSize = (width, height) => new NSSize(width, height);
const NSMakeRect = (x, y, width, height) => new NSRect(new NSPoint(x, y), new NSSize(width, height));

// ============================================================================
// Libraries and the Objective-C runtime (Python-ctypes style: argtypes / restype).
// ============================================================================

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
prototype(appkit.NSRectFill, c_void, [NSRect]);

const selectors = new Map();
function sel(name) {
  let selector = selectors.get(name);
  if (selector === undefined) selectors.set(name, (selector = libobjc.sel_registerName(name)));
  return selector;
}
const cls = (name) => libobjc.objc_getClass(name);

/**
 * objc_msgSend cast to a method's prototype: (receiver, selector, ...args).
 * Same export, typed prototypes (Python: CFUNCTYPE(...)(("objc_msgSend", libobjc))).
 * On Intel, structures larger than 16 bytes are returned through objc_msgSend_stret.
 */
function msgSend(restype, ...argtypes) {
  const stret = process.arch === "x64" && restype?.prototype instanceof Structure && sizeof(restype) > 16;
  const fn = CFUNCTYPE(restype, id, SEL, ...argtypes)([stret ? "objc_msgSend_stret" : "objc_msgSend", libobjc]);
  return (receiver, selector, ...args) => fn(receiver, sel(selector), ...args);
}

const send = msgSend(id); // id [receiver selector]
const sendId = msgSend(id, id); // id [receiver selector:object]
const sendIdId = msgSend(id, id, id);
const sendStr = msgSend(id, c_char_p);
const sendInt = msgSend(id, NSInteger);
const sendBool = msgSend(id, BOOL);
const sendDouble = msgSend(id, CGFloat);
const sendDouble2 = msgSend(id, CGFloat, CGFloat);
const sendRect = msgSend(id, NSRect);
const setId = msgSend(c_void, id); // void [receiver setter:object]
const setIdId = msgSend(c_void, id, id);
const setBool = msgSend(c_void, BOOL);
const setInt = msgSend(c_void, NSInteger);
const setDouble = msgSend(c_void, CGFloat);
const setSel = msgSend(c_void, SEL);
const setRect = msgSend(c_void, NSRect);
const setSize = msgSend(c_void, NSSize);
const getBool = msgSend(BOOL);
const getIntRaw = msgSend(NSInteger);
const getInt = (receiver, selector) => Number(getIntRaw(receiver, selector));
const getIntForRaw = msgSend(NSInteger, id);
const getIntFor = (receiver, selector, object) => Number(getIntForRaw(receiver, selector, object)); // [outline rowForItem:item]
const getDouble = msgSend(CGFloat);
const getStr = msgSend(c_char_p);
const getRect = msgSend(NSRect);
const getSize = msgSend(NSSize);
// Methods with their own prototypes
const initWindow = msgSend(id, NSRect, NSUInteger, NSUInteger, BOOL); // initWithContentRect:styleMask:backing:defer:
const initMenuItem = msgSend(id, id, SEL, id); // initWithTitle:action:keyEquivalent:
const buttonWithTitle = msgSend(id, id, id, SEL); // buttonWithTitle:target:action: and the checkbox / radio variants
const sliderWithValue = msgSend(id, CGFloat, CGFloat, CGFloat, id, SEL);
const initPopUpButton = msgSend(id, NSRect, BOOL); // initWithFrame:pullsDown:
const timerWithInterval = msgSend(id, CGFloat, id, SEL, id, BOOL); // timerWithTimeInterval:target:selector:userInfo:repeats:
const setPositionOfDivider = msgSend(c_void, CGFloat, NSInteger);
const selectRowIndexes = msgSend(c_void, id, BOOL);
const showRelativeToRect = msgSend(c_void, NSRect, id, NSUInteger);
const drawAtPoint = msgSend(c_void, NSPoint, id);
const strokeLine = msgSend(c_void, NSPoint, NSPoint);
const pathPoint = msgSend(c_void, NSPoint); // moveToPoint:, lineToPoint:
const getResourceValue = msgSend(BOOL, c_void_p, id, c_void_p); // getResourceValue:forKey:error:
const contentsOfDirectory = msgSend(id, id, id, NSUInteger, c_void_p); // contentsOfDirectoryAtURL:includingPropertiesForKeys:options:error:
const mountedVolumeURLs = msgSend(id, id, NSUInteger); // mountedVolumeURLsIncludingResourceValuesForKeys:options:
const requestUserAttention = msgSend(NSInteger, NSUInteger);
const otherEvent = msgSend(id, NSUInteger, NSPoint, NSUInteger, CGFloat, NSInteger, id, c_int16, NSInteger, NSInteger);
const postEvent = msgSend(c_void, id, BOOL);
const operatingSystemVersion = msgSend(NSOperatingSystemVersion);

// Exported NSString constants (Python: c_void_p.in_dll(appkit, "...").value).
const constant = (library, name) => c_void_p.in_dll(library, name).value;
const NSRunLoopCommonModes = constant(foundation, "NSRunLoopCommonModes");
const NSURLIsDirectoryKey = constant(foundation, "NSURLIsDirectoryKey");
const NSURLIsPackageKey = constant(foundation, "NSURLIsPackageKey");
const NSURLFileSizeKey = constant(foundation, "NSURLFileSizeKey");
const NSURLContentModificationDateKey = constant(foundation, "NSURLContentModificationDateKey");
const NSURLLocalizedTypeDescriptionKey = constant(foundation, "NSURLLocalizedTypeDescriptionKey");
const NSAppearanceNameAqua = constant(appkit, "NSAppearanceNameAqua");
const NSAppearanceNameDarkAqua = constant(appkit, "NSAppearanceNameDarkAqua");
const NSPasteboardTypeFileURL = constant(appkit, "NSPasteboardTypeFileURL");
const NSPasteboardURLReadingFileURLsOnlyKey = constant(appkit, "NSPasteboardURLReadingFileURLsOnlyKey");
const NSForegroundColorAttributeName = constant(appkit, "NSForegroundColorAttributeName");
const NSFontAttributeName = constant(appkit, "NSFontAttributeName");
const NSToolbarFlexibleSpaceItemIdentifier = constant(appkit, "NSToolbarFlexibleSpaceItemIdentifier");
const NSAboutPanelOptionApplicationName = constant(appkit, "NSAboutPanelOptionApplicationName");
const NSAboutPanelOptionApplicationVersion = constant(appkit, "NSAboutPanelOptionApplicationVersion");
const NSAboutPanelOptionVersion = constant(appkit, "NSAboutPanelOptionVersion");

// Method implementations: C functions whose first two arguments are self and _cmd.
const IMP_v_id = CFUNCTYPE(c_void, id, SEL, id); // - (void)action:(id)sender, notifications, timers
const IMP_v_id_id = CFUNCTYPE(c_void, id, SEL, id, id);
const IMP_v = CFUNCTYPE(c_void, id, SEL); // drawRect: (its NSRect argument is not read)
const IMP_B = CFUNCTYPE(BOOL, id, SEL);
const IMP_B_id = CFUNCTYPE(BOOL, id, SEL, id);
const IMP_B_id_id = CFUNCTYPE(BOOL, id, SEL, id, id);
const IMP_q_id = CFUNCTYPE(NSInteger, id, SEL, id);
const IMP_Q_id = CFUNCTYPE(NSUInteger, id, SEL, id);
const IMP_q_id_id = CFUNCTYPE(NSInteger, id, SEL, id, id);
const IMP_id_id = CFUNCTYPE(id, id, SEL, id);
const IMP_id_id_id_q = CFUNCTYPE(id, id, SEL, id, id, NSInteger);
const IMP_id_id_q_id = CFUNCTYPE(id, id, SEL, id, NSInteger, id);
const IMP_id_id_id_id = CFUNCTYPE(id, id, SEL, id, id, id);
const IMP_id_id_id_B = CFUNCTYPE(id, id, SEL, id, id, BOOL);

// ============================================================================
// Layout, in points: Retina scaling is done by AppKit. On the Controls page the
// boxes form two columns that share the width; below TWO_COLUMNS_WIDTH they
// stack in one column, and the page scrolls.
// ============================================================================

const MARGIN = 20;
const GAP = 12; // between boxes
const INSET = 14; // left and right padding inside a box
const BOX_TITLE = 24; // the title of a box, above its content
const MIN_COLUMN = 380;
const TWO_COLUMNS_WIDTH = 2 * MIN_COLUMN + 3 * MARGIN;
const WINDOW_W = 1060;
const WINDOW_H = 700;
const MIN_WINDOW_H = 420;
const STATUS_H = 24;
// Widths of controls inside a box of width `w`.
const FILL = (w) => w - 2 * INSET;
// Cell `i` of `n` equal buttons in a row, at most 140 wide.
const cellWidth = (w, n) => Math.min(140, (w - 2 * INSET - (n - 1) * 10) / n);
const cell = (i, n) => ({ x: (w) => INSET + i * (cellWidth(w, n) + 10), w: (w) => cellWidth(w, n) });
const HISTORY = 100; // chart samples: 10 s at SAMPLE_INTERVAL

// Global state for demo
let app = null;
let controller = null; // the instance of NodeCtypesController: target, delegate and data source
let window = null;
let pool = null;
let counter = 0;
let value = 0; // shared by the slider, the stepper, the progress bar and the chart
let syncing = false; // re-entrancy guard: setValue() changes the other controls
let animating = false;
let notifyAt100 = false;
const history = new Array(HISTORY).fill(0);
const callbacks = []; // method implementations: alive as long as their classes
const timers = new Map(); // selector → NSTimer
const menuItems = new Map(); // selector → [NSMenuItem]: their states follow the application
const toolbarItems = new Map(); // identifier → NSToolbarItem
let statusLabels = [];
let tabView = null;
let statusItem = null;
let popover = null;
let alert = null; // the alert with a progress bar, while it is open
let alertProgress = null;
let alertStep = 1;
let appearance = "system";
let keepOnTop = false;
// Controls page
let controlsScroll = null;
let controlsPage = null; // the flipped document view of the scroll view
const sections = []; // { box, height, column, items: [{ view, x, y, w, h }] }: a box and its controls
let textInput = null;
let animateCheckbox = null;
let slider = null;
let stepper = null;
let numberField = null;
let progressBar = null;
let spinner = null;
let listBox = null;
let chart = null;
const LIST_ITEMS = ["Item C", "Item A", "Item B", "Item E", "Item D"].sort();
// Files page
let outline = null;
let fileTable = null;
const nodes = new Map(); // outline item (a retained NSString) → { path, item, children }
let roots = [];
let rows = []; // table rows: { url, name, path, isDir, isPackage, size, modified, type, icon }
let currentFolder = null;
let revealing = false; // openFolder() is selecting an outline item
let showHidden = false;
let sortColumn = "name";
let sortAscending = true;
const COLUMNS = [
  { id: "icon", title: "", width: 20 },
  { id: "name", title: "Name", width: 260 },
  { id: "size", title: "Size", width: 90, right: true },
  { id: "type", title: "Kind", width: 170 },
  { id: "modified", title: "Date Modified", width: 150 },
];
// Date page
let datePicker = null;
let timePicker = null;
let calendar = null;
let clock = null;
let dateSummary = null;

// x and w of an item: points, or a function of the box width.
const resolve = (v, width) => (typeof v === "function" ? v(width) : v);

// ============================================================================
// Foundation helpers: strings, arrays, objects.
// ============================================================================

/** An autoreleased NSString. */
const ns = (text) => sendStr(cls("NSString"), "stringWithUTF8String:", text);
/** An NSString as a JavaScript string (null for nil). */
const str = (object) => (object ? getStr(object, "UTF8String") : null);
const retain = (object) => send(object, "retain");
const release = (object) => object && send(object, "release");
const alloc = (className) => send(cls(className), "alloc");
/** [[className alloc] init]: owned by the caller. */
const create = (className) => send(alloc(className), "init");
/** [[className alloc] initWithFrame:frame]. */
const createView = (className, x = 0, y = 0, w = 0, h = 0) => sendRect(alloc(className), "initWithFrame:", NSMakeRect(x, y, w, h));

function nsArray(objects) {
  const array = send(cls("NSMutableArray"), "array");
  for (const object of objects) setId(array, "addObject:", object);
  return array;
}

function jsArray(array) {
  const count = array ? getInt(array, "count") : 0;
  return Array.from({ length: count }, (_, i) => sendInt(array, "objectAtIndex:", i));
}

function nsDictionary(entries) {
  const dictionary = send(cls("NSMutableDictionary"), "dictionary");
  for (const [key, object] of entries) setIdId(dictionary, "setObject:forKey:", object, key);
  return dictionary;
}

/** An SF Symbol (macOS 11+); null if the name is unknown. */
const symbol = (name, description = name) => sendIdId(cls("NSImage"), "imageWithSystemSymbolName:accessibilityDescription:", ns(name), ns(description));
const label = (text) => sendId(cls("NSTextField"), "labelWithString:", ns(text));
const color = (name) => send(cls("NSColor"), name);

/** A class created at runtime: [selector, type encoding, implementation] for each method. */
function defineClass(name, superclass, methods) {
  const newClass = libobjc.objc_allocateClassPair(cls(superclass), name, 0);
  if (!newClass) throw new Error(`Class ${name} already exists`);
  for (const [selector, types, implementation] of methods) {
    callbacks.push(implementation);
    if (!libobjc.class_addMethod(newClass, sel(selector), implementation, types)) throw new Error(`class_addMethod ${selector}`);
  }
  libobjc.objc_registerClassPair(newClass);
  return newClass;
}

/** A repeating (or one-shot) NSTimer sending `selector` to the controller, also during menus, modal alerts and live resize. */
function startTimer(selector, interval, repeats = true) {
  stopTimer(selector);
  const timer = timerWithInterval(cls("NSTimer"), "timerWithTimeInterval:target:selector:userInfo:repeats:", interval, controller, sel(selector), nil, repeats);
  setIdId(send(cls("NSRunLoop"), "currentRunLoop"), "addTimer:forMode:", timer, NSRunLoopCommonModes);
  timers.set(selector, retain(timer));
}

function stopTimer(selector) {
  const timer = timers.get(selector);
  if (!timer) return;
  send(timer, "invalidate");
  release(timer);
  timers.delete(selector);
}

/** A one-shot timer has fired: it is already invalidated, release it. */
function forgetTimer(selector) {
  release(timers.get(selector));
  timers.delete(selector);
}

function setStatus(part, text) {
  setId(statusLabels[part], "setStringValue:", ns(text));
}

function setTarget(control, selector) {
  setId(control, "setTarget:", controller);
  setSel(control, "setAction:", sel(selector));
}

// ============================================================================
// Controls page: boxes in a responsive, scrollable layout.
// ============================================================================

/** Start a box of the given height, in column 0 (left) or 1 (right); the next controls belong to it. */
function createSection(title, height, column) {
  const box = createView("NSBox");
  setId(box, "setTitle:", ns(title));
  setId(controlsPage, "addSubview:", box);
  sections.push({ box, height, column, items: [] });
}

/**
 * Add a control to the last box, placed by layoutControls(): `place` is
 * { x, y, w, h } in points from the top-left corner of the box's content
 * (below its title); x and w may be functions of the box width, h defaults
 * to the control's fitting height. The controls are subviews of the page,
 * in front of their box, as the group boxes of Win32.
 */
function addControl(view, place) {
  setId(controlsPage, "addSubview:", view);
  sections.at(-1).items.push({ view, h: getSize(view, "fittingSize").height, ...place });
  return view;
}

/** Place every box and control for the page width. */
function layoutControls() {
  const { width } = getSize(controlsScroll, "contentSize");
  const twoColumns = width >= TWO_COLUMNS_WIDTH;
  const columnWidth = Math.max(MIN_COLUMN, twoColumns ? (width - 3 * MARGIN) / 2 : width - 2 * MARGIN);
  const bottoms = [MARGIN, MARGIN];
  for (const { box, height, column: preferred, items } of sections) {
    const column = twoColumns ? preferred : 0;
    const x = MARGIN + column * (columnWidth + MARGIN);
    const y = bottoms[column];
    // The page is flipped: y grows downwards, as in the layout values.
    setRect(box, "setFrame:", NSMakeRect(x, y, columnWidth, height));
    for (const item of items) {
      const top = y + BOX_TITLE + item.y + (item.center ? (item.center - item.h) / 2 : 0);
      setRect(item.view, "setFrame:", NSMakeRect(x + resolve(item.x, columnWidth), top, resolve(item.w, columnWidth), item.h));
    }
    bottoms[column] = y + height + GAP;
  }
  setSize(controlsPage, "setFrameSize:", NSMakeSize(width, Math.max(...bottoms) - GAP + MARGIN));
}

/** The value shown by the slider, the stepper, the progress bar and the chart. */
function setValue(next, source) {
  if (syncing) return;
  next = Math.max(0, Math.min(100, Math.round(next)));
  syncing = true;
  try {
    value = next;
    if (source !== "slider") setDouble(slider, "setDoubleValue:", value);
    if (source !== "stepper") setInt(stepper, "setIntegerValue:", value);
    // While the user types, the field keeps its text (and the insertion point)
    // unless the number was clamped.
    if (source !== "field" || str(send(numberField, "stringValue")) !== String(value)) setInt(numberField, "setIntegerValue:", value);
    setDouble(progressBar, "setDoubleValue:", value);
    setStatus(1, `Value: ${value}`);
  } finally {
    syncing = false;
  }
}

/** Start or stop the animation everywhere it is shown: checkbox, toolbar, menus and spinner. */
function setAnimate(on) {
  animating = on;
  if (on) {
    notifyAt100 = true;
    startTimer("animateTick:", ANIMATE_INTERVAL);
    setId(spinner, "startAnimation:", nil);
  } else {
    stopTimer("animateTick:");
    setId(spinner, "stopAnimation:", nil);
  }
  setInt(animateCheckbox, "setState:", on ? NSControlStateValueOn : NSControlStateValueOff);
  for (const item of menuItems.get("toggleAnimate:") ?? []) setInt(item, "setState:", on ? NSControlStateValueOn : NSControlStateValueOff);
  const toolbarItem = toolbarItems.get("animate");
  if (toolbarItem) {
    setId(toolbarItem, "setImage:", symbol(on ? "pause.fill" : "play.fill"));
    setId(toolbarItem, "setLabel:", ns(on ? "Pause" : "Animate"));
  }
  console.log(`Animation ${on ? "started" : "stopped"}`);
}

// ============================================================================
// Chart: a custom NSView subclass drawn with NSBezierPath. AppKit views are
// double-buffered and drawn at the screen's backing scale (Retina).
// ============================================================================

function drawChart(view) {
  const bounds = getRect(view, "bounds");
  const { width, height } = bounds.size;
  // Semantic colors: drawRect: runs with the view's appearance, light or dark.
  send(color("textBackgroundColor"), "setFill");
  appkit.NSRectFill(bounds);

  // Grid: 0, 25, 50, 75, 100 (y grows upwards).
  const top = 18;
  const plot = height - top - 4;
  const yOf = (v) => 4 + (v / 100) * plot;
  send(color("separatorColor"), "setStroke");
  for (let v = 0; v <= 100; v += 25) strokeLine(cls("NSBezierPath"), "strokeLineFromPoint:toPoint:", NSMakePoint(0, yOf(v)), NSMakePoint(width, yOf(v)));

  // The history: a filled area under a line, in the accent color.
  const accent = color("controlAccentColor");
  const step = width / (HISTORY - 1);
  const line = send(cls("NSBezierPath"), "bezierPath");
  const area = send(cls("NSBezierPath"), "bezierPath");
  pathPoint(area, "moveToPoint:", NSMakePoint(0, yOf(0)));
  history.forEach((v, i) => {
    const point = NSMakePoint(i * step, yOf(v));
    pathPoint(line, i === 0 ? "moveToPoint:" : "lineToPoint:", point);
    pathPoint(area, "lineToPoint:", point);
  });
  pathPoint(area, "lineToPoint:", NSMakePoint(width, yOf(0)));
  send(area, "closePath");
  send(sendDouble(accent, "colorWithAlphaComponent:", 0.2), "setFill");
  send(area, "fill");
  send(accent, "setStroke");
  setDouble(line, "setLineWidth:", 2);
  send(line, "stroke");

  const font = sendDouble2(cls("NSFont"), "monospacedDigitSystemFontOfSize:weight:", 11, 0);
  const attributes = nsDictionary([
    [NSFontAttributeName, font],
    [NSForegroundColorAttributeName, color("secondaryLabelColor")],
  ]);
  drawAtPoint(ns(`Value: ${value}`), "drawAtPoint:withAttributes:", NSMakePoint(6, height - 16), attributes);
}

// ============================================================================
// Files page: an NSOutlineView of folders and an NSTableView whose cells are
// asked for by AppKit (data source), only for the visible rows.
// ============================================================================

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

/** A resource value of a file URL (out parameter: byref(c_void_p)). */
function resource(url, key) {
  const result = new c_void_p();
  return getResourceValue(url, "getResourceValue:forKey:error:", byref(result), key, null) ? result.value : null;
}

function rowOf(url) {
  const isDir = Boolean(getBool(resource(url, NSURLIsDirectoryKey), "boolValue"));
  const isPackage = Boolean(getBool(resource(url, NSURLIsPackageKey), "boolValue"));
  const size = resource(url, NSURLFileSizeKey);
  const modified = resource(url, NSURLContentModificationDateKey);
  return {
    url: retain(url),
    name: str(send(url, "lastPathComponent")),
    path: str(send(url, "path")),
    isDir: isDir && !isPackage,
    isPackage,
    size: size ? Number(getIntRaw(size, "longLongValue")) : null,
    modified: modified ? new Date(getDouble(modified, "timeIntervalSince1970") * 1000) : null,
    type: null, // read when shown or sorted
    icon: null,
  };
}

/** The file URLs of a folder, with the properties of the rows fetched in the same pass. */
function listDirectory(folder) {
  const keys = nsArray([NSURLIsDirectoryKey, NSURLIsPackageKey, NSURLFileSizeKey, NSURLContentModificationDateKey]);
  const options = showHidden ? 0 : NSDirectoryEnumerationSkipsHiddenFiles;
  const fileManager = send(cls("NSFileManager"), "defaultManager");
  const urls = contentsOfDirectory(fileManager, "contentsOfDirectoryAtURL:includingPropertiesForKeys:options:error:", sendId(cls("NSURL"), "fileURLWithPath:", ns(folder)), keys, options, null);
  if (!urls) console.log(`Cannot read ${folder}`);
  return jsArray(urls);
}

/** An outline item: a retained NSString, the same pointer every time AppKit asks for it. */
function treeNode(path) {
  const item = retain(ns(path));
  const node = { path, item, children: null };
  nodes.set(item, node);
  return node;
}

function childrenOf(node) {
  if (!node.children) {
    node.children = listDirectory(node.path)
      .map(rowOf)
      .filter((row) => row.isDir)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => {
        release(row.url);
        return treeNode(row.path);
      });
  }
  return node.children;
}

/** Show `path` in the table, selecting it in the outline when it is below a root. */
function openFolder(path) {
  // The deepest root containing the path ("/Volumes/Disk" rather than "/").
  const root = [...roots].sort((a, b) => b.path.length - a.path.length).find((r) => path === r.path || path.startsWith(r.path.endsWith("/") ? r.path : `${r.path}/`));
  let item = null;
  if (root) {
    // Expand each folder from the root down to the path.
    let node = root;
    const parts = path.slice(root.path.length).split("/").filter(Boolean);
    for (const part of parts) {
      setId(outline, "expandItem:", node.item);
      const next = childrenOf(node).find((child) => child.path.endsWith(`/${part}`));
      if (!next) break;
      node = next;
    }
    if (node.path === path) item = node.item;
  }
  if (item) {
    revealing = true;
    const row = getIntFor(outline, "rowForItem:", item);
    selectRowIndexes(outline, "selectRowIndexes:byExtendingSelection:", sendInt(cls("NSIndexSet"), "indexSetWithIndex:", row), NO);
    setInt(outline, "scrollRowToVisible:", row);
    revealing = false;
  } else {
    selectRowIndexes(outline, "selectRowIndexes:byExtendingSelection:", send(cls("NSIndexSet"), "indexSet"), NO);
  }
  showFolder(path);
}

function typeOf(row) {
  if (row.type === null) row.type = str(resource(row.url, NSURLLocalizedTypeDescriptionKey)) ?? "";
  return row.type;
}

function sortRows() {
  const key = {
    name: (row) => row.name.toLowerCase(),
    size: (row) => row.size ?? -1,
    type: (row) => typeOf(row).toLowerCase(),
    modified: (row) => row.modified?.getTime() ?? 0,
  }[sortColumn];
  const sign = sortAscending ? 1 : -1;
  // Folders first, as in the Finder's list view sorted by name.
  rows.sort((a, b) => b.isDir - a.isDir || (key(a) < key(b) ? -sign : key(a) > key(b) ? sign : 0));
  for (const column of jsArray(send(fileTable, "tableColumns"))) {
    const indicator = str(send(column, "identifier")) === sortColumn ? (sortAscending ? "NSAscendingSortIndicator" : "NSDescendingSortIndicator") : null;
    setIdId(fileTable, "setIndicatorImage:inTableColumn:", indicator ? sendId(cls("NSImage"), "imageNamed:", ns(indicator)) : nil, column);
  }
}

function showRows(newRows, title) {
  for (const row of rows) {
    release(row.url);
    release(row.icon);
  }
  rows = newRows;
  sortRows();
  send(fileTable, "reloadData");
  setInt(fileTable, "scrollRowToVisible:", 0);
  updateFilesStatus(title);
}

function showFolder(folder) {
  currentFolder = folder;
  showRows(listDirectory(folder).map(rowOf), folder);
}

function updateFilesStatus(title = currentFolder ?? "Dropped files") {
  const selected = getInt(fileTable, "numberOfSelectedRows");
  setStatus(0, `${title} — ${rows.length} items${selected ? `, ${selected} selected` : ""}`);
}

function formatSize(size) {
  if (size === null) return "--";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (size >= 1000 && i < units.length - 1) ((size /= 1000), i++);
  return i === 0 ? `${size} bytes` : `${size.toFixed(1)} ${units[i]}`;
}

/** The object value of a cell: an NSImage for the icon column, an NSString otherwise. */
function cellValue(row, column) {
  switch (column) {
    case "icon":
      if (!row.icon) {
        row.icon = retain(sendId(send(cls("NSWorkspace"), "sharedWorkspace"), "iconForFile:", ns(row.path)));
        setSize(row.icon, "setSize:", NSMakeSize(16, 16));
      }
      return row.icon;
    case "name":
      return ns(row.name);
    case "size":
      return ns(row.isDir ? "--" : formatSize(row.size));
    case "type":
      return ns(typeOf(row));
    case "modified":
      return ns(row.modified ? dateFormat.format(row.modified) : "");
  }
  return nil;
}

/** The clicked row of a context menu, otherwise the selected one. */
function targetRow() {
  const clicked = getInt(fileTable, "clickedRow");
  const row = clicked >= 0 ? clicked : getInt(fileTable, "selectedRow");
  return rows[row] ?? null;
}

function openRow(row) {
  if (!row) return;
  if (row.isDir) {
    console.log(`Open folder: ${row.path}`);
    openFolder(row.path);
  } else {
    console.log(`Open: ${row.path}`);
    setId(send(cls("NSWorkspace"), "sharedWorkspace"), "openURL:", row.url);
  }
}

/** File URLs dropped on the window (NSPasteboard). */
function onDrop(info) {
  const pasteboard = send(info, "draggingPasteboard");
  const options = nsDictionary([[NSPasteboardURLReadingFileURLsOnlyKey, sendBool(cls("NSNumber"), "numberWithBool:", YES)]]);
  const urls = jsArray(sendIdId(pasteboard, "readObjectsForClasses:options:", nsArray([cls("NSURL")]), options));
  if (!urls.length) return false;
  console.log(`Dropped ${urls.length} item(s)`);
  currentFolder = null;
  showRows(urls.map(rowOf), "Dropped files");
  setInt(tabView, "selectTabViewItemAtIndex:", 1);
  setBool(app, "activateIgnoringOtherApps:", YES);
  return true;
}

// ============================================================================
// Date and time page: date picker, time picker, calendar and clock in sync.
// ============================================================================

function updateDateSummary() {
  const date = send(datePicker, "dateValue");
  const formatter = create("NSDateFormatter"); // the user's locale and calendar
  setInt(formatter, "setDateStyle:", NSDateFormatterFullStyle);
  setInt(formatter, "setTimeStyle:", NSDateFormatterMediumStyle);
  const full = str(sendId(formatter, "stringFromDate:", date));
  setInt(formatter, "setDateStyle:", NSDateFormatterShortStyle);
  setInt(formatter, "setTimeStyle:", NSDateFormatterShortStyle);
  const short = str(sendId(formatter, "stringFromDate:", date));
  release(formatter);
  const relativeFormatter = create("NSRelativeDateTimeFormatter");
  const relative = str(sendIdId(relativeFormatter, "localizedStringForDate:relativeToDate:", date, send(cls("NSDate"), "date")));
  release(relativeFormatter);
  setId(dateSummary, "setStringValue:", ns(`${full}\n${short}\n${relative}`));
}

/** One picker changed: the others show the same NSDate. */
function onDateChanged(sender) {
  const date = send(sender, "dateValue");
  for (const picker of [datePicker, timePicker, calendar, clock]) if (!sameObject(picker, sender)) setId(picker, "setDateValue:", date);
  updateDateSummary();
  console.log(`Date: ${str(send(date, "description"))}`);
}

// ============================================================================
// Alert: NSAlert with an accessory view, a progress bar driven by a timer
// (also during the modal loop), a suppression checkbox and a help button.
// ============================================================================

function showProgressAlert() {
  alert = create("NSAlert");
  setInt(alert, "setAlertStyle:", NSAlertStyleInformational);
  setId(alert, "setMessageText:", ns("Working on it"));
  setId(alert, "setInformativeText:", ns("The progress bar is driven by an NSTimer in the common run loop modes, so it moves while the alert runs its modal loop."));
  const icon = symbol("gauge.with.dots.needle.67percent");
  if (icon) setId(alert, "setIcon:", icon);
  setId(alert, "addButtonWithTitle:", ns("Close"));
  // The second button sends restartProgress: to the controller instead of
  // ending the modal loop: the alert stays open.
  const restart = sendId(alert, "addButtonWithTitle:", ns("Restart the Progress"));
  setTarget(restart, "restartProgress:");
  setBool(alert, "setShowsSuppressionButton:", YES);
  setId(send(alert, "suppressionButton"), "setTitle:", ns("Show a notification when closed"));
  setBool(alert, "setShowsHelp:", YES);
  setId(alert, "setDelegate:", controller);

  // Accessory view: the progress bar and the speed.
  const accessory = createView("NSView", 0, 0, 300, 56);
  alertProgress = createView("NSProgressIndicator", 0, 32, 300, 20);
  setInt(alertProgress, "setStyle:", NSProgressIndicatorStyleBar);
  setBool(alertProgress, "setIndeterminate:", NO);
  setDouble(alertProgress, "setMaxValue:", 100);
  setId(accessory, "addSubview:", alertProgress);
  ["Normal speed", "Fast"].forEach((title, i) => {
    const radio = buttonWithTitle(cls("NSButton"), "radioButtonWithTitle:target:action:", ns(title), controller, sel(i ? "alertFast:" : "alertNormal:"));
    setRect(radio, "setFrame:", NSMakeRect(i * 140, 0, 130, 22));
    setInt(radio, "setState:", i === 0 ? NSControlStateValueOn : NSControlStateValueOff);
    setId(accessory, "addSubview:", radio);
  });
  setId(alert, "setAccessoryView:", accessory);
  release(accessory);
  alertStep = 1;
  startTimer("alertTick:", 0.05);

  const response = getInt(alert, "runModal");
  stopTimer("alertTick:");
  const suppressed = getInt(send(alert, "suppressionButton"), "state") === NSControlStateValueOn;
  console.log(`Alert closed: response ${response}${response === NSAlertFirstButtonReturn ? " (Close)" : ""}, checkbox ${suppressed ? "on" : "off"}`);
  release(alertProgress);
  release(alert);
  alert = alertProgress = null;
  if (suppressed) showNotification("Alert", "The alert was closed with its checkbox selected.");
}

function showAbout() {
  const version = operatingSystemVersion(send(cls("NSProcessInfo"), "processInfo"), "operatingSystemVersion");
  const macos = `${version.majorVersion}.${version.minorVersion}.${version.patchVersion}`;
  console.log(`macOS ${macos}, ${process.arch}`);
  const options = nsDictionary([
    [NSAboutPanelOptionApplicationName, ns("macOS Controls Showcase")],
    [NSAboutPanelOptionApplicationVersion, ns(`node-ctypes on Node.js ${process.versions.node}`)],
    [NSAboutPanelOptionVersion, ns(`macOS ${macos} ${process.arch}`)],
  ]);
  setId(app, "orderFrontStandardAboutPanelWithOptions:", options);
}

// ============================================================================
// Status item (the menu bar extra) and its popover notifications.
// ============================================================================

function addStatusItem() {
  statusItem = retain(sendDouble(send(cls("NSStatusBar"), "systemStatusBar"), "statusItemWithLength:", NSVariableStatusItemLength));
  const image = symbol("slider.horizontal.3", "Controls Showcase");
  setBool(image, "setTemplate:", YES); // drawn in the menu bar's color
  setId(send(statusItem, "button"), "setImage:", image);
  setId(send(statusItem, "button"), "setToolTip:", ns("macOS Controls Showcase"));
  setId(statusItem, "setMenu:", createMenu("", [["Show the Window", "showWindow:"], ["Show a Notification", "notify:"], null, ["Quit", "terminate:", "", { target: nil }]]));
}

function removeStatusItem() {
  if (!statusItem) return;
  setId(send(cls("NSStatusBar"), "systemStatusBar"), "removeStatusItem:", statusItem);
  release(statusItem);
  statusItem = null;
}

/** A popover under the status item, closed after a few seconds; a badge on the Dock icon until the application is active. */
function showNotification(title, text) {
  console.log(`Notification: ${title} — ${text}`);
  if (popover) {
    setId(popover, "performClose:", nil);
    release(popover);
  }
  const view = createView("NSView", 0, 0, 280, 64);
  const heading = label(title);
  setId(heading, "setFont:", sendDouble(cls("NSFont"), "boldSystemFontOfSize:", 13));
  setRect(heading, "setFrame:", NSMakeRect(12, 38, 256, 18));
  const body = sendId(cls("NSTextField"), "wrappingLabelWithString:", ns(text));
  setRect(body, "setFrame:", NSMakeRect(12, 8, 256, 28));
  setId(view, "addSubview:", heading);
  setId(view, "addSubview:", body);
  const viewController = create("NSViewController");
  setId(viewController, "setView:", view);
  release(view);
  popover = create("NSPopover");
  setId(popover, "setContentViewController:", viewController);
  release(viewController);
  setInt(popover, "setBehavior:", NSPopoverBehaviorTransient);
  const button = send(statusItem, "button");
  showRelativeToRect(popover, "showRelativeToRect:ofView:preferredEdge:", getRect(button, "bounds"), button, NSRectEdgeMinY);
  startTimer("closeNotification:", NOTIFICATION_DURATION, false);
  if (!getBool(app, "isActive")) {
    setId(send(app, "dockTile"), "setBadgeLabel:", ns("1"));
    requestUserAttention(app, "requestUserAttention:", NSInformationalRequest);
  }
}

function showWindow() {
  if (getBool(window, "isMiniaturized")) setId(window, "deminiaturize:", nil);
  setId(window, "makeKeyAndOrderFront:", nil);
  setBool(app, "activateIgnoringOtherApps:", YES);
}

// ============================================================================
// Appearance and window level.
// ============================================================================

function setAppearance(name) {
  appearance = name;
  const appearanceName = { light: NSAppearanceNameAqua, dark: NSAppearanceNameDarkAqua }[name];
  // nil: follow the system setting (and its changes).
  setId(app, "setAppearance:", appearanceName ? sendId(cls("NSAppearance"), "appearanceNamed:", appearanceName) : nil);
  for (const [selector, value] of [
    ["appearanceSystem:", "system"],
    ["appearanceLight:", "light"],
    ["appearanceDark:", "dark"],
  ]) {
    for (const item of menuItems.get(selector) ?? []) setInt(item, "setState:", value === name ? NSControlStateValueOn : NSControlStateValueOff);
  }
  console.log(`Appearance: ${name}`);
}

function setKeepOnTop(on) {
  keepOnTop = on;
  setInt(window, "setLevel:", on ? NSFloatingWindowLevel : NSNormalWindowLevel);
  for (const item of menuItems.get("toggleKeepOnTop:") ?? []) setInt(item, "setState:", on ? NSControlStateValueOn : NSControlStateValueOff);
}

function setShowHidden(on) {
  showHidden = on;
  for (const item of menuItems.get("toggleHidden:") ?? []) setInt(item, "setState:", on ? NSControlStateValueOn : NSControlStateValueOff);
  refresh();
}

function refresh() {
  // The outline is read again from its roots, keeping the folder shown.
  for (const node of nodes.values()) node.children = null;
  send(outline, "reloadData");
  if (currentFolder) openFolder(currentFolder);
}

// ============================================================================
// Menus and toolbar: they all send action messages to the controller.
// ============================================================================

/**
 * An NSMenu from [title, selector, key, { modifiers, target, submenu, state }]
 * entries; null is a separator. Items with a selector of the controller are
 * kept by selector, for their check marks.
 */
function createMenu(title, entries) {
  const menu = sendId(alloc("NSMenu"), "initWithTitle:", ns(title));
  for (const entry of entries) {
    if (!entry) {
      setId(menu, "addItem:", send(cls("NSMenuItem"), "separatorItem"));
      continue;
    }
    const [text, selector, key = "", { modifiers, target = controller, submenu, state } = {}] = entry;
    const item = initMenuItem(alloc("NSMenuItem"), "initWithTitle:action:keyEquivalent:", ns(text), selector ? sel(selector) : null, ns(key));
    if (modifiers !== undefined) setInt(item, "setKeyEquivalentModifierMask:", modifiers);
    if (selector && target) {
      setId(item, "setTarget:", target);
      if (!menuItems.has(selector)) menuItems.set(selector, []);
      menuItems.get(selector).push(item);
    }
    if (state) setInt(item, "setState:", NSControlStateValueOn);
    if (submenu) setId(item, "setSubmenu:", createMenu(text, submenu));
    setId(menu, "addItem:", item);
    release(item);
  }
  return send(menu, "autorelease");
}

function createMainMenu() {
  const command = NSEventModifierFlagCommand;
  // nil target: the action goes up the responder chain (text fields, window, application).
  const standard = (text, selector, key = "", modifiers = command) => [text, selector, key, { target: nil, modifiers }];
  const menus = [
    [
      "Controls Showcase",
      [
        ["About Controls Showcase", "about:"],
        null,
        standard("Hide Controls Showcase", "hide:", "h"),
        standard("Hide Others", "hideOtherApplications:", "h", command | NSEventModifierFlagOption),
        standard("Show All", "unhideAllApplications:"),
        null,
        standard("Quit Controls Showcase", "terminate:", "q"),
      ],
    ],
    ["File", [["Open Folder…", "openFolderPanel:", "o"], null, standard("Close Window", "performClose:", "w")]],
    // Without an Edit menu, ⌘C / ⌘V / ⌘A do nothing in the text fields.
    [
      "Edit",
      [
        standard("Undo", "undo:", "z"),
        standard("Redo", "redo:", "z", command | NSEventModifierFlagShift),
        null,
        standard("Cut", "cut:", "x"),
        standard("Copy", "copy:", "c"),
        standard("Paste", "paste:", "v"),
        standard("Select All", "selectAll:", "a"),
      ],
    ],
    [
      "View",
      [
        ["Refresh", "refresh:", "r"],
        ["Show Hidden Files", "toggleHidden:", ".", { modifiers: command | NSEventModifierFlagShift }],
        null,
        [
          "Appearance",
          null,
          "",
          {
            submenu: [
              ["System", "appearanceSystem:", "", { state: true }],
              ["Light", "appearanceLight:"],
              ["Dark", "appearanceDark:"],
            ],
          },
        ],
        ["Keep on Top", "toggleKeepOnTop:"],
        null,
        standard("Enter Full Screen", "toggleFullScreen:", "f", command | NSEventModifierFlagControl),
      ],
    ],
    [
      "Tools",
      [
        ["Animate the Value", "toggleAnimate:", "l"],
        [
          "Set the Value",
          null,
          "",
          {
            submenu: [
              ["0", "value0:", "0"],
              ["50", "value50:", "5"],
              ["100", "value100:", "1"],
            ],
          },
        ],
        null,
        ["Alert with Progress…", "progressAlert:", "t"],
        ["Show a Notification", "notify:", "n"],
      ],
    ],
    ["Window", [standard("Minimize", "performMiniaturize:", "m"), standard("Zoom", "performZoom:"), null, standard("Bring All to Front", "arrangeInFront:")]],
    ["Help", [["node-ctypes Website", "openHelp:", "?"]]],
  ];
  const menuBar = sendId(alloc("NSMenu"), "initWithTitle:", ns(""));
  for (const [title, entries] of menus) {
    const item = initMenuItem(alloc("NSMenuItem"), "initWithTitle:action:keyEquivalent:", ns(title), null, ns(""));
    const submenu = createMenu(title, entries);
    setId(item, "setSubmenu:", submenu);
    setId(menuBar, "addItem:", item);
    release(item);
    // AppKit adds its own items to these: window list, Help search field.
    if (title === "Window") setId(app, "setWindowsMenu:", submenu);
    if (title === "Help") setId(app, "setHelpMenu:", submenu);
  }
  setId(app, "setMainMenu:", menuBar);
  release(menuBar);
}

const TOOLBAR = [
  { id: "open", label: "Open", symbol: "folder", action: "openFolderPanel:", tip: "Open a folder (⌘O)" },
  { id: "refresh", label: "Refresh", symbol: "arrow.clockwise", action: "refresh:", tip: "Read the folder again (⌘R)" },
  { id: "animate", label: "Animate", symbol: "play.fill", action: "toggleAnimate:", tip: "Animate the value (⌘L)" },
  { id: "alert", label: "Alert", symbol: "exclamationmark.bubble", action: "progressAlert:", tip: "Alert with a progress bar (⌘T)" },
  { id: "notify", label: "Notify", symbol: "bell", action: "notify:", tip: "Show a notification (⌘N)" },
  { id: "about", label: "About", symbol: "info.circle", action: "about:", tip: "About this demo" },
];

/** toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar: */
function toolbarItem(identifier) {
  const key = str(identifier);
  let item = toolbarItems.get(key);
  if (!item) {
    const spec = TOOLBAR.find((t) => t.id === key);
    if (!spec) return nil;
    item = sendId(alloc("NSToolbarItem"), "initWithItemIdentifier:", identifier);
    setId(item, "setLabel:", ns(spec.label));
    setId(item, "setToolTip:", ns(spec.tip));
    setId(item, "setImage:", symbol(spec.symbol, spec.label));
    setTarget(item, spec.action);
    toolbarItems.set(key, item);
  }
  return item;
}

function toolbarIdentifiers() {
  const ids = TOOLBAR.map((t) => ns(t.id));
  ids.splice(2, 0, NSToolbarFlexibleSpaceItemIdentifier);
  return nsArray(ids);
}

// ============================================================================
// The controller class: one implementation receives every action, timer and
// notification message (like a window procedure), others implement the data
// sources and delegates with their own signatures.
// ============================================================================

function onCommand(selector, sender) {
  switch (selector) {
    // Controls page
    case "push:":
      console.log("Push button clicked");
      return;
    case "defaultButton:":
      console.log("Default button clicked (Return)");
      return;
    case "minimize:":
      console.log(`Minimized: restored in ${RESTORE_DELAY} seconds`);
      setId(window, "miniaturize:", nil);
      startTimer("restoreTick:", RESTORE_DELAY, false);
      return;
    case "count:":
      counter++;
      setId(sender, "setTitle:", ns(`Count: ${counter}`));
      console.log(`Counter: ${counter}`);
      return;
    case "animateCheckbox:":
      return setAnimate(getInt(sender, "state") === NSControlStateValueOn);
    case "radio:":
      console.log(`Radio: ${str(send(sender, "title"))}`);
      return;
    case "slider:":
      return setValue(getDouble(sender, "doubleValue"), "slider");
    case "stepper:":
      return setValue(getInt(sender, "integerValue"), "stepper");
    case "popUp:":
      console.log(`Pop-up button: ${str(send(sender, "titleOfSelectedItem"))}`);
      return;
    case "dateChanged:":
      return onDateChanged(sender);
    // Files page
    case "openRow:":
    case "openItem:":
      return openRow(targetRow());
    case "showInFinder:": {
      const row = targetRow();
      if (row) setId(send(cls("NSWorkspace"), "sharedWorkspace"), "activateFileViewerSelectingURLs:", nsArray([row.url]));
      return;
    }
    case "openFolderPanel:": {
      const panel = send(cls("NSOpenPanel"), "openPanel");
      setBool(panel, "setCanChooseDirectories:", YES);
      setBool(panel, "setCanChooseFiles:", NO);
      setId(panel, "setMessage:", ns("Choose a folder to list"));
      if (getInt(panel, "runModal") === NSModalResponseOK) {
        const path = str(send(send(panel, "URL"), "path"));
        console.log(`Folder: ${path}`);
        setInt(tabView, "selectTabViewItemAtIndex:", 1);
        openFolder(path);
      }
      return;
    }
    case "refresh:":
      return refresh();
    case "toggleHidden:":
      return setShowHidden(!showHidden);
    // Application
    case "toggleAnimate:":
      return setAnimate(!animating);
    case "value0:":
      return setValue(0, "menu");
    case "value50:":
      return setValue(50, "menu");
    case "value100:":
      return setValue(100, "menu");
    case "progressAlert:":
      return showProgressAlert();
    case "notify:":
      return showNotification("node-ctypes", "A notification from the Tools menu.");
    case "about:":
      return showAbout();
    case "openHelp:":
      setId(send(cls("NSWorkspace"), "sharedWorkspace"), "openURL:", sendId(cls("NSURL"), "URLWithString:", ns("https://dmazzella.github.io/node-ctypes/")));
      return;
    case "appearanceSystem:":
      return setAppearance("system");
    case "appearanceLight:":
      return setAppearance("light");
    case "appearanceDark:":
      return setAppearance("dark");
    case "toggleKeepOnTop:":
      return setKeepOnTop(!keepOnTop);
    case "showWindow:":
      return showWindow();
    // Alert
    case "restartProgress:":
      setDouble(alertProgress, "setDoubleValue:", 0);
      startTimer("alertTick:", 0.05);
      console.log("Progress restarted");
      return;
    case "alertNormal:":
      alertStep = 1;
      return;
    case "alertFast:":
      alertStep = 4;
      return;
  }
  console.log(`Unhandled action: ${selector}`);
}

/** Every void method with one object argument: actions, timers and notifications. */
function ControllerProc(self, _cmd, arg) {
  const selector = libobjc.sel_getName(_cmd);
  switch (selector) {
    // Timers
    case "animateTick:":
      setValue(value === 100 ? 0 : value + 1, "timer");
      if (value === 100 && notifyAt100) {
        notifyAt100 = false;
        showNotification("Animation", "The value reached 100.");
      }
      return;
    case "sampleTick:":
      history.shift();
      history.push(value);
      if (getIntFor(tabView, "indexOfTabViewItem:", send(tabView, "selectedTabViewItem")) === 0) setBool(chart, "setNeedsDisplay:", YES);
      return;
    case "clockTick:":
      setStatus(2, new Date().toLocaleTimeString());
      return;
    case "restoreTick:":
      forgetTimer("restoreTick:");
      showWindow();
      console.log("Window restored");
      return;
    case "closeNotification:":
      forgetTimer("closeNotification:");
      if (popover) setId(popover, "performClose:", nil);
      return;
    case "alertTick:": {
      const next = Math.min(100, getDouble(alertProgress, "doubleValue") + alertStep);
      setDouble(alertProgress, "setDoubleValue:", next);
      if (next >= 100) {
        stopTimer("alertTick:");
        setId(alert, "setInformativeText:", ns("Done. “Restart the Progress” keeps the alert open."));
      }
      return;
    }
    // Notifications (delegates)
    case "windowDidResize:":
      return layoutControls();
    case "windowWillClose:":
      return stopApplication();
    case "applicationDidBecomeActive:":
      setId(send(app, "dockTile"), "setBadgeLabel:", nil);
      return;
    case "controlTextDidChange:": {
      const field = send(arg, "object");
      const text = str(send(field, "stringValue"));
      if (sameObject(field, textInput)) console.log(`Text changed: "${text}"`);
      else if (sameObject(field, numberField) && /^\d+$/.test(text)) setValue(Number(text), "field");
      return;
    }
    case "tableViewSelectionDidChange:": {
      const table = send(arg, "object");
      if (sameObject(table, listBox)) {
        const row = getInt(listBox, "selectedRow");
        if (row >= 0) console.log(`List: ${LIST_ITEMS[row]}`);
      } else {
        updateFilesStatus();
      }
      return;
    }
    case "outlineViewSelectionDidChange:": {
      const item = sendInt(outline, "itemAtRow:", getInt(outline, "selectedRow"));
      const node = item && nodes.get(item);
      if (node && !revealing) showFolder(node.path);
      return;
    }
  }
  onCommand(selector, arg);
}

const ACTIONS = [
  ...["push:", "defaultButton:", "minimize:", "count:", "animateCheckbox:", "radio:", "slider:", "stepper:", "popUp:", "dateChanged:"],
  ...["openRow:", "openItem:", "showInFinder:", "openFolderPanel:", "refresh:", "toggleHidden:", "toggleAnimate:", "value0:", "value50:", "value100:"],
  ...["progressAlert:", "notify:", "about:", "openHelp:", "appearanceSystem:", "appearanceLight:", "appearanceDark:", "toggleKeepOnTop:", "showWindow:"],
  ...["restartProgress:", "alertNormal:", "alertFast:"],
  ...["animateTick:", "sampleTick:", "clockTick:", "restoreTick:", "closeNotification:", "alertTick:"],
  ...["windowDidResize:", "windowWillClose:", "applicationDidBecomeActive:", "controlTextDidChange:", "tableViewSelectionDidChange:", "outlineViewSelectionDidChange:"],
];

function defineClasses() {
  const controllerProc = IMP_v_id(ControllerProc);
  defineClass("NodeCtypesController", "NSObject", [
    ...ACTIONS.map((selector) => [selector, "v@:@", controllerProc]),
    // NSApplicationDelegate: ⌘Q closes the window, which stops the run loop
    // and lets the script clean up, instead of exit().
    [
      "applicationShouldTerminate:",
      "Q@:@",
      IMP_Q_id(() => {
        send(window, "close");
        return NSTerminateCancel;
      }),
    ],
    // NSTableViewDataSource: the list box and the file table
    ["numberOfRowsInTableView:", "q@:@", IMP_q_id((self, _cmd, table) => (sameObject(table, listBox) ? LIST_ITEMS.length : rows.length))],
    [
      "tableView:objectValueForTableColumn:row:",
      "@@:@@q",
      IMP_id_id_id_q((self, _cmd, table, column, row) => {
        if (sameObject(table, listBox)) return ns(LIST_ITEMS[Number(row)]);
        return rows[Number(row)] ? cellValue(rows[Number(row)], str(send(column, "identifier"))) : nil;
      }),
    ],
    // NSTableViewDelegate: a click on a column header sorts the files
    [
      "tableView:didClickTableColumn:",
      "v@:@@",
      IMP_v_id_id((self, _cmd, table, column) => {
        const key = str(send(column, "identifier"));
        if (!sameObject(table, fileTable) || key === "icon") return;
        sortAscending = key === sortColumn ? !sortAscending : true;
        sortColumn = key;
        sortRows();
        send(fileTable, "reloadData");
        console.log(`Sorted by ${key}, ${sortAscending ? "ascending" : "descending"}`);
      }),
    ],
    // NSOutlineViewDataSource: the items are the retained NSStrings of nodes
    ["outlineView:numberOfChildrenOfItem:", "q@:@@", IMP_q_id_id((self, _cmd, view, item) => (item ? childrenOf(nodes.get(item)).length : roots.length))],
    ["outlineView:child:ofItem:", "@@:@q@", IMP_id_id_q_id((self, _cmd, view, index, item) => (item ? childrenOf(nodes.get(item)) : roots)[Number(index)].item)],
    ["outlineView:isItemExpandable:", "B@:@@", IMP_B_id_id(() => YES)], // read when expanded
    [
      "outlineView:objectValueForTableColumn:byItem:",
      "@@:@@@",
      IMP_id_id_id_id((self, _cmd, view, column, item) => {
        const { path } = nodes.get(item);
        return roots.some((root) => root.item === item) ? sendId(send(cls("NSFileManager"), "defaultManager"), "displayNameAtPath:", ns(path)) : ns(path.slice(path.lastIndexOf("/") + 1));
      }),
    ],
    // NSToolbarDelegate
    ["toolbar:itemForItemIdentifier:willBeInsertedIntoToolbar:", "@@:@@B", IMP_id_id_id_B((self, _cmd, toolbar, identifier) => toolbarItem(identifier))],
    ["toolbarDefaultItemIdentifiers:", "@@:@", IMP_id_id(() => toolbarIdentifiers())],
    ["toolbarAllowedItemIdentifiers:", "@@:@", IMP_id_id(() => toolbarIdentifiers())],
    // NSTabViewDelegate
    [
      "tabView:didSelectTabViewItem:",
      "v@:@@",
      IMP_v_id_id((self, _cmd, view, item) => {
        const index = getIntFor(tabView, "indexOfTabViewItem:", item);
        if (index === 0) (layoutControls(), setStatus(0, "Ready — drop files on the window to list them"));
        if (index === 1) updateFilesStatus();
        if (index === 2) setStatus(0, "Date and time");
      }),
    ],
    // NSAlertDelegate: the help button
    [
      "alertShowHelp:",
      "B@:@",
      IMP_B_id(() => {
        console.log("Alert help");
        onCommand("openHelp:");
        return YES;
      }),
    ],
    // NSDraggingDestination: NSWindow forwards these to its delegate
    ["draggingEntered:", "Q@:@", IMP_Q_id(() => NSDragOperationCopy)],
    ["performDragOperation:", "B@:@", IMP_B_id((self, _cmd, info) => onDrop(info))],
  ]);

  // A view whose y axis grows downwards, like the layout values.
  defineClass("NodeCtypesFlippedView", "NSView", [["isFlipped", "B@:", IMP_B(() => YES)]]);
  defineClass("NodeCtypesChart", "NSView", [["drawRect:", "v@:{CGRect={CGPoint=dd}{CGSize=dd}}", IMP_v((self) => drawChart(self))]]);
}

// ============================================================================
// Creation
// ============================================================================

function createControlsPage() {
  controlsScroll = createView("NSScrollView");
  setBool(controlsScroll, "setHasVerticalScroller:", YES);
  setBool(controlsScroll, "setAutohidesScrollers:", YES);
  setBool(controlsScroll, "setDrawsBackground:", NO);
  controlsPage = createView("NodeCtypesFlippedView", 0, 0, 800, 600);
  setId(controlsScroll, "setDocumentView:", controlsPage);
  // Right-click anywhere on the page (controls without their own menu pass it up).
  setId(controlsPage, "setMenu:", createMenu("", [["Value 0", "value0:"], ["Value 50", "value50:"], ["Value 100", "value100:"], null, ["Animate", "toggleAnimate:"]]));
  const button = (title, selector) => buttonWithTitle(cls("NSButton"), "buttonWithTitle:target:action:", ns(title), controller, sel(selector));

  // Controls are created in key-view order: left column, then right column.
  // Buttons
  createSection("Buttons", 66, 0);
  const pushButton = addControl(button("Push", "push:"), { ...cell(0, 4), y: 8 });
  const defaultButton = addControl(button("Default", "defaultButton:"), { ...cell(1, 4), y: 8 });
  setId(defaultButton, "setKeyEquivalent:", ns("\r")); // Return: drawn in the accent color
  const minimizeButton = addControl(button("Minimize", "minimize:"), { ...cell(2, 4), y: 8 });
  addControl(button("Count: 0", "count:"), { ...cell(3, 4), y: 8 });

  // Text input
  createSection("Text Input", 66, 0);
  textInput = addControl(createView("NSTextField"), { x: INSET, y: 8, w: FILL });
  setId(textInput, "setPlaceholderString:", ns("Type here: every change is printed"));
  setId(textInput, "setDelegate:", controller);

  // Options: the checkbox animates the value; radio buttons with the same
  // action and superview form one group.
  createSection("Options", 92, 0);
  animateCheckbox = addControl(buttonWithTitle(cls("NSButton"), "checkboxWithTitle:target:action:", ns("Animate the value"), controller, sel("animateCheckbox:")), { x: INSET, y: 8, w: 200 });
  for (const [i, title] of ["Choice A", "Choice B"].entries()) {
    const radio = addControl(buttonWithTitle(cls("NSButton"), "radioButtonWithTitle:target:action:", ns(title), controller, sel("radio:")), { x: INSET + i * 130, y: 38, w: 120 });
    if (i === 0) setInt(radio, "setState:", NSControlStateValueOn);
  }

  // Value: slider, and a number field with a stepper.
  createSection("Value", 104, 0);
  slider = addControl(sliderWithValue(cls("NSSlider"), "sliderWithValue:minValue:maxValue:target:action:", 0, 0, 100, controller, sel("slider:")), { x: INSET, y: 6, w: FILL });
  setInt(slider, "setNumberOfTickMarks:", 11);
  setId(slider, "setToolTip:", ns("Slider: sets the value of the stepper, the progress bar and the chart"));
  numberField = addControl(createView("NSTextField"), { x: INSET, y: 46, w: 70 });
  setInt(numberField, "setAlignment:", NSTextAlignmentRight);
  setId(numberField, "setDelegate:", controller);
  setId(numberField, "setToolTip:", ns("Number field: type 0-100 or use the stepper"));
  stepper = addControl(createView("NSStepper"), { x: INSET + 74, y: 46, w: 19, center: getSize(numberField, "fittingSize").height });
  setDouble(stepper, "setMaxValue:", 100);
  setBool(stepper, "setValueWraps:", NO);
  setTarget(stepper, "stepper:");
  setBool(stepper, "setAutorepeat:", YES);

  // Pop-up button (the drop-down list of macOS)
  createSection("Pop-up Button", 66, 1);
  const popUp = addControl(initPopUpButton(alloc("NSPopUpButton"), "initWithFrame:pullsDown:", NSMakeRect(0, 0, 0, 0), NO), { x: INSET, y: 8, w: FILL });
  setId(popUp, "addItemsWithTitles:", nsArray(["First option", "Second option", "Third option"].map(ns)));
  setTarget(popUp, "popUp:");

  // List: a one-column table in a scroll view
  createSection("List", 150, 1);
  const listScroll = addControl(createView("NSScrollView"), { x: INSET, y: 6, w: FILL, h: 108 });
  setInt(listScroll, "setBorderType:", NSBezelBorder);
  setBool(listScroll, "setHasVerticalScroller:", YES);
  listBox = createView("NSTableView");
  const listColumn = sendId(alloc("NSTableColumn"), "initWithIdentifier:", ns("item"));
  setInt(listColumn, "setResizingMask:", 1); // NSTableColumnAutoresizingMask
  setId(listBox, "addTableColumn:", listColumn);
  release(listColumn);
  setId(listBox, "setHeaderView:", nil);
  setInt(listBox, "setStyle:", NSTableViewStylePlain);
  setBool(listBox, "setUsesAlternatingRowBackgroundColors:", YES);
  setId(listBox, "setDataSource:", controller);
  setId(listBox, "setDelegate:", controller);
  setId(listScroll, "setDocumentView:", listBox);
  send(listBox, "sizeLastColumnToFit");

  // Progress bar, spinner and chart: they follow the value
  createSection("Progress (follows the value)", 66, 1);
  progressBar = addControl(createView("NSProgressIndicator"), { x: INSET, y: 14, w: (w) => FILL(w) - 28, h: 20 });
  setInt(progressBar, "setStyle:", NSProgressIndicatorStyleBar);
  setBool(progressBar, "setIndeterminate:", NO);
  setDouble(progressBar, "setMaxValue:", 100);
  spinner = addControl(createView("NSProgressIndicator"), { x: (w) => w - INSET - 16, y: 16, w: 16, h: 16 });
  setInt(spinner, "setStyle:", NSProgressIndicatorStyleSpinning);
  setInt(spinner, "setControlSize:", NSControlSizeSmall);
  setBool(spinner, "setDisplayedWhenStopped:", NO);
  createSection("History (custom NSView, NSBezierPath)", 150, 1);
  chart = addControl(createView("NodeCtypesChart"), { x: INSET, y: 6, w: FILL, h: 110 });

  // Tooltips
  setId(pushButton, "setToolTip:", ns("Push button: prints a message"));
  setId(defaultButton, "setToolTip:", ns("Default button: Return presses it"));
  setId(minimizeButton, "setToolTip:", ns(`Minimizes the window and restores it after ${RESTORE_DELAY} seconds`));
  setId(chart, "setToolTip:", ns("Right-click the page for a menu"));
  return controlsScroll;
}

function createFilesPage() {
  const split = createView("NSSplitView", 0, 0, 900, 500);
  setBool(split, "setVertical:", YES);
  setInt(split, "setDividerStyle:", NSSplitViewDividerStyleThin);

  // Outline: the home folder, the startup disk and the mounted volumes.
  const outlineScroll = createView("NSScrollView", 0, 0, 220, 500);
  setBool(outlineScroll, "setHasVerticalScroller:", YES);
  outline = createView("NSOutlineView");
  const outlineColumn = sendId(alloc("NSTableColumn"), "initWithIdentifier:", ns("folder"));
  setId(outline, "addTableColumn:", outlineColumn);
  setId(outline, "setOutlineTableColumn:", outlineColumn);
  setInt(outline, "setColumnAutoresizingStyle:", 1); // NSTableViewUniformColumnAutoresizingStyle: the column follows the width
  release(outlineColumn);
  setId(outline, "setHeaderView:", nil);
  setInt(outline, "setStyle:", NSTableViewStyleSourceList);
  setId(outline, "setDataSource:", controller);
  setId(outline, "setDelegate:", controller);
  setId(outlineScroll, "setDocumentView:", outline);

  // Table: the rows are asked for by AppKit (tableView:objectValueForTableColumn:row:).
  const tableScroll = createView("NSScrollView", 0, 0, 680, 500);
  setBool(tableScroll, "setHasVerticalScroller:", YES);
  setBool(tableScroll, "setHasHorizontalScroller:", YES);
  setBool(tableScroll, "setAutohidesScrollers:", YES);
  fileTable = createView("NSTableView");
  for (const spec of COLUMNS) {
    const column = sendId(alloc("NSTableColumn"), "initWithIdentifier:", ns(spec.id));
    setId(column, "setTitle:", ns(spec.title));
    setDouble(column, "setWidth:", spec.width);
    if (spec.id === "icon") {
      const imageCell = create("NSImageCell");
      setId(column, "setDataCell:", imageCell);
      release(imageCell);
      setInt(column, "setResizingMask:", 0);
    } else {
      const dataCell = send(column, "dataCell");
      setInt(dataCell, "setLineBreakMode:", NSLineBreakByTruncatingMiddle);
      if (spec.right) setInt(dataCell, "setAlignment:", NSTextAlignmentRight);
    }
    setBool(column, "setEditable:", NO);
    setId(fileTable, "addTableColumn:", column);
    release(column);
  }
  setInt(fileTable, "setStyle:", NSTableViewStyleFullWidth);
  setBool(fileTable, "setUsesAlternatingRowBackgroundColors:", YES);
  setBool(fileTable, "setAllowsMultipleSelection:", YES);
  setId(fileTable, "setDataSource:", controller);
  setId(fileTable, "setDelegate:", controller);
  setId(fileTable, "setTarget:", controller);
  setSel(fileTable, "setDoubleAction:", sel("openRow:"));
  setId(fileTable, "setMenu:", createMenu("", [["Open", "openItem:"], ["Show in Finder", "showInFinder:"], null, ["Show Hidden Files", "toggleHidden:"], ["Refresh", "refresh:"]]));
  setId(tableScroll, "setDocumentView:", fileTable);

  setId(split, "addSubview:", outlineScroll);
  setId(split, "addSubview:", tableScroll);
  release(outlineScroll);
  release(tableScroll);
  send(split, "adjustSubviews");
  setPositionOfDivider(split, "setPosition:ofDividerAtIndex:", 220, 0);

  const home = process.env.HOME;
  const volumes = jsArray(mountedVolumeURLs(send(cls("NSFileManager"), "defaultManager"), "mountedVolumeURLsIncludingResourceValuesForKeys:options:", nil, NSVolumeEnumerationSkipHiddenVolumes));
  roots = [home, ...volumes.map((url) => str(send(url, "path")))].filter(Boolean).map(treeNode);
  send(outline, "reloadData");
  setId(outline, "expandItem:", roots[0].item);
  send(outline, "sizeLastColumnToFit");
  return split;
}

function createDatePage() {
  const page = createView("NodeCtypesFlippedView", 0, 0, 800, 500);
  const place = (view, x, y, w, h) => {
    const size = getSize(view, "fittingSize");
    setRect(view, "setFrame:", NSMakeRect(x, y, w ?? size.width, h ?? size.height));
    setId(page, "addSubview:", view);
    return view;
  };
  const picker = (style, elements) => {
    const view = createView("NSDatePicker");
    setInt(view, "setDatePickerStyle:", style);
    setInt(view, "setDatePickerElements:", elements);
    setId(view, "setDateValue:", send(cls("NSDate"), "date"));
    setTarget(view, "dateChanged:");
    if (style === NSDatePickerStyleClockAndCalendar) setBool(view, "setBezeled:", NO);
    return view;
  };
  place(label("Date"), MARGIN, MARGIN + 3, 60);
  datePicker = place(picker(NSDatePickerStyleTextFieldAndStepper, NSDatePickerElementFlagYearMonthDay), MARGIN + 60, MARGIN);
  place(label("Time"), MARGIN, MARGIN + 37, 60);
  timePicker = place(picker(NSDatePickerStyleTextFieldAndStepper, NSDatePickerElementFlagHourMinuteSecond), MARGIN + 60, MARGIN + 34);
  calendar = place(picker(NSDatePickerStyleClockAndCalendar, NSDatePickerElementFlagYearMonthDay), MARGIN, MARGIN + 76);
  clock = place(picker(NSDatePickerStyleClockAndCalendar, NSDatePickerElementFlagHourMinuteSecond), MARGIN + getSize(calendar, "fittingSize").width + MARGIN, MARGIN + 76);
  dateSummary = place(sendId(cls("NSTextField"), "wrappingLabelWithString:", ns("")), MARGIN, MARGIN + 76 + getSize(calendar, "fittingSize").height + 16, 600, 54);
  setBool(dateSummary, "setSelectable:", YES);
  updateDateSummary();
  return page;
}

function createWindow() {
  const style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
  window = initWindow(alloc("NSWindow"), "initWithContentRect:styleMask:backing:defer:", NSMakeRect(0, 0, WINDOW_W, WINDOW_H), style, NSBackingStoreBuffered, NO);
  setBool(window, "setReleasedWhenClosed:", NO); // the script releases it after the run loop
  setId(window, "setTitle:", ns("macOS Controls Showcase Demo"));
  setId(window, "setDelegate:", controller);
  // Minimum size: one column on the Controls page, with its scroller.
  setSize(window, "setContentMinSize:", NSMakeSize(MIN_COLUMN + 2 * MARGIN + 40, MIN_WINDOW_H));
  setBool(window, "setAutorecalculatesKeyViewLoop:", YES); // Tab follows the layout
  // Files dropped from the Finder: NSWindow forwards the drag messages to its delegate.
  setId(window, "registerForDraggedTypes:", nsArray([NSPasteboardTypeFileURL]));

  const toolbar = sendId(alloc("NSToolbar"), "initWithIdentifier:", ns("NodeCtypesToolbar"));
  setId(toolbar, "setDelegate:", controller);
  setInt(toolbar, "setDisplayMode:", NSToolbarDisplayModeIconAndLabel);
  setId(window, "setToolbar:", toolbar);
  release(toolbar);
  setInt(window, "setToolbarStyle:", NSWindowToolbarStyleUnified);

  // Content: the tab view, and the status bar below it (autoresizing masks).
  const content = send(window, "contentView");
  const { width, height } = getRect(content, "bounds").size;
  tabView = createView("NSTabView", 12, STATUS_H, width - 24, height - STATUS_H - 8);
  setInt(tabView, "setAutoresizingMask:", NSViewWidthSizable | NSViewHeightSizable);
  setId(content, "addSubview:", tabView);
  for (const [title, createPage] of [
    ["Controls", createControlsPage],
    ["Files", createFilesPage],
    ["Date and Time", createDatePage],
  ]) {
    const item = sendId(alloc("NSTabViewItem"), "initWithIdentifier:", ns(title));
    setId(item, "setLabel:", ns(title));
    const view = createPage();
    setId(item, "setView:", view);
    release(view);
    setId(tabView, "addTabViewItem:", item);
    release(item);
  }
  setId(tabView, "setDelegate:", controller);

  const font = sendDouble(cls("NSFont"), "systemFontOfSize:", getDouble(cls("NSFont"), "smallSystemFontSize"));
  const parts = [
    { x: 14, w: width - 14 - 260, mask: NSViewWidthSizable },
    { x: width - 250, w: 110, mask: NSViewMinXMargin },
    { x: width - 130, w: 116, mask: NSViewMinXMargin, right: true },
  ];
  statusLabels = parts.map(({ x, w, mask, right }) => {
    const part = label("");
    setRect(part, "setFrame:", NSMakeRect(x, 4, w, 16));
    setInt(part, "setAutoresizingMask:", mask | NSViewMaxYMargin);
    setId(part, "setFont:", font);
    setId(part, "setTextColor:", color("secondaryLabelColor"));
    setInt(part, "setLineBreakMode:", NSLineBreakByTruncatingMiddle);
    if (right) setInt(part, "setAlignment:", NSTextAlignmentRight);
    setId(content, "addSubview:", part);
    return part;
  });
}

/** [NSApp stop:] ends the run loop after the current event: post one so that it returns now. */
function stopApplication() {
  setId(app, "stop:", nil);
  const event = otherEvent(cls("NSEvent"), "otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:", NSEventTypeApplicationDefined, NSMakePoint(0, 0), 0, 0, 0, nil, 0, 0, 0);
  postEvent(app, "postEvent:atStart:", event, YES);
}

function createControlsDemo() {
  console.log("Creating macOS Controls Demo...");
  // Objects autoreleased outside the run loop (which drains its own pools).
  pool = libobjc.objc_autoreleasePoolPush();
  app = send(cls("NSApplication"), "sharedApplication");
  // node is a command-line tool: a regular application has a Dock icon and a menu bar.
  setInt(app, "setActivationPolicy:", NSApplicationActivationPolicyRegular);
  setId(app, "setApplicationIconImage:", sendId(cls("NSImage"), "imageNamed:", ns("NSComputer")));

  defineClasses();
  controller = create("NodeCtypesController");
  setId(app, "setDelegate:", controller);
  createMainMenu();
  createWindow();
  addStatusItem();

  setValue(0, "init");
  setAppearance("system");
  layoutControls();
  openFolder(process.env.HOME);
  setInt(tabView, "selectTabViewItemAtIndex:", 0);
  setStatus(0, "Ready — drop files on the window to list them");
  setStatus(2, new Date().toLocaleTimeString());
  startTimer("clockTick:", CLOCK_INTERVAL);
  startTimer("sampleTick:", SAMPLE_INTERVAL);

  send(window, "center");
  setId(window, "makeKeyAndOrderFront:", nil);
  setBool(app, "activateIgnoringOtherApps:", YES);
  console.log(`Window created, backing scale ${getDouble(window, "backingScaleFactor")}x`);

  // The run loop: events, timers and the callbacks into this script, until
  // stopApplication(). JavaScript timers do not run meanwhile: NSTimer does.
  send(app, "run");
  console.log("Run loop ended");

  // Post-loop cleanup (safe: no more messages dispatched to the callbacks).
  for (const selector of [...timers.keys()]) stopTimer(selector);
  removeStatusItem();
  for (const view of [listBox, fileTable, outline]) {
    setId(view, "setDataSource:", nil);
    setId(view, "setDelegate:", nil);
  }
  setId(send(window, "toolbar"), "setDelegate:", nil);
  for (const object of [window, tabView, textInput, numberField]) setId(object, "setDelegate:", nil);
  setId(app, "setDelegate:", nil);
  setId(window, "orderOut:", nil);
  for (const row of rows) {
    release(row.url);
    release(row.icon);
  }
  for (const node of nodes.values()) release(node.item);
  for (const item of toolbarItems.values()) release(item);
  if (popover) release(popover);
  release(window);
  release(controller);
  libobjc.objc_autoreleasePoolPop(pool);
  for (const callback of callbacks) callback.release();
  for (const library of [appkit, foundation, libobjc]) library.close();
}

try {
  createControlsDemo();
} catch (err) {
  console.error(err);
}
