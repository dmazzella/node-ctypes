/**
 * Test Structs and Unions - Cross Platform
 * Tests struct/union creation, nested structs, bit fields, anonymous fields
 */

import assert, { strictEqual, throws } from "node:assert";
import { describe, it, before, after } from "node:test";
import * as ctypes from "node-ctypes";

describe("Structs and Unions", function () {
  describe("Basic Struct", function () {
    it("should create and use simple struct", function () {
      const Point = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
      });

      const p = Point.create({ x: 10, y: 20 });
      assert.strictEqual(Point.get(p, "x"), 10);
      assert.strictEqual(Point.get(p, "y"), 20);

      Point.set(p, "x", 100);
      assert.strictEqual(Point.get(p, "x"), 100);
    });

    it("should have correct size and alignment", function () {
      const Point = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
      });

      assert.strictEqual(Point.size, 8);
    });
  });

  describe("Nested Structs", function () {
    it("should support nested structs with dot notation", function () {
      const Point = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
      });

      const Rectangle = ctypes.struct({
        topLeft: Point,
        bottomRight: Point,
        color: ctypes.c_uint32,
      });

      const rect = Rectangle.create({
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
        color: 0xff0000,
      });

      assert.strictEqual(Rectangle.get(rect, "topLeft.x"), 0);
      assert.strictEqual(Rectangle.get(rect, "topLeft.y"), 0);
      assert.strictEqual(Rectangle.get(rect, "bottomRight.x"), 100);
      assert.strictEqual(Rectangle.get(rect, "bottomRight.y"), 200);
      assert.strictEqual(Rectangle.get(rect, "color"), 0xff0000);
    });
  });

  describe("Unions", function () {
    it("should create and use unions with Python-style syntax", function () {
      // Python: class IntOrFloat(Union): _fields_ = [("i", c_int32), ("f", c_float)]
      class IntOrFloat extends ctypes.Union {
        static _fields_ = [
          ["i", ctypes.c_int32],
          ["f", ctypes.c_float],
        ];
      }

      const u = new IntOrFloat();
      u.f = 3.14159;

      // Union shares memory - reading as int gives bit pattern
      assert(typeof u.i === "number");

      // Reading back as float gives original value
      assert(Math.abs(u.f - 3.14159) < 0.00001);
    });

    it("should have size of largest member", function () {
      // Python: class IntOrDouble(Union): _fields_ = [("i", c_int32), ("d", c_double)]
      class IntOrDouble extends ctypes.Union {
        static _fields_ = [
          ["i", ctypes.c_int32],  // 4 bytes
          ["d", ctypes.c_double], // 8 bytes
        ];
      }

      // sizeof() correctly accesses the class size
      assert.strictEqual(ctypes.sizeof(IntOrDouble), 8);
    });

    it("should support Python-style bitfield syntax with Union class", function () {
      // Python: class Flags(Union): _fields_ = [("low", c_uint32, 16), ("high", c_uint32, 16)]
      class Flags extends ctypes.Union {
        static _fields_ = [
          ["low", ctypes.c_uint32, 16],
          ["high", ctypes.c_uint32, 16],
        ];
      }

      const f = new Flags();
      f.low = 0xABCD;
      assert.strictEqual(f.low, 0xABCD);

      f.high = 0x1234;
      assert.strictEqual(f.high, 0x1234);
    });
  });

  describe("Bit Fields", function () {
    it("should support bit fields with Python-style syntax", function () {
      // Python: _fields_ = [("enabled", c_uint32, 1), ("mode", c_uint32, 3), ...]
      class Flags extends ctypes.Structure {
        static _fields_ = [
          ["enabled", ctypes.c_uint32, 1],
          ["mode", ctypes.c_uint32, 3],
          ["priority", ctypes.c_uint32, 4],
          ["reserved", ctypes.c_uint32, 24],
        ];
      }

      const f = new Flags({ enabled: 1, mode: 5, priority: 15 });

      assert.strictEqual(f.enabled, 1);
      assert.strictEqual(f.mode, 5);
      assert.strictEqual(f.priority, 15);
    });

    it("should handle bit field overflow correctly", function () {
      // Python: _fields_ = [("value", c_uint32, 3)]
      class Flags extends ctypes.Structure {
        static _fields_ = [
          ["value", ctypes.c_uint32, 3], // Max 7 (0b111)
        ];
      }

      const f = new Flags({ value: 15 }); // 0b1111 - overflow
      assert.strictEqual(f.value, 7); // Truncated to 0b111
    });

    it("should also support bitfield() helper function", function () {
      // Alternative syntax with bitfield() helper
      const Flags = ctypes.struct({
        enabled: ctypes.bitfield(ctypes.c_uint32, 1),
        mode: ctypes.bitfield(ctypes.c_uint32, 3),
      });

      const f = Flags.create({ enabled: 1, mode: 5 });

      assert.strictEqual(Flags.get(f, "enabled"), 1);
      assert.strictEqual(Flags.get(f, "mode"), 5);
    });
  });

  describe("Anonymous Fields", function () {
    it("should support anonymous union fields", function () {
      // Python: class Inner(Union): _fields_ = [("i", c_int32), ("f", c_float)]
      class Inner extends ctypes.Union {
        static _fields_ = [
          ["i", ctypes.c_int32],
          ["f", ctypes.c_float],
        ];
      }

      // Python: class Outer(Structure): _fields_ = [("tag", c_uint32), ("data", Inner)]; _anonymous_ = ["data"]
      class Outer extends ctypes.Structure {
        static _fields_ = [
          ["tag", ctypes.c_uint32],
          ["data", Inner],
        ];
        static _anonymous_ = ["data"];
      }

      const obj = new Outer({ tag: 1, i: 42 });

      // Anonymous field members are promoted to parent level
      assert.strictEqual(obj.i, 42);
      assert.strictEqual(obj.tag, 1);
    });

    it("should support nested anonymous structures", function () {
      const Coords = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
      });

      const Entity = ctypes.struct({
        id: ctypes.c_uint32,
        pos: { type: Coords, anonymous: true },
        health: ctypes.c_int32,
      });

      const ent = Entity.create({
        id: 1,
        x: 100,
        y: 200,
        health: 100,
      });

      assert.strictEqual(Entity.get(ent, "id"), 1);
      assert.strictEqual(Entity.get(ent, "x"), 100); // From anonymous Coords
      assert.strictEqual(Entity.get(ent, "y"), 200); // From anonymous Coords
      assert.strictEqual(Entity.get(ent, "health"), 100);
    });
  });

  describe("Packed Structs", function () {
    it("should support packed structs", function () {
      const Unpacked = ctypes.struct({
        a: ctypes.c_uint8,
        b: ctypes.c_uint32,
        c: ctypes.c_uint8,
      });

      const Packed = ctypes.struct(
        {
          a: ctypes.c_uint8,
          b: ctypes.c_uint32,
          c: ctypes.c_uint8,
        },
        { packed: true },
      );

      // Unpacked has padding for alignment
      assert(Unpacked.size >= 6); // At least 1 + 4 + 1

      // Packed has no padding
      assert.strictEqual(Packed.size, 6); // Exactly 1 + 4 + 1
    });

    // Python ctypes parity: `_pack_` è un intero (1,2,4,8,...) che limita
    // l'allineamento massimo dei campi, non un boolean.
    // Questi test bloccano eventuali regressioni sulla numeric-pack fix
    // del round 1 di ottimizzazione.
    it("should honor numeric _pack_ values (Python semantics)", function () {
      class P1 extends ctypes.Structure {
        static _pack_ = 1;
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_uint32]];
      }
      class P2 extends ctypes.Structure {
        static _pack_ = 2;
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_uint32]];
      }
      class P4 extends ctypes.Structure {
        static _pack_ = 4;
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_uint32]];
      }
      class NP extends ctypes.Structure {
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_uint32]];
      }
      assert.strictEqual(P1.size, 5, "_pack_=1 → 1 + 4 = 5");
      assert.strictEqual(P2.size, 6, "_pack_=2 → 1 + pad1 + 4 = 6");
      assert.strictEqual(P4.size, 8, "_pack_=4 → 1 + pad3 + 4 = 8 (pack>=nat align)");
      assert.strictEqual(NP.size, 8, "no _pack_ → naturale = 8");
    });

    it("should reject invalid _pack_ values", function () {
      assert.throws(() => {
        class Bad extends ctypes.Structure {
          static _pack_ = 3;
          static _fields_ = [["a", ctypes.c_uint8]];
        }
        Bad._buildStruct();
      }, /_pack_/);
    });

    // Propagazione di _pack_ attraverso struct nested.
    it("should propagate _pack_ to nested struct alignment", function () {
      class Inner extends ctypes.Structure {
        static _pack_ = 4;
        static _fields_ = [["a", ctypes.c_uint8], ["b", ctypes.c_uint32]];
      }
      class Outer1 extends ctypes.Structure {
        static _pack_ = 1;
        static _fields_ = [["i", ctypes.c_uint8], ["n", Inner]];
      }
      class Outer2 extends ctypes.Structure {
        static _pack_ = 2;
        static _fields_ = [["i", ctypes.c_uint8], ["n", Inner]];
      }
      class OuterN extends ctypes.Structure {
        static _fields_ = [["i", ctypes.c_uint8], ["n", Inner]];
      }
      assert.strictEqual(Inner.size, 8);
      assert.strictEqual(Outer1.size, 9,  "pack=1: i[1] + n[8]");
      assert.strictEqual(Outer2.size, 10, "pack=2: i[1] + pad[1] + n[8]");
      assert.strictEqual(OuterN.size, 12, "no pack: i[1] + pad[3] + n[8]");
    });
  });

  describe("Struct Arrays", function () {
    it("should support arrays in struct fields", function () {
      const IntArray10 = ctypes.array(ctypes.c_int32, 10);

      const Data = ctypes.struct({
        count: ctypes.c_int32,
        values: IntArray10,
      });

      const data = Data.create({
        count: 3,
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      });

      assert.strictEqual(Data.get(data, "count"), 3);

      // Access array field
      const values = Data.get(data, "values");
      assert.strictEqual(values[0], 1);
      assert.strictEqual(values[9], 10);
    });
  });

  describe("toObject() and fromObject()", function () {
    it("should convert struct to/from JavaScript object", function () {
      const Point = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
      });

      const Rectangle = ctypes.struct({
        topLeft: Point,
        bottomRight: Point,
      });

      const rect = Rectangle.create({
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
      });

      const obj = Rectangle.toObject(rect);
      assert.deepStrictEqual(obj, {
        topLeft: { x: 0, y: 0 },
        bottomRight: { x: 100, y: 200 },
      });
    });
  });

  describe("Subclassing compatibility", function () {
    it("should support class extends Structure with positional args and properties", function () {
      class PointCls extends ctypes.Structure {
        static _fields_ = [
          ["x", ctypes.c_int],
          ["y", ctypes.c_int],
        ];
      }

      const p = new PointCls(10, 20);
      assert.strictEqual(p.x, 10);
      assert.strictEqual(p.y, 20);

      const p2 = PointCls.create({ x: 1, y: 2 });
      assert.ok(p2 instanceof PointCls);
      assert.strictEqual(p2.x, 1);
    });

    it("should support anonymous nested fields via static _anonymous_", function () {
      const Inner = ctypes.struct({ a: ctypes.c_int32, b: ctypes.c_int32 });
      class OuterCls extends ctypes.Structure {
        static _fields_ = { inner: Inner, tag: ctypes.c_int32 };
        static _anonymous_ = ["inner"];
      }

      const o = new OuterCls({ a: 5, b: 6, tag: 9 });
      assert.strictEqual(o.a, 5);
      assert.strictEqual(o.b, 6);
      assert.strictEqual(o.tag, 9);
    });

    it("should support Union subclassing", function () {
      class UCls extends ctypes.Union {
        static _fields_ = [
          ["i", ctypes.c_int32],
          ["f", ctypes.c_float],
        ];
      }
      const u = UCls.create({ f: 2.5 });
      assert.ok(u.i !== undefined);
    });
  });

  // ─── POINTER() in Structure _fields_ ───
  // Python: class S(Structure): _fields_ = [("pData", POINTER(c_int32))]

  describe("POINTER in Structure _fields_", function () {
    it("should store and read NULL pointer field", function () {
      // Python: s = S(); assertFalse(bool(s.pData))
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class S extends ctypes.Structure {
        static _fields_ = [["pData", IntPtr]];
      }
      const s = new S();
      assert.strictEqual(s.pData.isNull, true);
      assert.strictEqual(s.pData.address, 0n);
    });

    it("should have correct struct size with POINTER field", function () {
      // Python: assertEqual(sizeof(S), 16 if ptr==8 else 8)
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class S extends ctypes.Structure {
        static _fields_ = [["value", ctypes.c_int32], ["pData", IntPtr]];
      }
      const expected = ctypes.POINTER_SIZE === 8 ? 16 : 8;
      assert.strictEqual(ctypes.sizeof(S), expected);
    });

    it("should assign via pointer() and read back", function () {
      // Python: val = c_int32(999); s.pData = pointer(val); assertEqual(s.pData[0], 999)
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class S extends ctypes.Structure {
        static _fields_ = [["pData", IntPtr]];
      }
      const val = new ctypes.c_int32(999);
      const s = new S();
      const p = ctypes.pointer(val);
      s.pData = p;
      assert.strictEqual(s.pData[0], 999);
    });

    it("should read .contents value", function () {
      // Python: assertEqual(s.pData.contents.value, 42)
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class S extends ctypes.Structure {
        static _fields_ = [["pData", IntPtr]];
      }
      const val = new ctypes.c_int32(42);
      const s = new S();
      s.pData = ctypes.pointer(val);
      assert.strictEqual(s.pData.contents, 42);
    });

    it("should modify through pointer field changes original", function () {
      // Python: s.pData[0] = 99; assertEqual(val.value, 99)
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class S extends ctypes.Structure {
        static _fields_ = [["pData", IntPtr]];
      }
      const val = new ctypes.c_int32(10);
      const s = new S();
      s.pData = ctypes.pointer(val);
      s.pData[0] = 99;
      assert.strictEqual(val.value, 99);
    });

    it("should support multiple POINTER fields", function () {
      // Python: struct with pInt and pDbl
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      const DblPtr = ctypes.POINTER(ctypes.c_double);
      class S extends ctypes.Structure {
        static _fields_ = [["pInt", IntPtr], ["pDbl", DblPtr]];
      }
      const iv = new ctypes.c_int32(10);
      const dv = new ctypes.c_double(3.14);
      const s = new S();
      s.pInt = ctypes.pointer(iv);
      s.pDbl = ctypes.pointer(dv);
      assert.strictEqual(s.pInt[0], 10);
      assert.ok(Math.abs(s.pDbl[0] - 3.14) < 0.01);
    });

    it("should support POINTER to struct in _fields_", function () {
      // Python: outer.pInner = pointer(inner); outer.pInner.contents.x
      class Inner extends ctypes.Structure {
        static _fields_ = [["x", ctypes.c_int32], ["y", ctypes.c_int32]];
      }
      const InnerPtr = ctypes.POINTER(Inner);
      class Outer extends ctypes.Structure {
        static _fields_ = [["pInner", InnerPtr]];
      }
      const inner = new Inner(100, 200);
      const outer = new Outer();
      outer.pInner = ctypes.pointer(inner);
      assert.strictEqual(outer.pInner.contents.x, 100);
      assert.strictEqual(outer.pInner.contents.y, 200);
    });
  });

  describe("POINTER in Union _fields_", function () {
    it("should support POINTER field in Union", function () {
      // Python: class U(Union): _fields_ = [("asInt", c_uint32), ("asPtr", POINTER(c_int32))]
      const IntPtr = ctypes.POINTER(ctypes.c_int32);
      class U extends ctypes.Union {
        static _fields_ = [["asInt", ctypes.c_uint32], ["asPtr", IntPtr]];
      }
      const u = new U();
      assert.strictEqual(u.asPtr.isNull, true);
      const expected = ctypes.POINTER_SIZE === 8 ? 8 : 4;
      assert.strictEqual(ctypes.sizeof(U), expected);
    });
  });
});

describe("Structure subclass custom methods", function () {
  // Regressione: metodi custom dichiarati in una Structure subclass che
  // leggono i field via `this.<name>` devono risolvere via Proxy.
  // Pre-fix: `method.bind(target)` saltava il field accessor → undefined → NaN.
  it("should resolve field reads inside custom methods via `this`", function () {
    class Point extends ctypes.Structure {
      static _fields_ = [
        ["x", ctypes.c_int32],
        ["y", ctypes.c_int32],
      ];
      mag2() {
        return this.x * this.x + this.y * this.y;
      }
      scaled(f) {
        return new Point({ x: this.x * f, y: this.y * f });
      }
    }
    const p = new Point({ x: 3, y: 4 });
    assert.strictEqual(p.mag2(), 25);
    const q = p.scaled(2);
    assert.strictEqual(q.x, 6);
    assert.strictEqual(q.y, 8);
  });
});

// ────────────────────────────────────────────────────────────────────
// Structure.from_buffer / from_buffer_copy / from_address
// (Python: class method to wrap or copy existing memory)
// ────────────────────────────────────────────────────────────────────

describe("Structure.from_buffer / from_buffer_copy / from_address", function () {
  class RECT extends ctypes.Structure {
    static _fields_ = [
      ["left", ctypes.c_int32],
      ["top", ctypes.c_int32],
      ["right", ctypes.c_int32],
      ["bottom", ctypes.c_int32],
    ];
  }

  it("from_buffer shares memory with source", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer(src);
    assert.strictEqual(r.left, 42);
    r.left = 999;
    assert.strictEqual(src.readInt32LE(0), 999, "writes propagate to source");
  });

  it("from_buffer with offset", function () {
    const src = Buffer.alloc(32);
    src.writeInt32LE(7, 16);
    const r = RECT.from_buffer(src, 16);
    assert.strictEqual(r.left, 7);
  });

  it("from_buffer rejects too-small source", function () {
    const tiny = Buffer.alloc(4);
    assert.throws(() => RECT.from_buffer(tiny), /too small/);
  });

  it("from_buffer_copy is independent of source", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer_copy(src);
    r.left = 99;
    assert.strictEqual(src.readInt32LE(0), 42, "source unchanged");
  });

  it("from_buffer_copy accepts Uint8Array", function () {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setInt32(0, 42, true);
    const r = RECT.from_buffer_copy(bytes);
    assert.strictEqual(r.left, 42);
  });

  it("from_address wraps a raw address (round-trip)", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(1234, 0);
    const addr = ctypes.addressof(src);
    const r = RECT.from_address(addr);
    assert.strictEqual(r.left, 1234);
  });

  it("Union.from_buffer works (inherited)", function () {
    class V extends ctypes.Union {
      static _fields_ = [
        ["as_int", ctypes.c_int32],
        ["as_float", ctypes.c_float],
      ];
    }
    const b = Buffer.alloc(4);
    b.writeFloatLE(3.14, 0);
    const v = V.from_buffer(b);
    assert.ok(Math.abs(v.as_float - 3.14) < 1e-6);
  });
});

// ────────────────────────────────────────────────────────────────────
// BigEndianStructure / LittleEndianStructure / *Union
// (Python: ctypes.BigEndianStructure + swapped accessors)
// ────────────────────────────────────────────────────────────────────

describe("BigEndianStructure / LittleEndianStructure", function () {
  const {
    BigEndianStructure, LittleEndianStructure, Structure,
    c_uint32, c_uint16, c_uint8, c_float, c_double, c_int64,
  } = ctypes;

  it("serializes scalar fields in big-endian byte order", function () {
    class H extends BigEndianStructure {
      static _fields_ = [
        ["magic", c_uint32],
        ["version", c_uint16],
        ["flags", c_uint8],
      ];
    }
    const h = new H();
    h.magic = 0x12345678;
    h.version = 0x0102;
    h.flags = 0xab;
    assert.strictEqual(h._buffer[0], 0x12);
    assert.strictEqual(h._buffer[1], 0x34);
    assert.strictEqual(h._buffer[2], 0x56);
    assert.strictEqual(h._buffer[3], 0x78);
    assert.strictEqual(h._buffer[4], 0x01);
    assert.strictEqual(h._buffer[5], 0x02);
    assert.strictEqual(h._buffer[6], 0xab);
    assert.strictEqual(h.magic, 0x12345678);
    assert.strictEqual(h.version, 0x0102);
    assert.strictEqual(h.flags, 0xab);
  });

  it("LittleEndianStructure matches native byte order on LE host", function () {
    class L extends LittleEndianStructure {
      static _fields_ = [["magic", c_uint32]];
    }
    const l = new L();
    l.magic = 0x12345678;
    assert.strictEqual(l._buffer[0], 0x78);
    assert.strictEqual(l._buffer[3], 0x12);
  });

  it("handles c_float / c_double in BE", function () {
    class F extends BigEndianStructure {
      static _fields_ = [
        ["f", c_float],
        ["d", c_double],
      ];
    }
    const f = new F();
    f.f = 3.14;
    f.d = 2.7182818284590451;
    assert.ok(Math.abs(f.f - 3.14) < 1e-6);
    assert.ok(Math.abs(f.d - 2.7182818284590451) < 1e-15);
    assert.strictEqual(f._buffer[0], 0x40);
  });

  it("handles c_int64 (BigInt) in BE", function () {
    class Q extends BigEndianStructure {
      static _fields_ = [["n", c_int64]];
    }
    const q = new Q();
    q.n = 0x0102030405060708n;
    assert.strictEqual(q._buffer[0], 0x01);
    assert.strictEqual(q._buffer[7], 0x08);
    assert.strictEqual(q.n, 0x0102030405060708n);
  });

  it("1-byte fields are unaffected", function () {
    class B extends BigEndianStructure {
      static _fields_ = [["a", c_uint8], ["b", c_uint8]];
    }
    const b = new B();
    b.a = 0xab;
    b.b = 0xcd;
    assert.strictEqual(b._buffer[0], 0xab);
    assert.strictEqual(b._buffer[1], 0xcd);
  });

  it("nested Structure (LE) inside BigEndianStructure keeps LE", function () {
    // Python parity: byte order è per-classe, non propagato ai nested.
    class InnerLE extends Structure {
      static _fields_ = [["x", c_uint32]];
    }
    class OuterBE extends BigEndianStructure {
      static _fields_ = [["hdr", c_uint16], ["inner", InnerLE]];
    }
    const o = new OuterBE();
    o.hdr = 0x1234;
    o.inner.x = 0xaabbccdd;
    assert.strictEqual(o._buffer[0], 0x12);
    assert.strictEqual(o._buffer[1], 0x34);
    assert.strictEqual(o._buffer[2], 0x00);
    assert.strictEqual(o._buffer[3], 0x00);
    assert.strictEqual(o._buffer[4], 0xdd);
    assert.strictEqual(o._buffer[5], 0xcc);
    assert.strictEqual(o._buffer[6], 0xbb);
    assert.strictEqual(o._buffer[7], 0xaa);
    assert.strictEqual(o.hdr, 0x1234);
    assert.strictEqual(o.inner.x, 0xaabbccdd);
  });

  it("nested BigEndianStructure inside BigEndianStructure is BE", function () {
    class InnerBE extends BigEndianStructure {
      static _fields_ = [["x", c_uint32]];
    }
    class OuterBE extends BigEndianStructure {
      static _fields_ = [["inner", InnerBE]];
    }
    const o = new OuterBE();
    o.inner.x = 0xaabbccdd;
    assert.strictEqual(o._buffer[0], 0xaa);
    assert.strictEqual(o._buffer[1], 0xbb);
    assert.strictEqual(o._buffer[2], 0xcc);
    assert.strictEqual(o._buffer[3], 0xdd);
    assert.strictEqual(o.inner.x, 0xaabbccdd);
  });
});

describe("Complex Nested Structures", function () {
  describe("Multi-level Nesting", function () {
    it("should handle 3-level nested structs", function () {
      const Point2D = ctypes.struct({ x: ctypes.c_int32, y: ctypes.c_int32 });
      const Point3D = ctypes.struct({ point2d: Point2D, z: ctypes.c_int32 });
      const BoundingBox = ctypes.struct({ min: Point3D, max: Point3D });

      const bbox = BoundingBox.create();
      bbox.min.point2d.x = 10;
      bbox.min.point2d.y = 20;
      bbox.min.z = 30;
      bbox.max.point2d.x = 100;
      bbox.max.point2d.y = 200;
      bbox.max.z = 300;

      assert.strictEqual(bbox.min.point2d.x, 10);
      assert.strictEqual(bbox.min.point2d.y, 20);
      assert.strictEqual(bbox.min.z, 30);
      assert.strictEqual(bbox.max.point2d.x, 100);
      assert.strictEqual(bbox.max.point2d.y, 200);
      assert.strictEqual(bbox.max.z, 300);
    });

    it("should calculate correct size for nested structs", function () {
      const Inner = ctypes.struct({ value: ctypes.c_int32 });
      const Middle = ctypes.struct({ inner: Inner, extra: ctypes.c_int32 });
      const Outer = ctypes.struct({ middle: Middle, final: ctypes.c_int32 });

      assert.strictEqual(ctypes.sizeof(Inner), 4);
      assert.strictEqual(ctypes.sizeof(Middle), 8);
      assert.strictEqual(ctypes.sizeof(Outer), 12);
    });
  });

  describe("Arrays of Nested Structs", function () {
    it("should handle fixed-size byte arrays in structs", function () {
      const Point = ctypes.struct({
        x: ctypes.c_int32,
        y: ctypes.c_int32,
        reserved: ctypes.array(ctypes.c_uint8, 4),
      });

      const pt = Point.create();
      pt.x = 100;
      pt.y = 200;
      pt.reserved[0] = 1;
      pt.reserved[1] = 2;
      pt.reserved[2] = 3;
      pt.reserved[3] = 4;

      assert.strictEqual(pt.x, 100);
      assert.strictEqual(pt.y, 200);
      assert.strictEqual(pt.reserved[0], 1);
      assert.strictEqual(pt.reserved[1], 2);
      assert.strictEqual(pt.reserved[2], 3);
      assert.strictEqual(pt.reserved[3], 4);
    });
  });

  describe("Union within Struct", function () {
    it("should handle union nested in struct", function () {
      class Value extends ctypes.Union {
        static _fields_ = [
          ["asInt", ctypes.c_int32],
          ["asBytes", ctypes.array(ctypes.c_uint8, 4)],
        ];
      }
      class Tagged extends ctypes.Structure {
        static _fields_ = [
          ["tag", ctypes.c_uint16],
          ["value", Value],
        ];
      }

      const tagged = new Tagged();
      tagged.tag = 1;
      tagged.value.asInt = 0x12345678;

      assert.strictEqual(tagged.tag, 1);
      assert.strictEqual(tagged.value.asInt, 0x12345678);
      assert.strictEqual(tagged.value.asBytes[0], 0x78);
      assert.strictEqual(tagged.value.asBytes[1], 0x56);
      assert.strictEqual(tagged.value.asBytes[2], 0x34);
      assert.strictEqual(tagged.value.asBytes[3], 0x12);
    });
  });

  describe("Complex Real-World Example", function () {
    it("should handle network packet structure", function () {
      const IPv4Address = ctypes.struct({ octets: ctypes.array(ctypes.c_uint8, 4) });
      const MACAddress = ctypes.struct({ bytes: ctypes.array(ctypes.c_uint8, 6) });
      const EthernetHeader = ctypes.struct({
        destination: MACAddress,
        source: MACAddress,
        etherType: ctypes.c_uint16,
      });
      const IPv4Header = ctypes.struct({
        versionAndHeaderLength: ctypes.c_uint8,
        typeOfService: ctypes.c_uint8,
        totalLength: ctypes.c_uint16,
        identification: ctypes.c_uint16,
        flagsAndFragmentOffset: ctypes.c_uint16,
        timeToLive: ctypes.c_uint8,
        protocol: ctypes.c_uint8,
        headerChecksum: ctypes.c_uint16,
        sourceAddress: IPv4Address,
        destinationAddress: IPv4Address,
      });
      const Packet = ctypes.struct({ ethernet: EthernetHeader, ipv4: IPv4Header });

      const packet = Packet.create();
      for (let i = 0; i < 6; i++) packet.ethernet.destination.bytes[i] = 0xff;
      packet.ethernet.source.bytes[0] = 0x00;
      packet.ethernet.source.bytes[1] = 0x11;
      packet.ethernet.source.bytes[2] = 0x22;
      packet.ethernet.source.bytes[3] = 0x33;
      packet.ethernet.source.bytes[4] = 0x44;
      packet.ethernet.source.bytes[5] = 0x55;
      packet.ethernet.etherType = 0x0800;
      packet.ipv4.versionAndHeaderLength = 0x45;
      packet.ipv4.typeOfService = 0;
      packet.ipv4.totalLength = 40;
      packet.ipv4.timeToLive = 64;
      packet.ipv4.protocol = 6;
      packet.ipv4.sourceAddress.octets[0] = 192;
      packet.ipv4.sourceAddress.octets[1] = 168;
      packet.ipv4.sourceAddress.octets[2] = 1;
      packet.ipv4.sourceAddress.octets[3] = 100;
      packet.ipv4.destinationAddress.octets[0] = 8;
      packet.ipv4.destinationAddress.octets[1] = 8;
      packet.ipv4.destinationAddress.octets[2] = 8;
      packet.ipv4.destinationAddress.octets[3] = 8;

      assert.strictEqual(packet.ethernet.destination.bytes[0], 0xff);
      assert.strictEqual(packet.ethernet.source.bytes[0], 0x00);
      assert.strictEqual(packet.ethernet.etherType, 0x0800);
      assert.strictEqual(packet.ipv4.versionAndHeaderLength, 0x45);
      assert.strictEqual(packet.ipv4.protocol, 6);
      assert.strictEqual(packet.ipv4.sourceAddress.octets[0], 192);
      assert.strictEqual(packet.ipv4.sourceAddress.octets[1], 168);
      assert.strictEqual(packet.ipv4.destinationAddress.octets[0], 8);
      assert.strictEqual(packet.ipv4.destinationAddress.octets[3], 8);
    });
  });

  describe("Deeply Nested with Mixed Types", function () {
    it("should handle union with nested struct", function () {
      class RGB extends ctypes.Structure {
        static _fields_ = [
          ["r", ctypes.c_uint8],
          ["g", ctypes.c_uint8],
          ["b", ctypes.c_uint8],
          ["a", ctypes.c_uint8],
        ];
      }
      class Color extends ctypes.Union {
        static _fields_ = [
          ["rgb", RGB],
          ["value", ctypes.c_int32],
        ];
      }
      class Pixel extends ctypes.Structure {
        static _fields_ = [
          ["x", ctypes.c_uint16],
          ["y", ctypes.c_uint16],
          ["color", Color],
        ];
      }

      const pixel = new Pixel();
      pixel.x = 10;
      pixel.y = 20;
      pixel.color.rgb.r = 255;
      pixel.color.rgb.g = 0;
      pixel.color.rgb.b = 0;
      pixel.color.rgb.a = 255;

      assert.strictEqual(pixel.x, 10);
      assert.strictEqual(pixel.y, 20);
      assert.strictEqual(pixel.color.rgb.r, 255);
      assert.strictEqual(pixel.color.rgb.g, 0);
      assert.strictEqual(pixel.color.rgb.b, 0);
      assert.strictEqual(pixel.color.rgb.a, 255);
    });
  });

  describe("Alignment and Padding", function () {
    it("should handle alignment in nested structs", function () {
      const Inner = ctypes.struct({ byte1: ctypes.c_uint8, int1: ctypes.c_int32 });
      const Outer = ctypes.struct({
        byte2: ctypes.c_uint8,
        nested: Inner,
        byte3: ctypes.c_uint8,
      });

      assert.ok(ctypes.sizeof(Outer) > 0);
      assert.ok(ctypes.sizeof(Inner) > 0);

      const outer = Outer.create();
      outer.byte2 = 1;
      outer.nested.byte1 = 2;
      outer.nested.int1 = 12345;
      outer.byte3 = 3;

      assert.strictEqual(outer.byte2, 1);
      assert.strictEqual(outer.nested.byte1, 2);
      assert.strictEqual(outer.nested.int1, 12345);
      assert.strictEqual(outer.byte3, 3);
    });
  });

  describe("Array of Structs within Struct", function () {
    it("should hold an array of Point structs as a field (Polygon)", function () {
      class Point extends ctypes.Structure {
        static _fields_ = [
          ["x", ctypes.c_int32],
          ["y", ctypes.c_int32],
        ];
      }
      class Polygon extends ctypes.Structure {
        static _fields_ = [
          ["count", ctypes.c_int32],
          ["vertices", ctypes.array(Point, 4)],
        ];
      }

      const poly = new Polygon();
      poly.count = 4;
      poly.vertices[0].x = 0;
      poly.vertices[0].y = 0;
      poly.vertices[1].x = 10;
      poly.vertices[1].y = 0;
      poly.vertices[2].x = 10;
      poly.vertices[2].y = 10;
      poly.vertices[3].x = 0;
      poly.vertices[3].y = 10;

      assert.strictEqual(poly.count, 4);
      assert.strictEqual(poly.vertices[0].x, 0);
      assert.strictEqual(poly.vertices[1].x, 10);
      assert.strictEqual(poly.vertices[2].y, 10);
      assert.strictEqual(poly.vertices[3].y, 10);
      assert.strictEqual(ctypes.sizeof(Polygon), 4 + 4 * ctypes.sizeof(Point));
    });
  });
});

describe("Signed bitfield sign-extension", function () {
  it("c_int8 bitfield: roundtrip negative values", function () {
    class B extends ctypes.Structure {
      static _fields_ = [
        ["a", ctypes.c_int8, 3],
        ["b", ctypes.c_int8, 5],
      ];
    }
    const s = new B();
    for (const v of [-4, -1, 0, 1, 3]) {
      s.a = v;
      assert.strictEqual(s.a, v, `c_int8×3: ${v}`);
    }
    for (const v of [-16, -1, 0, 1, 15]) {
      s.b = v;
      assert.strictEqual(s.b, v, `c_int8×5: ${v}`);
    }
  });

  it("c_int16 bitfield: roundtrip", function () {
    class B extends ctypes.Structure {
      static _fields_ = [["a", ctypes.c_int16, 7]];
    }
    const s = new B();
    for (const v of [-64, -1, 0, 1, 63]) {
      s.a = v;
      assert.strictEqual(s.a, v, `c_int16×7: ${v}`);
    }
  });

  it("c_int32 bitfield: roundtrip large signed", function () {
    class B extends ctypes.Structure {
      static _fields_ = [["a", ctypes.c_int32, 30]];
    }
    const s = new B();
    const max = (1 << 29) - 1;
    const min = -(1 << 29);
    for (const v of [min, -1, 0, 1, max]) {
      s.a = v;
      assert.strictEqual(s.a, v, `c_int32×30: ${v}`);
    }
  });

  it("c_int64 bitfield: roundtrip using BigInt range", function () {
    class B extends ctypes.Structure {
      static _fields_ = [["a", ctypes.c_int64, 40]];
    }
    const s = new B();
    for (const v of [-(1 << 30), -1, 0, 1, (1 << 30) - 1]) {
      s.a = v;
      assert.strictEqual(s.a, v, `c_int64×40: ${v}`);
    }
  });

  it("unsigned bitfield still returns unsigned", function () {
    class B extends ctypes.Structure {
      static _fields_ = [
        ["a", ctypes.c_uint8, 3],
        ["b", ctypes.c_uint32, 16],
      ];
    }
    const s = new B();
    s.a = 7;
    assert.strictEqual(s.a, 7);
    s.b = 0xffff;
    assert.strictEqual(s.b, 0xffff);
    s.a = -1;
    assert.strictEqual(s.a, 7, "unsigned 3-bit field wraps -1 → 7");
  });
});

describe("BigEndianUnion / LittleEndianUnion", function () {
  const { BigEndianUnion, LittleEndianUnion, c_uint32, c_uint8, array } = ctypes;

  it("BigEndianUnion stores primitive fields in BE order", function () {
    class V extends BigEndianUnion {
      static _fields_ = [["i", c_uint32], ["bytes", array(c_uint8, 4)]];
    }
    const v = new V();
    v.i = 0x12345678;
    assert.strictEqual(v._buffer[0], 0x12);
    assert.strictEqual(v._buffer[3], 0x78);
    assert.strictEqual(v.i, 0x12345678);
    assert.strictEqual(v.bytes[0], 0x12);
  });

  it("LittleEndianUnion matches native order on LE host", function () {
    class V extends LittleEndianUnion {
      static _fields_ = [["i", c_uint32]];
    }
    const v = new V();
    v.i = 0x12345678;
    assert.strictEqual(v._buffer[0], 0x78);
  });
});
