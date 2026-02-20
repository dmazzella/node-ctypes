// comtypes — COM Automation for node-ctypes
//
// A port of Python's comtypes library. Provides:
//   - GUID parsing/formatting
//   - HRESULT helpers
//   - COM interface definition (STDMETHOD, COMMETHOD, COMInterface)
//   - COM vtable dispatch (COMPointer with Proxy)
//   - CoInitializeEx / CoUninitialize / CoCreateInstance
//   - Pre-defined: IUnknown, IDispatch
//
// Usage:
//   import { CoInitializeEx, CoCreateInstance, IUnknown, COMInterface, STDMETHOD } from './comtypes.js';
//
//   CoInitializeEx();
//   const obj = CoCreateInstance(CLSID_ShellLink, IShellLinkW);
//   obj.SetDescription('Hello');
//   obj.Release();
//   CoUninitialize();

import { WinDLL, WINFUNCTYPE, Structure, array, sizeof, c_int32, c_uint32, c_uint16, c_uint8, c_void_p, c_wchar_p, ptrToBuffer, POINTER_SIZE } from "node-ctypes";

// ═══════════════════════════════════════════════════════════════════════
// GUID — COM Globally Unique Identifier (16 bytes)
// ═══════════════════════════════════════════════════════════════════════

export class GUID extends Structure {
  static _fields_ = [
    ["Data1", c_uint32],
    ["Data2", c_uint16],
    ["Data3", c_uint16],
    ["Data4", array(c_uint8, 8)],
  ];

  /**
   * Create a GUID from a string.
   * Accepts: "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" or without braces.
   *
   * @param {string} str
   * @returns {GUID}
   */
  static from(str) {
    const s = str.replace(/[{}-]/g, "");
    if (s.length !== 32) throw new Error(`Invalid GUID: "${str}"`);
    const guid = new GUID();
    guid.Data1 = parseInt(s.substring(0, 8), 16);
    guid.Data2 = parseInt(s.substring(8, 12), 16);
    guid.Data3 = parseInt(s.substring(12, 16), 16);
    for (let i = 0; i < 8; i++) {
      guid.Data4[i] = parseInt(s.substring(16 + i * 2, 18 + i * 2), 16);
    }
    return guid;
  }

  /**
   * Format this GUID as string.
   * @returns {string} e.g. "{00000000-0000-0000-C000-000000000046}"
   */
  toString() {
    const d1 = (this.Data1 >>> 0).toString(16).padStart(8, "0");
    const d2 = (this.Data2 & 0xffff).toString(16).padStart(4, "0");
    const d3 = (this.Data3 & 0xffff).toString(16).padStart(4, "0");
    let d4 = "";
    for (let i = 0; i < 8; i++) d4 += this.Data4[i].toString(16).padStart(2, "0");
    return `{${d1}-${d2}-${d3}-${d4.substring(0, 4)}-${d4.substring(4)}}`.toUpperCase();
  }
}

// Well-known IIDs
export const IID_IUnknown = GUID.from("{00000000-0000-0000-C000-000000000046}");
export const IID_IDispatch = GUID.from("{00020400-0000-0000-C000-000000000046}");
export const IID_IPersist = GUID.from("{0000010C-0000-0000-C000-000000000046}");
export const IID_IPersistFile = GUID.from("{0000010B-0000-0000-C000-000000000046}");

// ═══════════════════════════════════════════════════════════════════════
// HRESULT helpers
// ═══════════════════════════════════════════════════════════════════════

export const S_OK = 0;
export const S_FALSE = 1;
export const E_NOINTERFACE = 0x80004002 | 0;
export const E_POINTER = 0x80004003 | 0;
export const E_FAIL = 0x80004005 | 0;
export const E_INVALIDARG = 0x80070057 | 0;
export const E_NOTIMPL = 0x80004001 | 0;
export const E_OUTOFMEMORY = 0x8007000e | 0;

/** HRESULT is a signed 32-bit integer; negative = failure */
export function SUCCEEDED(hr) {
  return (hr | 0) >= 0;
}
export function FAILED(hr) {
  return (hr | 0) < 0;
}

/**
 * Throw if HRESULT indicates failure.
 * @param {number} hr
 * @param {string} [methodName]
 */
export function checkHR(hr, methodName) {
  if (FAILED(hr)) {
    const hex = "0x" + (hr >>> 0).toString(16).toUpperCase().padStart(8, "0");
    throw new Error(`COM error ${hex} in ${methodName || "?"}`);
  }
  return hr;
}

// ═══════════════════════════════════════════════════════════════════════
// STDMETHOD / COMMETHOD — method slot descriptors
// ═══════════════════════════════════════════════════════════════════════

/**
 * Describes a COM vtable method slot.
 *
 * @param {*} restype  - Return type (e.g. c_int32 for HRESULT, c_uint32, etc.)
 * @param {string} name - Method name
 * @param {Array} [argtypes] - Argument types (excluding the implicit `this` pointer)
 * @returns {{ restype, name, argtypes }}
 */
export function STDMETHOD(restype, name, argtypes = []) {
  return { restype, name, argtypes };
}

/**
 * Describes a COM method slot with IDL flags (future: in/out/retval handling).
 * For now, behaves like STDMETHOD but accepts the idlflags parameter for compatibility.
 *
 * @param {Array} idlflags - IDL flags (e.g. ['propget'], ['in', 'out'])
 * @param {*} restype
 * @param {string} name
 * @param {...Array} argspec - Argument specs as [flags, type, name] tuples
 * @returns {{ restype, name, argtypes, idlflags }}
 */
export function COMMETHOD(idlflags, restype, name, ...argspec) {
  const argtypes = argspec.map((spec) => {
    // argspec is ([flags], type, name) or (type)
    if (Array.isArray(spec)) {
      return spec[1]; // [flags, type, name] → type
    }
    return spec;
  });
  return { restype, name, argtypes, idlflags };
}

// Convenience: HRESULT type alias (just c_int32, but reads better in interface definitions)
export const HRESULT = c_int32;

// ═══════════════════════════════════════════════════════════════════════
// COMInterface — declarative interface definitions
// ═══════════════════════════════════════════════════════════════════════

/**
 * Define a COM interface.
 *
 * @param {Object} spec
 * @param {string} spec.name        - Interface name (e.g. 'IShellLinkW')
 * @param {string} spec.iid         - Interface IID as GUID string
 * @param {Object} [spec.extends]   - Parent interface definition (e.g. IUnknown)
 * @param {Array}  spec.methods     - Array of STDMETHOD/COMMETHOD descriptors
 * @returns {Object} Interface definition with _iid, _name, _allMethods, _methodIndex
 */
export function COMInterface(spec) {
  const parentMethods = spec.extends?._allMethods || [];
  const ownMethods = spec.methods || [];
  const allMethods = [...parentMethods, ...ownMethods];

  // Build method name → vtable index map
  const methodIndex = {};
  for (let i = 0; i < allMethods.length; i++) {
    methodIndex[allMethods[i].name] = i;
  }

  return Object.freeze({
    _name: spec.name,
    _iid: GUID.from(spec.iid),
    _extends: spec.extends || null,
    _ownMethods: ownMethods,
    _allMethods: allMethods,
    _methodIndex: methodIndex,
    _baseSlotCount: parentMethods.length,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Pre-defined interfaces: IUnknown, IDispatch
// ═══════════════════════════════════════════════════════════════════════

export const IUnknown = COMInterface({
  name: "IUnknown",
  iid: "{00000000-0000-0000-C000-000000000046}",
  methods: [STDMETHOD(HRESULT, "QueryInterface", [c_void_p, c_void_p]), STDMETHOD(c_uint32, "AddRef"), STDMETHOD(c_uint32, "Release")],
});

export const IDispatch = COMInterface({
  name: "IDispatch",
  iid: "{00020400-0000-0000-C000-000000000046}",
  extends: IUnknown,
  methods: [
    STDMETHOD(HRESULT, "GetTypeInfoCount", [c_void_p]),
    STDMETHOD(HRESULT, "GetTypeInfo", [c_uint32, c_uint32, c_void_p]),
    STDMETHOD(HRESULT, "GetIDsOfNames", [c_void_p, c_void_p, c_uint32, c_uint32, c_void_p]),
    STDMETHOD(HRESULT, "Invoke", [c_uint32, c_void_p, c_uint32, c_uint32, c_void_p, c_void_p, c_void_p, c_void_p]),
  ],
});

export const IPersist = COMInterface({
  name: "IPersist",
  iid: "{0000010C-0000-0000-C000-000000000046}",
  extends: IUnknown,
  methods: [STDMETHOD(HRESULT, "GetClassID", [c_void_p])],
});

export const IPersistFile = COMInterface({
  name: "IPersistFile",
  iid: "{0000010B-0000-0000-C000-000000000046}",
  extends: IPersist,
  methods: [STDMETHOD(HRESULT, "IsDirty"), STDMETHOD(HRESULT, "Load", [c_wchar_p, c_uint32]), STDMETHOD(HRESULT, "Save", [c_wchar_p, c_int32]), STDMETHOD(HRESULT, "SaveCompleted", [c_wchar_p]), STDMETHOD(HRESULT, "GetCurFile", [c_void_p])],
});

// ═══════════════════════════════════════════════════════════════════════
// COMPointer — wraps a raw COM pointer with vtable dispatch
// ═══════════════════════════════════════════════════════════════════════

// Cache WINFUNCTYPE prototypes: "restype|arg1|arg2|..." → factory
const _protoCache = new Map();

function _getProto(restype, argtypes) {
  // Key: combine restype and argtypes identity
  const key = [restype, ...argtypes].map((t) => t?.name || String(t)).join("|");
  let proto = _protoCache.get(key);
  if (!proto) {
    // All COM methods have an implicit `this` (c_void_p) as first arg
    proto = WINFUNCTYPE(restype, c_void_p, ...argtypes);
    _protoCache.set(key, proto);
  }
  return proto;
}

export class COMPointer {
  /**
   * @param {bigint} ptr - Raw COM interface pointer
   * @param {Object} interfaceDef - Interface definition from COMInterface()
   */
  constructor(ptr, interfaceDef) {
    this._ptr = ptr;
    this._interface = interfaceDef;
    this._vtable = null; // lazy-initialized

    // Return a Proxy that allows obj.MethodName(...) syntax
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Own properties and methods first
        if (prop in target || typeof prop === "symbol") {
          return Reflect.get(target, prop, receiver);
        }
        // Check if it's a COM method name
        if (typeof prop === "string" && prop in target._interface._methodIndex) {
          return (...args) => target.call(prop, ...args);
        }
        return undefined;
      },
    });
  }

  /** Lazily read the vtable and create WINFUNCTYPE dispatchers */
  _ensureVtable() {
    if (this._vtable) return;

    const methods = this._interface._allMethods;
    const slotSize = POINTER_SIZE; // 8 on x64, 4 on x86

    // Read vtable pointer (first pointer-sized bytes of object)
    const objBuf = ptrToBuffer(this._ptr, slotSize);
    const vtableAddr = slotSize === 8 ? objBuf.readBigUInt64LE(0) : BigInt(objBuf.readUInt32LE(0));

    // Read all vtable slots
    const vtableBuf = ptrToBuffer(vtableAddr, methods.length * slotSize);

    this._vtable = methods.map((m, i) => {
      const addr = slotSize === 8 ? vtableBuf.readBigUInt64LE(i * slotSize) : BigInt(vtableBuf.readUInt32LE(i * slotSize));
      const proto = _getProto(m.restype, m.argtypes);
      return proto(addr);
    });
  }

  /**
   * Call a COM method by name.
   * The `this` pointer is automatically prepended.
   *
   * @param {string} methodName
   * @param {...*} args
   * @returns {*} Method return value
   */
  call(methodName, ...args) {
    this._ensureVtable();
    const idx = this._interface._methodIndex[methodName];
    if (idx === undefined) {
      throw new Error(`Method "${methodName}" not found in ${this._interface._name}`);
    }
    return this._vtable[idx](this._ptr, ...args);
  }

  // ── IUnknown convenience methods ───────────────────────────────────

  /**
   * QueryInterface for a target interface.
   * @param {Object} targetInterface - Interface definition from COMInterface()
   * @returns {COMPointer} New pointer for the requested interface
   */
  QueryInterface(targetInterface) {
    const ppOut = Buffer.alloc(POINTER_SIZE);
    const hr = this.call("QueryInterface", targetInterface._iid, ppOut);
    checkHR(hr, `${this._interface._name}::QueryInterface(${targetInterface._name})`);
    const outPtr = POINTER_SIZE === 8 ? ppOut.readBigUInt64LE(0) : BigInt(ppOut.readUInt32LE(0));
    return new COMPointer(outPtr, targetInterface);
  }

  /** AddRef and return new refcount */
  AddRef() {
    return this.call("AddRef");
  }

  /** Release and return new refcount */
  Release() {
    return this.call("Release");
  }

  /** Raw pointer value */
  get ptr() {
    return this._ptr;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// COM Runtime — CoInitializeEx, CoUninitialize, CoCreateInstance
// ═══════════════════════════════════════════════════════════════════════

const _ole32 = new WinDLL("ole32.dll");

const _CoInitializeEx = _ole32.func("CoInitializeEx", c_int32, [c_void_p, c_uint32]);
const _CoUninitialize = _ole32.func("CoUninitialize", c_void_p, []);
const _CoCreateInstance = _ole32.func("CoCreateInstance", c_int32, [
  c_void_p, // rclsid
  c_void_p, // pUnkOuter
  c_uint32, // dwClsContext
  c_void_p, // riid
  c_void_p, // ppv (output)
]);

// COINIT flags
export const COINIT_MULTITHREADED = 0x0;
export const COINIT_APARTMENTTHREADED = 0x2;

// CLSCTX flags
export const CLSCTX_INPROC_SERVER = 0x1;
export const CLSCTX_INPROC_HANDLER = 0x2;
export const CLSCTX_LOCAL_SERVER = 0x4;
export const CLSCTX_ALL = 0x17;

/**
 * Initialize COM runtime.
 * @param {number} [flags=COINIT_MULTITHREADED]
 */
export function CoInitializeEx(flags = COINIT_MULTITHREADED) {
  const hr = _CoInitializeEx(null, flags);
  // S_OK=0 and S_FALSE=1 (already initialized) are both acceptable
  if (FAILED(hr)) checkHR(hr, "CoInitializeEx");
  return hr;
}

/** Uninitialize COM runtime. */
export function CoUninitialize() {
  _CoUninitialize();
}

/**
 * Create a COM object by CLSID and return it wrapped as a COMPointer.
 *
 * @param {string|Buffer} clsid    - CLSID as GUID string or Buffer
 * @param {Object} interfaceDef    - Target interface definition (e.g. IShellLinkW)
 * @param {number} [clsctx=CLSCTX_INPROC_SERVER]
 * @returns {COMPointer}
 */
export function CoCreateInstance(clsid, interfaceDef, clsctx = CLSCTX_INPROC_SERVER) {
  const clsidGuid = typeof clsid === "string" ? GUID.from(clsid) : clsid;
  const ppv = Buffer.alloc(POINTER_SIZE);

  const hr = _CoCreateInstance(clsidGuid, null, clsctx, interfaceDef._iid, ppv);
  const label = typeof clsid === "string" ? clsid : clsidGuid.toString();
  checkHR(hr, `CoCreateInstance(${label}, ${interfaceDef._name})`);

  const ptr = POINTER_SIZE === 8 ? ppv.readBigUInt64LE(0) : BigInt(ppv.readUInt32LE(0));
  return new COMPointer(ptr, interfaceDef);
}
