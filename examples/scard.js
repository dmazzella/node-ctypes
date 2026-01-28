/**
 * scard.js - PC/SC Smart Card API wrapper for Node.js using node-ctypes
 *
 * This module provides a JavaScript interface to the PC/SC smart card API
 */

import { CDLL, Structure, WinDLL, array, byref, c_char_p, c_long, c_ubyte, c_uint, c_void_p, create_string_buffer, ptrToBuffer, sizeof } from "node-ctypes";
import { platform } from "node:os";

// Platform detection
const PLATFORM = platform().toLowerCase();

// Type definitions
class c_scardhandle extends c_void_p {}
class c_scardcontext extends c_void_p {}

// Error codes
const E_SUCCESS = 0x00000000;
const E_TIMEOUT = 0x8010000a;
const E_READER_UNAVAILABLE = 0x80100017;
const E_NO_SERVICE = 0x8010001d;
const E_UNEXPECTED = 0x8010001f;
const E_NO_READERS_AVAILABLE = 0x8010002e;
const E_INVALID_HANDLE = 0x80100003;
const E_NO_SMARTCARD = 0x8010000c;

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
if (PLATFORM === "win32") {
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

// Card state constants (SCARD_*)
const SCARD_UNKNOWN = 0;
const SCARD_ABSENT = 1;
const SCARD_PRESENT = 2;
const SCARD_SWALLOWED = 3;
const SCARD_POWERED = 4;
const SCARD_NEGOTIABLE = 5;
const SCARD_SPECIFIC = 6;

// Other constants
const INFINITE = 0xffffffff;

class READER_STATE extends Structure {
  static _fields_ = [
    ["szReader", c_char_p],
    ["pvUserData", c_void_p],
    ["dwCurrentState", c_uint],
    ["dwEventState", c_uint],
    ["cbAtr", c_uint],
    ["rgbAtr", array(c_ubyte, 36)],
  ];
}

class SCARD_IO_REQUEST extends Structure {
  static _fields_ = [
    ["dwProtocol", c_uint],
    ["cbPciLength", c_uint],
  ];
}

// Load the appropriate library
let winscard;
if (PLATFORM === "win32") {
  winscard = new WinDLL("winscard.dll");
} else if (PLATFORM === "darwin") {
  winscard = new CDLL("/System/Library/Frameworks/PCSC.framework/PCSC");
} else {
  winscard = new CDLL("/usr/lib/libpcsclite.so.1");
}

const SCardEstablishContext = winscard.SCardEstablishContext;
SCardEstablishContext.argtypes = [c_uint, c_void_p, c_void_p, c_void_p];
SCardEstablishContext.restype = c_long;
SCardEstablishContext.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

let SCardListReaders = PLATFORM === "win32" ? winscard.SCardListReadersA : winscard.SCardListReaders;
SCardListReaders.argtypes = [c_void_p, c_char_p, c_char_p, c_void_p];
SCardListReaders.restype = c_long;
SCardListReaders.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardReleaseContext = winscard.SCardReleaseContext;
SCardReleaseContext.argtypes = [c_void_p];
SCardReleaseContext.restype = c_long;
SCardReleaseContext.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

let SCardGetStatusChange = PLATFORM === "win32" ? winscard.SCardGetStatusChangeA : winscard.SCardGetStatusChange;
SCardGetStatusChange.argtypes = [c_void_p, c_uint, c_void_p, c_uint];
SCardGetStatusChange.restype = c_long;
SCardGetStatusChange.errcheck = function (rv, func, args) {
  // E_TIMEOUT e E_UNEXPECTED sono casi validi, non errori
  const code = Number(rv) >>> 0;
  if (code !== E_SUCCESS && code !== E_TIMEOUT && code !== E_UNEXPECTED) {
    throw new SCardError(rv);
  }
  return rv;
};

let SCardConnect = PLATFORM === "win32" ? winscard.SCardConnectA : winscard.SCardConnect;
SCardConnect.argtypes = [c_void_p, c_char_p, c_uint, c_uint, c_void_p, c_void_p];
SCardConnect.restype = c_long;
SCardConnect.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardReconnect = winscard.SCardReconnect;
SCardReconnect.argtypes = [c_void_p, c_uint, c_uint, c_uint, c_void_p];
SCardReconnect.restype = c_long;
SCardReconnect.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardDisconnect = winscard.SCardDisconnect;
SCardDisconnect.argtypes = [c_void_p, c_uint];
SCardDisconnect.restype = c_long;
SCardDisconnect.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardBeginTransaction = winscard.SCardBeginTransaction;
SCardBeginTransaction.argtypes = [c_void_p];
SCardBeginTransaction.restype = c_long;
SCardBeginTransaction.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardEndTransaction = winscard.SCardEndTransaction;
SCardEndTransaction.argtypes = [c_void_p, c_uint];
SCardEndTransaction.restype = c_long;
SCardEndTransaction.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardTransmit = winscard.SCardTransmit;
SCardTransmit.argtypes = [c_void_p, c_void_p, c_void_p, c_uint, c_void_p, c_void_p, c_void_p];
SCardTransmit.restype = c_long;
SCardTransmit.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardGetAttrib = winscard.SCardGetAttrib;
SCardGetAttrib.argtypes = [c_void_p, c_uint, c_void_p, c_void_p];
SCardGetAttrib.restype = c_long;
SCardGetAttrib.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

let SCardStatus = PLATFORM === "win32" ? winscard.SCardStatusA : winscard.SCardStatus;
SCardStatus.argtypes = [c_void_p, c_char_p, c_void_p, c_void_p, c_void_p, c_char_p, c_void_p];
SCardStatus.restype = c_long;
SCardStatus.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

const SCardControl = winscard.SCardControl;
SCardControl.argtypes = [c_void_p, c_uint, c_void_p, c_uint, c_void_p, c_uint, c_void_p];
SCardControl.restype = c_long;
SCardControl.errcheck = function (rv, func, args) {
  if (rv != E_SUCCESS) {
    throw new SCardError(rv);
  }
  return rv;
};

// PCI structures for protocols
const pci = {};
// Attempt to read SCARD_PCI objects from the native library.
// Fallback to local SCARD_IO_REQUEST instances when symbols are unavailable.
try {
  // Try to obtain the in-DLL symbols (addresses)
  const addrT0 = winscard.symbol("g_rgSCardT0Pci");
  const addrT1 = winscard.symbol("g_rgSCardT1Pci");

  if (addrT0 && addrT0 !== 0n) {
    const buf = ptrToBuffer(addrT0, sizeof(SCARD_IO_REQUEST));
    pci[PROTOCOL_T0] = new SCARD_IO_REQUEST(buf);
  }
  if (addrT1 && addrT1 !== 0n) {
    const buf = ptrToBuffer(addrT1, sizeof(SCARD_IO_REQUEST));
    pci[PROTOCOL_T1] = new SCARD_IO_REQUEST(buf);
  }

  // If symbols not found, create local fallbacks
  if (!pci[PROTOCOL_T0]) {
    const scardPciT0 = new SCARD_IO_REQUEST();
    scardPciT0.dwProtocol = PROTOCOL_T0;
    scardPciT0.cbPciLength = sizeof(SCARD_IO_REQUEST);
    pci[PROTOCOL_T0] = scardPciT0;
  }
  if (!pci[PROTOCOL_T1]) {
    const scardPciT1 = new SCARD_IO_REQUEST();
    scardPciT1.dwProtocol = PROTOCOL_T1;
    scardPciT1.cbPciLength = sizeof(SCARD_IO_REQUEST);
    pci[PROTOCOL_T1] = scardPciT1;
  }
} catch (e) {
  // On any failure, create simple local fallbacks
  try {
    const scardPciT0 = new SCARD_IO_REQUEST();
    scardPciT0.dwProtocol = PROTOCOL_T0;
    scardPciT0.cbPciLength = sizeof(SCARD_IO_REQUEST);
    pci[PROTOCOL_T0] = scardPciT0;

    const scardPciT1 = new SCARD_IO_REQUEST();
    scardPciT1.dwProtocol = PROTOCOL_T1;
    scardPciT1.cbPciLength = sizeof(SCARD_IO_REQUEST);
    pci[PROTOCOL_T1] = scardPciT1;
  } catch (ee) {
    // leave pci empty
  }
}

const SCARD_PCI_T0 = pci[PROTOCOL_T0] || null;
const SCARD_PCI_T1 = pci[PROTOCOL_T1] || null;

// Error class
export class SCardError extends Error {
  constructor(code, description) {
    super(`SCardError: 0x${code.toString(16).toUpperCase()} - ${description || "Unknown error"}`);
    this.code = code;
    this.description = description;
  }
}

// Context class
export class Context {
  static establish(scope = SCOPE_USER) {
    const context = new c_scardcontext();
    SCardEstablishContext(scope, null, null, byref(context));
    return new Context(context);
  }

  constructor(hcontext) {
    this.hcontext = hcontext;
  }

  release() {
    if (this.hcontext) {
      SCardReleaseContext(this.hcontext.value || 0);
      this.hcontext = null;
    }
  }

  list_readers() {
    const readers_count = new c_uint(0);
    SCardListReaders(this.hcontext.value || 0, null, null, byref(readers_count));

    const readers = create_string_buffer(Number(readers_count.value) || 0);
    SCardListReaders(this.hcontext.value || 0, null, readers, byref(readers_count));

    if (readers.length === 0 || readers[0] === 0) {
      return [];
    }
    // Split null-terminated strings into individual Buffers (each NUL-terminated)
    const readerList = [];
    let start = 0;
    const bufLen = readers.length;
    while (start < bufLen && readers[start] !== 0) {
      // find next NUL
      let end = start;
      while (end < bufLen && readers[end] !== 0) end++;
      // include terminating NUL in slice
      const slice = readers.subarray(start, Math.min(end + 1, bufLen));
      readerList.push(slice);
      // advance to after the NUL
      start = end + 1;
      // skip any additional NULs
      while (start < bufLen && readers[start] === 0) start++;
    }

    return readerList;
  }

  get_status_change(in_reader_states = null, timeout = INFINITE) {
    if (!in_reader_states) {
      in_reader_states = [0];
    }

    const reader_count = in_reader_states.length;
    // Construct an array of READER_STATE instances.
    const out_reader_states = [];
    for (let j = 0; j < reader_count; j++) {
      out_reader_states[j] = new READER_STATE();
    }

    for (let i = 0; i < reader_count; i++) {
      const in_state = in_reader_states[i];
      const out_state = out_reader_states[i];

      let current_state = STATE_UNAWARE;
      let reader_name = in_state;

      if (typeof in_state === "number") {
        current_state = STATE_UNAWARE;
        if (in_state < this.list_readers().length) {
          reader_name = this.list_readers()[in_state];
        } else {
          reader_name = in_state.toString();
        }
      } else if (Array.isArray(in_state)) {
        current_state = in_state[1] || STATE_UNAWARE;
        reader_name = in_state[0];
      }

      // Ensure a null-terminated ASCII buffer for the reader name
      let readerBuf;
      if (Buffer.isBuffer(reader_name)) {
        if (reader_name.length === 0 || reader_name[reader_name.length - 1] !== 0) {
          const nb = Buffer.alloc(reader_name.length + 1);
          reader_name.copy(nb, 0, 0, reader_name.length);
          nb[reader_name.length] = 0;
          readerBuf = nb;
        } else {
          readerBuf = reader_name;
        }
      } else {
        readerBuf = Buffer.from(String(reader_name) + "\0", "ascii");
      }
      out_state.szReader = readerBuf;
      // keep a reference to the C-string buffer so it isn't GC'd while native code uses it
      out_state._readerBuf = readerBuf;
      out_state.pvUserData = null;
      out_state.dwCurrentState = current_state;
      // remember requested desired state for later checks
      out_state._desired = current_state;
      out_state.dwEventState = STATE_UNAWARE;
      out_state.cbAtr = 0;
    }

    // Call SCardGetStatusChange per-reader and
    // improve compatibility across platforms. If the caller passed
    // STATE_UNAWARE we first query the current event state (timeout=0)
    // and then perform the blocking wait using the provided timeout so
    // we actually wait for an insertion/removal event.
    let timed_out = true;
    const ctxVal = (this.hcontext && this.hcontext.value) || 0;
    for (let k = 0; k < reader_count; k++) {
      const out_state = out_reader_states[k];

      // Initial non-blocking query to populate current event state
      // Pass the Structure instance directly so the native function
      // receives a pointer to the struct buffer.
      SCardGetStatusChange(ctxVal, 0, byref(out_state), 1);

      // removed debug logging

      // observed current event state
      const observed = (out_state.dwEventState || 0) >>> 0;
      const desired = (out_state._desired || 0) >>> 0 || STATE_UNAWARE;

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
      out_state.dwCurrentState = observed || out_state.dwCurrentState;

      // Blocking wait for change
      const r = Number(SCardGetStatusChange(ctxVal, timeout, byref(out_state), 1)) >>> 0;
      if (r === E_SUCCESS) {
        timed_out = false;
      }
    }

    if (timed_out) {
      throw new SCardError(E_TIMEOUT);
    }

    return out_reader_states.map((state) => {
      // Return reader as Buffer (bytes) without trailing NUL
      let readerBuf = state.szReader || Buffer.alloc(0);
      if (Buffer.isBuffer(readerBuf) && readerBuf.length && readerBuf[readerBuf.length - 1] === 0) {
        readerBuf = readerBuf.subarray(0, readerBuf.length - 1);
      }
      const eventState = state.dwEventState || 0;
      const cbAtr = state.cbAtr || 0;
      const atrSlice = Buffer.from(state.rgbAtr).subarray(0, cbAtr);
      return [readerBuf, eventState, Buffer.from(atrSlice)];
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
    this.active_protocol = new c_uint();
    this.hcard = new c_scardhandle();
  }

  connect(context, reader = 0, sharemode = SHARE_SHARED, preferred_protocols = PROTOCOL_Tx) {
    this.disconnect(); // Ensure clean state
    this.context = context;

    if (typeof reader === "number") {
      try {
        const readers = context.list_readers();
        if (reader < readers.length) {
          reader = readers[reader];
        } else {
          throw new Error(`Reader index ${reader} out of range`);
        }
      } catch (listError) {
        throw listError;
      }
    }

    // Use ASCII encoding and ensure null-terminated
    const reader_name = typeof reader === "string" ? Buffer.from(reader + "\0", "ascii") : reader;

    SCardConnect(context.hcontext.value || 0, reader_name, sharemode, preferred_protocols, byref(this.hcard), byref(this.active_protocol));

    // Protocol is now set in this.active_protocol.value
  }

  disconnect(disposition = LEAVE_CARD) {
    if (this.hcard && this.hcard.value) {
      try {
        SCardDisconnect(this.hcard.value || 0, disposition);
      } catch (e) {
        console.log("Warning: SCardDisconnect failed:", e.message);
      }
      this.context = null;
      this.hcard = new c_scardhandle();
    }
  }

  reconnect(sharemode = SHARE_SHARED, preferred_protocols = PROTOCOL_Tx, initialization = LEAVE_CARD) {
    const active_protocol = new c_uint(0);

    SCardReconnect(this.hcard.value || 0, sharemode, preferred_protocols, initialization, byref(active_protocol));

    this.active_protocol.value = active_protocol.value;
  }

  transmit(sendbuffer) {
    // Use PCI based on negotiated protocol when available (fall back to null)
    const sendPci = pci[this.active_protocol.value] || null;

    const recv_len = new c_uint(258);
    const ub_sendbuffer = Buffer.from(sendbuffer);
    const recvbuffer = Buffer.alloc(258);

    SCardTransmit(this.hcard.value || 0, sendPci, ub_sendbuffer, sendbuffer.length, null, recvbuffer, byref(recv_len));

    const actual_len = recv_len.value || 0;
    return recvbuffer.subarray(0, actual_len);
  }

  getAttribute(attr_id) {
    const attr_len = new c_uint(0);
    SCardGetAttrib(this.hcard.value || 0, attr_id, null, byref(attr_len));

    const attr_len_val = attr_len.value || 0;
    const attr = Buffer.alloc(attr_len_val);
    SCardGetAttrib(this.hcard.value || 0, attr_id, attr, byref(attr_len));

    return attr.subarray(0, attr_len.value || 0);
  }

  control(code, data, outbufsize = 4096) {
    const ub_recvbuffer = outbufsize > 0 ? Buffer.alloc(outbufsize) : null;
    const returned = new c_uint(0);

    SCardControl(this.hcard.value || 0, code, Buffer.from(data), data.length, ub_recvbuffer, outbufsize, byref(returned));

    const returned_val = returned.value || 0;
    return ub_recvbuffer ? ub_recvbuffer.subarray(0, returned_val) : Buffer.alloc(0);
  }

  begin_transaction() {
    if (this.hcard && this.hcard.value !== 0n) {
      SCardBeginTransaction(this.hcard.value || 0);
    }
  }

  end_transaction(disposition = LEAVE_CARD) {
    if (this.hcard && this.hcard.value !== 0n) {
      SCardEndTransaction(this.hcard.value || 0, disposition);
    }
  }

  status() {
    const reader_name_length = new c_uint(0);
    const state = new c_uint(0);
    const protocol = new c_uint(0);
    const atr_length = new c_uint(0);

    // First call to get lengths
    SCardStatus(this.hcard.value || 0, null, byref(reader_name_length), byref(state), byref(protocol), null, byref(atr_length));

    // Allocate buffers
    const reader_name = Buffer.alloc(reader_name_length.value);
    const atr = Buffer.alloc(atr_length.value);

    // Second call to get data (pass numeric handle and buffers)
    SCardStatus(this.hcard.value || 0, reader_name, byref(reader_name_length), byref(state), byref(protocol), atr, byref(atr_length));

    // return (state, protocol)
    return [state.value, protocol.value];
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
