/**
 * Structure and union layout, as Python ctypes (ctypes._layout):
 * - bitfields in the "gcc-sysv" and "ms" layouts, `_pack_`, `_align_`,
 *   big-endian bitfields, full-width (32/64-bit) bitfields;
 * - subclasses that extend the fields of their base class;
 * - by-value structures described to libffi with the same layout, returned
 *   as instances of their class;
 * - objects assigned to fields kept alive with the memory of the outermost
 *   structure (Python `_objects`).
 *
 * layout_cases.json holds the expected sizes, bytes and values, generated
 * with Python ctypes (see test_layout.py, which checks the same file).
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import v8 from "node:v8";
import vm from "node:vm";
import * as ctypes from "node-ctypes";
import { keptObject } from "../../lib/structures/helpers/common.js";

const { Structure, Union, BigEndianStructure, BigEndianUnion, CDLL, sizeof, alignment, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_char_p } = ctypes;

const TYPES = { u8: c_uint8, u16: c_uint16, u32: c_uint32, u64: c_uint64, i8: c_int8, i16: c_int16, i32: c_int32, i64: c_int64 };
const cases = JSON.parse(readFileSync(new URL("./layout_cases.json", import.meta.url), "utf8"));

// Value written to field `index`: a pattern truncated to the field width
// (signed types wrap into their range), as in test_layout.py.
function fieldValue(index, kind, bits) {
  const width = BigInt(bits ?? sizeof(TYPES[kind]) * 8);
  let v = (0x5a5a5a5a5a5a5a5an ^ (BigInt(index) * 0x0101010101010101n)) & ((1n << width) - 1n);
  if (kind.startsWith("i") && v >= 1n << (width - 1n)) v -= 1n << width;
  const asBigInt = bits ? bits > 53 : sizeof(TYPES[kind]) === 8;
  return asBigInt ? v : Number(v);
}

function defineCase(kase) {
  const Kind = kase.union ? (kase.bigEndian ? BigEndianUnion : Union) : kase.bigEndian ? BigEndianStructure : Structure;
  const fields = (list) => list.map(([name, kind, bits]) => (bits ? [name, TYPES[kind], bits] : [name, TYPES[kind]]));
  const options = (Cls) => {
    if ("pack" in kase) Cls._pack_ = kase.pack;
    if ("layout" in kase) Cls._layout_ = kase.layout;
    if ("align" in kase) Cls._align_ = kase.align;
    return Cls;
  };
  let Parent = Kind;
  if (kase.base) {
    Parent = options(class Base extends Kind {});
    Parent._fields_ = fields(kase.base);
  }
  const Cls = options(class S extends Parent {});
  Cls._fields_ = fields(kase.fields);
  return { Cls, all: [...(kase.base ?? []), ...kase.fields] };
}

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");

describe("Structure layout (Python ctypes parity)", function () {
  for (const kase of cases) {
    it(kase.name, function () {
      const { Cls, all } = defineCase(kase);
      const instance = new Cls();
      all.forEach(([name, kind, bits], i) => {
        instance[name] = fieldValue(i, kind, bits);
      });
      const { expected } = kase;
      assert.strictEqual(sizeof(Cls), expected.size, "size");
      assert.strictEqual(alignment(Cls), expected.align, "alignment");
      assert.strictEqual(instance._buffer.toString("hex"), expected.bytes, "bytes");
      if (!kase.union) {
        assert.deepStrictEqual(
          all.map(([name]) => String(instance[name])),
          expected.reads,
          "values",
        );
      }
    });
  }
});

describe("Structure inheritance", function () {
  class Base extends Structure {
    static _fields_ = [
      ["x", c_int32],
      ["y", c_int8],
    ];
  }
  class Derived extends Base {
    static _fields_ = [["z", c_int8]];
  }
  class Same extends Derived {}

  it("a subclass with _fields_ extends the base layout", function () {
    // The base is used (and cached) first: its definition must not leak into the subclass.
    assert.strictEqual(sizeof(new Base()), 8);
    const d = new Derived(1, 2, 3);
    assert.strictEqual(sizeof(Derived), 12);
    assert.deepStrictEqual([d.x, d.y, d.z], [1, 2, 3]);
    assert.deepStrictEqual(Object.keys(d.toObject()), ["x", "y", "z"]);
    assert.strictEqual(Derived._structDef.fieldMap.get("z").offset, 8);
    assert.deepStrictEqual(Derived.toObject(d), { x: 1, y: 2, z: 3 });
  });

  it("a subclass without _fields_ has the layout of its base", function () {
    const s = new Same(4, 5, 6);
    assert.strictEqual(sizeof(Same), 12);
    assert.deepStrictEqual([s.x, s.y, s.z], [4, 5, 6]);
  });

  it("a Union subclass extends the fields of its base", function () {
    class U extends Union {
      static _fields_ = [["a", c_uint16]];
    }
    class U2 extends U {
      static _fields_ = [["b", c_uint64]];
    }
    const u = new U2();
    u.b = 0x0102030405060708n;
    assert.strictEqual(sizeof(U2), 8);
    assert.strictEqual(u.a, 0x0708);
  });

  it("assigning _structDef = null rebuilds the layout", function () {
    class Late extends Structure {}
    Late._fields_ = [["a", c_int64]];
    Late._structDef = null;
    assert.strictEqual(sizeof(Late), 8);
  });
});

describe("Bitfield values", function () {
  it("full-width 32-bit fields keep all their bits", function () {
    class B extends Structure {
      static _fields_ = [
        ["u", c_uint32, 32],
        ["i", c_int32, 32],
      ];
    }
    const b = new B(0xffffffff, -1);
    assert.strictEqual(b.u, 0xffffffff);
    assert.strictEqual(b.i, -1);
  });

  it("fields wider than 53 bits read as BigInt, narrower ones as numbers", function () {
    class B extends Structure {
      static _fields_ = [
        ["wide", c_uint64, 64],
        ["narrow", c_int64, 40],
      ];
    }
    const b = new B();
    b.wide = 2n ** 53n + 1n;
    b.narrow = -5;
    assert.strictEqual(b.wide, 2n ** 53n + 1n);
    assert.strictEqual(b.narrow, -5);
  });

  it("values are truncated to the field width", function () {
    class B extends Structure {
      static _fields_ = [["v", c_uint32, 3]];
    }
    assert.strictEqual(new B(15).v, 7);
    assert.strictEqual(new B(-1).v, 7);
  });
});

describe("BigEndianStructure accessors", function () {
  it("get(), set() and toObject() use the byte order of the structure", function () {
    class Wire extends BigEndianStructure {
      static _fields_ = [["magic", c_uint32]];
    }
    const w = new Wire(0x12345678);
    assert.deepStrictEqual([...w._buffer], [0x12, 0x34, 0x56, 0x78]);
    assert.strictEqual(w.get("magic"), 0x12345678);
    assert.strictEqual(w.toObject().magic, 0x12345678);
    w.set("magic", 0x0a0b0c0d);
    assert.deepStrictEqual([...w._buffer], [0x0a, 0x0b, 0x0c, 0x0d]);
  });
});

describe("Structures by value", function () {
  const LIBC = process.platform === "win32" ? "msvcrt.dll" : process.platform === "darwin" ? "libc.dylib" : "libc.so.6";

  it("a Structure restype returns an instance of the class", async function () {
    class DivT extends Structure {
      static _fields_ = [
        ["quot", c_int32],
        ["rem", c_int32],
      ];
    }
    const libc = new CDLL(LIBC);
    const div = libc.func("div", DivT, [c_int32, c_int32]);
    const r = div(17, 5);
    assert.ok(r instanceof DivT);
    assert.deepStrictEqual([r.quot, r.rem], [3, 2]);
    assert.strictEqual(sizeof(r), 8);
    const a = await div.callAsync(-17, 5);
    assert.ok(a instanceof DivT);
    assert.deepStrictEqual([a.quot, a.rem], [-3, -2]);
    libc.close();
  });

  it("the libffi type has the size and alignment of the JS layout", function () {
    class Bits extends Structure {
      static _layout_ = "gcc-sysv";
      static _fields_ = [
        ["a", c_uint8, 3],
        ["b", c_uint32, 5],
        ["tail", c_uint8],
      ];
    }
    class Base extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int8],
      ];
    }
    class Derived extends Base {
      static _fields_ = [["z", c_int8]];
    }
    class Aligned extends Structure {
      static _align_ = 16;
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
      ];
    }
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    class Polyline extends Structure {
      static _fields_ = [
        ["count", c_int32],
        ["points", ctypes.array(Point, 2)],
      ];
    }
    const libc = new CDLL(LIBC);
    for (const T of [Bits, Derived, Aligned, Polyline]) {
      // The signature alone builds the native type (the function is not called).
      libc.func("abs", c_int32, [T]);
      const nativeType = T._structDef._nativeStructType;
      assert.strictEqual(nativeType.getSize(), sizeof(T), `${T.name} size`);
      assert.strictEqual(nativeType.getAlignment(), alignment(T), `${T.name} alignment`);
    }
    libc.close();
  });
});

describe("Objects kept alive by fields", function () {
  it("a string assigned through a nested structure lives with the outer one", async function () {
    class Child extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    class Outer extends Structure {
      static _fields_ = [
        ["id", c_int32],
        ["child", Child],
      ];
    }
    const outer = new Outer();
    outer.child.text = "kept with outer";
    const offset = Outer._structDef.fieldMap.get("child").offset;
    for (let i = 0; i < 5; i++) {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(Buffer.isBuffer(keptObject(outer._buffer, offset)), "the converted string is kept");
    assert.strictEqual(outer.child.text, "kept with outer");
  });

  it("copying a structure into a field copies the objects it keeps alive", function () {
    class Child extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    class Outer extends Structure {
      static _fields_ = [
        ["id", c_int32],
        ["child", Child],
      ];
    }
    const source = new Child();
    source.text = "copied";
    const outer = new Outer();
    outer.child = source;
    const offset = Outer._structDef.fieldMap.get("child").offset;
    assert.strictEqual(keptObject(outer._buffer, offset), keptObject(source._buffer, 0));
    assert.strictEqual(outer.child.text, "copied");
  });

  it("self-assignment preserves nested keepalives", function () {
    class Child extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    class Outer extends Structure {
      static _fields_ = [["child", Child]];
    }
    const outer = new Outer();
    outer.child.text = "self";
    const owner = keptObject(outer._buffer, 0);
    outer.child = outer.child;
    assert.strictEqual(keptObject(outer._buffer, 0), owner);
  });

  it("overlapping typed copies snapshot the owners before clearing the target", function () {
    class Pair extends Structure {
      static _fields_ = [
        ["first", c_char_p],
        ["second", c_char_p],
      ];
    }
    const word = sizeof(c_char_p);
    const buffer = Buffer.alloc(word * 3);
    const source = Pair.from_buffer(buffer);
    const destination = Pair.from_buffer(buffer, word);
    source.first = "first";
    source.second = "second";
    const first = keptObject(buffer, 0);
    const second = keptObject(buffer, word);
    ctypes.writeValue(destination, Pair, source);
    assert.strictEqual(keptObject(buffer, word), first);
    assert.strictEqual(keptObject(buffer, word * 2), second);
  });

  it("array fields and nested array elements transfer their keepalives", function () {
    const Strings = ctypes.array(c_char_p, 2);
    class Record extends Structure {
      static _fields_ = [["items", Strings]];
    }
    class Value extends Union {
      static _fields_ = [["items", Strings]];
    }
    const source = Strings("one", "two");
    const owners = [keptObject(source._buffer, 0), keptObject(source._buffer, sizeof(c_char_p))];
    for (const target of [new Record(), new Value()]) {
      target.items = source;
      assert.strictEqual(keptObject(target._buffer, 0), owners[0]);
      assert.strictEqual(keptObject(target._buffer, sizeof(c_char_p)), owners[1]);
    }
    const nested = ctypes.array(Strings, 2)();
    nested[1] = source;
    assert.strictEqual(keptObject(nested._buffer, sizeof(Strings)), owners[0]);
    assert.strictEqual(keptObject(nested._buffer, sizeof(Strings) + sizeof(c_char_p)), owners[1]);
  });

  it("functional structure assignments transfer owners rather than copying bytes only", function () {
    const Child = ctypes.struct({ text: c_char_p });
    const Parent = ctypes.struct({ child: Child });
    const source = Child.create({ text: "functional" });
    const target = Parent.create();
    target.child = source;
    assert.strictEqual(keptObject(target._buffer, 0), keptObject(source._buffer, 0));
  });

  it("typed copies keep known pointer owners but raw memmove does not", function () {
    class Record extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    const source = new Record("known owner");
    const typed = Record.from_buffer_copy(source);
    assert.strictEqual(keptObject(typed._buffer, 0), keptObject(source._buffer, 0));
    const strings = ctypes.array(c_char_p, 1).from_buffer_copy(source);
    assert.strictEqual(keptObject(strings._buffer, 0), keptObject(source._buffer, 0));
    const scalar = c_char_p.from_buffer_copy(source._buffer);
    assert.strictEqual(keptObject(scalar._buffer, 0), keptObject(source._buffer, 0));
    const raw = Buffer.alloc(sizeof(Record));
    ctypes.memmove(raw, source, raw.length);
    assert.strictEqual(keptObject(raw, 0), undefined);
  });

  it("failed pointer writes leave the previous reference intact", function () {
    class Record extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    const record = new Record("still owned");
    const owner = keptObject(record._buffer, 0);
    assert.throws(() => {
      record.text = -1n;
    }, RangeError);
    assert.strictEqual(keptObject(record._buffer, 0), owner);
    assert.strictEqual(record.text, "still owned");
  });
});
