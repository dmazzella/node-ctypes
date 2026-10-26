// These convenience names do not exist in CPython 3.14/3.15 ctypes.wintypes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("Node wintypes convenience aliases", function () {
  it("exposes the wintypes namespace as an object", function () {
    assert.equal(typeof c.wintypes, "object");
  });
  it("has additional 64-bit integer aliases", function () {
    const w = c.wintypes;
    assert.equal(w.QWORD, c.c_uint64);
    assert.equal(w.DWORDLONG, c.c_uint64);
    assert.equal(w.LONGLONG, c.c_int64);
    assert.equal(w.ULONGLONG, c.c_uint64);
  });
  it("has PVOID as a void-pointer alias", function () {
    assert.equal(c.wintypes.PVOID, c.c_void_p);
  });
  it("has additional pointer-sized integer aliases", function () {
    const w = c.wintypes;
    assert.equal(w.LRESULT, c.c_ssize_t);
    assert.equal(w.UINT_PTR, c.c_size_t);
    assert.equal(w.LONG_PTR, c.c_ssize_t);
    assert.equal(w.ULONG_PTR, c.c_size_t);
  });
  it("has registry convenience aliases", function () {
    assert.equal(c.wintypes.LSTATUS, c.c_long);
    assert.equal(c.wintypes.REGSAM, c.c_ulong);
  });
});
