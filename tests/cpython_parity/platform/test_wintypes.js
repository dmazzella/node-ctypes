import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "node-ctypes";

describe("TestWintypes", function () {
  it("test_namespace", function () {
    assert.ok(c.wintypes);
  });
  it("test_integer_aliases", function () {
    const w = c.wintypes;
    assert.equal(w.BYTE, c.c_ubyte);
    assert.equal(w.WORD, c.c_ushort);
    assert.equal(w.DWORD, c.c_ulong);
    assert.equal(w.BOOL, c.c_long);
    assert.equal(w.SHORT, c.c_short);
    assert.equal(w.USHORT, c.c_ushort);
    assert.equal(w.INT, c.c_int);
    assert.equal(w.UINT, c.c_uint);
    assert.equal(w.LONG, c.c_long);
    assert.equal(w.ULONG, c.c_ulong);
    assert.equal(w.ATOM, c.c_ushort);
    assert.equal(w.COLORREF, c.c_ulong);
  });
  it("test_handle_family", function () {
    for (const name of ["HANDLE", "HWND", "HINSTANCE", "HMODULE", "HICON", "HCURSOR", "HBRUSH", "HMENU", "HFONT", "HBITMAP", "HGDIOBJ", "HKEY", "HDC", "HRGN", "LPVOID", "LPCVOID"]) {
      assert.equal(c.wintypes[name], c.c_void_p);
      assert.equal(c.sizeof(c.wintypes[name]), c.sizeof(c.c_void_p));
    }
  });
  it("test_string_pointers", function () {
    assert.equal(c.wintypes.LPSTR, c.c_char_p);
    assert.equal(c.wintypes.LPCSTR, c.c_char_p);
    assert.equal(c.wintypes.LPWSTR, c.c_wchar_p);
    assert.equal(c.wintypes.LPCWSTR, c.c_wchar_p);
  });
  it("test_pointer_sized_ints", function () {
    assert.equal(c.sizeof(c.wintypes.WPARAM), c.sizeof(c.c_void_p));
    assert.equal(c.sizeof(c.wintypes.LPARAM), c.sizeof(c.c_void_p));
    assert.equal(c.wintypes.WPARAM, c.c_size_t);
    assert.equal(c.wintypes.LPARAM, c.c_ssize_t);
  });
  it("test_character_types", function () {
    assert.equal(c.wintypes.CHAR, c.c_char);
    assert.equal(c.wintypes.WCHAR, c.c_wchar);
  });
  it("test_pointer_types", function () {
    const w = c.wintypes;
    assert.equal(w.LPDWORD, c.POINTER(w.DWORD));
    assert.equal(w.PDWORD, w.LPDWORD);
    assert.equal(w.LPBYTE, c.POINTER(w.BYTE));
    assert.equal(w.PHKEY, c.POINTER(w.HKEY));
    assert.equal(w.LPRECT, c.POINTER(w.RECT));
    assert.equal(w.LPMSG, c.POINTER(w.MSG));
    const value = new w.DWORD(7);
    const pointer = c.cast(c.byref(value), w.LPDWORD);
    assert.equal(pointer[0], 7n);
  });
  it("test_structures", function () {
    const w = c.wintypes;
    const rect = new w.RECT(1, 2, 3, 4);
    assert.deepEqual([rect.left, rect.bottom], [1n, 4n]);
    assert.equal(c.sizeof(w.RECT), 4 * c.sizeof(c.c_long));
    assert.equal(w.tagRECT, w.RECT);
    assert.equal(w.POINTL, w.POINT);
    assert.equal(w.SIZEL, w.SIZE);
    assert.equal(new w.MSG().hWnd, null);
    assert.equal(new w.SMALL_RECT(1, 2, 3, 4).Bottom, 4);
    const find = new w.WIN32_FIND_DATAW();
    find.cFileName = "notepad.exe";
    assert.equal(find.cFileName, "notepad.exe");
    assert.equal(w.MAX_PATH, 260);
    assert.equal(w.RGB(1, 2, 3), 0x030201);
  });
  it("test_variant_bool", function () {
    const value = new c.wintypes.VARIANT_BOOL(true);
    assert.equal(value.value, true);
    assert.deepEqual(Array.from(c.ARRAY(c.c_uint8, 2).from_buffer(value)), [0xff, 0xff]);
    assert.equal(c.c_int16.from_buffer(value).value, -1);
  });
});
