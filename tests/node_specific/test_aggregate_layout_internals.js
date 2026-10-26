// Native descriptor introspection, async results and owner-map/GC assertions.
import assert from "node:assert";
import { describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import v8 from "node:v8";
import vm from "node:vm";
import { keptObject } from "../../lib/structures/helpers/common.js";
import { LIBC } from "../cpython_parity/_support.js";
const { Structure, Union, BigEndianStructure, CDLL, sizeof, alignment, c_int8, c_uint8, c_uint16, c_int32, c_uint32, c_int64, c_uint64, c_char_p } = ctypes;
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");
class Base extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int8],
  ];
}
class Derived extends Base {
  static _fields_ = [["z", c_int8]];
}

describe("Node aggregate accessors, native descriptors and owner bookkeeping", function () {
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

  it("assigning _structDef = null rebuilds the layout", function () {
    class Late extends Structure {}
    Late._fields_ = [["a", c_int64]];
    Late._structDef = null;
    assert.strictEqual(sizeof(Late), 8);
  });

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
