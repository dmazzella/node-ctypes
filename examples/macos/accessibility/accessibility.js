/**
 * accessibility.js — macOS Accessibility API wrapper for node-ctypes
 *
 * Wraps the ApplicationServices and CoreFoundation frameworks to provide
 * a clean JS interface for UI automation via the macOS AX API.
 *
 * This is the macOS equivalent of Microsoft UI Automation (UIA).
 *
 * Usage:
 *   import { AXApplication, AXSystem, isAccessibilityEnabled, requestAccessibility } from "./accessibility/accessibility.js";
 *
 *   if (!isAccessibilityEnabled()) requestAccessibility();
 *
 *   const app = new AXApplication(pid);
 *   const win = app.findWindowByTitle("My App");
 *   const field = win.findChild({ role: "AXTextField" });
 *   field.setValue("Hello World");
 *   const button = win.findChild({ role: "AXButton", title: "Submit" });
 *   button.press();
 *   app.dispose();
 *
 * Prerequisites:
 *   - macOS only (darwin)
 *   - Accessibility permissions must be granted to the terminal / application
 */

import { CDLL, byref, c_void_p, c_int32, c_uint32, c_uint8, c_long, c_ulong, c_float, readValue, ptrToBuffer, POINTER_SIZE, create_string_buffer } from "node-ctypes";

// ─── AXError Codes ──────────────────────────────────────────────────

const kAXErrorSuccess = 0;
const kAXErrorFailure = -25200;
const kAXErrorIllegalArgument = -25201;
const kAXErrorInvalidUIElement = -25202;
const kAXErrorInvalidUIElementObserver = -25203;
const kAXErrorCannotComplete = -25204;
const kAXErrorAttributeUnsupported = -25205;
const kAXErrorActionUnsupported = -25206;
const kAXErrorNotificationUnsupported = -25207;
const kAXErrorNotImplemented = -25208;
const kAXErrorNotificationAlreadyRegistered = -25209;
const kAXErrorNotificationNotRegistered = -25210;
const kAXErrorAPIDisabled = -25211;
const kAXErrorNoValue = -25212;
const kAXErrorParameterizedAttributeUnsupported = -25213;
const kAXErrorNotEnoughPrecision = -25214;

const AX_ERROR_NAMES = {
  [kAXErrorSuccess]: "kAXErrorSuccess",
  [kAXErrorFailure]: "kAXErrorFailure",
  [kAXErrorIllegalArgument]: "kAXErrorIllegalArgument",
  [kAXErrorInvalidUIElement]: "kAXErrorInvalidUIElement",
  [kAXErrorInvalidUIElementObserver]: "kAXErrorInvalidUIElementObserver",
  [kAXErrorCannotComplete]: "kAXErrorCannotComplete",
  [kAXErrorAttributeUnsupported]: "kAXErrorAttributeUnsupported",
  [kAXErrorActionUnsupported]: "kAXErrorActionUnsupported",
  [kAXErrorNotificationUnsupported]: "kAXErrorNotificationUnsupported",
  [kAXErrorNotImplemented]: "kAXErrorNotImplemented",
  [kAXErrorNotificationAlreadyRegistered]: "kAXErrorNotificationAlreadyRegistered",
  [kAXErrorNotificationNotRegistered]: "kAXErrorNotificationNotRegistered",
  [kAXErrorAPIDisabled]: "kAXErrorAPIDisabled",
  [kAXErrorNoValue]: "kAXErrorNoValue",
  [kAXErrorParameterizedAttributeUnsupported]: "kAXErrorParameterizedAttributeUnsupported",
  [kAXErrorNotEnoughPrecision]: "kAXErrorNotEnoughPrecision",
};

// ─── CoreFoundation Constants ───────────────────────────────────────

const kCFStringEncodingUTF8 = 0x08000100;

// CFNumberType values
const kCFNumberSInt32Type = 3;
const kCFNumberSInt64Type = 4;
const kCFNumberFloat64Type = 6;

// AXValueType values (for AXValueGetType / AXValueGetValue)
const kAXValueCGPointType = 1; // { x: number, y: number }
const kAXValueCGSizeType = 2; // { width: number, height: number }
const kAXValueCGRectType = 3; // { x, y, width, height }
const kAXValueCFRangeType = 4; // { location: number, length: number }
const kAXValueIllegalType = 0xffffffff;

// ─── Error Class ────────────────────────────────────────────────────

export class AXError extends Error {
  constructor(code, message) {
    const name = AX_ERROR_NAMES[code] || "Unknown";
    super(message || `AXError ${code} (${name})`);
    this.code = code;
    this.axErrorName = name;
  }
}

function checkAX(code, context) {
  if (code !== kAXErrorSuccess) {
    throw new AXError(code, `${context}: AXError ${code} (${AX_ERROR_NAMES[code] || "Unknown"})`);
  }
}

// ─── Lazy Framework Loading ─────────────────────────────────────────

let _appServices = null;
let _cf = null;

function appServices() {
  if (!_appServices) {
    _appServices = new CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");

    // AXUIElement creation
    _appServices.AXUIElementCreateApplication.argtypes = [c_int32];
    _appServices.AXUIElementCreateApplication.restype = c_void_p;

    _appServices.AXUIElementCreateSystemWide.argtypes = [];
    _appServices.AXUIElementCreateSystemWide.restype = c_void_p;

    // Attribute access
    _appServices.AXUIElementCopyAttributeValue.argtypes = [c_void_p, c_void_p, c_void_p];
    _appServices.AXUIElementCopyAttributeValue.restype = c_int32;

    _appServices.AXUIElementSetAttributeValue.argtypes = [c_void_p, c_void_p, c_void_p];
    _appServices.AXUIElementSetAttributeValue.restype = c_int32;

    // Actions
    _appServices.AXUIElementPerformAction.argtypes = [c_void_p, c_void_p];
    _appServices.AXUIElementPerformAction.restype = c_int32;

    // Attribute settable check
    _appServices.AXUIElementIsAttributeSettable.argtypes = [c_void_p, c_void_p, c_void_p];
    _appServices.AXUIElementIsAttributeSettable.restype = c_int32;

    // Process trust
    _appServices.AXIsProcessTrusted.argtypes = [];
    _appServices.AXIsProcessTrusted.restype = c_uint8;

    _appServices.AXIsProcessTrustedWithOptions.argtypes = [c_void_p];
    _appServices.AXIsProcessTrustedWithOptions.restype = c_uint8;

    // AXValue (CGRect / CGPoint / CGSize / CFRange)
    _appServices.AXValueGetTypeID.argtypes = [];
    _appServices.AXValueGetTypeID.restype = c_ulong;

    _appServices.AXValueGetType.argtypes = [c_void_p];
    _appServices.AXValueGetType.restype = c_int32;

    _appServices.AXValueGetValue.argtypes = [c_void_p, c_int32, c_void_p];
    _appServices.AXValueGetValue.restype = c_uint8;

    // AXValueCreate — create an AXValueRef from a C struct (for writing positions/sizes)
    _appServices.AXValueCreate.argtypes = [c_int32, c_void_p];
    _appServices.AXValueCreate.restype = c_void_p;

    // Attribute inspection
    _appServices.AXUIElementCopyAttributeNames.argtypes = [c_void_p, c_void_p];
    _appServices.AXUIElementCopyAttributeNames.restype = c_int32;

    _appServices.AXUIElementCopyParameterizedAttributeNames.argtypes = [c_void_p, c_void_p];
    _appServices.AXUIElementCopyParameterizedAttributeNames.restype = c_int32;

    _appServices.AXUIElementCopyParameterizedAttributeValue.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p];
    _appServices.AXUIElementCopyParameterizedAttributeValue.restype = c_int32;

    // Action inspection
    _appServices.AXUIElementCopyActionNames.argtypes = [c_void_p, c_void_p];
    _appServices.AXUIElementCopyActionNames.restype = c_int32;

    _appServices.AXUIElementCopyActionDescription.argtypes = [c_void_p, c_void_p, c_void_p];
    _appServices.AXUIElementCopyActionDescription.restype = c_int32;

    // Hit testing — x and y are C float (32-bit), not double
    _appServices.AXUIElementCopyElementAtPosition.argtypes = [c_void_p, c_float, c_float, c_void_p];
    _appServices.AXUIElementCopyElementAtPosition.restype = c_int32;

    // PID — pid_t* is int* (4 bytes) on macOS
    _appServices.AXUIElementGetPid.argtypes = [c_void_p, c_void_p];
    _appServices.AXUIElementGetPid.restype = c_int32;

    // Messaging timeout — timeoutInSeconds is C float
    _appServices.AXUIElementSetMessagingTimeout.argtypes = [c_void_p, c_float];
    _appServices.AXUIElementSetMessagingTimeout.restype = c_int32;
  }
  return _appServices;
}

function cf() {
  if (!_cf) {
    _cf = new CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

    // CFString
    _cf.CFStringCreateWithCString.argtypes = [c_void_p, c_void_p, c_uint32];
    _cf.CFStringCreateWithCString.restype = c_void_p;

    _cf.CFStringGetCString.argtypes = [c_void_p, c_void_p, c_long, c_uint32];
    _cf.CFStringGetCString.restype = c_uint8;

    _cf.CFStringGetLength.argtypes = [c_void_p];
    _cf.CFStringGetLength.restype = c_long;

    _cf.CFStringGetMaximumSizeForEncoding.argtypes = [c_long, c_uint32];
    _cf.CFStringGetMaximumSizeForEncoding.restype = c_long;

    // CFArray
    _cf.CFArrayGetCount.argtypes = [c_void_p];
    _cf.CFArrayGetCount.restype = c_long;

    _cf.CFArrayGetValueAtIndex.argtypes = [c_void_p, c_long];
    _cf.CFArrayGetValueAtIndex.restype = c_void_p;

    // CFRelease / CFRetain
    _cf.CFRelease.argtypes = [c_void_p];
    _cf.CFRelease.restype = c_void_p;

    _cf.CFRetain.argtypes = [c_void_p];
    _cf.CFRetain.restype = c_void_p;

    // CFTypeID
    _cf.CFGetTypeID.argtypes = [c_void_p];
    _cf.CFGetTypeID.restype = c_ulong;

    _cf.CFStringGetTypeID.argtypes = [];
    _cf.CFStringGetTypeID.restype = c_ulong;

    _cf.CFArrayGetTypeID.argtypes = [];
    _cf.CFArrayGetTypeID.restype = c_ulong;

    _cf.CFBooleanGetTypeID.argtypes = [];
    _cf.CFBooleanGetTypeID.restype = c_ulong;

    _cf.CFNumberGetTypeID.argtypes = [];
    _cf.CFNumberGetTypeID.restype = c_ulong;

    // CFBoolean
    _cf.CFBooleanGetValue.argtypes = [c_void_p];
    _cf.CFBooleanGetValue.restype = c_uint8;

    // CFNumber
    _cf.CFNumberGetValue.argtypes = [c_void_p, c_long, c_void_p];
    _cf.CFNumberGetValue.restype = c_uint8;

    _cf.CFNumberCreate.argtypes = [c_void_p, c_long, c_void_p];
    _cf.CFNumberCreate.restype = c_void_p;

    // CFDictionary
    _cf.CFDictionaryCreateMutable.argtypes = [c_void_p, c_long, c_void_p, c_void_p];
    _cf.CFDictionaryCreateMutable.restype = c_void_p;

    _cf.CFDictionarySetValue.argtypes = [c_void_p, c_void_p, c_void_p];
    _cf.CFDictionarySetValue.restype = c_void_p;
  }
  return _cf;
}

// ─── Global Symbol Accessors ────────────────────────────────────────

function getGlobalCFRef(lib, symbolName) {
  const addr = lib.symbol(symbolName);
  if (!addr || addr === 0n) return null;
  const buf = ptrToBuffer(addr, POINTER_SIZE);
  return readValue(buf, c_void_p, 0);
}

let _kCFBooleanTrue = null;
let _kCFBooleanFalse = null;
let _kAXTrustedCheckOptionPrompt = null;
let _kCFTypeDictionaryKeyCallBacks = null;
let _kCFTypeDictionaryValueCallBacks = null;

function getCFBooleanTrue() {
  if (_kCFBooleanTrue === null) {
    _kCFBooleanTrue = getGlobalCFRef(cf(), "kCFBooleanTrue");
  }
  return _kCFBooleanTrue;
}

function getCFBooleanFalse() {
  if (_kCFBooleanFalse === null) {
    _kCFBooleanFalse = getGlobalCFRef(cf(), "kCFBooleanFalse");
  }
  return _kCFBooleanFalse;
}

function getAXTrustedCheckOptionPrompt() {
  if (_kAXTrustedCheckOptionPrompt === null) {
    _kAXTrustedCheckOptionPrompt = getGlobalCFRef(appServices(), "kAXTrustedCheckOptionPrompt");
  }
  return _kAXTrustedCheckOptionPrompt;
}

// These are struct addresses (not pointer-to-pointer), passed directly to CFDictionaryCreateMutable
function getCFTypeDictionaryKeyCallBacks() {
  if (_kCFTypeDictionaryKeyCallBacks === null) {
    _kCFTypeDictionaryKeyCallBacks = cf().symbol("kCFTypeDictionaryKeyCallBacks");
  }
  return _kCFTypeDictionaryKeyCallBacks;
}

function getCFTypeDictionaryValueCallBacks() {
  if (_kCFTypeDictionaryValueCallBacks === null) {
    _kCFTypeDictionaryValueCallBacks = cf().symbol("kCFTypeDictionaryValueCallBacks");
  }
  return _kCFTypeDictionaryValueCallBacks;
}

// ─── CoreFoundation Helpers ─────────────────────────────────────────

// Cache for frequently used AX attribute CFStrings (created once, never released)
const _cfstrCache = new Map();

/**
 * Create a CFStringRef from a JS string. Caller must CFRelease.
 * @param {string} jsString
 * @returns {bigint} CFStringRef pointer
 */
function cfstr(jsString) {
  const buf = Buffer.from(jsString + "\0", "utf8");
  const ref = cf().CFStringCreateWithCString(null, buf, kCFStringEncodingUTF8);
  if (!ref || ref === 0n) {
    throw new AXError(kAXErrorFailure, `Failed to create CFString for "${jsString}"`);
  }
  return ref;
}

/**
 * Get a cached CFStringRef for a commonly used string (never released).
 * @param {string} str
 * @returns {bigint} CFStringRef pointer
 */
function cachedCFStr(str) {
  let ref = _cfstrCache.get(str);
  if (!ref) {
    ref = cfstr(str);
    _cfstrCache.set(str, ref);
  }
  return ref;
}

/**
 * Read a CFStringRef into a JS string. Does NOT release.
 * @param {bigint} cfStringRef
 * @returns {string}
 */
function cfstrToJs(cfStringRef) {
  const lib = cf();
  const len = Number(lib.CFStringGetLength(cfStringRef));
  if (len <= 0) return "";
  const maxSize = Number(lib.CFStringGetMaximumSizeForEncoding(len, kCFStringEncodingUTF8));
  const bufSize = maxSize + 1;
  const buf = Buffer.alloc(bufSize);
  const ok = lib.CFStringGetCString(cfStringRef, buf, bufSize, kCFStringEncodingUTF8);
  if (!ok) return "";
  let end = 0;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(0, end).toString("utf8");
}

/**
 * Safely release a CF object (null-safe).
 * @param {bigint} ref
 */
function cfRelease(ref) {
  if (ref && ref !== 0n) {
    cf().CFRelease(ref);
  }
}

// ─── CF Type Detection ──────────────────────────────────────────────

let _cfStringTypeID = null;
let _cfArrayTypeID = null;
let _cfBooleanTypeID = null;
let _cfNumberTypeID = null;
let _axValueTypeID = null;

function cfStringTypeID() {
  if (_cfStringTypeID === null) _cfStringTypeID = cf().CFStringGetTypeID();
  return _cfStringTypeID;
}

function cfArrayTypeID() {
  if (_cfArrayTypeID === null) _cfArrayTypeID = cf().CFArrayGetTypeID();
  return _cfArrayTypeID;
}

function cfBooleanTypeID() {
  if (_cfBooleanTypeID === null) _cfBooleanTypeID = cf().CFBooleanGetTypeID();
  return _cfBooleanTypeID;
}

function cfNumberTypeID() {
  if (_cfNumberTypeID === null) _cfNumberTypeID = cf().CFNumberGetTypeID();
  return _cfNumberTypeID;
}

function axValueTypeID() {
  if (_axValueTypeID === null) _axValueTypeID = appServices().AXValueGetTypeID();
  return _axValueTypeID;
}

/**
 * Convert a CFTypeRef to an appropriate JS value.
 * Does NOT release the CF object.
 * @param {bigint} cfTypeRef
 * @returns {*} JS value (string, boolean, number, or raw bigint for unknown types)
 */
function cfToJs(cfTypeRef) {
  if (!cfTypeRef || cfTypeRef === 0n) return null;

  const lib = cf();
  const typeID = lib.CFGetTypeID(cfTypeRef);

  if (typeID === cfStringTypeID()) {
    return cfstrToJs(cfTypeRef);
  }

  if (typeID === cfBooleanTypeID()) {
    return !!lib.CFBooleanGetValue(cfTypeRef);
  }

  if (typeID === cfNumberTypeID()) {
    const buf = Buffer.alloc(8);
    // Try int64 first, then double
    if (lib.CFNumberGetValue(cfTypeRef, kCFNumberSInt64Type, buf)) {
      const val = buf.readBigInt64LE(0);
      // Return as Number if it fits safely
      if (val >= -9007199254740991n && val <= 9007199254740991n) {
        return Number(val);
      }
      return val;
    }
    if (lib.CFNumberGetValue(cfTypeRef, kCFNumberFloat64Type, buf)) {
      return buf.readDoubleLE(0);
    }
    return null;
  }

  // AXValueRef — CGPoint, CGSize, CGRect, CFRange
  if (typeID === axValueTypeID()) {
    return axValueToJs(cfTypeRef);
  }

  // Unknown type — return the raw pointer
  return cfTypeRef;
}

/**
 * Convert an AXValueRef to a JS object.
 * Structs use double (CGFloat=64-bit) and long (CFIndex=64-bit) on macOS/arm64+x86_64.
 * @param {bigint} axValueRef
 * @returns {{ x, y }|{ width, height }|{ x, y, width, height }|{ location, length }|null}
 */
function axValueToJs(axValueRef) {
  const ax = appServices();
  const valueType = ax.AXValueGetType(axValueRef);

  if (valueType === kAXValueCGPointType) {
    const buf = Buffer.alloc(16);
    if (!ax.AXValueGetValue(axValueRef, kAXValueCGPointType, buf)) return null;
    return { x: buf.readDoubleLE(0), y: buf.readDoubleLE(8) };
  }

  if (valueType === kAXValueCGSizeType) {
    const buf = Buffer.alloc(16);
    if (!ax.AXValueGetValue(axValueRef, kAXValueCGSizeType, buf)) return null;
    return { width: buf.readDoubleLE(0), height: buf.readDoubleLE(8) };
  }

  if (valueType === kAXValueCGRectType) {
    const buf = Buffer.alloc(32);
    if (!ax.AXValueGetValue(axValueRef, kAXValueCGRectType, buf)) return null;
    return {
      x: buf.readDoubleLE(0),
      y: buf.readDoubleLE(8),
      width: buf.readDoubleLE(16),
      height: buf.readDoubleLE(24),
    };
  }

  if (valueType === kAXValueCFRangeType) {
    const buf = Buffer.alloc(16);
    if (!ax.AXValueGetValue(axValueRef, kAXValueCFRangeType, buf)) return null;
    return {
      location: Number(buf.readBigInt64LE(0)),
      length: Number(buf.readBigInt64LE(8)),
    };
  }

  return null;
}

/**
 * Convert a CFArrayRef of CFStrings to a JS string[]. Does NOT release.
 * @param {bigint} cfArrayRef
 * @returns {string[]}
 */
function cfStringArrayToJs(cfArrayRef) {
  if (!cfArrayRef || cfArrayRef === 0n) return [];
  const lib = cf();
  const count = Number(lib.CFArrayGetCount(cfArrayRef));
  const result = [];
  for (let i = 0; i < count; i++) {
    const strRef = lib.CFArrayGetValueAtIndex(cfArrayRef, i);
    if (strRef && strRef !== 0n) {
      result.push(cfstrToJs(strRef));
    }
  }
  return result;
}

/**
 * Create an AXValueRef from a JS geometry or range object.
 * Caller must CFRelease the returned ref.
 * @param {{ location, length }|{ x, y }|{ width, height }|{ x, y, width, height }} obj
 * @returns {bigint|null} AXValueRef pointer or null if shape is not recognized
 */
function jsToAXValue(obj) {
  const ax = appServices();
  if ("location" in obj && "length" in obj) {
    const buf = Buffer.alloc(16);
    buf.writeBigInt64LE(BigInt(obj.location), 0);
    buf.writeBigInt64LE(BigInt(obj.length), 8);
    return ax.AXValueCreate(kAXValueCFRangeType, buf);
  }
  if ("x" in obj && "y" in obj && "width" in obj && "height" in obj) {
    const buf = Buffer.alloc(32);
    buf.writeDoubleLE(obj.x, 0);
    buf.writeDoubleLE(obj.y, 8);
    buf.writeDoubleLE(obj.width, 16);
    buf.writeDoubleLE(obj.height, 24);
    return ax.AXValueCreate(kAXValueCGRectType, buf);
  }
  if ("x" in obj && "y" in obj) {
    const buf = Buffer.alloc(16);
    buf.writeDoubleLE(obj.x, 0);
    buf.writeDoubleLE(obj.y, 8);
    return ax.AXValueCreate(kAXValueCGPointType, buf);
  }
  if ("width" in obj && "height" in obj) {
    const buf = Buffer.alloc(16);
    buf.writeDoubleLE(obj.width, 0);
    buf.writeDoubleLE(obj.height, 8);
    return ax.AXValueCreate(kAXValueCGSizeType, buf);
  }
  return null;
}

// ─── AXElement Class ────────────────────────────────────────────────

/**
 * Wraps an AXUIElementRef pointer and provides JS-friendly access
 * to attributes, actions, and child traversal.
 */
export class AXElement {
  /**
   * @param {bigint} ref - AXUIElementRef pointer
   * @param {boolean} [owned=true] - If true, CFRelease on dispose()
   */
  constructor(ref, owned = true) {
    this._ref = ref;
    this._owned = owned;
  }

  /** The raw AXUIElementRef pointer. */
  get ref() {
    return this._ref;
  }

  /**
   * Read an AX attribute by name.
   * @param {string} name - Attribute name (e.g., "AXTitle", "AXRole", "AXValue")
   * @returns {*} JS value, AXElement[], or null if not supported
   */
  getAttribute(name) {
    const ax = appServices();
    const lib = cf();
    const cfName = cachedCFStr(name);
    const valueOut = new c_void_p();

    const err = ax.AXUIElementCopyAttributeValue(this._ref, cfName, byref(valueOut));

    if (err === kAXErrorNoValue || err === kAXErrorAttributeUnsupported || err === kAXErrorCannotComplete || err === kAXErrorFailure) {
      return null;
    }
    checkAX(err, `getAttribute("${name}")`);

    const cfValue = valueOut.value;
    if (!cfValue || cfValue === 0n) return null;

    try {
      const typeID = lib.CFGetTypeID(cfValue);

      // CFArray — may contain AXUIElementRefs or primitive CF types
      if (typeID === cfArrayTypeID()) {
        const count = Number(lib.CFArrayGetCount(cfValue));
        const result = [];
        for (let i = 0; i < count; i++) {
          const elem = lib.CFArrayGetValueAtIndex(cfValue, i);
          if (!elem || elem === 0n) continue;
          const elemTypeID = lib.CFGetTypeID(elem);
          if (elemTypeID !== cfStringTypeID() && elemTypeID !== cfBooleanTypeID() && elemTypeID !== cfNumberTypeID() && elemTypeID !== cfArrayTypeID()) {
            // Likely an AXUIElementRef — retain it so it survives past the array release
            lib.CFRetain(elem);
            result.push(new AXElement(elem, true));
          } else {
            result.push(cfToJs(elem));
          }
        }
        return result;
      }

      return cfToJs(cfValue);
    } finally {
      // CopyAttributeValue follows the Create Rule — caller must release
      cfRelease(cfValue);
    }
  }

  /**
   * Set an AX attribute value.
   * @param {string} name - Attribute name (e.g., "AXValue", "AXFocused")
   * @param {string|boolean|number} value - Value to set
   */
  setAttribute(name, value) {
    const ax = appServices();
    const cfName = cachedCFStr(name);

    let cfValue;
    let shouldRelease = false;

    if (typeof value === "string") {
      cfValue = cfstr(value);
      shouldRelease = true;
    } else if (typeof value === "boolean") {
      cfValue = value ? getCFBooleanTrue() : getCFBooleanFalse();
      shouldRelease = false; // globals — do NOT release
    } else if (typeof value === "number") {
      const buf = Buffer.alloc(8);
      if (Number.isInteger(value)) {
        buf.writeBigInt64LE(BigInt(value), 0);
        cfValue = cf().CFNumberCreate(null, kCFNumberSInt64Type, buf);
      } else {
        buf.writeDoubleLE(value, 0);
        cfValue = cf().CFNumberCreate(null, kCFNumberFloat64Type, buf);
      }
      shouldRelease = true;
    } else if (typeof value === "object" && value !== null) {
      // Geometry / range object → AXValueRef (e.g. setting AXPosition, AXSize)
      cfValue = jsToAXValue(value);
      if (!cfValue || cfValue === 0n) {
        throw new Error(`setAttribute: cannot convert object to AXValueRef (unsupported shape)`);
      }
      shouldRelease = true;
    } else {
      throw new Error(`setAttribute: unsupported value type "${typeof value}"`);
    }

    try {
      const err = ax.AXUIElementSetAttributeValue(this._ref, cfName, cfValue);
      checkAX(err, `setAttribute("${name}")`);
    } finally {
      if (shouldRelease) cfRelease(cfValue);
    }
  }

  /**
   * Check if an attribute is settable.
   * @param {string} name - Attribute name
   * @returns {boolean}
   */
  isAttributeSettable(name) {
    const ax = appServices();
    const cfName = cachedCFStr(name);
    const settable = new c_uint8(0);
    const err = ax.AXUIElementIsAttributeSettable(this._ref, cfName, byref(settable));
    if (err !== kAXErrorSuccess) return false;
    return !!settable.value;
  }

  /**
   * List all supported attribute names for this element.
   * @returns {string[]}
   */
  getAttributeNames() {
    const ax = appServices();
    const namesOut = new c_void_p();
    const err = ax.AXUIElementCopyAttributeNames(this._ref, byref(namesOut));
    if (err === kAXErrorNoValue || err === kAXErrorAttributeUnsupported || err === kAXErrorCannotComplete) return [];
    checkAX(err, "getAttributeNames()");
    const cfNames = namesOut.value;
    if (!cfNames || cfNames === 0n) return [];
    try {
      return cfStringArrayToJs(cfNames);
    } finally {
      cfRelease(cfNames);
    }
  }

  /**
   * List all supported parameterized attribute names for this element.
   * @returns {string[]}
   */
  getParameterizedAttributeNames() {
    const ax = appServices();
    const namesOut = new c_void_p();
    const err = ax.AXUIElementCopyParameterizedAttributeNames(this._ref, byref(namesOut));
    if (err === kAXErrorNoValue || err === kAXErrorAttributeUnsupported || err === kAXErrorCannotComplete) return [];
    checkAX(err, "getParameterizedAttributeNames()");
    const cfNames = namesOut.value;
    if (!cfNames || cfNames === 0n) return [];
    try {
      return cfStringArrayToJs(cfNames);
    } finally {
      cfRelease(cfNames);
    }
  }

  /**
   * List all supported action names for this element.
   * @returns {string[]}
   */
  getActionNames() {
    const ax = appServices();
    const namesOut = new c_void_p();
    const err = ax.AXUIElementCopyActionNames(this._ref, byref(namesOut));
    if (err === kAXErrorNoValue || err === kAXErrorAttributeUnsupported || err === kAXErrorCannotComplete) return [];
    checkAX(err, "getActionNames()");
    const cfNames = namesOut.value;
    if (!cfNames || cfNames === 0n) return [];
    try {
      return cfStringArrayToJs(cfNames);
    } finally {
      cfRelease(cfNames);
    }
  }

  /**
   * Get the human-readable description of an action.
   * @param {string} action - Action name (e.g., "AXPress")
   * @returns {string|null}
   */
  getActionDescription(action) {
    const ax = appServices();
    const cfAction = cachedCFStr(action);
    const descOut = new c_void_p();
    const err = ax.AXUIElementCopyActionDescription(this._ref, cfAction, byref(descOut));
    if (err !== kAXErrorSuccess) return null;
    const cfDesc = descOut.value;
    if (!cfDesc || cfDesc === 0n) return null;
    try {
      return cfstrToJs(cfDesc);
    } finally {
      cfRelease(cfDesc);
    }
  }

  /**
   * Get a parameterized attribute value.
   * The `parameter` may be:
   *   - a number → wrapped in CFNumber
   *   - a string → wrapped in CFString
   *   - an AXElement → passed as AXUIElementRef
   *   - a geometry/range object → converted to AXValueRef via jsToAXValue()
   *     e.g. { location, length } for AXStringForRange / AXBoundsForRange
   *         { x, y }            for AXRangeForPosition
   * @param {string} attr - Parameterized attribute name (e.g., "AXStringForRange")
   * @param {number|string|AXElement|object} parameter
   * @returns {*} converted JS value or null
   */
  getParameterizedAttribute(attr, parameter) {
    const ax = appServices();
    const lib = cf();
    const cfAttr = cachedCFStr(attr);

    let cfParam;
    let shouldRelease = false;

    if (typeof parameter === "string") {
      cfParam = cfstr(parameter);
      shouldRelease = true;
    } else if (typeof parameter === "number") {
      const buf = Buffer.alloc(8);
      if (Number.isInteger(parameter)) {
        buf.writeBigInt64LE(BigInt(parameter), 0);
        cfParam = lib.CFNumberCreate(null, kCFNumberSInt64Type, buf);
      } else {
        buf.writeDoubleLE(parameter, 0);
        cfParam = lib.CFNumberCreate(null, kCFNumberFloat64Type, buf);
      }
      shouldRelease = true;
    } else if (parameter instanceof AXElement) {
      cfParam = parameter._ref;
      shouldRelease = false;
    } else if (typeof parameter === "object" && parameter !== null) {
      cfParam = jsToAXValue(parameter);
      if (!cfParam || cfParam === 0n) throw new Error(`getParameterizedAttribute: cannot convert parameter to AXValueRef`);
      shouldRelease = true;
    } else {
      throw new Error(`getParameterizedAttribute: unsupported parameter type "${typeof parameter}"`);
    }

    const valueOut = new c_void_p();
    let err;
    try {
      err = ax.AXUIElementCopyParameterizedAttributeValue(this._ref, cfAttr, cfParam, byref(valueOut));
    } finally {
      if (shouldRelease) cfRelease(cfParam);
    }

    if (err === kAXErrorNoValue || err === kAXErrorParameterizedAttributeUnsupported || err === kAXErrorCannotComplete) return null;
    checkAX(err, `getParameterizedAttribute("${attr}")`);

    const cfValue = valueOut.value;
    if (!cfValue || cfValue === 0n) return null;

    try {
      const typeID = lib.CFGetTypeID(cfValue);
      if (typeID === cfArrayTypeID()) {
        const count = Number(lib.CFArrayGetCount(cfValue));
        const result = [];
        for (let i = 0; i < count; i++) {
          const elem = lib.CFArrayGetValueAtIndex(cfValue, i);
          if (!elem || elem === 0n) continue;
          const elemTypeID = lib.CFGetTypeID(elem);
          if (elemTypeID !== cfStringTypeID() && elemTypeID !== cfBooleanTypeID() && elemTypeID !== cfNumberTypeID() && elemTypeID !== cfArrayTypeID()) {
            lib.CFRetain(elem);
            result.push(new AXElement(elem, true));
          } else {
            result.push(cfToJs(elem));
          }
        }
        return result;
      }
      return cfToJs(cfValue);
    } finally {
      cfRelease(cfValue);
    }
  }

  /**
   * Get the PID of the process that owns this element.
   * @returns {number}
   */
  getPid() {
    const ax = appServices();
    const pidOut = new c_int32(0);
    const err = ax.AXUIElementGetPid(this._ref, byref(pidOut));
    checkAX(err, "getPid()");
    return pidOut.value;
  }

  /**
   * Perform an AX action on this element.
   * @param {string} action - Action name (e.g., "AXPress", "AXConfirm")
   */
  performAction(action) {
    const ax = appServices();
    const cfAction = cachedCFStr(action);
    const err = ax.AXUIElementPerformAction(this._ref, cfAction);
    checkAX(err, `performAction("${action}")`);
  }

  // ── Convenience Getters ────────────────────────────────────────

  get role() {
    return this.getAttribute("AXRole");
  }

  get subrole() {
    return this.getAttribute("AXSubrole");
  }

  get title() {
    return this.getAttribute("AXTitle");
  }

  get value() {
    return this.getAttribute("AXValue");
  }

  get description() {
    return this.getAttribute("AXDescription");
  }

  get roleDescription() {
    return this.getAttribute("AXRoleDescription");
  }

  get focused() {
    return this.getAttribute("AXFocused");
  }

  get enabled() {
    return this.getAttribute("AXEnabled");
  }

  get url() {
    return this.getAttribute("AXURL");
  }

  get identifier() {
    return this.getAttribute("AXIdentifier");
  }

  get help() {
    return this.getAttribute("AXHelp");
  }

  // Text-specific getters
  get placeholder() {
    return this.getAttribute("AXPlaceholderValue");
  }

  get selectedText() {
    return this.getAttribute("AXSelectedText");
  }

  get selectedTextRange() {
    return this.getAttribute("AXSelectedTextRange");
  }

  get numberOfCharacters() {
    return this.getAttribute("AXNumberOfCharacters");
  }

  get insertionPointLineNumber() {
    return this.getAttribute("AXInsertionPointLineNumber");
  }

  // Window-specific getters
  get isMain() {
    return this.getAttribute("AXMain");
  }

  get isMinimized() {
    return this.getAttribute("AXMinimized");
  }

  get isModal() {
    return this.getAttribute("AXModal");
  }

  // Application-specific getters
  get frontmost() {
    return this.getAttribute("AXFrontmost");
  }

  get hidden() {
    return this.getAttribute("AXHidden");
  }

  // ── Children Traversal ─────────────────────────────────────────

  /**
   * Get direct children.
   * @returns {AXElement[]}
   */
  getChildren() {
    const result = this.getAttribute("AXChildren");
    if (!result || !Array.isArray(result)) return [];
    return result;
  }

  /**
   * Get children in navigation order (AXChildrenInNavigationOrder).
   * Used by browser-embedded web content (e.g., Safari tabs) which expose
   * their subtree via this attribute instead of AXChildren.
   * @returns {AXElement[]}
   */
  getNavigationChildren() {
    const result = this.getAttribute("AXChildrenInNavigationOrder");
    if (!result || !Array.isArray(result)) return [];
    return result;
  }

  /**
   * Get the parent element.
   * @returns {AXElement|null}
   */
  getParent() {
    return this.getAttribute("AXParent") ?? null;
  }

  /**
   * Get the top-level UI element (usually the window).
   * @returns {AXElement|null}
   */
  getTopLevelElement() {
    return this.getAttribute("AXTopLevelUIElement") ?? null;
  }

  /**
   * Get all siblings (other children of the same parent), excluding this element.
   * @returns {AXElement[]}
   */
  getSiblings() {
    const parent = this.getParent();
    if (!parent) return [];
    return parent.getChildren().filter((c) => c._ref !== this._ref);
  }

  /**
   * Get the next sibling (the element immediately after this one in the parent's children).
   * @returns {AXElement|null}
   */
  getNextSibling() {
    const parent = this.getParent();
    if (!parent) return null;
    const siblings = parent.getChildren();
    const idx = siblings.findIndex((c) => c._ref === this._ref);
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }

  /**
   * Get the previous sibling (the element immediately before this one in the parent's children).
   * @returns {AXElement|null}
   */
  getPreviousSibling() {
    const parent = this.getParent();
    if (!parent) return null;
    const siblings = parent.getChildren();
    const idx = siblings.findIndex((c) => c._ref === this._ref);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  /**
   * Recursive search for a child matching the given criteria.
   * @param {Object} criteria
   * @param {string} [criteria.role] - e.g., "AXTextField", "AXButton"
   * @param {string} [criteria.title] - Exact title match
   * @param {string} [criteria.description] - Exact description match
   * @param {string} [criteria.value] - Exact value match
   * @param {string} [criteria.identifier] - Exact AXIdentifier match (developer-set, most reliable when available)
   * @param {string} [criteria.placeholder] - Exact AXPlaceholderValue match
   * @param {string} [criteria.help] - Exact AXHelp (tooltip) match
   * @param {string} [criteria.subrole] - Exact AXSubrole match (e.g. "AXSecureTextField", "AXSearchField")
   * @param {boolean} [criteria.enabled] - Filter by AXEnabled state
   * @param {string} [criteria.url] - Exact AXURL match (for links/web content)
   * @returns {AXElement|null}
   */
  findChild(criteria) {
    const children = this.getChildren();
    for (const child of children) {
      if (_matches(child, criteria)) return child;
      const found = child.findChild(criteria);
      if (found) return found;
    }
    return null;
  }

  /**
   * Recursive search for ALL children matching criteria.
   * @param {Object} criteria
   * @returns {AXElement[]}
   */
  findChildren(criteria) {
    const results = [];
    const children = this.getChildren();
    for (const child of children) {
      if (_matches(child, criteria)) results.push(child);
      results.push(...child.findChildren(criteria));
    }
    return results;
  }

  /**
   * Find the first AXWebArea descendant, searching both AXChildren and
   * AXChildrenInNavigationOrder. Required for browser-embedded web content
   * (e.g., Safari) where the web subtree is only reachable via navigation order.
   * @returns {AXElement|null}
   */
  findWebArea() {
    return _findWebArea(this, new Set());
  }

  // ── Convenience Actions ────────────────────────────────────────

  /** Set the AXValue attribute (for text fields). */
  setValue(text) {
    this.setAttribute("AXValue", text);
  }

  /** Set focus on this element. */
  setFocus() {
    this.setAttribute("AXFocused", true);
  }

  /** Perform AXPress action (for buttons). */
  press() {
    this.performAction("AXPress");
  }

  /** Perform AXConfirm action. */
  confirm() {
    this.performAction("AXConfirm");
  }

  /** Perform AXRaise action (for windows). */
  raise() {
    this.performAction("AXRaise");
  }

  /** Perform AXIncrement action (for sliders/steppers). */
  increment() {
    this.performAction("AXIncrement");
  }

  /** Perform AXDecrement action (for sliders/steppers). */
  decrement() {
    this.performAction("AXDecrement");
  }

  /** Perform AXShowMenu action (shows context menu). */
  showMenu() {
    this.performAction("AXShowMenu");
  }

  /** Perform AXCancel action. */
  cancel() {
    this.performAction("AXCancel");
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** Release the underlying AXUIElementRef. */
  dispose() {
    if (this._owned && this._ref && this._ref !== 0n) {
      cfRelease(this._ref);
      this._ref = 0n;
    }
  }

  [Symbol.dispose]() {
    this.dispose();
  }

  toString() {
    try {
      const role = this.role || "?";
      const title = this.title || "";
      return `<AXElement role="${role}" title="${title}">`;
    } catch {
      return `<AXElement ref=${this._ref}>`;
    }
  }
}

function _matches(element, criteria) {
  if (criteria.role && element.role !== criteria.role) return false;
  if (criteria.title && element.title !== criteria.title) return false;
  if (criteria.description && element.description !== criteria.description) return false;
  if (criteria.value && element.value !== criteria.value) return false;
  if (criteria.identifier && element.identifier !== criteria.identifier) return false;
  if (criteria.placeholder && element.placeholder !== criteria.placeholder) return false;
  if (criteria.help && element.help !== criteria.help) return false;
  if (criteria.subrole && element.subrole !== criteria.subrole) return false;
  if (criteria.enabled !== undefined && element.enabled !== criteria.enabled) return false;
  if (criteria.url && element.url !== criteria.url) return false;
  return true;
}

/**
 * Recursively search for the first AXWebArea, checking both AXChildren and
 * AXChildrenInNavigationOrder. Uses a visited Set to avoid infinite loops.
 * @param {AXElement} el
 * @param {Set<bigint>} visited
 * @returns {AXElement|null}
 */
function _findWebArea(el, visited) {
  if (!el._ref || el._ref === 0n || visited.has(el._ref)) return null;
  visited.add(el._ref);

  // Check regular children
  const children = el.getChildren();
  for (const child of children) {
    if (child.role === "AXWebArea") return child;
    const found = _findWebArea(child, visited);
    if (found) return found;
  }

  // Check navigation-order children (browser web content)
  if (children.length === 0) {
    const navChildren = el.getNavigationChildren();
    for (const child of navChildren) {
      if (child.role === "AXWebArea") return child;
      const found = _findWebArea(child, visited);
      if (found) return found;
    }
  }

  return null;
}

// ─── AXApplication Class ────────────────────────────────────────────

/**
 * Wraps an application AXUIElement created from a process ID.
 */
export class AXApplication {
  /**
   * @param {number} pid - Process ID of the target application
   */
  constructor(pid) {
    const ref = appServices().AXUIElementCreateApplication(pid);
    if (!ref || ref === 0n) {
      throw new AXError(kAXErrorFailure, `Failed to create AXUIElement for pid ${pid}`);
    }
    this._element = new AXElement(ref, true);
    this._pid = pid;
  }

  /** The underlying AXElement for the application. */
  get element() {
    return this._element;
  }

  /** The process ID. */
  get pid() {
    return this._pid;
  }

  /**
   * Get all windows of this application.
   * @returns {AXElement[]}
   */
  getWindows() {
    return this._element.getAttribute("AXWindows") || [];
  }

  /**
   * Get the focused window.
   * @returns {AXElement|null}
   */
  getFocusedWindow() {
    const result = this._element.getAttribute("AXFocusedWindow");
    if (result instanceof AXElement) return result;
    // AXFocusedWindow returns a single AXUIElementRef, not an array.
    // getAttribute will return it as a raw BigInt if it can't identify the CF type.
    if (result && typeof result === "bigint" && result !== 0n) {
      return new AXElement(result, true);
    }
    return null;
  }

  /**
   * Get the main window.
   * @returns {AXElement|null}
   */
  getMainWindow() {
    const result = this._element.getAttribute("AXMainWindow");
    if (result instanceof AXElement) return result;
    if (result && typeof result === "bigint" && result !== 0n) {
      return new AXElement(result, true);
    }
    return null;
  }

  /**
   * Find a window by its title.
   * @param {string} title - Window title to match
   * @returns {AXElement|null}
   */
  findWindowByTitle(title) {
    const windows = this.getWindows();
    for (const win of windows) {
      if (win.title === title) return win;
    }
    return null;
  }

  /**
   * Find the AXWebArea in the given window (or the first window if omitted).
   * Works with browser apps (Safari, Chrome) where web content is exposed
   * via AXChildrenInNavigationOrder rather than AXChildren.
   * @param {AXElement} [win] - Window element; defaults to first window
   * @returns {AXElement|null}
   */
  getWebArea(win) {
    const target = win ?? this.getWindows()[0];
    if (!target) return null;
    return target.findWebArea();
  }

  /**
   * Hit-test a screen position and return the topmost UI element at that point.
   * x and y are in global screen coordinates (top-left origin on macOS).
   * @param {number} x - Screen x coordinate
   * @param {number} y - Screen y coordinate
   * @returns {AXElement|null}
   */
  getElementAtPosition(x, y) {
    const ax = appServices();
    const elementOut = new c_void_p();
    const err = ax.AXUIElementCopyElementAtPosition(this._element._ref, x, y, byref(elementOut));
    if (err === kAXErrorNoValue || err === kAXErrorCannotComplete) return null;
    checkAX(err, `getElementAtPosition(${x}, ${y})`);
    const ref = elementOut.value;
    if (!ref || ref === 0n) return null;
    return new AXElement(ref, true);
  }

  /**
   * Set the messaging timeout for calls to this application element.
   * Use 0 to reset to the system default.
   * @param {number} seconds - Timeout in seconds (float); 0 resets to default
   */
  setMessagingTimeout(seconds) {
    const ax = appServices();
    const err = ax.AXUIElementSetMessagingTimeout(this._element._ref, seconds);
    checkAX(err, `setMessagingTimeout(${seconds})`);
  }

  /** Release resources. */
  dispose() {
    this._element.dispose();
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

// ─── AXSystem Class ─────────────────────────────────────────────────

/**
 * Wraps the system-wide AXUIElement for cross-application queries.
 */
export class AXSystem {
  constructor() {
    const ref = appServices().AXUIElementCreateSystemWide();
    if (!ref || ref === 0n) {
      throw new AXError(kAXErrorFailure, "Failed to create system-wide AXUIElement");
    }
    this._element = new AXElement(ref, true);
  }

  /** Get the currently focused element across all applications. */
  getFocusedElement() {
    const result = this._element.getAttribute("AXFocusedUIElement");
    if (result instanceof AXElement) return result;
    if (result && typeof result === "bigint" && result !== 0n) {
      return new AXElement(result, true);
    }
    return null;
  }

  dispose() {
    this._element.dispose();
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

// ─── AX Constants ───────────────────────────────────────────────────

/** Accessibility role strings (kAX*Role — from AXRoleConstants.h) */
export const AXRoles = {
  Application: "AXApplication",
  SystemWide: "AXSystemWide",
  Window: "AXWindow",
  Sheet: "AXSheet",
  Drawer: "AXDrawer",
  GrowArea: "AXGrowArea",
  Image: "AXImage",
  Unknown: "AXUnknown",
  Button: "AXButton",
  RadioButton: "AXRadioButton",
  CheckBox: "AXCheckBox",
  PopUpButton: "AXPopUpButton",
  MenuItem: "AXMenuItem",
  MenuButton: "AXMenuButton",
  ComboBox: "AXComboBox",
  Slider: "AXSlider",
  Incrementor: "AXIncrementor",
  BusyIndicator: "AXBusyIndicator",
  ProgressIndicator: "AXProgressIndicator",
  RelevanceIndicator: "AXRelevanceIndicator",
  Toolbar: "AXToolbar",
  Popover: "AXPopover",
  ScrollArea: "AXScrollArea",
  ScrollBar: "AXScrollBar",
  Grid: "AXGrid",
  WebArea: "AXWebArea",
  TextArea: "AXTextArea",
  TextField: "AXTextField",
  StaticText: "AXStaticText",
  Heading: "AXHeading",
  Browser: "AXBrowser",
  Outline: "AXOutline",
  Row: "AXRow",
  Column: "AXColumn",
  Table: "AXTable",
  TableHeaderView: "AXTableHeaderView",
  Cell: "AXCell",
  List: "AXList",
  Group: "AXGroup",
  RadioGroup: "AXRadioGroup",
  TabGroup: "AXTabGroup",
  SplitGroup: "AXSplitGroup",
  Splitter: "AXSplitter",
  ValueIndicator: "AXValueIndicator",
  Link: "AXLink",
  MenuBar: "AXMenuBar",
  MenuBarItem: "AXMenuBarItem",
  Menu: "AXMenu",
  DisclosureTriangle: "AXDisclosureTriangle",
  ColorWell: "AXColorWell",
  DateField: "AXDateField",
  TimeField: "AXTimeField",
  LevelIndicator: "AXLevelIndicator",
  SortButton: "AXSortButton",
  HelpTag: "AXHelpTag",
  Matte: "AXMatte",
  RulerMarker: "AXRulerMarker",
  Ruler: "AXRuler",
  LayoutArea: "AXLayoutArea",
  LayoutItem: "AXLayoutItem",
  Handle: "AXHandle",
  Form: "AXForm",
  Alert: "AXAlert",
};

/** Accessibility subrole strings (kAX*Subrole — from AXRoleConstants.h) */
export const AXSubroles = {
  StandardWindow: "AXStandardWindow",
  Dialog: "AXDialog",
  SystemDialog: "AXSystemDialog",
  FloatingWindow: "AXFloatingWindow",
  SystemFloatingWindow: "AXSystemFloatingWindow",
  IncrementArrow: "AXIncrementArrow",
  DecrementArrow: "AXDecrementArrow",
  IncrementPage: "AXIncrementPage",
  DecrementPage: "AXDecrementPage",
  SecureTextField: "AXSecureTextField",
  TableRow: "AXTableRow",
  OutlineRow: "AXOutlineRow",
  Expanded: "AXExpanded",
  Collapsed: "AXCollapsed",
  Unknown: "AXUnknown",
  ContentList: "AXContentList",
  DefinitionList: "AXDefinitionList",
  DescriptionList: "AXDescriptionList",
  Toggle: "AXToggle",
  Switch: "AXSwitch",
  SearchField: "AXSearchField",
  ApplicationDockItem: "AXApplicationDockItem",
  DocumentDockItem: "AXDocumentDockItem",
  FolderDockItem: "AXFolderDockItem",
  MinimizedWindowDockItem: "AXMinimizedWindowDockItem",
  URLDockItem: "AXURLDockItem",
  TrashDockItem: "AXTrashDockItem",
  SeparatorDockItem: "AXSeparatorDockItem",
  DockExtrasDockItem: "AXDockExtrasDockItem",
  LandmarkMain: "AXLandmarkMain",
  LandmarkNavigation: "AXLandmarkNavigation",
  LandmarkSearch: "AXLandmarkSearch",
  LandmarkComplementary: "AXLandmarkComplementary",
  LandmarkBanner: "AXLandmarkBanner",
  LandmarkForm: "AXLandmarkForm",
  LandmarkContentInfo: "AXLandmarkContentInfo",
  LandmarkRegion: "AXLandmarkRegion",
};

/** Accessibility action name strings (kAXPress etc. — from AXActionConstants.h) */
export const AXActions = {
  Press: "AXPress",
  Increment: "AXIncrement",
  Decrement: "AXDecrement",
  Confirm: "AXConfirm",
  Cancel: "AXCancel",
  ShowAlternateUI: "AXShowAlternateUI",
  ShowDefaultUI: "AXShowDefaultUI",
  Raise: "AXRaise",
  ShowMenu: "AXShowMenu",
  Pick: "AXPick",
};

/** Accessibility notification name strings (from AXNotificationConstants.h) */
export const AXNotifications = {
  MainWindowChanged: "AXMainWindowChanged",
  FocusedWindowChanged: "AXFocusedWindowChanged",
  FocusedUIElementChanged: "AXFocusedUIElementChanged",
  ApplicationActivated: "AXApplicationActivated",
  ApplicationDeactivated: "AXApplicationDeactivated",
  ApplicationHidden: "AXApplicationHidden",
  ApplicationShown: "AXApplicationShown",
  WindowCreated: "AXWindowCreated",
  WindowMoved: "AXWindowMoved",
  WindowResized: "AXWindowResized",
  WindowMiniaturized: "AXWindowMiniaturized",
  WindowDeminiaturized: "AXWindowDeminiaturized",
  DrawerCreated: "AXDrawerCreated",
  SheetCreated: "AXSheetCreated",
  HelpTagCreated: "AXHelpTagCreated",
  ValueChanged: "AXValueChanged",
  UIElementDestroyed: "AXUIElementDestroyed",
  ElementBusyChanged: "AXElementBusyChanged",
  MenuOpened: "AXMenuOpened",
  MenuClosed: "AXMenuClosed",
  MenuItemSelected: "AXMenuItemSelected",
  RowCountChanged: "AXRowCountChanged",
  RowExpanded: "AXRowExpanded",
  RowCollapsed: "AXRowCollapsed",
  SelectedChildrenChanged: "AXSelectedChildrenChanged",
  ResizedNotification: "AXResizedNotification",
  MovedNotification: "AXMovedNotification",
  CreatedNotification: "AXCreatedNotification",
  LayoutChanged: "AXLayoutChanged",
  AnnouncementRequested: "AXAnnouncementRequested",
  TitleChanged: "AXTitleChanged",
  SelectedTextChanged: "AXSelectedTextChanged",
  SelectedColumnsChanged: "AXSelectedColumnsChanged",
  SelectedRowsChanged: "AXSelectedRowsChanged",
};

/** Common attribute name strings (kAX*Attribute — from AXAttributeConstants.h) */
export const AXAttributes = {
  // General
  Role: "AXRole",
  Subrole: "AXSubrole",
  RoleDescription: "AXRoleDescription",
  Title: "AXTitle",
  Description: "AXDescription",
  Help: "AXHelp",
  Identifier: "AXIdentifier",
  // Value
  Value: "AXValue",
  ValueDescription: "AXValueDescription",
  MinValue: "AXMinValue",
  MaxValue: "AXMaxValue",
  ValueIncrement: "AXValueIncrement",
  AllowedValues: "AXAllowedValues",
  PlaceholderValue: "AXPlaceholderValue",
  // Text
  SelectedText: "AXSelectedText",
  SelectedTextRange: "AXSelectedTextRange",
  SelectedTextRanges: "AXSelectedTextRanges",
  VisibleCharacterRange: "AXVisibleCharacterRange",
  NumberOfCharacters: "AXNumberOfCharacters",
  InsertionPointLineNumber: "AXInsertionPointLineNumber",
  // State
  Enabled: "AXEnabled",
  Focused: "AXFocused",
  Hidden: "AXHidden",
  // Window
  Main: "AXMain",
  Minimized: "AXMinimized",
  Modal: "AXModal",
  DefaultButton: "AXDefaultButton",
  CancelButton: "AXCancelButton",
  // Application
  Frontmost: "AXFrontmost",
  MenuBar: "AXMenuBar",
  // Hierarchy
  Children: "AXChildren",
  ChildrenInNavigationOrder: "AXChildrenInNavigationOrder",
  Parent: "AXParent",
  TopLevelUIElement: "AXTopLevelUIElement",
  Windows: "AXWindows",
  FocusedWindow: "AXFocusedWindow",
  FocusedUIElement: "AXFocusedUIElement",
  MainWindow: "AXMainWindow",
  // Geometry
  Position: "AXPosition",
  Size: "AXSize",
  Frame: "AXFrame",
  // Link
  URL: "AXURL",
  TitleUIElement: "AXTitleUIElement",
  LinkedUIElements: "AXLinkedUIElements",
  // Table / Outline
  Rows: "AXRows",
  Columns: "AXColumns",
  SelectedRows: "AXSelectedRows",
  SelectedColumns: "AXSelectedColumns",
  VisibleRows: "AXVisibleRows",
  VisibleColumns: "AXVisibleColumns",
  Header: "AXHeader",
  Index: "AXIndex",
  // Misc
  Orientation: "AXOrientation",
  Busy: "AXElementIsBusy",
};

// ─── Utility Functions ──────────────────────────────────────────────

/**
 * Check if the current process has accessibility permissions.
 * @returns {boolean}
 */
export function isAccessibilityEnabled() {
  return !!appServices().AXIsProcessTrusted();
}

/**
 * Request accessibility permissions with a system prompt dialog.
 * If not already trusted, macOS will show the accessibility permission dialog.
 * @returns {boolean} Current trust status
 */
export function requestAccessibility() {
  const ax = appServices();
  const lib = cf();

  const dict = lib.CFDictionaryCreateMutable(null, 1, getCFTypeDictionaryKeyCallBacks(), getCFTypeDictionaryValueCallBacks());

  if (!dict || dict === 0n) {
    throw new AXError(kAXErrorFailure, "Failed to create CFDictionary for accessibility options");
  }

  try {
    lib.CFDictionarySetValue(dict, getAXTrustedCheckOptionPrompt(), getCFBooleanTrue());
    return !!ax.AXIsProcessTrustedWithOptions(dict);
  } finally {
    cfRelease(dict);
  }
}

/**
 * Release all shared framework handles and cached CFStrings.
 * Call this when done with the accessibility module.
 */
export function close() {
  for (const ref of _cfstrCache.values()) {
    cfRelease(ref);
  }
  _cfstrCache.clear();

  _kCFBooleanTrue = null;
  _kCFBooleanFalse = null;
  _kAXTrustedCheckOptionPrompt = null;
  _kCFTypeDictionaryKeyCallBacks = null;
  _kCFTypeDictionaryValueCallBacks = null;
  _cfStringTypeID = null;
  _cfArrayTypeID = null;
  _cfBooleanTypeID = null;
  _cfNumberTypeID = null;
  _axValueTypeID = null;

  if (_appServices) {
    _appServices = null;
  }
  if (_cf) {
    _cf = null;
  }
}

// ─── Exports ────────────────────────────────────────────────────────

export {
  // Error codes
  kAXErrorSuccess,
  kAXErrorFailure,
  kAXErrorIllegalArgument,
  kAXErrorInvalidUIElement,
  kAXErrorCannotComplete,
  kAXErrorAttributeUnsupported,
  kAXErrorActionUnsupported,
  kAXErrorAPIDisabled,
  kAXErrorNoValue,
  kAXErrorNotImplemented,
  kAXErrorParameterizedAttributeUnsupported,
  AX_ERROR_NAMES,
};

export default {
  AXApplication,
  AXSystem,
  AXElement,
  AXError,
  AXRoles,
  AXSubroles,
  AXActions,
  AXNotifications,
  AXAttributes,
  isAccessibilityEnabled,
  requestAccessibility,
  close,
};
