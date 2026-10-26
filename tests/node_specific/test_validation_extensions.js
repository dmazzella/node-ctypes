import { describe, it } from "node:test";
import assert from "node:assert";
import { struct, union, c_int32, readValue, writeValue, cast, Structure, StructType, ArrayType, CType, Library, addressof, sizeof, find_library } from "node-ctypes";

// Node constructors, native binding classes, and Buffer/typed-array convenience
// validation. Public from_buffer/cast contracts are paired in scalars/test_validation.
describe("Input Validation", () => {
  it("should handle object with duplicate keys (JS limitation)", () => {
    // Note: JavaScript automatically deduplicates object literal keys
    // so { x: 1, x: 2 } becomes { x: 2 }
    // This is a JS language limitation, not a validation failure
    const s = struct({ x: c_int32 });
    assert.strictEqual(s.fields.length, 1);
  });

  it("should reject empty field names", () => {
    assert.throws(() => {
      struct({ "": c_int32 });
    }, /non-empty string/);
  });

  it("sequence field names preserve empty keys and own prototype-named data", () => {
    for (const define of [struct, union]) {
      const definition = define([
        ["", c_int32],
        ["constructor", c_int32],
        ["__proto__", c_int32],
        ["toString", c_int32],
      ]);
      const inherited = Object.create({ constructor: 99, toString: 88 });
      inherited[""] = 7;
      const instance = definition.create(inherited);
      assert.deepStrictEqual([instance[""], instance.constructor, instance.__proto__, instance.toString], define === union ? [7, 7, 7, 7] : [7, 0, 0, 0]);
      instance.constructor = 8;
      instance.__proto__ = 9;
      const plain = definition.toObject(instance);
      assert.strictEqual(Object.getPrototypeOf(plain), Object.prototype);
      assert.strictEqual(Object.hasOwn(plain, "__proto__"), true);
      assert.deepStrictEqual([plain[""], plain.constructor, plain.__proto__, plain.toString], define === union ? [9, 9, 9, 9] : [7, 8, 9, 0]);
    }
    const anonymous = struct({ inner: { anonymous: true, type: struct([["__proto__", c_int32]]) } });
    const plain = anonymous.toObject(anonymous.create({ ["__proto__"]: 11 }));
    assert.strictEqual(Object.getPrototypeOf(plain), Object.prototype);
    assert.strictEqual(Object.hasOwn(plain, "__proto__"), true);
    assert.strictEqual(plain.__proto__, 11);
  });

  it("constructor-named fields preserve inherited class tags", () => {
    class Parent extends Structure {
      static _fields_ = [["constructor", c_int32]];
    }
    class Inherited extends Parent {}
    class Child extends Inherited {
      static _fields_ = [["extra", c_int32]];
    }
    const parent = new Parent({ constructor: 3 }),
      inherited = new Inherited(4),
      child = new Child(5, 6);
    assert.deepStrictEqual([parent.constructor, inherited.constructor, child.constructor], [3, 4, 5]);
    assert.strictEqual(Object.prototype.toString.call(parent), "[object Parent]");
    assert.strictEqual(Object.prototype.toString.call(inherited), "[object Inherited]");
    assert.strictEqual(Object.prototype.toString.call(child), "[object Child]");
  });

  it("should validate buffer size in Structure constructor", () => {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }

    const smallBuf = Buffer.alloc(4);
    assert.throws(() => {
      new Point(smallBuf);
    }, /Buffer size.*smaller than struct size/);
  });

  it("should validate offset in readValue", () => {
    const buf = Buffer.alloc(8);
    assert.throws(() => {
      readValue(buf, c_int32, -1);
    }, /non-negative/);
  });

  it("should check bounds in readValue", () => {
    const buf = Buffer.alloc(4);
    assert.throws(() => {
      readValue(buf, c_int32, 2);
    }, /exceed buffer bounds/);
  });

  it("should check bounds in writeValue", () => {
    const buf = Buffer.alloc(4);
    assert.throws(() => {
      writeValue(buf, c_int32, 42, 2);
    }, /exceed buffer bounds/);
  });

  it("should validate cast arguments", () => {
    assert.throws(() => {
      cast(null, c_int32);
    }, /non-null pointer/);

    const buf = Buffer.alloc(4);
    assert.throws(() => {
      cast(buf, null);
    }, /target type/);
  });

  // Errori nel modulo nativo: errori JS, mai la terminazione del processo.
  it("native types reject invalid arguments with JS errors", () => {
    assert.throws(() => new StructType().addField("x", 999), /Invalid CType value: 999/);
    assert.throws(() => new ArrayType(999, 2), /Invalid CType value: 999/);
    assert.throws(() => new ArrayType(CType.INT32, -1), RangeError);
    assert.throws(() => new ArrayType(CType.INT32, 1.5), RangeError);
    assert.deepStrictEqual([...new ArrayType(CType.CHAR, 0).create("a")], []);
  });

  it("native types are recognized by their instances, not by their methods", () => {
    // Objects with the methods of StructType / ArrayType / Library are not one.
    const fakeStruct = { addField() {}, getSize: () => 4, getAlignment: () => 4 };
    const fakeArray = { getLength: () => 2, getSize: () => 8, _native: {} };
    for (const fake of [fakeStruct, fakeArray]) {
      assert.throws(() => new StructType().addField("x", fake), { name: "TypeError", message: /StructType or ArrayType/ });
      assert.throws(() => new ArrayType(fake, 2), TypeError);
    }
    // The C runtime: Library(null) on Windows is node.exe, which does not export abs.
    const lib = new Library(find_library("c"));
    try {
      assert.throws(() => lib.func("abs", fakeStruct, []), { name: "TypeError", message: /^Invalid return type: / });
      assert.throws(() => lib.func("abs", CType.INT32, [fakeArray]), { name: "TypeError", message: /^Invalid argument type at index 0: / });
      // A struct type wrapped by array() is accepted through its `_native`.
      const inner = new StructType();
      inner.addField("v", CType.INT32);
      const outer = new StructType();
      outer.addField("items", { _native: new ArrayType(inner, 2) });
      assert.strictEqual(outer.getSize(), 8);
    } finally {
      lib.close();
    }
  });

  it("StructType.create() fields can be assigned", () => {
    const type = new StructType();
    type.addField("x", CType.INT32);
    type.addField("p", CType.STRING);
    const instance = type.create({ x: 1 });
    instance.x = 99;
    assert.strictEqual(instance.x, 99);
    assert.strictEqual(instance._buffer.readInt32LE(0), 99);
    assert.throws(() => {
      instance.p = "not a pointer";
    }, /Cannot assign field 'p'/);
  });

  it("readValue / writeValue accept addresses, instances and typed arrays for every type", () => {
    class P extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    const p = new P(3, 4);
    const addr = addressof(p);
    assert.deepStrictEqual(readValue(addr, P), { x: 3, y: 4 });
    assert.strictEqual(readValue(addr, c_int32, 4), 4);
    writeValue(addr, c_int32, 9);
    writeValue(addr, P, { y: 10 });
    assert.deepStrictEqual([p.x, p.y], [9, 10]);
    assert.strictEqual(readValue(p, c_int32, 4), 10);
    const bytes = new Uint8Array(8);
    writeValue(bytes, c_int32, 5, 4);
    assert.strictEqual(readValue(bytes, c_int32, 4), 5);
    assert.strictEqual(sizeof(new Float64Array(2)), 16);
    assert.throws(() => readValue(Buffer.alloc(4), P), RangeError);
    assert.throws(() => writeValue(0n, c_int32, 1), /NULL pointer/);
  });
});
