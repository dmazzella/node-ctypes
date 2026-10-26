import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARRAY, ArgumentError, addressof, c_uint8, create_string_buffer, sizeof, string_at } from "node-ctypes";

describe("TestBinaryStringAt", function () {
  it("test_exact_sized_bytes", function () {
    const value = ARRAY(c_uint8, 4)(0, 0x80, 0xff, 0xda);
    const raw = string_at(addressof(value), sizeof(value));
    assert.equal(typeof raw, "string");
    assert.equal(raw.length, 4);
    assert.deepEqual(Buffer.from(raw, "latin1"), Buffer.from([0, 0x80, 0xff, 0xda]));
    assert.deepEqual(Buffer.from(string_at(value, sizeof(value)), "latin1"), Buffer.from([0, 0x80, 0xff, 0xda]));
  });

  it("test_sized_embedded_nul", function () {
    const value = create_string_buffer(Buffer.from([0x41, 0, 0x42, 0xff]), 4);
    const raw = string_at(addressof(value), sizeof(value));
    assert.deepEqual(Buffer.from(raw, "latin1"), Buffer.from([0x41, 0, 0x42, 0xff]));
  });

  it("test_zero_length", function () {
    const value = create_string_buffer("Hello");
    for (const source of [value, addressof(value), null, 0n]) {
      assert.equal(string_at(source, 0), "");
    }
  });

  it("test_text_without_size", function () {
    const value = create_string_buffer(Buffer.from("Hello\0ignored"));
    assert.equal(string_at(addressof(value)), "Hello");
    assert.equal(string_at(value), "Hello");
  });

  it("test_sized_text", function () {
    const value = create_string_buffer("Hello, world!");
    assert.equal(string_at(addressof(value), 5), "Hello");
    assert.equal(string_at(value, 5), "Hello");
  });

  it("test_utf8_text_and_sized_bytes", function () {
    const value = create_string_buffer(Buffer.from("café", "utf8"));
    assert.equal(string_at(addressof(value)), "café");
    assert.deepEqual(Buffer.from(string_at(addressof(value), sizeof(value)), "latin1"), Buffer.from("café\0", "utf8"));
  });

  it("test_invalid_address", function () {
    assert.throws(() => string_at({}), ArgumentError);
    assert.throws(() => string_at({}, 0), ArgumentError);
    assert.throws(() => string_at({}, 1), ArgumentError);
  });
});
