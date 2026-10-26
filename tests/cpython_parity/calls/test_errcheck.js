import assert from "node:assert/strict";
import { constants } from "node:os";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { LIBC } from "../_support.js";

describe("TestErrcheck", function () {
  let libc;
  beforeEach(() => {
    libc = new c.CDLL(LIBC);
  });

  it("test_basic_errcheck", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    const received = [];
    strlen.errcheck = (result, function_, arguments_) => {
      received.push([result, function_ === strlen, arguments_]);
      return result;
    };
    assert.equal(strlen("hello"), 5n);
    assert.deepEqual(received, [[5n, true, ["hello"]]]);
    assert.ok(Array.isArray(received[0][2]));
  });

  it("test_modify_return_value", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => result * 2n;
    assert.equal(strlen("hello"), 10n);
  });

  it("test_errcheck_throws", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => {
      if (result > 10n) throw new Error("String too long!");
      return result;
    };
    assert.equal(strlen("hello"), 5n);
    assert.throws(() => strlen("this is a very long string"), /String too long!/);
  });

  it("test_clear_errcheck", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => result * 2n;
    assert.equal(strlen("hi"), 4n);
    strlen.errcheck = null;
    assert.equal(strlen("hi"), 2n);
  });

  it("test_errno_pattern", { skip: process.platform === "win32" && "Unix-specific test" }, function () {
    const library = new c.CDLL(LIBC, { use_errno: true });
    const open_file = library.open;
    open_file.argtypes = [c.c_char_p, c.c_int];
    open_file.restype = c.c_int;
    open_file.errcheck = (result) => {
      if (result === -1) {
        const error = new Error("open failed with errno");
        error.errno = c.get_errno();
        throw error;
      }
      return result;
    };
    assert.throws(
      () => open_file("/path/that/does/not/exist/test.txt", 0),
      (error) => error instanceof Error && error.errno === constants.errno.ENOENT,
    );
  });

  it("test_winerror_pattern", { skip: process.platform !== "win32" && "Windows-specific test" }, function () {
    const kernel32 = new c.WinDLL("kernel32.dll", { use_last_error: true });
    const delete_file = kernel32.DeleteFileW;
    delete_file.argtypes = [c.c_wchar_p];
    delete_file.restype = c.c_bool;
    c.set_last_error(0);
    delete_file.errcheck = (result) => {
      if (!result) {
        const error = c.get_last_error();
        if (error) throw c.WinError(error);
      }
      return result;
    };
    assert.throws(
      () => delete_file("Z:\\file_that_does_not_exist_xyz123.txt"),
      (error) => error instanceof Error && typeof error.winerror === "number" && error.winerror !== 0,
    );
  });

  it("test_pointer_validation", function () {
    const malloc = libc.malloc;
    malloc.argtypes = [c.c_size_t];
    malloc.restype = c.c_void_p;
    malloc.errcheck = (result) => {
      if (!result) throw new Error("malloc returned NULL");
      return result;
    };
    const address = malloc(100);
    assert.ok(address);
    const free = libc.free;
    free.argtypes = [c.c_void_p];
    free.restype = null;
    free(address);
  });

  it("test_errcheck_parameters", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int];
    absolute.restype = c.c_int;
    const captured = [];
    absolute.errcheck = (result, function_, arguments_) => {
      captured.push([result, function_ === absolute, arguments_]);
      return result;
    };
    assert.equal(absolute(-42), 42);
    assert.deepEqual(captured, [[42, true, [-42]]]);
    assert.ok(Array.isArray(captured[0][2]));
  });

  it("test_multiple_arguments", function () {
    const memcpy = libc.memcpy;
    memcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t];
    memcpy.restype = c.c_void_p;
    const src = c.create_string_buffer(10);
    const dst = c.create_string_buffer(10);
    const captured = [];
    memcpy.errcheck = (result, function_, arguments_) => {
      captured.push(arguments_);
      return result;
    };
    assert.equal(memcpy(dst, src, 10), c.addressof(dst));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].length, 3);
    assert.equal(captured[0][0], dst);
    assert.equal(captured[0][1], src);
    assert.equal(captured[0][2], 10);
  });

  it("test_errcheck_chaining", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => result + 1n;
    assert.equal(strlen("hi"), 3n);
    strlen.errcheck = (result) => result * 3n;
    assert.equal(strlen("hi"), 6n);
    strlen.errcheck = null;
    assert.equal(strlen("hi"), 2n);
  });

  it("test_errcheck_kept_on_type_change", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int];
    absolute.restype = c.c_int;
    const twice = (result) => result * 2;
    absolute.errcheck = twice;
    assert.equal(absolute(-3), 6);
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    assert.equal(absolute.errcheck, twice);
    assert.equal(absolute(-4), 8);
    absolute.errcheck = null;
    assert.equal(absolute(-4), 4);
  });

  it("test_python_ctypes_compatibility", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int];
    absolute.restype = c.c_int;
    absolute.errcheck = (result) => {
      if (result === 0) {
        const error = new Error("Test error");
        error.errno = 42;
        throw error;
      }
      return result;
    };
    assert.equal(absolute(-5), 5);
    assert.throws(
      () => absolute(0),
      (error) => error.errno === 42,
    );
  });

  it("test_independent_binding_errcheck", function () {
    const attribute = libc.abs;
    attribute.argtypes = [c.c_int];
    attribute.restype = c.c_int;
    const independent = c.CFUNCTYPE(c.c_int, c.c_int)(["abs", libc]);
    attribute.errcheck = (result) => -result;
    assert.equal(attribute(-3), -3);
    assert.equal(independent(-3), 3);
    assert.notEqual(independent.errcheck, attribute.errcheck);
  });

  it("test_variadic_errcheck_unix", { skip: process.platform === "win32" && "Unix-specific test" }, function () {
    const sprintf = libc.sprintf;
    sprintf.argtypes = [c.c_void_p, c.c_char_p];
    sprintf.restype = c.c_int32;
    const calls = [];
    sprintf.errcheck = (result, function_, arguments_) => {
      calls.push([result, function_ === sprintf, arguments_.slice(1)]);
      if (result < 0) throw new Error("sprintf failed");
      return result;
    };
    const buffer = c.create_string_buffer(100);
    assert.equal(sprintf(buffer, "Number: %d", 42), 10);
    assert.equal(buffer.value, "Number: 42");
    assert.deepEqual(calls, [[10, true, ["Number: %d", 42]]]);
  });

  it("test_variadic_errcheck_windows", { skip: process.platform !== "win32" && "Windows-specific test" }, function () {
    const snprintf = libc._snprintf;
    snprintf.argtypes = [c.c_void_p, c.c_size_t, c.c_char_p];
    snprintf.restype = c.c_int32;
    const calls = [];
    snprintf.errcheck = (result, function_, arguments_) => {
      calls.push([result, function_ === snprintf, arguments_.slice(1)]);
      if (result < 0) throw new Error("_snprintf failed");
      return result;
    };
    const buffer = c.create_string_buffer(100);
    assert.equal(snprintf(buffer, 100, "Number: %d", 42), 10);
    assert.equal(buffer.value, "Number: 42");
    assert.deepEqual(calls, [[10, true, [100, "Number: %d", 42]]]);
  });
});

describe("TestOleDLL", { skip: process.platform !== "win32" && "Windows only" }, function () {
  it("test_failing_hresult", function () {
    const ole32 = new c.OleDLL("ole32.dll");
    const parse = ole32.CLSIDFromString;
    parse.argtypes = [c.c_wchar_p, c.c_void_p];
    parse.restype = c.HRESULT;
    assert.throws(
      () => parse("NOT A GUID", c.create_string_buffer(16)),
      (error) => error instanceof Error && typeof error.winerror === "number",
    );
  });

  it("test_successful_hresult", function () {
    const ole32 = new c.OleDLL("ole32.dll");
    const parse = ole32.CLSIDFromString;
    parse.argtypes = [c.c_wchar_p, c.c_void_p];
    parse.restype = c.HRESULT;
    assert.equal(parse("{00000000-0000-0000-0000-000000000000}", c.create_string_buffer(16)), 0);
  });

  it("test_non_hresult_restype", function () {
    const ole32 = new c.OleDLL("ole32.dll");
    const current = ole32.CoGetCurrentProcess;
    current.argtypes = [];
    current.restype = c.c_int32;
    assert.ok(current() > 0);
  });
});

describe("TestUseLastError", { skip: process.platform !== "win32" && "Windows only" }, function () {
  it("test_failure_snapshot", function () {
    const kernel32 = new c.WinDLL("kernel32.dll", { use_last_error: true });
    const load = kernel32.LoadLibraryW;
    load.argtypes = [c.c_wchar_p];
    load.restype = c.c_void_p;
    c.set_last_error(0);
    assert.equal(load("C:/NoSuchFile_ABCXYZ_test.dll"), null);
    assert.ok([126, 3].includes(c.get_last_error()));
  });
});
