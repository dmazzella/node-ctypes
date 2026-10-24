import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("packing API compatibility", function () {
  for (const pack of [0, 1, 2, 3, 4, 5, true, false, 3.9, "3", null]) {
    for (const Base of [c.Structure, c.Union]) {
      it(`${Base.name} accepts MS pack=${String(pack)}`, function () {
        class Record extends Base {
          static _layout_ = "ms";
          static _pack_ = pack;
          static _fields_ = [
            ["a", c.c_uint8],
            ["b", c.c_uint32],
          ];
        }
        const value = pack == null ? 0 : Math.trunc(Number(pack));
        const alignment = value ? Math.min(value, 4) : 4;
        const offset = Base === c.Union ? 0 : value === 1 ? 1 : value === 2 ? 2 : value === 3 ? 3 : 4;
        const size = Math.ceil((Base === c.Union ? 4 : offset + 4) / alignment) * alignment;
        assert.equal(c.sizeof(Record), size);
        assert.equal(c.alignment(Record), alignment);
        assert.equal(Record.fields[1].offset, offset);
        const record = new Record();
        record.b = 0x11223344;
        assert.equal(record._buffer.readUInt32LE(offset), 0x11223344);
      });
    }
  }
  it("explicit GCC layout rejects any explicitly declared pack, including zero", function () {
    for (const pack of [0, 1, 3, false]) {
      class Record extends c.Structure {
        static _layout_ = "gcc-sysv";
        static _pack_ = pack;
        static _fields_ = [["value", c.c_int32]];
      }
      assert.throws(() => c.sizeof(Record), /_pack_.*gcc-sysv/);
    }
    class Unset extends c.Structure {
      static _layout_ = "gcc-sysv";
      static _pack_ = null;
      static _fields_ = [["value", c.c_int32]];
    }
    assert.equal(c.sizeof(Unset), 4);
  });
  it("invalid pack values remain explicit errors", function () {
    for (const pack of [-1, Infinity, NaN, {}, "3.5", 2 ** 31]) {
      class Record extends c.Structure {
        static _pack_ = pack;
        static _fields_ = [["value", c.c_int32]];
      }
      assert.throws(() => c.sizeof(Record), /_pack_/);
    }
  });
  it("non-power-of-two layouts are serializable but cannot pretend to be a native ABI", function () {
    class Record extends c.Structure {
      static _layout_ = "ms";
      static _pack_ = 3;
      static _fields_ = [
        ["a", c.c_uint8],
        ["b", c.c_uint32],
      ];
    }
    const library = new c.CDLL(null);
    try {
      assert.equal(c.sizeof(Record), 9);
      assert.throws(() => library.func("abs", c.c_int32, [Record]), /power-of-two alignment/);
      assert.throws(() => new c.StructType({ alignment: 3 }), /power of two/);
      assert.throws(() => new c.StructType({ alignment: 2.1 }), /power of two/);
    } finally {
      library.close();
    }
  });
});
