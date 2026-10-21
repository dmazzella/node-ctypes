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

Errors are thrown as `SCardError`; `error.code` is the unsigned PC/SC code, comparable with the exported `E_*` constants.

## node-ctypes features used

`CDLL` / `WinDLL` per platform · `Structure` with `c_char_p` and `c_ubyte * 36` fields (`READER_STATE`) · `POINTER(T)` argtypes · `errcheck` · `SCARD_IO_REQUEST.in_dll()` for the exported PCI globals · `c_void_p` subclasses as handles · `byref()` · `create_string_buffer()`
