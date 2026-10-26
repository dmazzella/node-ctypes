import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as c from "node-ctypes";
const w = c.wintypes;

describe("TestWindowsAPI", function () {
  let kernel32, user32;
  before(() => {
    if (process.platform === "win32") {
      kernel32 = new c.WinDLL("kernel32");
      user32 = new c.WinDLL("user32");
    }
  });
  after(() => {
    kernel32?.close();
    user32?.close();
  });

  it("test_get_set_last_error", { skip: process.platform !== "win32" && "Windows only" }, function () {
    for (const value of [0, 123, 5]) {
      c.set_last_error(value);
      assert.equal(c.get_last_error(), value);
    }
  });
  it("test_native_get_set_last_error", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const setError = kernel32.SetLastError;
    setError.argtypes = [c.c_uint32];
    setError.restype = null;
    const getError = kernel32.GetLastError;
    getError.argtypes = [];
    getError.restype = c.c_uint32;
    for (const value of [126, 123, 0xdeadbeef, 0]) {
      setError(value);
      assert.equal(getError(), value);
    }
  });
  it("test_get_module_handle", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetModuleHandleW;
    fn.argtypes = [w.LPCWSTR];
    fn.restype = w.HMODULE;
    const handle = fn("kernel32.dll");
    assert.notEqual(handle, null);
    assert.notEqual(handle, 0n);
  });
  it("test_get_module_handle_nonexistent", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetModuleHandleW;
    fn.argtypes = [w.LPCWSTR];
    fn.restype = w.HMODULE;
    fn.errcheck = null;
    assert.equal(fn("NonExistentModule99999.dll"), null);
  });
  it("test_get_current_process_id", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetCurrentProcessId;
    fn.argtypes = [];
    fn.restype = w.DWORD;
    const pid = fn();
    assert.ok(pid > 0n);
    assert.equal(pid, BigInt(process.pid));
  });
  it("test_get_current_thread_id", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetCurrentThreadId;
    fn.argtypes = [];
    fn.restype = w.DWORD;
    assert.ok(fn() > 0n);
  });
  it("test_get_tick_count", { skip: process.platform !== "win32" && "Windows only" }, async function () {
    const fn = kernel32.GetTickCount;
    fn.argtypes = [];
    fn.restype = w.DWORD;
    const first = fn();
    assert.ok(first > 0n);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(fn() >= first);
  });
  it("test_systemtime_structure", { skip: process.platform !== "win32" && "Windows only" }, function () {
    class SYSTEMTIME extends c.Structure {
      static _fields_ = [
        ["wYear", w.WORD],
        ["wMonth", w.WORD],
        ["wDayOfWeek", w.WORD],
        ["wDay", w.WORD],
        ["wHour", w.WORD],
        ["wMinute", w.WORD],
        ["wSecond", w.WORD],
        ["wMilliseconds", w.WORD],
      ];
    }
    const fn = kernel32.GetLocalTime;
    fn.argtypes = [c.POINTER(SYSTEMTIME)];
    fn.restype = null;
    const time = new SYSTEMTIME();
    fn(c.byref(time));
    assert.ok(time.wYear >= 2020);
    assert.ok(time.wMonth >= 1 && time.wMonth <= 12);
    assert.ok(time.wDay >= 1 && time.wDay <= 31);
    assert.ok(time.wHour >= 0 && time.wHour < 24);
    assert.ok(time.wMinute >= 0 && time.wMinute < 60);
    assert.ok(time.wSecond >= 0 && time.wSecond < 60);
  });
  it("test_virtual_alloc_free", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const allocate = kernel32.VirtualAlloc;
    allocate.argtypes = [c.c_void_p, c.c_size_t, w.DWORD, w.DWORD];
    allocate.restype = c.c_void_p;
    const free = kernel32.VirtualFree;
    free.argtypes = [c.c_void_p, c.c_size_t, w.DWORD];
    free.restype = c.c_int32;
    const pointer = allocate(null, 4096, 0x1000 | 0x2000, 0x04);
    assert.notEqual(pointer, null);
    assert.notEqual(pointer, 0n);
    assert.notEqual(free(pointer, 0, 0x8000), 0);
  });
  it("test_wide_strings", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetEnvironmentVariableW;
    fn.argtypes = [w.LPCWSTR, w.LPWSTR, w.DWORD];
    fn.restype = w.DWORD;
    const buffer = c.create_unicode_buffer(1024);
    const length = fn("TEMP", buffer, 1024);
    assert.ok(length > 0n);
    assert.ok(buffer.value.length > 0);
    assert.ok(buffer.value.includes("\\"));
    assert.equal(c.wstring_at(buffer), buffer.value);
  });
  it("test_message_box_definition", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = user32.MessageBoxW;
    fn.argtypes = [c.c_void_p, w.LPCWSTR, w.LPCWSTR, c.c_uint32];
    fn.restype = c.c_int32;
    assert.equal(typeof fn, "function");
  });
  it("test_get_computer_name", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetComputerNameW;
    fn.argtypes = [w.LPWSTR, c.POINTER(w.DWORD)];
    fn.restype = w.BOOL;
    const buffer = c.create_unicode_buffer(256);
    const size = new w.DWORD(256);
    assert.notEqual(fn(buffer, c.byref(size)), 0n);
    assert.ok(buffer.value.length > 0);
    assert.equal(c.wstring_at(buffer), buffer.value);
  });
  it("test_errcheck_with_windows_api", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const fn = kernel32.GetModuleHandleW;
    fn.argtypes = [w.LPCWSTR];
    fn.restype = w.HMODULE;
    const checked = [];
    fn.errcheck = (result) => {
      checked.push(true);
      if (result === null || result === 0n) throw c.WinError(c.get_last_error());
      return result;
    };
    try {
      const handle = fn("kernel32.dll");
      assert.ok(checked.length);
      assert.notEqual(handle, null);
      assert.notEqual(handle, 0n);
      checked.length = 0;
      assert.throws(() => fn("NonExistentModule99999.dll"), Error);
      assert.ok(checked.length);
    } finally {
      fn.errcheck = null;
    }
  });
});

describe("TestWinError", function () {
  it("test_fields", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const error = c.WinError(2);
    assert.equal(error.winerror, 2);
    assert.equal(error.errno, 2);
    assert.equal(typeof error.strerror, "string");
    assert.ok(error.message.startsWith("[WinError 2] "));
    assert.equal(c.WinError(5).errno, 13);
    assert.equal(c.WinError(87, "bad").strerror, "bad");
  });
});
