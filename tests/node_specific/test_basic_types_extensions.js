// Public ctypes contracts live in cpython_parity/scalars/test_basic_types.
// These retain Buffer representations, convenience bindings, pointer helpers, and GC coverage.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";
import { LIBC } from "../cpython_parity/_support.js";

describe("Basic type Node extensions", function () {
  it("c_void_p accepts extra pointer adapters and retains assigned memory", function () {
    class Record extends c.Structure {
      static _fields_ = [["p", c.c_void_p]];
    }
    const buffer = c.create_string_buffer("hi");
    const address = c.addressof(buffer);
    const record = new Record();
    for (const value of [{ _as_parameter_: address }, c.POINTER(c.c_char).fromAddress(address), new c.c_void_p(address), c.cast(address, c.c_char_p), buffer]) {
      record.p = value;
      assert.equal(record.p, address);
    }
    record.p = c.create_string_buffer("kept");
    for (let index = 0; index < 3; index++) globalThis.gc?.();
    assert.equal(c.string_at(record.p), "kept");
    assert.throws(() => {
      record.p = {};
    }, /cannot be converted to pointer/);
  });

  it("exposes instance and static size properties", function () {
    assert.equal(new c.c_uint64(42n).size, 8);
    assert.equal(c.c_uint64.size, 8);
    assert.equal(c.c_int32.size, 4);
    assert.equal(c.c_bool.size, 1);
    assert.equal(c.sizeof(c.c_void_p), c.POINTER_SIZE);
    assert.equal(c.sizeof(c.c_size_t), c.POINTER_SIZE);
  });

  it("byref exposes scalar and structure storage as Buffers", function () {
    const reference = c.byref(new c.c_uint32(42));
    assert.ok(Buffer.isBuffer(reference));
    assert.equal(reference.length, 4);
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    assert.ok(Buffer.isBuffer(c.byref(new Point(10, 20))));
  });

  it("from_buffer views interoperate with readValue and writeValue", function () {
    const buffer = c.create_string_buffer(4);
    c.writeValue(buffer, c.c_uint32, 0xdeadbeef);
    const value = c.c_uint32.from_buffer(buffer);
    assert.equal(value.value, 0xdeadbeef);
    value.value = 0x12345678;
    assert.equal(c.readValue(buffer, c.c_uint32), 0x12345678);
  });

  it("from_buffer offsets interoperate with writeValue", function () {
    const buffer = c.create_string_buffer(8);
    c.writeValue(buffer, c.c_uint32, 0xaabbccdd, 0);
    c.writeValue(buffer, c.c_uint32, 0x11223344, 4);
    assert.equal(c.c_uint32.from_buffer(buffer, 0).value, 0xaabbccdd);
    assert.equal(c.c_uint32.from_buffer(buffer, 4).value, 0x11223344);
  });

  it("from_buffer_copy does not alias writeValue storage", function () {
    const buffer = c.create_string_buffer(4);
    c.writeValue(buffer, c.c_uint32, 0xdeadbeef);
    const value = c.c_uint32.from_buffer_copy(buffer);
    assert.equal(value.value, 0xdeadbeef);
    value.value = 0x12345678;
    assert.equal(c.readValue(buffer, c.c_uint32), 0xdeadbeef);
  });

  it("has JavaScript toString and valueOf conversions", function () {
    assert.equal(new c.c_uint32(42).toString(), "c_uint32(42)");
    assert.equal(new c.c_int32(42) + 0, 42);
  });

  it("readValue and writeValue accept SimpleCData classes", function () {
    const buffer = c.create_string_buffer(8);
    c.writeValue(buffer, c.c_uint64, 18446744073709551615n);
    assert.equal(c.readValue(buffer, c.c_uint64), 18446744073709551615n);
  });

  it("a plain contents assignment writes through instead of repointing", function () {
    const value = new c.c_int32(42);
    const pointer = c.pointer(value);
    pointer.contents = 99;
    assert.equal(pointer.contents.value, 99);
    assert.equal(value.value, 99);
  });

  it("deref aliases contents", function () {
    const pointer = c.pointer(new c.c_int32(42));
    assert.equal(pointer.deref().value, pointer.contents.value);
    assert.equal(pointer.deref().value, 42);
  });

  it("pointer address and isNull expose JavaScript representations", function () {
    const value = new c.c_int32(42);
    const pointer = c.pointer(value);
    assert.equal(pointer.isNull, false);
    assert.equal(c.addressof(value), pointer.address);
  });

  it("casts a PointerInstance constructed from a Buffer", function () {
    const IntPointer = c.POINTER(c.c_int32);
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(42);
    const pointer = c.cast(IntPointer.fromBuffer(buffer), IntPointer);
    assert.equal(pointer[0], 42);
  });

  it("casts a Buffer to its memory rather than interpreting its bytes as an address", function () {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(0x12345678);
    const pointer = c.cast(buffer, c.POINTER(c.c_int32));
    assert.equal(pointer.contents.value, 0x12345678);
  });

  it("casts a BigInt address without dereferencing", function () {
    const pointer = c.cast(0x12345678n, c.POINTER(c.c_int32));
    assert.equal(pointer.address, 0x12345678n);
  });

  it("POINTER.create constructs a NULL PointerInstance", function () {
    const pointer = c.POINTER(c.c_int32).create();
    assert.equal(pointer.isNull, true);
    assert.throws(() => pointer.contents, /NULL pointer/);
    assert.throws(() => pointer[0], /NULL pointer/);
  });

  it("fromAddress constructs a non-null pointer", function () {
    const pointer = c.POINTER(c.c_int32).fromAddress(0xdeadbeefn);
    assert.equal(pointer.address, 0xdeadbeefn);
    assert.equal(pointer.isNull, false);
  });

  it("fromAddress constructs NULL from zero", function () {
    assert.equal(c.POINTER(c.c_int32).fromAddress(0n).isNull, true);
  });

  it("fromAddress reads Buffer elements", function () {
    const buffer = Buffer.alloc(12);
    buffer.writeInt32LE(100, 0);
    buffer.writeInt32LE(200, 4);
    buffer.writeInt32LE(300, 8);
    const pointer = c.POINTER(c.c_int32).fromAddress(c.addressof(buffer));
    assert.deepEqual([pointer[0], pointer[1], pointer[2]], [100, 200, 300]);
  });

  it("fromAddress writes Buffer elements", function () {
    const buffer = Buffer.alloc(12);
    const pointer = c.POINTER(c.c_int32).fromAddress(c.addressof(buffer));
    pointer[0] = 11;
    pointer[1] = 22;
    pointer[2] = 33;
    assert.deepEqual([buffer.readInt32LE(0), buffer.readInt32LE(4), buffer.readInt32LE(8)], [11, 22, 33]);
  });

  it("fromAddress accepts an object-initialized structure", function () {
    class Point extends c.Structure {
      static _fields_ = [
        ["x", c.c_int32],
        ["y", c.c_int32],
      ];
    }
    const point = new Point({ x: 10, y: 20 });
    const pointer = c.POINTER(Point).fromAddress(c.addressof(point));
    assert.deepEqual([pointer.contents.x, pointer.contents.y], [10, 20]);
  });

  it("PointerInstance.set changes the target Buffer", function () {
    const first = Buffer.alloc(4),
      second = Buffer.alloc(4);
    first.writeInt32LE(42);
    second.writeInt32LE(100);
    const pointer = c.POINTER(c.c_int32).create();
    assert.equal(pointer.isNull, true);
    pointer.set(first);
    assert.equal(pointer.contents.value, 42);
    pointer.set(second);
    assert.equal(pointer.contents.value, 100);
  });

  it("PointerInstance.set changes the address", function () {
    const pointer = c.POINTER(c.c_int32).create();
    pointer.set(0x12345678n);
    assert.equal(pointer.address, 0x12345678n);
  });

  it("PointerInstance.toBuffer returns pointer-sized address bytes", function () {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(42);
    const pointer = c.POINTER(c.c_int32).fromBuffer(buffer);
    const address = pointer.toBuffer();
    assert.ok(Buffer.isBuffer(address));
    assert.equal(address.length, 8);
    assert.ok(address.readBigUInt64LE() > 0n);
  });

  it("PointerInstance.toString includes the type and address", function () {
    const text = c.POINTER(c.c_int32).create().toString();
    assert.ok(text.includes("pointer"));
    assert.ok(text.includes("0x0"));
  });

  it("func unwraps _as_parameter_ and honors from_param", function () {
    const library = new c.CDLL(LIBC);
    try {
      class Handle {
        constructor(value) {
          this._as_parameter_ = value;
        }
      }
      assert.equal(library.func("abs", c.c_int32, [c.c_int32])(new Handle(-42)), 42);
      class StrLen extends c.c_int32 {
        static from_param(value) {
          return typeof value === "string" ? value.length : value;
        }
      }
      const abs = library.func("abs", c.c_int32, [StrLen]);
      assert.equal(abs("hello"), 5);
      assert.equal(abs(-7), 7);
    } finally {
      library.close();
    }
  });

  it("func and prototype conversion errors preserve JavaScript causes", function () {
    const library = new c.CDLL(LIBC);
    const seen = [];
    class Strict extends c.c_int32 {
      static from_param(value) {
        seen.push(value?.constructor?.name ?? typeof value);
        if (typeof value === "string") throw new RangeError("no strings");
        return value;
      }
    }
    class Wrapped {
      constructor(value) {
        this._as_parameter_ = value;
      }
    }
    try {
      const abs = library.func("abs", c.c_int32, [Strict]);
      assert.equal(abs(new Wrapped(-3)), 3);
      assert.equal(abs(-4), 4);
      assert.deepEqual(seen, ["Wrapped", "Number"]);
      const prototype = c.CFUNCTYPE(c.c_int32, Strict)(["abs", library]);
      assert.equal(prototype(new Wrapped(-9)), 9);
      for (const fn of [abs, prototype]) {
        assert.throws(
          () => fn("x"),
          (error) => error instanceof c.ArgumentError && error.message === "argument 1: RangeError: no strings" && error.cause instanceof RangeError,
        );
      }
    } finally {
      library.close();
    }
  });
});
