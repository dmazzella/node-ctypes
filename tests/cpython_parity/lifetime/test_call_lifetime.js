import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { FIXTURE, LIBC } from "../_support.js";

const { ARRAY } = c;
const IntPointer = c.POINTER(c.c_int32);

class Record extends c.Structure {
  static _fields_ = [["p", IntPointer]];
}
class Value extends c.Union {
  static _fields_ = [["p", IntPointer]];
}

describe("TestCallLifetime", function () {
  let lib;
  beforeEach(() => {
    lib = new c.CDLL(FIXTURE);
  });

  it("test_function_keeps_library_loaded", function () {
    function bind() {
      const library = new c.CDLL(LIBC);
      const function_ = library.abs;
      function_.argtypes = [c.c_int32];
      function_.restype = c.c_int32;
      return function_;
    }
    const function_ = bind();
    assert.equal(function_(-3), 3);
    assert.equal(function_(-4), 4);
  });

  it("test_prototype_keeps_library_loaded", function () {
    function bind() {
      const library = new c.CDLL(LIBC);
      return c.CFUNCTYPE(c.c_int32, c.c_int32)(["abs", library]);
    }
    const function_ = bind();
    assert.equal(function_(-4), 4);
    assert.equal(function_(-3), 3);
  });

  it("test_reentrant_bsearch", function () {
    const libc = new c.CDLL(LIBC);
    const search = libc.bsearch;
    search.argtypes = [c.c_char_p, c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p];
    search.restype = c.c_void_p;
    const base = c.create_string_buffer("abc", 3);
    let nested = false;
    const inner = [];
    const callback = c.CFUNCTYPE(
      c.c_int32,
      c.c_void_p,
      c.c_void_p,
    )((key, element) => {
      if (!nested) {
        nested = true;
        try {
          inner.push(search("z", base, 3, 1, callback));
        } finally {
          nested = false;
        }
      }
      return c.cast(key, c.POINTER(c.c_uint8))[0] - c.cast(element, c.POINTER(c.c_uint8))[0];
    });
    const found = search("b", base, 3, 1, callback);
    assert.ok(inner.length > 0);
    assert.ok(inner.every((result) => result === null));
    assert.equal(found - c.addressof(base), 1n);
  });

  it("test_converted_arguments_survive_native_entry", function () {
    class Temporary extends c.c_void_p {
      static from_param() {
        const owner = c.create_string_buffer("A".repeat(4096));
        return c.cast(owner, c.POINTER(c.c_uint8));
      }
    }
    class Nested extends c.c_void_p {
      static from_param() {
        const address = lib.fixture_address;
        address.argtypes = [c.c_void_p];
        address.restype = c.c_size_t;
        address(c.create_string_buffer(32));
        return null;
      }
    }
    const attribute = lib.fixture_first_char_after;
    attribute.argtypes = [Temporary, Nested];
    attribute.restype = c.c_int32;
    const independent = c.CFUNCTYPE(c.c_int32, Temporary, Nested)(["fixture_first_char_after", lib]);
    for (const function_ of [attribute, independent]) assert.equal(function_(0, null), 65);
  });

  it("test_conversion_owner_survives_errcheck", function () {
    const addresses = [];
    class Temporary extends c.c_void_p {
      static from_param() {
        const owner = c.create_string_buffer("A".repeat(4096));
        addresses.push(c.addressof(owner));
        return c.cast(owner, c.POINTER(c.c_uint8));
      }
    }
    const function_ = lib.fixture_first_char_after;
    function_.argtypes = [Temporary, c.c_void_p];
    function_.restype = c.c_int32;
    const checked = [];
    function_.errcheck = (result, invoked) => {
      checked.push([result, invoked === function_, c.cast(addresses.at(-1), c.POINTER(c.c_uint8))[0]]);
      return result;
    };
    assert.equal(function_(0, null), 65);
    assert.deepEqual(checked, [[65, true, 65]]);
  });

  it("test_reuse_after_conversion_failure", function () {
    let fail = true;
    class Temporary extends c.c_void_p {
      static from_param() {
        return c.cast(c.create_string_buffer("A".repeat(4096)), c.POINTER(c.c_uint8));
      }
    }
    class Later extends c.c_void_p {
      static from_param() {
        if (fail) throw new Error("conversion stopped");
        return null;
      }
    }
    const function_ = lib.fixture_first_char_after;
    function_.argtypes = [Temporary, Later];
    function_.restype = c.c_int32;
    assert.throws(() => function_(0, null), c.ArgumentError);
    fail = false;
    assert.equal(function_(0, null), 65);
  });

  it("test_mutable_void_pointer_owner", function () {
    function escape() {
      const owner = c.cast(c.pointer(new c.c_int32(48)), c.c_void_p);
      const derived = c.cast(owner, IntPointer);
      owner.value = null;
      return derived;
    }
    const pointer = escape();
    assert.equal(pointer[0], 48);
  });

  it("test_union_pointer_overlay", function () {
    class Overlay extends c.Union {
      static _fields_ = [
        ["p", IntPointer],
        ["bits", c.c_uint64],
      ];
    }
    const overlay = new Overlay();
    overlay.p = c.pointer(new c.c_int32(42));
    assert.equal(overlay.p[0], 42);
    overlay.bits = 0n;
    assert.equal(c.cast(overlay.p, c.c_void_p).value, null);
  });

  it("test_pointer_alias_assignments", function () {
    function assign() {
      const holder = new Record();
      const alias = c.cast(c.pointer(holder), c.POINTER(Record));
      alias.contents.p = c.pointer(new c.c_int32(61));
      return holder;
    }
    const holder = assign();
    assert.equal(holder.p[0], 61);
    holder.p = null;
    assert.equal(c.cast(holder.p, c.c_void_p).value, null);
  });

  it("test_pointer_slot_assignments", function () {
    function assign() {
      const slots = ARRAY(IntPointer, 1)();
      const alias = c.cast(slots, c.POINTER(IntPointer));
      alias[0] = c.pointer(new c.c_int32(73));
      return slots;
    }
    const slots = assign();
    assert.equal(slots[0][0], 73);
    slots[0] = null;
    assert.equal(c.cast(slots[0], c.c_void_p).value, null);
  });

  it("test_pointer_assignment_snapshots_pointee", function () {
    function escape() {
      const original = new c.c_int32(42);
      const pointer = c.pointer(original);
      const holder = new Record();
      holder.p = pointer;
      pointer.contents = new c.c_int32(7);
      return [holder, pointer, original];
    }
    const [holder, pointer, original] = escape();
    assert.equal(original.value, 42);
    assert.equal(holder.p[0], 42);
    assert.equal(pointer[0], 7);
  });

  it("test_escaped_pointer_owners", function () {
    function escape(kind) {
      const pointer = c.pointer(new c.c_int32(42));
      if (kind === "array") {
        const holder = ARRAY(IntPointer, 1)(pointer);
        return holder[0];
      }
      if (kind === "double pointer") return c.pointer(pointer)[0];
      const holder = kind === "union" ? new Value() : new Record();
      holder.p = pointer;
      return holder.p;
    }
    for (const kind of ["structure", "union", "array", "double pointer"]) {
      const result = escape(kind);
      assert.equal(result[0], 42, kind);
    }
  });

  it("test_address_backed_contents_owner", function () {
    function escape() {
      const owner = c.cast(c.pointer(new c.c_int32(37)), c.c_void_p);
      const pointer = c.cast(owner, IntPointer);
      return pointer.contents;
    }
    const value = escape();
    assert.equal(value.value, 37);
    value.value = 38;
    assert.equal(value.value, 38);
  });

  it("test_double_pointer_slot_repointing", function () {
    const first = new c.c_int32(42);
    const second = new c.c_int32(7);
    const pointer = c.pointer(first);
    const double = c.pointer(pointer);
    assert.equal(c.cast(double, c.c_void_p).value, c.addressof(pointer));
    assert.equal(double[0][0], 42);
    double[0] = c.pointer(second);
    assert.equal(pointer[0], 7);
    assert.equal(double[0][0], 7);
  });
});
