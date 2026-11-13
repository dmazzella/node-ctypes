---
title: Smart card (PC/SC)
---

# Smart Card (PC/SC)

A Python-style PC/SC wrapper: establishes a context, lists the readers, waits for a card, connects to it, reads the ATR and exchanges APDUs.

**Platforms:** Windows (`winscard.dll`), macOS (`PCSC.framework`), Linux (`libpcsclite`) · **Library:** [scard.js](scard.js) · **Requires:** on Linux the `pcscd` service and `libpcsclite1`; a reader and a card to go past the reader list

## Run

```bash
node examples/cross-platform/smartcard/demo_scard.js
```

## Use the library

```javascript
import { establish_context, Card, SCOPE_USER, SHARE_SHARED, PROTOCOL_Tx } from "./scard.js";

const context = establish_context(SCOPE_USER);
const readers = context.list_readers(); // [] without readers
if (readers.length > 0) {
  const card = new Card();
  card.connect(context, readers[0], SHARE_SHARED, PROTOCOL_Tx);
  console.log("ATR:", card.atr.toString("hex"));
  console.log("response:", card.transmit(Buffer.from([0x00, 0x84, 0x00, 0x00, 0x08])).toString("hex"));
  card.disconnect();
}
context.release();
```

Errors are thrown as `SCardError`; `error.code` is the unsigned PC/SC code, comparable with the exported `E_*` constants, and `error.description` its name (`SCARD_E_UNKNOWN_READER`).

Reader names are UTF-8 bytes (`Buffer`, with their NUL) or strings: on Windows the `W` functions are used, so names outside the ANSI code page work too. `transmit()` accepts extended APDU responses (up to 65536 bytes plus SW1 SW2).

## Platform ABI

The types follow each PC/SC implementation:

| Platform | `DWORD` / `LONG`                  | Handles         | Notes                                                                  |
| -------- | --------------------------------- | --------------- | ---------------------------------------------------------------------- |
| Windows  | 32-bit                            | pointer-sized   | UTF-16 `W` functions, `MAX_ATR_SIZE` 36, `SCARD_*` card states 0–6     |
| macOS    | 32-bit                            | 32-bit          | packed structures (`_pack_ = 1`), `SCardControl132`, `MAX_ATR_SIZE` 33 |
| Linux    | `unsigned long` / `long` (64-bit) | `long` (64-bit) | pcsclite, `MAX_ATR_SIZE` 33, `SCARD_*` card states as bit flags        |

## node-ctypes features used

`CDLL` / `WinDLL` per platform · `Structure` with `_pack_`, a `POINTER(TCHAR)` field set with `cast()` and a `c_ubyte * MAX_ATR_SIZE` array (`READER_STATE`) · type aliases chosen per platform (`DWORD`, `LONG`, `SCARDCONTEXT`) · `POINTER(T)` argtypes · `errcheck` · `SCARD_IO_REQUEST.in_dll()` for the exported PCI globals · `byref()`
