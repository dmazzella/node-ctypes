/**
 * ctypes instances on native memory (from_address, in_dll, pointers) are
 * live: what C writes is read, what JS writes reaches C.
 *
 * Where external buffers are not allowed (Electron) these instances work on
 * a synchronized copy of the memory; run this file with
 * NODE_CTYPES_NO_EXTERNAL_BUFFERS=1 to test that mode on Node.js.
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import * as ctypes from "node-ctypes";

const { BigEndianStructure, CDLL, POINTER, Structure, Union, addressof, array, byref, c_char, c_int16, c_int32, c_uint8, c_double, c_size_t, c_void_p, memmove, memset, pointer, sizeof } = ctypes;

class Point extends Structure {
  static _fields_ = [
    ["x", c_int32],
    ["y", c_int32],
  ];
}

class Shape extends Structure {
  static _fields_ = [
    ["id", c_int32],
    ["origin", Point],
    ["weights", array(c_double, 3)],
    ["flags", c_int32, 4],
  ];
}

describe("Instances on native memory", function () {
  let libc, malloc, free, cmemset, cmemcpy;
  const blocks = [];

  // Memoria nativa (malloc), scritta e letta dal C con memset/memcpy.
  const allocate = (size) => {
    const address = malloc(size);
    blocks.push(address);
    cmemset(address, 0, size);
    return address;
  };
  const nativeBytes = (address, size) => {
    const out = Buffer.alloc(size);
    cmemcpy(out, address, size);
    return out;
  };
  const writeNative = (address, bytes) => cmemcpy(address, bytes, bytes.length);

  before(function () {
    const path = process.platform === "darwin" ? "/usr/lib/libSystem.dylib" : process.platform === "win32" ? "msvcrt.dll" : null;
    libc = new CDLL(path);
    malloc = libc.func("malloc", c_void_p, [c_size_t]);
    free = libc.func("free", ctypes.c_void, [c_void_p]);
    cmemset = libc.func("memset", c_void_p, [c_void_p, c_int32, c_size_t]);
    cmemcpy = libc.func("memcpy", c_void_p, [c_void_p, c_void_p, c_size_t]);
  });

  after(function () {
    for (const address of blocks) free(address);
    libc.close();
  });

  it("EXTERNAL_BUFFERS is a boolean", function () {
    assert.strictEqual(typeof ctypes.EXTERNAL_BUFFERS, "boolean");
  });

  it("simple types: C writes are read, JS writes reach C", function () {
    const address = allocate(4);
    const value = c_int32.from_address(address);
    cmemset(address, 1, 4);
    assert.strictEqual(value.value, 0x01010101);
    value.value = -7;
    assert.strictEqual(nativeBytes(address, 4).readInt32LE(0), -7);
    assert.strictEqual(addressof(value), address);
  });

  it("structures: fields, nested structures, arrays and bitfields", function () {
    const address = allocate(sizeof(Shape));
    const shape = Shape.from_address(address);
    const origin = sizeof(c_int32);
    const weights = Shape._structDef.fields.find((f) => f.name === "weights").offset;
    const flags = Shape._structDef.fields.find((f) => f.name === "flags").offset;

    const bytes = Buffer.alloc(sizeof(Shape));
    bytes.writeInt32LE(11, 0);
    bytes.writeInt32LE(-3, origin + 4);
    bytes.writeDoubleLE(2.5, weights + 8);
    writeNative(address, bytes);
    assert.strictEqual(shape.id, 11);
    assert.strictEqual(shape.origin.y, -3);
    assert.strictEqual(shape.weights[1], 2.5);
    assert.deepStrictEqual(Shape._structDef.toObject(shape._buffer).id, 11);

    const nested = shape.origin;
    shape.id = 42;
    nested.x = 5;
    shape.weights[2] = -1.25;
    shape.flags = 9;
    const after = nativeBytes(address, sizeof(Shape));
    assert.strictEqual(after.readInt32LE(0), 42);
    assert.strictEqual(after.readInt32LE(origin), 5);
    assert.strictEqual(after.readDoubleLE(weights + 16), -1.25);
    assert.strictEqual(after.readInt32LE(flags) & 0xf, 9);

    // Un'istanza ottenuta prima della scrittura del C la vede comunque.
    writeNative(address + BigInt(origin), Buffer.from([0x63, 0, 0, 0]));
    assert.strictEqual(nested.x, 0x63);
    assert.strictEqual(addressof(nested), address + BigInt(origin));
  });

  it("unions, arrays of structures, char arrays, big-endian and subclasses", function () {
    class Value extends Union {
      static _fields_ = [
        ["i", c_int32],
        ["b", array(c_uint8, 4)],
      ];
    }
    class Record extends Structure {
      static _fields_ = [
        ["name", array(c_char, 8)],
        ["points", array(Point, 2)],
        ["value", Value],
        ["low", c_int16, 3],
        ["high", c_int16, 5],
      ];
    }
    class Wire extends BigEndianStructure {
      static _fields_ = [["n", c_int32]];
    }
    class Counter extends c_int32 {}

    const address = allocate(sizeof(Record));
    const record = Record.from_address(address);
    const off = (name) => Record._structDef.fields.find((f) => f.name === name).offset;

    record.name = "abc";
    record.points[1].y = 9;
    record.value.i = 0x01020304;
    record.low = -2;
    record.high = 7;
    const bytes = nativeBytes(address, sizeof(Record));
    assert.strictEqual(bytes.toString("latin1", 0, 3), "abc");
    assert.strictEqual(bytes.readInt32LE(off("points") + 12), 9);
    assert.strictEqual(bytes.readInt32LE(off("value")), 0x01020304);
    const bits = bytes.readUInt16LE(off("low"));
    assert.deepStrictEqual([bits & 0x7, (bits >> 3) & 0x1f], [-2 & 0x7, 7]);

    writeNative(address, Buffer.from("xyz\0"));
    writeNative(address + BigInt(off("points") + 8), Buffer.from([4, 0, 0, 0]));
    writeNative(address + BigInt(off("value")), Buffer.from([0xaa]));
    assert.strictEqual(record.name, "xyz");
    assert.strictEqual(record.points[1].x, 4);
    assert.strictEqual(record.value.b[0], 0xaa);
    assert.deepStrictEqual([record.low, record.high], [-2, 7]);

    // Un bitfield scritto da JS non sovrascrive l'altro, cambiato dal C.
    const unit = nativeBytes(address + BigInt(off("low")), 2).readUInt16LE(0);
    writeNative(address + BigInt(off("low")), Buffer.from([(unit & ~0xf8) | (3 << 3), unit >> 8]));
    record.low = 1;
    assert.deepStrictEqual([record.low, record.high], [1, 3]);

    const wire = Wire.from_address(address);
    wire.n = 0x01020304;
    assert.deepStrictEqual([...nativeBytes(address, 4)], [1, 2, 3, 4]);
    assert.strictEqual(wire.n, 0x01020304);

    const counter = Counter.from_address(address);
    assert.ok(counter instanceof Counter);
    counter.value = 5;
    assert.strictEqual(nativeBytes(address, 4).readInt32LE(0), 5);
  });

  it("pointers: contents and indexing", function () {
    const address = allocate(4 * 4);
    const p = POINTER(c_int32).fromAddress(address);
    p[2] = 77;
    assert.strictEqual(nativeBytes(address, 16).readInt32LE(8), 77);
    writeNative(address + 4n, Buffer.from([5, 0, 0, 0]));
    assert.strictEqual(p[1], 5);
    p.contents = 13;
    assert.strictEqual(nativeBytes(address, 4).readInt32LE(0), 13);

    const pp = POINTER(Point).fromAddress(address);
    pp.contents.y = 21;
    assert.strictEqual(nativeBytes(address, 8).readInt32LE(4), 21);
    assert.strictEqual(pp[1].x, 77);

    // Un puntatore a un'istanza su memoria nativa ne ha l'indirizzo.
    const point = Point.from_address(address);
    assert.strictEqual(pointer(point).address, address);
    assert.strictEqual(pointer(point).contents.y, 21);
  });

  it("passed to C functions by reference, the native memory is used", function () {
    const address = allocate(sizeof(Point));
    const point = Point.from_address(address);
    const source = new Point();
    source.x = 3;
    source.y = 4;
    cmemcpy(point, source, sizeof(Point));
    assert.deepStrictEqual([point.x, point.y], [3, 4]);
    source.x = 30;
    cmemcpy(byref(point), byref(source), sizeof(Point));
    assert.strictEqual(point.x, 30);
    point.y = 40;
    const copy = new Point();
    cmemcpy(copy, point._buffer, sizeof(Point));
    assert.strictEqual(copy.y, 40);
  });

  it("passed by value, the current bytes are used", function () {
    const address = allocate(sizeof(Point));
    const point = Point.from_address(address);
    writeNative(address, Buffer.from([0xfa, 0xff, 0xff, 0xff, 7, 0, 0, 0]));
    // Una struct di 8 byte per valore viaggia in un registro (x86-64, arm64):
    // abs() dichiarata con un Point riceve x nei 32 bit bassi.
    const absPoint = libc.func("abs", c_int32, [Point]);
    assert.strictEqual(absPoint(point), 6);
  });

  it("memmove and memset with addresses and instances", function () {
    const address = allocate(8);
    const value = c_int32.from_address(address + 4n);
    memset(address, 0x7f, 8);
    assert.strictEqual(value.value, 0x7f7f7f7f);
    memmove(value, Buffer.from([1, 2, 3, 4]), 4);
    assert.deepStrictEqual([...nativeBytes(address, 8)], [0x7f, 0x7f, 0x7f, 0x7f, 1, 2, 3, 4]);
    memset(value, 0, 4);
    const out = Buffer.alloc(4);
    memmove(out, address, 4);
    assert.deepStrictEqual([...out], [0x7f, 0x7f, 0x7f, 0x7f]);
    assert.strictEqual(value.value, 0);
  });

  it("arrays: elements are live, _buffer is the memory or a copy", function () {
    const address = allocate(16);
    const bytes = array(c_uint8, 16).from_address(address);
    cmemset(address, 2, 4);
    assert.strictEqual(bytes[3], 2);
    bytes[5] = 9;
    assert.strictEqual(nativeBytes(address, 16)[5], 9);
    assert.strictEqual(addressof(bytes), address);
    // Buffer over the memory (Python: memoryview); a copy without external buffers.
    const view = new Uint32Array(bytes._buffer.buffer, bytes._buffer.byteOffset, 4);
    view[3] = 0x01020304;
    assert.strictEqual(nativeBytes(address, 16).readUInt32LE(12), ctypes.EXTERNAL_BUFFERS ? 0x01020304 : 0);
    // The array (and memmove) still write through, also from the copy.
    memmove(bytes, Buffer.from([7, 7]), 2);
    assert.deepStrictEqual([...nativeBytes(address, 2)], [7, 7]);
  });
});
