/**
 * scard.js - PC/SC Smart Card API wrapper for Node.js using node-ctypes
 *
 * This module provides a JavaScript interface to the PC/SC smart card API
 */

import { CDLL, POINTER, Structure, WinDLL, array, byref, c_char, c_int32, c_long, c_size_t, c_ubyte, c_uint16, c_uint32, c_ulong, c_void_p, cast, sizeof } from "node-ctypes";
import { platform } from "node:os";

// Platform detection
const PLATFORM = platform().toLowerCase();
const WINDOWS = PLATFORM === "win32";

// Type definitions: the host ABI. pcsclite on Linux uses unsigned long / long
// (64-bit on 64-bit systems), macOS 32-bit integers, Windows DWORD / LONG and
// pointer-sized handles.
const DWORD = PLATFORM === "linux" ? c_ulong : c_uint32;
const LONG = PLATFORM === "linux" ? c_long : c_int32;
const SCARDCONTEXT = WINDOWS ? c_size_t : LONG;
const SCARDHANDLE = SCARDCONTEXT;
// Text: UTF-16 on Windows (the W functions), UTF-8 elsewhere.
const TCHAR = WINDOWS ? c_uint16 : c_char;
const LPTSTR = POINTER(TCHAR);
const ENCODING = WINDOWS ? "utf16le" : "utf8";
const MAX_ATR_SIZE = WINDOWS ? 36 : 33;

// Error codes
const E_SUCCESS = 0x00000000;
const E_CANCELLED = 0x80100002;
const E_INSUFFICIENT_BUFFER = 0x80100008;
const E_TIMEOUT = 0x8010000a;
const E_READER_UNAVAILABLE = 0x80100017;
const E_NO_SERVICE = 0x8010001d;
const E_UNEXPECTED = 0x8010001f;
const E_NO_READERS_AVAILABLE = 0x8010002e;
const E_INVALID_HANDLE = 0x80100003;
const E_NO_SMARTCARD = 0x8010000c;

// Names of the PC/SC result codes, for SCardError messages.
const ERROR_NAMES = {
  0x80100001: "SCARD_F_INTERNAL_ERROR",
  0x80100002: "SCARD_E_CANCELLED",
  0x80100003: "SCARD_E_INVALID_HANDLE",
  0x80100004: "SCARD_E_INVALID_PARAMETER",
  0x80100005: "SCARD_E_INVALID_TARGET",
  0x80100006: "SCARD_E_NO_MEMORY",
  0x80100007: "SCARD_F_WAITED_TOO_LONG",
  0x80100008: "SCARD_E_INSUFFICIENT_BUFFER",
  0x80100009: "SCARD_E_UNKNOWN_READER",
  0x8010000a: "SCARD_E_TIMEOUT",
  0x8010000b: "SCARD_E_SHARING_VIOLATION",
  0x8010000c: "SCARD_E_NO_SMARTCARD",
  0x8010000d: "SCARD_E_UNKNOWN_CARD",
  0x8010000e: "SCARD_E_CANT_DISPOSE",
  0x8010000f: "SCARD_E_PROTO_MISMATCH",
  0x80100010: "SCARD_E_NOT_READY",
  0x80100011: "SCARD_E_INVALID_VALUE",
  0x80100012: "SCARD_E_SYSTEM_CANCELLED",
  0x80100013: "SCARD_F_COMM_ERROR",
  0x80100014: "SCARD_F_UNKNOWN_ERROR",
  0x80100015: "SCARD_E_INVALID_ATR",
  0x80100016: "SCARD_E_NOT_TRANSACTED",
  0x80100017: "SCARD_E_READER_UNAVAILABLE",
  0x80100018: "SCARD_P_SHUTDOWN",
  0x80100019: "SCARD_E_PCI_TOO_SMALL",
  0x8010001a: "SCARD_E_READER_UNSUPPORTED",
  0x8010001b: "SCARD_E_DUPLICATE_READER",
  0x8010001c: "SCARD_E_CARD_UNSUPPORTED",
  0x8010001d: "SCARD_E_NO_SERVICE",
  0x8010001e: "SCARD_E_SERVICE_STOPPED",
  0x8010001f: "SCARD_E_UNEXPECTED",
  0x80100022: "SCARD_E_UNSUPPORTED_FEATURE",
  0x8010002e: "SCARD_E_NO_READERS_AVAILABLE",
  0x8010002f: "SCARD_E_COMM_DATA_LOST",
  0x80100031: "SCARD_E_SERVER_TOO_BUSY",
  0x80100065: "SCARD_W_UNSUPPORTED_CARD",
  0x80100066: "SCARD_W_UNRESPONSIVE_CARD",
  0x80100067: "SCARD_W_UNPOWERED_CARD",
  0x80100068: "SCARD_W_RESET_CARD",
  0x80100069: "SCARD_W_REMOVED_CARD",
  0x8010006a: "SCARD_W_SECURITY_VIOLATION",
  0x8010006b: "SCARD_W_WRONG_CHV",
  0x8010006c: "SCARD_W_CHV_BLOCKED",
  0x8010006d: "SCARD_W_EOF",
  0x8010006e: "SCARD_W_CANCELLED_BY_USER",
};

// Scope constants
const SCOPE_USER = 0;
const SCOPE_TERMINAL = 1;
const SCOPE_SYSTEM = 2;

// Share mode constants
const SHARE_EXCLUSIVE = 1;
const SHARE_SHARED = 2;
const SHARE_DIRECT = 3;

// Protocol constants
const PROTOCOL_UNDEFINED = 0;
const PROTOCOL_UNSET = 0;
const PROTOCOL_T0 = 1;
const PROTOCOL_T1 = 2;
const PROTOCOL_Tx = 3;
const PROTOCOL_ANY = 3;
// Platform-specific protocol extras
let PROTOCOL_RAW;
let PROTOCOL_DEFAULT;
let PROTOCOL_OPTIMAL;
let PROTOCOL_T15 = undefined;
if (WINDOWS) {
  PROTOCOL_RAW = 0x10000;
  PROTOCOL_DEFAULT = 0x80000000;
  PROTOCOL_OPTIMAL = 0;
} else {
  PROTOCOL_RAW = 4;
  PROTOCOL_T15 = 8;
}

// Disposition constants
const LEAVE_CARD = 0;
const RESET_CARD = 1;
const UNPOWER_CARD = 2;
const EJECT_CARD = 3;

// State constants
const STATE_UNAWARE = 0x00000000;
const STATE_IGNORE = 0x00000001;
const STATE_CHANGED = 0x00000002;
const STATE_UNKNOWN = 0x00000004;
const STATE_UNAVAILABLE = 0x00000008;
const STATE_EMPTY = 0x00000010;
const STATE_PRESENT = 0x00000020;
const STATE_ATRMATCH = 0x00000040;
const STATE_EXCLUSIVE = 0x00000080;
const STATE_INUSE = 0x00000100;
const STATE_MUTE = 0x00000200;
const STATE_UNPOWERED = 0x00000400;

// Attribute constants
const ATTR_ATR_STRING = (9 << 16) | 0x0303;

// SCARD class/attribute constants
const SCARD_CLASS_IFD_PROTOCOL = 8;
const SCARD_ATTR_CURRENT_PROTOCOL_TYPE = (SCARD_CLASS_IFD_PROTOCOL << 16) + 0x0201;

// Card state constants (SCARD_*, the state of SCardStatus): an enumeration on
// Windows, bit flags in pcsclite and macOS.
const SCARD_UNKNOWN = WINDOWS ? 0 : 0x0001;
const SCARD_ABSENT = WINDOWS ? 1 : 0x0002;
const SCARD_PRESENT = WINDOWS ? 2 : 0x0004;
const SCARD_SWALLOWED = WINDOWS ? 3 : 0x0008;
const SCARD_POWERED = WINDOWS ? 4 : 0x0010;
const SCARD_NEGOTIABLE = WINDOWS ? 5 : 0x0020;
const SCARD_SPECIFIC = WINDOWS ? 6 : 0x0040;

// Other constants
const INFINITE = 0xffffffff;
// Response buffer of SCardTransmit: an extended APDU response (65536 bytes) and SW1 SW2.
const MAX_RESPONSE_SIZE = 65538;

// macOS PCSC.framework packs its structures (#pragma pack(1)).
class READER_STATE extends Structure {
  static _pack_ = PLATFORM === "darwin" ? 1 : null;
  static _fields_ = [
    ["szReader", LPTSTR],
    ["pvUserData", c_void_p],
    ["dwCurrentState", DWORD],
    ["dwEventState", DWORD],
    ["cbAtr", DWORD],
    ["rgbAtr", array(c_ubyte, MAX_ATR_SIZE)],
  ];
}

class SCARD_IO_REQUEST extends Structure {
  static _pack_ = PLATFORM === "darwin" ? 1 : null;
  static _fields_ = [
    ["dwProtocol", DWORD],
    ["cbPciLength", DWORD],
  ];
}

// Load the appropriate library
let winscard;
if (WINDOWS) {
  winscard = new WinDLL("winscard.dll");
} else if (PLATFORM === "darwin") {
  winscard = new CDLL("/System/Library/Frameworks/PCSC.framework/PCSC");
} else {
  // Soname: found by the dynamic linker (/usr/lib, /usr/lib/<arch>-linux-gnu, ...)
  winscard = new CDLL("libpcsclite.so.1");
}

/** PC/SC result as the unsigned 32-bit code of the E_* constants (LONG results are signed). */
function result_code(rv) {
  return Number(BigInt.asUintN(32, BigInt(rv)));
}

/** errcheck: throws SCardError unless the result is E_SUCCESS or one of `allowed`; returns the code. */
function check(...allowed) {
  return function (rv, func, args) {
    const code = result_code(rv);
    if (code !== E_SUCCESS && !allowed.includes(code)) {
      throw new SCardError(code);
    }
    return code;
  };
}

const SCardEstablishContext = winscard.SCardEstablishContext;
// LONG SCardEstablishContext(DWORD dwScope, LPCVOID pvRes1, LPCVOID pvRes2, LPSCARDCONTEXT phContext)
SCardEstablishContext.argtypes = [DWORD, c_void_p, c_void_p, POINTER(SCARDCONTEXT)];
SCardEstablishContext.restype = LONG;
SCardEstablishContext.errcheck = check();

const SCardListReaders = WINDOWS ? winscard.SCardListReadersW : winscard.SCardListReaders;
// LONG SCardListReaders(SCARDCONTEXT hContext, LPCTSTR mszGroups, LPTSTR mszReaders, LPDWORD pcchReaders)
SCardListReaders.argtypes = [SCARDCONTEXT, LPTSTR, LPTSTR, POINTER(DWORD)];
SCardListReaders.restype = LONG;
// No reader is an empty list, not an error (pcsclite reports E_NO_READERS_AVAILABLE).
SCardListReaders.errcheck = check(E_NO_READERS_AVAILABLE, E_INSUFFICIENT_BUFFER);

const SCardReleaseContext = winscard.SCardReleaseContext;
SCardReleaseContext.argtypes = [SCARDCONTEXT];
SCardReleaseContext.restype = LONG;
SCardReleaseContext.errcheck = check();

const SCardGetStatusChange = WINDOWS ? winscard.SCardGetStatusChangeW : winscard.SCardGetStatusChange;
// LONG SCardGetStatusChange(SCARDCONTEXT hContext, DWORD dwTimeout, LPSCARD_READERSTATE rgReaderStates, DWORD cReaders)
SCardGetStatusChange.argtypes = [SCARDCONTEXT, DWORD, POINTER(READER_STATE), DWORD];
SCardGetStatusChange.restype = LONG;
// E_TIMEOUT e E_UNEXPECTED sono casi validi, non errori
SCardGetStatusChange.errcheck = check(E_TIMEOUT, E_UNEXPECTED);

const SCardConnect = WINDOWS ? winscard.SCardConnectW : winscard.SCardConnect;
// LONG SCardConnect(SCARDCONTEXT, LPCTSTR, DWORD, DWORD, LPSCARDHANDLE, LPDWORD)
SCardConnect.argtypes = [SCARDCONTEXT, LPTSTR, DWORD, DWORD, POINTER(SCARDHANDLE), POINTER(DWORD)];
SCardConnect.restype = LONG;
SCardConnect.errcheck = check();

const SCardReconnect = winscard.SCardReconnect;
// LONG SCardReconnect(SCARDHANDLE, DWORD, DWORD, DWORD, LPDWORD pdwActiveProtocol)
SCardReconnect.argtypes = [SCARDHANDLE, DWORD, DWORD, DWORD, POINTER(DWORD)];
SCardReconnect.restype = LONG;
SCardReconnect.errcheck = check();

const SCardDisconnect = winscard.SCardDisconnect;
SCardDisconnect.argtypes = [SCARDHANDLE, DWORD];
SCardDisconnect.restype = LONG;
SCardDisconnect.errcheck = check();

const SCardBeginTransaction = winscard.SCardBeginTransaction;
SCardBeginTransaction.argtypes = [SCARDHANDLE];
SCardBeginTransaction.restype = LONG;
SCardBeginTransaction.errcheck = check();

const SCardEndTransaction = winscard.SCardEndTransaction;
SCardEndTransaction.argtypes = [SCARDHANDLE, DWORD];
SCardEndTransaction.restype = LONG;
SCardEndTransaction.errcheck = check();

const SCardTransmit = winscard.SCardTransmit;
// LONG SCardTransmit(SCARDHANDLE, LPCSCARD_IO_REQUEST, LPCBYTE, DWORD, LPSCARD_IO_REQUEST, LPBYTE, LPDWORD)
SCardTransmit.argtypes = [SCARDHANDLE, POINTER(SCARD_IO_REQUEST), c_void_p, DWORD, POINTER(SCARD_IO_REQUEST), c_void_p, POINTER(DWORD)];
SCardTransmit.restype = LONG;
SCardTransmit.errcheck = check();

const SCardGetAttrib = winscard.SCardGetAttrib;
// LONG SCardGetAttrib(SCARDHANDLE, DWORD dwAttrId, LPBYTE pbAttr, LPDWORD pcbAttrLen)
SCardGetAttrib.argtypes = [SCARDHANDLE, DWORD, c_void_p, POINTER(DWORD)];
SCardGetAttrib.restype = LONG;
SCardGetAttrib.errcheck = check(E_INSUFFICIENT_BUFFER);

const SCardStatus = WINDOWS ? winscard.SCardStatusW : winscard.SCardStatus;
// LONG SCardStatus(SCARDHANDLE, LPTSTR szReaderName, LPDWORD pcchReaderLen, LPDWORD pdwState, LPDWORD pdwProtocol, LPBYTE pbAtr, LPDWORD pcbAtrLen)
SCardStatus.argtypes = [SCARDHANDLE, LPTSTR, POINTER(DWORD), POINTER(DWORD), POINTER(DWORD), c_void_p, POINTER(DWORD)];
SCardStatus.restype = LONG;
SCardStatus.errcheck = check(E_INSUFFICIENT_BUFFER);

// macOS: SCardControl is the legacy five-argument version, SCardControl132 the standard one.
const SCardControl = PLATFORM === "darwin" ? winscard.SCardControl132 : winscard.SCardControl;
// LONG SCardControl(SCARDHANDLE, DWORD dwControlCode, LPCVOID pbSendBuffer, DWORD cbSendLength, LPVOID pbRecvBuffer, DWORD cbRecvLength, LPDWORD lpBytesReturned)
SCardControl.argtypes = [SCARDHANDLE, DWORD, c_void_p, DWORD, c_void_p, DWORD, POINTER(DWORD)];
SCardControl.restype = LONG;
SCardControl.errcheck = check();

// PCI structures for protocols: the library's exported globals
// (Python: SCARD_IO_REQUEST.in_dll(winscard, "g_rgSCardT0Pci")), with local
// fallbacks when the symbols are unavailable.
const pci = {};
for (const [protocol, symbol] of [
  [PROTOCOL_T0, "g_rgSCardT0Pci"],
  [PROTOCOL_T1, "g_rgSCardT1Pci"],
  [PROTOCOL_RAW, "g_rgSCardRawPci"],
]) {
  try {
    pci[protocol] = SCARD_IO_REQUEST.in_dll(winscard, symbol);
  } catch {
    pci[protocol] = new SCARD_IO_REQUEST(protocol, sizeof(SCARD_IO_REQUEST));
  }
}

const SCARD_PCI_T0 = pci[PROTOCOL_T0] || null;
const SCARD_PCI_T1 = pci[PROTOCOL_T1] || null;
const SCARD_PCI_RAW = pci[PROTOCOL_RAW] || null;

/** A reader name (Buffer of UTF-8 bytes, with or without its NUL, or string) in the native encoding, NUL-terminated. */
function native_name(name) {
  const text = Buffer.isBuffer(name) ? name.toString("utf8").replace(/\0+$/, "") : String(name);
  return Buffer.from(text + "\0", ENCODING);
}

/**
 * Output of the two-call pattern: the first call returns the length (in
 * TCHARs or bytes), the second fills the buffer. The length can grow in
 * between (a reader connected meanwhile): E_INSUFFICIENT_BUFFER, retry.
 */
function read_buffer(invoke, unit = 1) {
  const length = new DWORD(0);
  invoke(null, length);
  for (let attempt = 0; attempt < 4; attempt++) {
    const size = Number(length.value) * unit;
    if (size === 0) return Buffer.alloc(0);
    const buffer = Buffer.alloc(size);
    if (invoke(buffer, length) === E_INSUFFICIENT_BUFFER) continue;
    return buffer.subarray(0, Math.min(Number(length.value) * unit, size));
  }
  throw new SCardError(E_INSUFFICIENT_BUFFER);
}

// Error class
export class SCardError extends Error {
  constructor(code, description) {
    // LONG results are signed on some platforms: compare codes as unsigned
    // 32-bit numbers, like the E_* constants.
    code = result_code(code);
    description ??= ERROR_NAMES[code];
    super(`SCardError: 0x${code.toString(16).toUpperCase()} - ${description || "Unknown error"}`);
    this.code = code;
    this.description = description;
  }
}

// Context class
export class Context {
  static establish(scope = SCOPE_USER) {
    const context = new SCARDCONTEXT();
    SCardEstablishContext(scope, null, null, byref(context));
    return new Context(context);
  }

  constructor(hcontext) {
    this.hcontext = hcontext;
  }

  release() {
    if (this.hcontext) {
      SCardReleaseContext(this.hcontext.value);
      this.hcontext = null;
    }
  }

  list_readers() {
    const readers = read_buffer((buffer, length) => SCardListReaders(this.hcontext.value, null, buffer, byref(length)), sizeof(TCHAR));

    // Multi-string: names separated by NUL, list ended by an empty name
    // (Python: [name + b"\0" for name in readers.raw.split(b"\0") if name]).
    // Names are returned as UTF-8 bytes with their NUL.
    return readers
      .toString(ENCODING)
      .split("\0")
      .filter((name) => name)
      .map((name) => Buffer.from(name + "\0", "utf8"));
  }

  get_status_change(in_reader_states = null, timeout = INFINITE) {
    if (!in_reader_states) {
      in_reader_states = [0];
    }

    const reader_count = in_reader_states.length;
    const readers = in_reader_states.some((state) => typeof state === "number") ? this.list_readers() : [];
    // Construct an array of READER_STATE instances.
    const out_reader_states = [];
    const names = []; // reader names as UTF-8 bytes, without NUL
    const native_names = []; // kept alive while szReader points to them
    for (let i = 0; i < reader_count; i++) {
      const in_state = in_reader_states[i];
      const out_state = new READER_STATE();

      let current_state = STATE_UNAWARE;
      let reader_name = in_state;

      if (typeof in_state === "number") {
        current_state = STATE_UNAWARE;
        reader_name = in_state < readers.length ? readers[in_state] : in_state.toString();
      } else if (Array.isArray(in_state)) {
        current_state = in_state[1] || STATE_UNAWARE;
        reader_name = in_state[0];
      }

      const native = native_name(reader_name);
      native_names.push(native);
      names.push(Buffer.from(native.toString(ENCODING).slice(0, -1), "utf8"));
      out_state.szReader = cast(native, LPTSTR);
      out_state.pvUserData = null;
      out_state.dwCurrentState = current_state;
      // remember requested desired state for later checks
      out_state._desired = current_state;
      out_state.dwEventState = STATE_UNAWARE;
      out_state.cbAtr = 0;
      out_reader_states.push(out_state);
    }

    // Call SCardGetStatusChange per-reader and
    // improve compatibility across platforms. If the caller passed
    // STATE_UNAWARE we first query the current event state (timeout=0)
    // and then perform the blocking wait using the provided timeout so
    // we actually wait for an insertion/removal event.
    let timed_out = true;
    for (const out_state of out_reader_states) {
      // Initial non-blocking query to populate current event state
      SCardGetStatusChange(this.hcontext.value, 0, byref(out_state), 1);

      // observed current event state
      const observed = Number(out_state.dwEventState) >>> 0;
      const desired = out_state._desired >>> 0;

      // If caller requested STATE_UNAWARE, return the current observed
      // event state immediately.
      if (desired === STATE_UNAWARE) {
        timed_out = false;
        continue;
      }

      // If caller requested a specific state (not STATE_UNAWARE) and
      // it's already satisfied, return immediately for this reader.
      if ((observed & desired) !== 0) {
        timed_out = false;
        continue;
      }

      // Update current state to last observed state for blocking wait
      out_state.dwCurrentState = observed || Number(out_state.dwCurrentState);

      // Blocking wait for change
      if (SCardGetStatusChange(this.hcontext.value, timeout, byref(out_state), 1) === E_SUCCESS) {
        timed_out = false;
      }
    }

    // Keep the names alive until the calls above have used them.
    native_names.length = 0;

    if (timed_out) {
      throw new SCardError(E_TIMEOUT);
    }

    return out_reader_states.map((state, i) => {
      const eventState = Number(state.dwEventState);
      const cbAtr = Math.min(Number(state.cbAtr), MAX_ATR_SIZE);
      return [names[i], eventState, Buffer.from(Buffer.from(state.rgbAtr).subarray(0, cbAtr))];
    });
  }

  connect(reader = 0, sharemode = SHARE_SHARED, preferred_protocols = PROTOCOL_Tx) {
    const card = new Card();
    card.connect(this, reader, sharemode, preferred_protocols);
    return card;
  }
}

// Card class
export class Card {
  constructor() {
    this.context = null;
    this.active_protocol = new DWORD();
    this.hcard = new SCARDHANDLE();
  }

  connect(context, reader = 0, sharemode = SHARE_SHARED, preferred_protocols = PROTOCOL_Tx) {
    this.disconnect(); // Ensure clean state
    this.context = context;

    if (typeof reader === "number") {
      const readers = context.list_readers();
      if (reader >= readers.length) {
        throw new Error(`Reader index ${reader} out of range`);
      }
      reader = readers[reader];
    }

    SCardConnect(context.hcontext.value, native_name(reader), sharemode, preferred_protocols, byref(this.hcard), byref(this.active_protocol));

    // Protocol is now set in this.active_protocol.value
  }

  disconnect(disposition = LEAVE_CARD) {
    if (this.hcard.value) {
      try {
        SCardDisconnect(this.hcard.value, disposition);
      } catch (e) {
        console.log("Warning: SCardDisconnect failed:", e.message);
      }
      this.context = null;
      this.hcard = new SCARDHANDLE();
    }
  }

  reconnect(sharemode = SHARE_SHARED, preferred_protocols = PROTOCOL_Tx, initialization = LEAVE_CARD) {
    const active_protocol = new DWORD(0);

    SCardReconnect(this.hcard.value, sharemode, preferred_protocols, initialization, byref(active_protocol));

    this.active_protocol.value = active_protocol.value;
  }

  transmit(sendbuffer) {
    // PCI of the negotiated protocol
    const sendPci = pci[Number(this.active_protocol.value)];
    if (!sendPci) {
      throw new Error("The card has no negotiated T=0, T=1 or raw protocol: use control() for direct connections");
    }

    const recv_len = new DWORD(MAX_RESPONSE_SIZE);
    const ub_sendbuffer = Buffer.from(sendbuffer);
    const recvbuffer = Buffer.alloc(MAX_RESPONSE_SIZE);

    SCardTransmit(this.hcard.value, sendPci, ub_sendbuffer, ub_sendbuffer.length, null, recvbuffer, byref(recv_len));

    return recvbuffer.subarray(0, Math.min(Number(recv_len.value), MAX_RESPONSE_SIZE));
  }

  getAttribute(attr_id) {
    return read_buffer((buffer, length) => SCardGetAttrib(this.hcard.value, attr_id, buffer, byref(length)));
  }

  control(code, data, outbufsize = 4096) {
    const ub_recvbuffer = outbufsize > 0 ? Buffer.alloc(outbufsize) : null;
    const ub_sendbuffer = Buffer.from(data);
    const returned = new DWORD(0);

    SCardControl(this.hcard.value, code, ub_sendbuffer, ub_sendbuffer.length, ub_recvbuffer, outbufsize, byref(returned));

    return ub_recvbuffer ? ub_recvbuffer.subarray(0, Math.min(Number(returned.value), outbufsize)) : Buffer.alloc(0);
  }

  begin_transaction() {
    if (this.hcard.value) {
      SCardBeginTransaction(this.hcard.value);
    }
  }

  end_transaction(disposition = LEAVE_CARD) {
    if (this.hcard.value) {
      SCardEndTransaction(this.hcard.value, disposition);
    }
  }

  status() {
    const reader_name_length = new DWORD(0);
    const state = new DWORD(0);
    const protocol = new DWORD(0);
    const atr_length = new DWORD(0);

    // First call to get lengths
    SCardStatus(this.hcard.value, null, byref(reader_name_length), byref(state), byref(protocol), null, byref(atr_length));

    // Second call with buffers of those lengths (reader names in TCHARs),
    // again if they grew meanwhile.
    for (let attempt = 0; attempt < 4; attempt++) {
      const reader_name = Buffer.alloc(Number(reader_name_length.value) * sizeof(TCHAR));
      const atr = Buffer.alloc(Number(atr_length.value));
      if (SCardStatus(this.hcard.value, reader_name, byref(reader_name_length), byref(state), byref(protocol), atr, byref(atr_length)) !== E_INSUFFICIENT_BUFFER) {
        // return (state, protocol)
        return [Number(state.value), Number(protocol.value)];
      }
    }
    throw new SCardError(E_INSUFFICIENT_BUFFER);
  }

  getATR() {
    return this.getAttribute(ATTR_ATR_STRING);
  }

  // Convenience method for ATR
  get atr() {
    return this.getATR();
  }
}

// Utility function
export function establish_context(scope = SCOPE_USER) {
  return Context.establish(scope);
}

// Export constants
export {
  // attributes
  ATTR_ATR_STRING,
  EJECT_CARD,
  E_CANCELLED,
  E_INSUFFICIENT_BUFFER,
  E_INVALID_HANDLE,
  E_NO_READERS_AVAILABLE,
  E_NO_SERVICE,
  E_NO_SMARTCARD,
  E_READER_UNAVAILABLE,
  E_SUCCESS,
  E_TIMEOUT,
  E_UNEXPECTED,
  // timeouts / errors
  INFINITE,
  // dispositions
  LEAVE_CARD,
  MAX_ATR_SIZE,
  PROTOCOL_ANY,
  PROTOCOL_DEFAULT,
  PROTOCOL_OPTIMAL,
  PROTOCOL_RAW,
  PROTOCOL_T0,
  PROTOCOL_T1,
  PROTOCOL_T15,
  PROTOCOL_Tx,
  // protocols
  PROTOCOL_UNDEFINED,
  PROTOCOL_UNSET,
  RESET_CARD,
  SCARD_ABSENT,
  SCARD_ATTR_CURRENT_PROTOCOL_TYPE,
  // SCARD constants
  SCARD_CLASS_IFD_PROTOCOL,
  SCARD_NEGOTIABLE,
  // PCI
  SCARD_PCI_RAW,
  SCARD_PCI_T0,
  SCARD_PCI_T1,
  SCARD_POWERED,
  SCARD_PRESENT,
  SCARD_SPECIFIC,
  SCARD_SWALLOWED,
  SCARD_UNKNOWN,
  SCOPE_SYSTEM,
  SCOPE_TERMINAL,
  // scopes
  SCOPE_USER,
  SHARE_DIRECT,
  // share modes
  SHARE_EXCLUSIVE,
  SHARE_SHARED,
  STATE_ATRMATCH,
  STATE_CHANGED,
  STATE_EMPTY,
  STATE_EXCLUSIVE,
  STATE_IGNORE,
  STATE_INUSE,
  STATE_MUTE,
  STATE_PRESENT,
  STATE_UNAVAILABLE,
  // reader states
  STATE_UNAWARE,
  STATE_UNKNOWN,
  STATE_UNPOWERED,
  UNPOWER_CARD,
  pci,
};
