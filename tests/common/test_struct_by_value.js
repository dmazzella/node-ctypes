/**
 * Struct-by-value — Python ctypes parity.
 *
 * Dimostra l'uso di Structure/Union come argtype e restype di funzioni
 * FFI, incluso il layout quando la struct contiene array, bitfield, o
 * array-of-struct fields.
 *
 * Per i test end-to-end usiamo `div()` di libc (POSIX / C standard):
 *   div_t div(int numer, int denom);
 *   struct div_t { int quot; int rem; };
 * disponibile cross-platform (libSystem su macOS, libc.so.6 su Linux,
 * msvcrt.dll su Windows).
 */

import assert from "node:assert";
import { describe, it, before } from "node:test";
import * as ctypes from "node-ctypes";

describe("struct-by-value (Python ctypes parity, CORR-4)", function () {
  const { Structure, c_int, CDLL } = ctypes;

  class DivT extends Structure {
    static _fields_ = [
      ["quot", c_int],
      ["rem", c_int],
    ];
  }

  let libc;
  before(() => {
    // Su Windows (CI) `div` è esportato da msvcrt.
    const path = process.platform === "darwin"
      ? "/usr/lib/libSystem.dylib"
      : process.platform === "win32"
        ? "msvcrt.dll"
        : null; // Linux: path=null → Library(NULL) cerca il processo corrente (libc già linkata)
    libc = new CDLL(path);
  });

  it("div() returns a struct (restype=Structure)", function () {
    const div = libc.func("div", DivT, [c_int, c_int]);
    const r = div(17, 5);
    assert.strictEqual(r.quot, 3);
    assert.strictEqual(r.rem, 2);
  });

  it("div() with negative numerator returns signed quot/rem", function () {
    const div = libc.func("div", DivT, [c_int, c_int]);
    const r = div(-17, 5);
    // C standard: truncation toward zero → quot=-3, rem=-2
    assert.strictEqual(r.quot, -3);
    assert.strictEqual(r.rem, -2);
  });

  it("div() multiple calls don't share state", function () {
    const div = libc.func("div", DivT, [c_int, c_int]);
    const a = div(100, 7);
    const b = div(42, 6);
    assert.strictEqual(a.quot, 14);
    assert.strictEqual(a.rem, 2);
    assert.strictEqual(b.quot, 7);
    assert.strictEqual(b.rem, 0);
  });

  it("plain struct() helper as restype", function () {
    const { struct } = ctypes;
    const DivTDef = struct({ quot: c_int, rem: c_int });
    const div = libc.func("div", DivTDef, [c_int, c_int]);
    const r = div(25, 4);
    // Result via structDef path — è un buffer wrapper con .quot/.rem
    assert.strictEqual(DivTDef.get(r, "quot"), 6);
    assert.strictEqual(DivTDef.get(r, "rem"), 1);
  });
});

describe("struct-by-value — composite fields (layout / signature only)", function () {
  // Questi test verificano che strutture con field non-triviali
  // (array di primitive, bitfield, array-di-Structure) siano accettabili
  // come argtype/restype (signature construction), senza richiedere una
  // libreria C di test ad hoc per il full roundtrip.

  it("struct with array-of-primitive field", function () {
    const IntArr4 = ctypes.array(ctypes.c_int32, 4);
    class S extends ctypes.Structure {
      static _fields_ = [
        ["n", ctypes.c_int32],
        ["items", IntArr4],
      ];
    }
    // Layout: 4 (n) + 16 (items) = 20
    assert.strictEqual(S.size, 20);
    const libc = process.platform === "darwin"
      ? new ctypes.CDLL("/usr/lib/libSystem.dylib")
      : new ctypes.CDLL(null);
    try {
      libc.func("__node_ctypes_dummy_never_exists", ctypes.c_int32, [S]);
    } catch (e) {
      assert.ok(!/array-in-struct-by-value/.test(e.message));
    }
  });

  it("struct with array-of-Structure field", function () {
    class Point extends ctypes.Structure {
      static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
    }
    const PointArr3 = ctypes.array(Point, 3);
    class Polyline extends ctypes.Structure {
      static _fields_ = [
        ["count", ctypes.c_int32],
        ["pad", ctypes.c_int32],
        ["points", PointArr3],
      ];
    }
    // Layout: 4 + 4 + 3*8 = 32
    assert.strictEqual(Polyline.size, 32);
    const libc = process.platform === "darwin"
      ? new ctypes.CDLL("/usr/lib/libSystem.dylib")
      : new ctypes.CDLL(null);
    try {
      libc.func("__node_ctypes_dummy_never_exists", ctypes.c_int32, [Polyline]);
    } catch (e) {
      assert.ok(!/array-in-struct/.test(e.message) && !/richiede un native/.test(e.message));
    }
  });

  it("struct with bitfield (storage-cell grouping)", function () {
    // Python ctypes: bitfield consecutivi condividono la stessa storage-cell
    // — qui il native StructType aggregga la cell come c_uint32 singolo.
    class Flags extends ctypes.Structure {
      static _fields_ = [
        ["low", ctypes.bitfield(ctypes.c_uint32, 16)],
        ["high", ctypes.bitfield(ctypes.c_uint32, 16)],
      ];
    }
    assert.strictEqual(Flags.size, 4);
    const f = new Flags();
    f.low = 0xaaaa;
    f.high = 0xbbbb;
    assert.strictEqual(f.low, 0xaaaa);
    assert.strictEqual(f.high, 0xbbbb);
    const libc = process.platform === "darwin"
      ? new ctypes.CDLL("/usr/lib/libSystem.dylib")
      : new ctypes.CDLL(null);
    try {
      libc.func("__node_ctypes_dummy_never_exists", ctypes.c_uint32, [Flags]);
    } catch (e) {
      assert.ok(!/bitfield in struct-by-value/.test(e.message));
    }
  });
});
