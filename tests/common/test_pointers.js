/**
 * Test suite for POINTER and pointer() functions
 * Tests Python ctypes-compatible pointer API
 */

import test from "node:test";
import assert from "node:assert";
import {
  POINTER,
  pointer,
  c_int32,
  c_double,
  c_char,
  struct,
  Structure,
} from "../../lib/index.js";

test("POINTER type creation", async (t) => {
  await t.test("POINTER creates a pointer type factory", () => {
    const IntPtr = POINTER(c_int32);
    assert.ok(IntPtr, "POINTER should return a type");
    assert.ok(IntPtr._pointerTo, "Should have _pointerTo property");
    assert.strictEqual(IntPtr._pointerTo, c_int32, "_pointerTo should reference the base type");
    assert.strictEqual(typeof IntPtr.create, "function", "Should have create method");
    assert.strictEqual(typeof IntPtr.fromBuffer, "function", "Should have fromBuffer method");
    assert.strictEqual(typeof IntPtr.fromAddress, "function", "Should have fromAddress method");
  });

  await t.test("POINTER toString shows type name", () => {
    const IntPtr = POINTER(c_int32);
    const str = IntPtr.toString();
    assert.ok(str.includes("POINTER"), "toString should include POINTER");
  });
});

test("POINTER instance creation", async (t) => {
  await t.test("create() creates NULL pointer", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    assert.ok(p, "create should return an instance");
    assert.strictEqual(p.address, 0n, "New pointer should be NULL");
    assert.strictEqual(p.isNull, true, "isNull should be true");
  });

  await t.test("fromBuffer creates pointer to buffer", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(42, 0);

    const p = IntPtr.fromBuffer(buf);
    assert.ok(!p.isNull, "Pointer should not be NULL");
    assert.ok(p.address !== 0n, "Pointer address should not be 0");
  });

  await t.test("fromAddress creates pointer from address", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.fromAddress(0x12345678n);
    assert.strictEqual(p.address, 0x12345678n, "Address should match");
  });
});

test("POINTER .contents property", async (t) => {
  await t.test(".contents reads value at pointer address", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(42, 0);

    const p = IntPtr.fromBuffer(buf);
    assert.strictEqual(p.contents, 42, ".contents should read the value");
  });

  await t.test(".contents writes value at pointer address", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(42, 0);

    const p = IntPtr.fromBuffer(buf);
    p.contents = 100;
    assert.strictEqual(buf.readInt32LE(0), 100, "Buffer should be modified");
    assert.strictEqual(p.contents, 100, ".contents should read new value");
  });

  await t.test(".contents throws on NULL pointer", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    assert.throws(() => p.contents, /NULL pointer/);
  });
});

test("POINTER indexing", async (t) => {
  await t.test("[0] reads value at pointer address", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(42, 0);

    const p = IntPtr.fromBuffer(buf);
    assert.strictEqual(p[0], 42, "p[0] should read the value");
  });

  await t.test("[n] reads value with offset", () => {
    const IntPtr = POINTER(c_int32);
    // Array of 3 int32s
    const buf = Buffer.alloc(12);
    buf.writeInt32LE(10, 0);
    buf.writeInt32LE(20, 4);
    buf.writeInt32LE(30, 8);

    const p = IntPtr.fromBuffer(buf);
    assert.strictEqual(p[0], 10);
    assert.strictEqual(p[1], 20);
    assert.strictEqual(p[2], 30);
  });

  await t.test("[n] = value writes with offset", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(12);

    const p = IntPtr.fromBuffer(buf);
    p[0] = 100;
    p[1] = 200;
    p[2] = 300;

    assert.strictEqual(buf.readInt32LE(0), 100);
    assert.strictEqual(buf.readInt32LE(4), 200);
    assert.strictEqual(buf.readInt32LE(8), 300);
  });

  await t.test("[n] throws on NULL pointer", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    assert.throws(() => p[0], /NULL pointer/);
  });
});

test("POINTER deref() method", async (t) => {
  await t.test("deref() is alias for .contents", () => {
    const IntPtr = POINTER(c_int32);
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(42, 0);

    const p = IntPtr.fromBuffer(buf);
    assert.strictEqual(p.deref(), 42);
    assert.strictEqual(p.deref(), p.contents);
  });
});

test("POINTER set() method", async (t) => {
  await t.test("set() changes pointer target buffer", () => {
    const IntPtr = POINTER(c_int32);
    const buf1 = Buffer.alloc(4);
    buf1.writeInt32LE(42, 0);
    const buf2 = Buffer.alloc(4);
    buf2.writeInt32LE(100, 0);

    const p = IntPtr.create();
    assert.ok(p.isNull);

    p.set(buf1);
    assert.strictEqual(p.contents, 42);

    p.set(buf2);
    assert.strictEqual(p.contents, 100);
  });

  await t.test("set() can set to address", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    p.set(0x12345678n);
    assert.strictEqual(p.address, 0x12345678n);
  });
});

test("pointer() function", async (t) => {
  await t.test("pointer(SimpleCData) creates pointer to instance", () => {
    const x = new c_int32(42);
    const p = pointer(x);
    assert.ok(p, "pointer should return an instance");
    assert.ok(!p.isNull, "Pointer should not be NULL");
    assert.strictEqual(p.contents, 42, ".contents should read the value");
  });

  await t.test("pointer() modifying contents modifies original", () => {
    const x = new c_int32(42);
    const p = pointer(x);
    p.contents = 100;
    assert.strictEqual(x.value, 100, "Original value should be modified");
  });

  await t.test("pointer(Buffer) creates generic pointer", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(0x123456789ABCDEFn, 0);
    const p = pointer(buf);
    assert.ok(p, "pointer should return an instance");
    assert.ok(!p.isNull, "Pointer should not be NULL");
  });

  await t.test("pointer(Structure) creates pointer to struct", () => {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }

    const pt = new Point({ x: 10, y: 20 });
    const p = pointer(pt);
    assert.ok(p, "pointer should return an instance");
    assert.ok(!p.isNull, "Pointer should not be NULL");
  });

  await t.test("pointer() throws for invalid argument", () => {
    assert.throws(() => pointer("string"), /TypeError/);
    assert.throws(() => pointer(42), /TypeError/);
    assert.throws(() => pointer({}), /TypeError/);
  });
});

test("POINTER with different types", async (t) => {
  await t.test("POINTER(c_double)", () => {
    const DoublePtr = POINTER(c_double);
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(3.14159, 0);

    const p = DoublePtr.fromBuffer(buf);
    assert.ok(Math.abs(p.contents - 3.14159) < 0.00001);
  });

  await t.test("POINTER(c_char)", () => {
    const CharPtr = POINTER(c_char);
    const buf = Buffer.alloc(3);
    buf[0] = 65; // 'A'
    buf[1] = 66; // 'B'
    buf[2] = 67; // 'C'

    const p = CharPtr.fromBuffer(buf);
    assert.strictEqual(p[0], 65);
    assert.strictEqual(p[1], 66);
    assert.strictEqual(p[2], 67);
  });
});

test("POINTER toString on instances", async (t) => {
  await t.test("instance toString shows address", () => {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    const str = p.toString();
    assert.ok(str.includes("pointer"), "Should contain 'pointer'");
    assert.ok(str.includes("0x0"), "Should contain address");
  });
});

test("POINTER in function definitions", async (t) => {
  // Import CDLL for function tests
  const { CDLL, c_void_p, c_size_t } = await import("../../lib/index.js");

  // Platform-specific C library
  let libc;
  if (process.platform === "win32") {
    libc = new CDLL("msvcrt");
  } else if (process.platform === "darwin") {
    libc = new CDLL("libSystem.B.dylib");
  } else {
    // Linux: try libc.so.6, fallback to null
    try {
      libc = new CDLL("libc.so.6");
    } catch {
      libc = new CDLL(null);
    }
  }

  await t.test("POINTER type can be used as function argument type", () => {
    const IntPtr = POINTER(c_int32);

    // Define memset with pointer argument
    const memset = libc.func("memset", c_void_p, [IntPtr, c_int32, c_size_t]);

    // Create buffer and call memset
    const buf = Buffer.alloc(10);
    memset(buf, 0x42, 10);

    // Verify buffer was filled
    assert.strictEqual(buf[0], 0x42);
    assert.strictEqual(buf[9], 0x42);
  });

  await t.test("POINTER type can be used as return type", () => {
    const IntPtr = POINTER(c_int32);

    // memchr returns a pointer
    const memchr = libc.func("memchr", IntPtr, [c_void_p, c_int32, c_size_t]);

    const buf = Buffer.from("Hello World");
    const result = memchr(buf, "W".charCodeAt(0), buf.length);

    // memchr should return a pointer (non-null since 'W' exists)
    assert.ok(result !== 0n && result !== null, "memchr should find 'W'");
  });
});
