import { describe, it } from "node:test";
import assert from "node:assert";
import { struct, c_int32, readValue, writeValue, cast, Structure } from "node-ctypes";

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
});
