import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as ctypes from "node-ctypes";
import { LIBC, bytes } from "../_support.js";
const { CDLL, Structure, Union, POINTER, pointer, ARRAY, sizeof, alignment, CFUNCTYPE, ArgumentError, create_string_buffer, create_unicode_buffer, c_buffer, c_int, c_char, c_wchar, c_char_p, c_void_p, c_size_t } = ctypes;
const platform = process.platform;

describe("TestPythonParity", function () {
  let libc;
  before(() => {
    libc = new CDLL(LIBC);
  });
  after(() => {
    if (libc) libc.close();
  });
  it("test_integer_like_field_names_keep_order", function () {
    class S extends Structure {
      static _fields_ = [
        ["a", ctypes.c_int8],
        ["1", c_int],
      ];
    }
    const s = new S();
    s.a = 1;
    s["1"] = 2;
    assert.strictEqual(sizeof(S), 8);
    assert.deepStrictEqual([...bytes(s)], [1, 0, 0, 0, 2, 0, 0, 0]);
  });

  it("test_union_anonymous_members", function () {
    class P extends Structure {
      static _fields_ = [["x", c_int]];
    }
    class Q extends Structure {
      static _fields_ = [
        ["p", P],
        ["z", c_int],
      ];
      static _anonymous_ = ["p"];
    }
    class U extends Union {
      static _fields_ = [
        ["q", Q],
        ["i", c_int],
      ];
      static _anonymous_ = ["q"];
    }
    const u = new U();
    u.x = 7;
    assert.deepStrictEqual([u.i, u.x, u.z, u.q.p.x], [7, 7, 0, 7]);
  });

  it("test_malformed_fields", function () {
    class M extends Structure {
      static _fields_ = [["x"]];
    }
    assert.throws(() => sizeof(M), { name: "TypeError", message: /_fields_ must be a sequence of \(name, C type\) pairs/ });
  });

  it("test_struct_positional_instance", function () {
    class POINT extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    class RECT extends Structure {
      static _fields_ = [
        ["a", POINT],
        ["b", POINT],
      ];
    }
    const r = new RECT(new POINT(1, 2), new POINT(3, 4));
    assert.deepStrictEqual([r.a.x, r.b.y], [1, 4]);
  });

  it("test_nested_field_is_instance_on_same_memory", function () {
    class POINT extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    class RECT extends Structure {
      static _fields_ = [
        ["a", POINT],
        ["b", POINT],
      ];
    }
    class Value extends Union {
      static _fields_ = [
        ["p", POINT],
        ["n", ctypes.c_int64],
      ];
    }
    const r = new RECT(new POINT(1, 2), new POINT(3, 4));
    const a = r.a;
    assert.ok(a instanceof POINT);
    a.x = 10;
    assert.strictEqual(r.a.x, 10);
    r.a = new POINT(5, 6);
    assert.deepStrictEqual([a.x, a.y], [5, 6]);
    assert.strictEqual(ctypes.addressof(r.b), ctypes.addressof(r) + BigInt(sizeof(POINT)));
    const v = new Value();
    v.p.y = 7;
    assert.ok(v.p instanceof POINT);
    assert.strictEqual(v.n, 7n << 32n);
  });

  it("test_nested_instances_copied_bytewise", function () {
    class Data extends Union {
      static _fields_ = [
        ["s", ctypes.c_wchar_p],
        ["Integer", ctypes.c_ulong],
      ];
    }
    class Value extends Structure {
      static _fields_ = [
        ["dwType", ctypes.c_ulong],
        ["Value", Data],
      ];
    }
    const v = new Value(7, new Data({ Integer: 1000 }));
    assert.deepStrictEqual([v.dwType, v.Value.Integer], [7n, 1000n]);
    const prefs = ARRAY(Value, 2)(v, new Value(6, new Data({ s: "text" })));
    assert.deepStrictEqual([prefs[0].Value.Integer, prefs[1].Value.s], [1000n, "text"]);
  });

  it("test_char_array_field", function () {
    class Named extends Structure {
      static _fields_ = [["name", ARRAY(c_char, 8)]];
    }
    const n = new Named();
    n.name = "abc";
    assert.strictEqual(n.name, "abc");
  });

  it("test_null_pointer_field", function () {
    class Node extends Structure {
      static _fields_ = [["next", POINTER(c_int)]];
    }
    assert.strictEqual(new Node().next, null);
  });

  it("test_pointer_contents_instance", function () {
    class POINT extends Structure {
      static _fields_ = [
        ["x", c_int],
        ["y", c_int],
      ];
    }
    const p = new POINT(3, 4);
    const pp = pointer(p);
    assert.ok(pp.contents instanceof POINT);
    pp.contents.x = 7;
    assert.strictEqual(p.x, 7);
  });

  it("test_cfunctype_fields", function () {
    const FT = CFUNCTYPE(c_int, c_int);
    class Ops extends Structure {
      static _fields_ = [
        ["n", c_int],
        ["f", FT],
      ];
    }
    class OpsU extends Union {
      static _fields_ = [
        ["f", FT],
        ["i", c_int],
      ];
    }
    const cb = FT((x) => x * 3);
    try {
      const o = new Ops(1, cb);
      assert.strictEqual(o.f(14), 42);
      assert.strictEqual(new Ops().f, null);
      const u = new OpsU();
      u.f = cb;
      assert.strictEqual(u.f(5), 15);
      assert.throws(() => (o.f = (x) => x), TypeError);
      assert.strictEqual(sizeof(Ops), 2 * sizeof(c_void_p));
      assert.strictEqual(sizeof(FT), sizeof(c_void_p));
      assert.strictEqual(alignment(FT), alignment(c_void_p));
    } finally {
      cb.release();
    }
  });
});
