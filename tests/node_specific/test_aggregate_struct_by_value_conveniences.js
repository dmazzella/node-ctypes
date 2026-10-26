// Functional restypes and bitfield() declarations are Node convenience syntax.
import assert from "node:assert";
import { after, describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { LIBC } from "../cpython_parity/_support.js";
const { c_int } = ctypes;
const libc = new ctypes.CDLL(LIBC);
after(() => libc.close());

describe("Node functional aggregate return binding", function () {
  it("plain struct() helper as restype", function () {
    const { struct } = ctypes;
    const DivTDef = struct({ quot: c_int, rem: c_int });
    const div = libc.func("div", DivTDef, [c_int, c_int]);
    const r = div(25, 4);
    // Result via structDef path — è un buffer wrapper con .quot/.rem
    assert.strictEqual(DivTDef.get(r, "quot"), 6);
    assert.strictEqual(DivTDef.get(r, "rem"), 1);
  });

  it("bitfield() declarations retain their signature-only composite layout", function () {
    class Flags extends ctypes.Structure {
      static _fields_ = [
        ["low", ctypes.bitfield(ctypes.c_uint32, 16)],
        ["high", ctypes.bitfield(ctypes.c_uint32, 16)],
      ];
    }
    assert.strictEqual(ctypes.sizeof(Flags), 4);
    const f = new Flags();
    f.low = 0xaaaa;
    f.high = 0xbbbb;
    assert.strictEqual(f.low, 0xaaaa);
    assert.strictEqual(f.high, 0xbbbb);
    assert.strictEqual(typeof ctypes.CFUNCTYPE(ctypes.c_uint32, Flags), "function");
  });
});
