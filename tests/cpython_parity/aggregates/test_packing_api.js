import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Structure, Union, addressof, alignment, c_int32, c_uint8, c_uint32, sizeof, string_at } from "node-ctypes";

describe("TestPackingAPI", function () {
  it("test_ms_pack_values", function () {
    for (const pack of [0, 1, 2, 3, 4, 5, true, false, 3.9, "3", null]) {
      for (const Base of [Structure, Union]) {
        class Record extends Base {
          static _layout_ = "ms";
          static _pack_ = pack;
          static _fields_ = [
            ["a", c_uint8],
            ["b", c_uint32],
          ];
        }
        const value = pack === null ? 0 : Math.trunc(Number(pack));
        const expected_alignment = value ? Math.min(value, 4) : 4;
        const offset = Base === Union ? 0 : value === 1 ? 1 : value === 2 ? 2 : value === 3 ? 3 : 4;
        const size = Math.ceil((Base === Union ? 4 : offset + 4) / expected_alignment) * expected_alignment;
        assert.equal(sizeof(Record), size);
        assert.equal(alignment(Record), expected_alignment);
        assert.equal(Record.fields[1].offset, offset);
        const record = new Record();
        record.b = 0x11223344;
        assert.equal(Buffer.from(string_at(addressof(record), sizeof(record)), "latin1").readUInt32LE(offset), 0x11223344);
      }
    }
  });

  it("test_explicit_gcc_pack", function () {
    for (const pack of [0, 1, 3, false]) {
      assert.throws(() => {
        class Record extends Structure {
          static _layout_ = "gcc-sysv";
          static _pack_ = pack;
          static _fields_ = [["value", c_int32]];
        }
        sizeof(Record);
      }, /_pack_.*gcc-sysv/);
    }
    class Unset extends Structure {
      static _layout_ = "gcc-sysv";
      static _pack_ = null;
      static _fields_ = [["value", c_int32]];
    }
    assert.equal(sizeof(Unset), 4);
  });

  it("test_invalid_pack_values", function () {
    for (const pack of [-1, Infinity, NaN, {}, "3.5", 2 ** 31]) {
      assert.throws(() => {
        class Record extends Structure {
          static _pack_ = pack;
          static _fields_ = [["value", c_int32]];
        }
        sizeof(Record);
      }, /_pack_/);
    }
  });

  it("test_non_power_two_layout", function () {
    class Record extends Structure {
      static _layout_ = "ms";
      static _pack_ = 3;
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint32],
      ];
    }
    assert.equal(sizeof(Record), 9);
    assert.equal(alignment(Record), 3);
    assert.equal(Record.fields[1].offset, 3);
    const record = new Record();
    record.b = 0x11223344;
    assert.equal(Buffer.from(string_at(addressof(record), sizeof(record)), "latin1").readUInt32LE(3), 0x11223344);
  });
});
