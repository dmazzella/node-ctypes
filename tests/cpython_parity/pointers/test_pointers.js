import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { POINTER, pointer, c_int32, c_uint32, c_double, c_float, c_char, c_void_p, c_size_t, Structure, cast, sizeof, addressof, byref, ARRAY, CDLL } from "node-ctypes";
import { LIBC } from "../_support.js";

describe("TestPOINTERTypeCreation", function () {
  it("test_pointer_creates_pointer_type_factory", function () {
    const IntPtr = POINTER(c_int32);
    assert.notEqual(IntPtr, null);
    assert.equal(IntPtr._type_, c_int32);
  });
  it("test_pointer_type_repr", function () {
    assert.match(String(POINTER(c_int32)), /POINTER/);
  });
});

describe("TestPOINTERInstanceCreation", function () {
  it("test_create_null_pointer", function () {
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.create();
    assert.equal(p.isNull, true);
  });
  it("test_create_pointer_from_value", function () {
    const x = new c_int32(42);
    const p = pointer(x);
    assert.equal(p.isNull, false);
    assert.equal(p.contents.value, 42);
  });
});

describe("TestPOINTERContentsProperty", function () {
  it("test_contents_reads_value", function () {
    const x = new c_int32(42);
    const p = pointer(x);
    assert.equal(p.contents.value, 42);
  });
  it("test_contents_writes_value", function () {
    const x = new c_int32(42);
    const p = pointer(x);
    p.contents = new c_int32(100);
    assert.equal(p.contents.value, 100);
  });
  it("test_contents_assignment_retargets", function () {
    const original = new c_int32(42);
    const replacement = new c_int32(100);
    const p = pointer(original);
    p.contents = replacement;
    assert.equal(original.value, 42);
    assert.equal(addressof(p.contents), addressof(replacement));
  });
  it("test_contents_throws_on_null_pointer", function () {
    const p = POINTER(c_int32).create();
    assert.throws(() => p.contents, /NULL pointer access/);
  });
});

describe("TestPOINTERIndexing", function () {
  it("test_index_0_reads_value", function () {
    const x = new c_int32(42);
    assert.equal(pointer(x)[0], 42);
  });
  it("test_index_array", function () {
    const arr = ARRAY(c_int32, 3)(10, 20, 30);
    const p = cast(arr, POINTER(c_int32));
    assert.deepEqual([p[0], p[1], p[2]], [10, 20, 30]);
  });
  it("test_index_write", function () {
    const arr = ARRAY(c_int32, 3)(0, 0, 0);
    const p = cast(arr, POINTER(c_int32));
    p[0] = 100;
    p[1] = 200;
    p[2] = 300;
    assert.deepEqual([...arr], [100, 200, 300]);
  });
});

describe("TestPointerFunction", function () {
  it("test_pointer_creates_pointer_to_instance", function () {
    const x = new c_int32(42);
    const p = pointer(x);
    assert.notEqual(p, null);
    assert.equal(p.isNull, false);
    assert.equal(p[0], 42);
  });
  it("test_pointer_modifying_changes_original", function () {
    const x = new c_int32(42);
    pointer(x)[0] = 100;
    assert.equal(x.value, 100);
  });
  it("test_pointer_to_structure", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    const pt = new Point(10, 20);
    const p = pointer(pt);
    assert.notEqual(p, null);
    assert.equal(p.isNull, false);
    assert.deepEqual([p.contents.x, p.contents.y], [10, 20]);
  });
});

describe("TestPOINTERDifferentTypes", function () {
  it("test_pointer_to_double", function () {
    const x = new c_double(3.14159);
    assert.ok(Math.abs(pointer(x)[0] - 3.14159) < 0.000005);
  });
  it("test_pointer_to_char", function () {
    const arr = ARRAY(c_char, 3)("A", "B", "C");
    const p = cast(arr, POINTER(c_char));
    assert.deepEqual([p[0], p[1], p[2]], ["A", "B", "C"]);
  });
});

describe("TestPOINTERAddressOf", function () {
  it("test_addressof_returns_address", function () {
    const x = new c_int32(42);
    const addr = addressof(x);
    assert.equal(typeof addr, "bigint");
    assert.ok(addr > 0n);
  });
  it("test_pointer_and_addressof", function () {
    const x = new c_int32(42);
    const p = pointer(x);
    assert.equal(addressof(x), addressof(p.contents));
  });
});

describe("TestPOINTERInFunctionDefinitions", function () {
  let libc;
  before(() => {
    libc = new CDLL(LIBC);
  });
  it("test_pointer_as_argument_type", function () {
    const IntPtr = POINTER(c_int32);
    const memset = libc.memset;
    memset.argtypes = [IntPtr, c_int32, c_size_t];
    memset.restype = c_void_p;
    const buf = ARRAY(c_char, 10)();
    memset(cast(buf, IntPtr), 0x42, 10);
    assert.equal(buf[0], "B");
    assert.equal(buf[9], "B");
  });
  it("test_pointer_as_return_type", function () {
    const memchr = libc.memchr;
    memchr.argtypes = [c_void_p, c_int32, c_size_t];
    memchr.restype = POINTER(c_char);
    const buf = "Hello World";
    const result = memchr(buf, "W".charCodeAt(0), buf.length);
    assert.notEqual(result, null);
    assert.equal(result[0], "W");
  });
});

describe("TestCastWithPOINTER", function () {
  it("test_cast_array_to_pointer", function () {
    const arr = ARRAY(c_int32, 3)(100, 200, 300);
    const p = cast(arr, POINTER(c_int32));
    assert.deepEqual([p[0], p[1], p[2]], [100, 200, 300]);
  });
  it("test_cast_c_void_p_to_pointer", function () {
    const val = new c_int32(12345);
    const addr = addressof(val);
    const voidP = new c_void_p(addr);
    assert.equal(cast(voidP, POINTER(c_int32))[0], 12345);
  });
  it("test_cast_preserves_type", function () {
    const val = new c_double(3.14);
    assert.ok(Math.abs(cast(pointer(val), POINTER(c_double))[0] - 3.14) < 0.005);
  });
  it("test_cast_pointer_to_different_type", function () {
    const val = new c_float(1);
    assert.equal(cast(pointer(val), POINTER(c_uint32))[0], 0x3f800000);
  });
  it("test_cast_write_through", function () {
    const arr = ARRAY(c_int32, 2)(0, 0);
    const p = cast(arr, POINTER(c_int32));
    p[0] = 111;
    p[1] = 222;
    assert.deepEqual([...arr], [111, 222]);
  });
});

describe("TestAddressofExtras", function () {
  it("test_struct_addressof", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    const pt = new Point(10, 20);
    const addr = addressof(pt);
    assert.equal(typeof addr, "bigint");
    assert.ok(addr > 0n);
  });
  it("test_addressof_roundtrip", function () {
    const x = new c_int32(42);
    const addr = addressof(x);
    assert.equal(cast(new c_void_p(addr), POINTER(c_int32))[0], 42);
  });
});

describe("TestPointerDoubleArrayWalk", function () {
  it("test_double_array_walk", function () {
    const arr = ARRAY(c_double, 3)(1.1, 2.2, 3.3);
    const p = cast(arr, POINTER(c_double));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(p[i] - [1.1, 2.2, 3.3][i]) < 0.05);
  });
});

describe("TestByref", function () {
  it("test_byref_returns_reference", function () {
    assert.notEqual(byref(new c_int32(42)), null);
  });
  it("test_byref_struct", function () {
    class Point extends Structure {
      static _fields_ = [
        ["x", c_int32],
        ["y", c_int32],
      ];
    }
    assert.notEqual(byref(new Point(10, 20)), null);
  });
});

describe("TestCastBufferToPointer", function () {
  it("test_cast_points_to_buffer_memory", function () {
    const buf = ARRAY(c_int32, 1)(0x12345678);
    assert.equal(cast(buf, POINTER(c_int32)).contents.value, 0x12345678);
  });
});

describe("TestPointerArithmetic", function () {
  it("test_indexing_via_cast", function () {
    const arr = ARRAY(c_int32, 5)(10, 20, 30, 40, 50);
    const p = cast(arr, POINTER(c_int32));
    for (let i = 0; i < 5; i++) assert.equal(p[i], (i + 1) * 10);
  });
  it("test_write_via_indexing", function () {
    const arr = ARRAY(c_int32, 3)(0, 0, 0);
    const p = cast(arr, POINTER(c_int32));
    p[0] = 11;
    p[1] = 22;
    p[2] = 33;
    assert.deepEqual([...arr], [11, 22, 33]);
  });
});

describe("TestSelfRefPointer", function () {
  it("test_pointer_does_not_finalize_incomplete_type", function () {
    class Node extends Structure {}
    const NodePointer = POINTER(Node);
    const p = NodePointer.create();
    Node._fields_ = [["val", c_int32]];
    const value = new Node(7);
    p.contents = value;
    assert.equal(p.contents.val, 7);
    assert.equal(addressof(p.contents), addressof(value));
  });
  it("test_linked_list_class_body", function () {
    class Node extends Structure {}
    Node._fields_ = [
      ["val", c_int32],
      ["next", POINTER(Node)],
    ];
    assert.equal(sizeof(Node), sizeof(c_void_p) === 8 ? 16 : 8);
  });
  it("test_walk_two_element_chain", function () {
    class Node extends Structure {}
    Node._fields_ = [
      ["val", c_int32],
      ["next", POINTER(Node)],
    ];
    const a = new Node();
    a.val = 1;
    const b = new Node();
    b.val = 2;
    a.next = pointer(b);
    assert.notEqual(a.next, null);
    assert.equal(a.next.contents.val, 2);
  });
});
