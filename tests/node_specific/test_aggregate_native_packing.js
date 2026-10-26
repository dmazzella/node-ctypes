// Node's native builders require power-of-two ABI alignment.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("Node native ABI alignment validation", function () {
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
