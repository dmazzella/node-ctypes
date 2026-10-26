import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("TestApiCompatibility", function () {
  it("test_ms_pack", function () {
    for (const pack of [0, 1, 2, 3, 4, 5, true, false, 3.9, "3", null]) {
      class Record extends c.Structure {
        static _layout_ = "ms";
        static _pack_ = pack;
        static _fields_ = [
          ["a", c.c_uint8],
          ["b", c.c_uint32],
        ];
      }
      const value = pack === null ? 0 : Math.trunc(Number(pack));
      const alignment = value ? Math.min(value, 4) : 4;
      const offset = [1, 2, 3].includes(value) ? value : 4;
      assert.equal(c.alignment(Record), alignment);
      const field = Record.fields.find((entry) => entry.name === "b");
      assert.ok(field, "the declared field must expose layout metadata");
      assert.equal(field.offset, offset);
    }
  });
  it("test_explicit_gcc_pack", function () {
    for (const pack of [0, false, 3]) {
      assert.throws(() => {
        class Invalid extends c.Structure {
          static _layout_ = "gcc-sysv";
          static _pack_ = pack;
          static _fields_ = [["value", c.c_int32]];
        }
        c.sizeof(Invalid);
      }, /_pack_|gcc-sysv/);
    }
  });
});
