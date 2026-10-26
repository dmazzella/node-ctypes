import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ARRAY, Structure, Union, BigEndianStructure, BigEndianUnion, CDLL, sizeof, alignment, addressof, string_at, c_int8, c_uint8, c_int16, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_char_p } from "node-ctypes";
import { LIBC } from "../_support.js";

const TYPES = { u8: c_uint8, u16: c_uint16, u32: c_uint32, u64: c_uint64, i8: c_int8, i16: c_int16, i32: c_int32, i64: c_int64 };
const CASES = JSON.parse(readFileSync(new URL("../../fixtures/layout_cases.json", import.meta.url), "utf8"));

describe("TestLayout", function () {
  it("test_cases", function () {
    for (const kase of CASES) {
      const Kind = kase.union ? (kase.bigEndian ? BigEndianUnion : Union) : kase.bigEndian ? BigEndianStructure : Structure;
      let Parent = Kind;
      if (kase.base) {
        class Base extends Kind {}
        if ("pack" in kase) Base._pack_ = kase.pack;
        if ("layout" in kase) Base._layout_ = kase.layout;
        if ("align" in kase) Base._align_ = kase.align;
        Base._fields_ = kase.base.map(([name, kind, ...bits]) => [name, TYPES[kind], ...bits]);
        Parent = Base;
      }
      class S extends Parent {}
      if ("pack" in kase) S._pack_ = kase.pack;
      if ("layout" in kase) S._layout_ = kase.layout;
      if ("align" in kase) S._align_ = kase.align;
      S._fields_ = kase.fields.map(([name, kind, ...bits]) => [name, TYPES[kind], ...bits]);
      const all_fields = [...(kase.base ?? []), ...kase.fields];
      const instance = new S();
      for (const [index, [name, kind, bits]] of all_fields.entries()) {
        const width = BigInt(bits ?? sizeof(TYPES[kind]) * 8);
        let value = (0x5a5a5a5a5a5a5a5an ^ (BigInt(index) * 0x0101010101010101n)) & ((1n << width) - 1n);
        if (kind.startsWith("i") && value >= 1n << (width - 1n)) value -= 1n << width;
        instance[name] = (bits ? bits > 53 : sizeof(TYPES[kind]) === 8) ? value : Number(value);
      }
      const expected = kase.expected;
      assert.equal(sizeof(S), expected.size, kase.name);
      assert.equal(alignment(S), expected.align, kase.name);
      assert.equal(Buffer.from(string_at(addressof(instance), sizeof(instance)), "latin1").toString("hex"), expected.bytes, kase.name);
      if (!kase.union)
        assert.deepEqual(
          all_fields.map(([name]) => String(instance[name])),
          expected.reads,
          kase.name,
        );
    }
  });

  it("test_inheritance", function () {
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
    assert.equal(sizeof(new Base()), 8);
    const d = new Derived(1, 2, 3);
    assert.equal(sizeof(Derived), 12);
    assert.deepEqual([d.x, d.y, d.z], [1, 2, 3]);
    assert.equal(Derived.fields.find((field) => field.name === "z").offset, 8);
    const s = new Same(4, 5, 6);
    assert.equal(sizeof(Same), 12);
    assert.deepEqual([s.x, s.y, s.z], [4, 5, 6]);
  });

  it("test_union_inheritance", function () {
    class U extends Union {
      static _fields_ = [["a", c_uint16]];
    }
    class U2 extends U {
      static _fields_ = [["b", c_uint64]];
    }
    const u = new U2();
    u.b = 0x0102030405060708n;
    assert.equal(sizeof(U2), 8);
    assert.equal(u.a, 0x0708);
  });

  it("test_full_width_bitfields", function () {
    class B extends Structure {
      static _fields_ = [
        ["u", c_uint32, 32],
        ["i", c_int32, 32],
      ];
    }
    const b = new B(0xffffffff, -1);
    assert.equal(b.u, 0xffffffff);
    assert.equal(b.i, -1);
    class W extends Structure {
      static _fields_ = [
        ["wide", c_uint64, 64],
        ["narrow", c_int64, 40],
      ];
    }
    const w = new W();
    w.wide = 2n ** 53n + 1n;
    w.narrow = -5;
    assert.equal(w.wide, 2n ** 53n + 1n);
    assert.equal(w.narrow, -5);
  });

  it("test_struct_restype_is_instance", function () {
    class DivT extends Structure {
      static _fields_ = [
        ["quot", c_int32],
        ["rem", c_int32],
      ];
    }
    const libc = new CDLL(LIBC);
    libc.div.restype = DivT;
    libc.div.argtypes = [c_int32, c_int32];
    try {
      const r = libc.div(17, 5);
      assert.ok(r instanceof DivT);
      assert.deepEqual([r.quot, r.rem], [3, 2]);
      assert.equal(sizeof(r), 8);
    } finally {
      libc.close();
    }
  });

  it("test_nested_keepalive", function () {
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
    assert.equal(outer.child.text, "kept with outer");
  });

  it("test_bitfield_truncation", function () {
    class B extends Structure {
      static _fields_ = [["v", c_uint32, 3]];
    }
    assert.equal(new B(15).v, 7);
    assert.equal(new B(-1).v, 7);
  });

  it("test_copy_nested_keepalive", function () {
    class Child extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    class Outer extends Structure {
      static _fields_ = [
        ["id", c_int32],
        ["child", Child],
      ];
    }
    const source = new Child("copied");
    const outer = new Outer();
    outer.child = source;
    assert.equal(outer.child.text, "copied");
  });

  it("test_self_assignment_keepalive", function () {
    class Child extends Structure {
      static _fields_ = [["text", c_char_p]];
    }
    class Outer extends Structure {
      static _fields_ = [["child", Child]];
    }
    const outer = new Outer();
    outer.child.text = "self";
    outer.child = outer.child;
    assert.equal(outer.child.text, "self");
  });

  it("test_array_keepalive_transfer", function () {
    const Strings = ARRAY(c_char_p, 2);
    class Record extends Structure {
      static _fields_ = [["items", Strings]];
    }
    class Value extends Union {
      static _fields_ = [["items", Strings]];
    }
    const source = Strings("one", "two");
    for (const target of [new Record(), new Value()]) {
      target.items = source;
      assert.deepEqual(Array.from(target.items), ["one", "two"]);
    }
    const nested = ARRAY(Strings, 2)();
    nested[1] = source;
    assert.deepEqual(Array.from(nested[1]), ["one", "two"]);
  });
});
