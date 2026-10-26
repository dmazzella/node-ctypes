import assert from "node:assert/strict";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import * as c from "node-ctypes";
import { LIBC } from "../_support.js";

const { ARRAY } = c;

describe("TestFunctionsAndCallbacks", function () {
  let libc;
  beforeEach(() => {
    libc = new c.CDLL(LIBC);
  });

  it("test_abs_function", function () {
    const absolute = libc.abs;
    absolute.argtypes = [c.c_int32];
    absolute.restype = c.c_int32;
    assert.equal(libc.abs, absolute);
    for (const [value, expected] of [
      [-42, 42],
      [42, 42],
      [0, 0],
    ]) {
      assert.equal(absolute(value), expected);
    }
  });

  it("test_strlen_function", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    for (const [value, expected] of [
      ["hello", 5n],
      ["world!", 6n],
      ["", 0n],
      ["Hello, World!", 13n],
    ]) {
      assert.equal(strlen(value), expected);
    }
  });

  it("test_memcpy_function", function () {
    const memcpy = libc.memcpy;
    memcpy.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t];
    memcpy.restype = c.c_void_p;
    const src = c.create_string_buffer(10);
    const dst = c.create_string_buffer(10);
    for (let index = 0; index < 10; index++) src[index] = index * 10;
    assert.equal(memcpy(dst, src, 10), c.addressof(dst));
    assert.deepEqual(dst.raw, src.raw);
  });

  it("test_errcheck_called", function () {
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
  });

  it("test_errcheck_modify_return", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => result * 2n;
    assert.equal(strlen("hello"), 10n);
  });

  it("test_errcheck_throw_exception", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    strlen.errcheck = (result) => {
      if (result === 0n) throw new Error("String is empty!");
      return result;
    };
    assert.equal(strlen("hello"), 5n);
    assert.throws(() => strlen(""), /String is empty!/);
  });

  it("test_errcheck_clear", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    const calls = [];
    strlen.errcheck = (result, function_, arguments_) => {
      calls.push(arguments_);
      return result;
    };
    assert.equal(strlen("hello"), 5n);
    strlen.errcheck = null;
    assert.equal(strlen("hello"), 5n);
    assert.deepEqual(calls, [["hello"]]);
  });

  it("test_callback_with_qsort", { skip: process.platform !== "win32" && "Windows only" }, function () {
    const qsort = libc.qsort;
    qsort.argtypes = [c.c_void_p, c.c_size_t, c.c_size_t, c.c_void_p];
    qsort.restype = null;
    const compare_type = c.CFUNCTYPE(c.c_int, c.c_void_p, c.c_void_p);
    const compare = compare_type((first, second) => c.cast(first, c.POINTER(c.c_int32)).contents.value - c.cast(second, c.POINTER(c.c_int32)).contents.value);
    const values = ARRAY(c.c_int32, 5)(5, 2, 8, 1, 9);
    qsort(values, 5, c.sizeof(c.c_int32), compare);
    assert.deepEqual([...values], [1, 2, 5, 8, 9]);
  });

  it("test_callback_signatures", function () {
    const addition = c.CFUNCTYPE(c.c_int32, c.c_int32, c.c_int32)((first, second) => first + second);
    const nothing = c.CFUNCTYPE(null, c.c_void_p)(() => null);
    assert.equal(addition(3, 4), 7);
    assert.equal(nothing(null), undefined);
    assert.notEqual(c.cast(addition, c.c_void_p).value, 0n);
    assert.notEqual(c.cast(nothing, c.c_void_p).value, 0n);
  });

  it(
    "test_variadic_functions",
    { skip: process.platform !== "win32" ? "Windows only - different sprintf behavior on Unix" : process.arch === "arm64" && "CPython on Windows does not use ffi_prep_cif_var: variadic doubles go in the wrong registers on ARM64" },
    function () {
      const sprintf = libc.sprintf;
      sprintf.argtypes = [c.c_char_p, c.c_char_p];
      sprintf.restype = c.c_int32;
      const buffer = c.create_string_buffer(256);
      for (const [format_string, values, expected] of [
        ["Hello %s!", ["World"], "Hello World!"],
        ["Number: %d, String: %s", [42, "test"], "Number: 42, String: test"],
        ["%d + %d = %d", [10, 20, 30], "10 + 20 = 30"],
        ["Pi is approximately %.2f", [new c.c_double(3.14159)], "Pi is approximately 3.14"],
      ]) {
        assert.equal(sprintf(buffer, format_string, ...values), expected.length);
        assert.equal(buffer.value, expected);
      }
    },
  );

  it("test_pointer_returns", function () {
    const malloc = libc.malloc;
    malloc.argtypes = [c.c_size_t];
    malloc.restype = c.c_void_p;
    const free = libc.free;
    free.argtypes = [c.c_void_p];
    free.restype = null;
    const address = malloc(1024);
    assert.ok(address);
    free(address);
  });

  it("test_function_address", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    assert.ok(c.cast(strlen, c.c_void_p).value);
  });

  it("test_cfunctype_from_address", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    const address = c.cast(strlen, c.c_void_p).value;
    const independent = c.CFUNCTYPE(c.c_size_t, c.c_char_p)(address);
    assert.equal(independent("Hello, World!"), 13n);
  });

  it("test_cast_callback_to_prototype", function () {
    const prototype = c.CFUNCTYPE(c.c_int32, c.c_int32);
    function bind() {
      const callback = prototype((value) => value + 1);
      return c.cast(callback, prototype);
    }
    const function_ = bind();
    assert.equal(function_(7), 8);
    assert.ok(c.cast(function_, c.c_void_p).value);
  });

  it("test_int_address_requires_c_void_p", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_char_p];
    strlen.restype = c.c_size_t;
    const buffer = c.create_string_buffer("Hello");
    assert.throws(() => strlen(c.addressof(buffer)), c.ArgumentError);
    strlen.argtypes = [c.c_void_p];
    assert.equal(strlen(c.addressof(buffer)), 5n);
  });

  it("test_int_address_via_c_void_p", function () {
    const strlen = libc.strlen;
    strlen.argtypes = [c.c_void_p];
    strlen.restype = c.c_size_t;
    const buffer = c.create_string_buffer("Hello");
    assert.equal(strlen(c.addressof(buffer)), 5n);
    assert.equal(strlen(buffer), 5n);
  });

  it("test_explicit_string_pointer_addresses", function () {
    const attribute = libc.strlen;
    attribute.argtypes = [c.c_char_p];
    attribute.restype = c.c_size_t;
    const independent = c.CFUNCTYPE(c.c_size_t, c.c_char_p)(["strlen", libc]);
    const buffer = c.create_string_buffer("Hello");
    const address = c.addressof(buffer);
    for (const strlen of [attribute, independent]) {
      assert.throws(() => strlen(address), c.ArgumentError);
      assert.throws(() => strlen(new c.c_void_p(address)), c.ArgumentError);
      assert.equal(strlen(new c.c_char_p(address)), 5n);
      assert.equal(strlen(c.cast(address, c.c_char_p)), 5n);
      assert.equal(strlen(buffer), 5n);
    }
    const strchr = libc.strchr;
    strchr.argtypes = [c.c_char_p, c.c_int];
    strchr.restype = c.c_void_p;
    assert.equal(strchr(new c.c_char_p(address), "H".charCodeAt(0)), address);
  });

  it("test_explicit_wide_pointer_addresses", function (context) {
    let attribute;
    try {
      attribute = libc.wcslen;
    } catch (error) {
      if (!/symbol.*wcslen|wcslen.*not found/i.test(error.message)) throw error;
      context.skip("wcslen not exported by this libc");
      return;
    }
    attribute.argtypes = [c.c_wchar_p];
    attribute.restype = c.c_size_t;
    const independent = c.CFUNCTYPE(c.c_size_t, c.c_wchar_p)(["wcslen", libc]);
    const buffer = c.create_unicode_buffer("Hello");
    const address = c.addressof(buffer);
    for (const wcslen of [attribute, independent]) {
      assert.throws(() => wcslen(address), c.ArgumentError);
      assert.throws(() => wcslen(new c.c_void_p(address)), c.ArgumentError);
      assert.equal(wcslen(new c.c_wchar_p(address)), 5n);
      assert.equal(wcslen(c.cast(address, c.c_wchar_p)), 5n);
      assert.equal(wcslen(buffer), 5n);
    }
  });

  it("test_int_address_to_wcslen_via_c_void_p", function (context) {
    let wcslen;
    try {
      wcslen = libc.wcslen;
    } catch (error) {
      if (!/symbol.*wcslen|wcslen.*not found/i.test(error.message)) throw error;
      context.skip("wcslen not exported by this libc");
      return;
    }
    wcslen.argtypes = [c.c_void_p];
    wcslen.restype = c.c_size_t;
    const buffer = c.create_unicode_buffer("Hello");
    assert.equal(wcslen(c.addressof(buffer)), 5n);
  });
});

describe("TestLibraryLoader", function () {
  it("test_probes", function () {
    assert.match(String(c.cdll), /LibraryLoader/);
    assert.equal(c.cdll._private, undefined);
  });

  it("test_lazy_library_cached", function () {
    const library = c.cdll[LIBC];
    assert.equal(c.cdll[LIBC], library);
  });

  it("test_find_library_opens_libc", function () {
    const name = c.find_library(process.platform === "win32" ? "msvcrt" : "c");
    assert.equal(typeof name, "string");
    assert.ok(name);
    const library = new c.CDLL(name);
    try {
      assert.ok(library instanceof c.CDLL);
      const absolute = library.abs;
      absolute.argtypes = [c.c_int];
      absolute.restype = c.c_int;
      assert.equal(absolute(-3), 3);
    } finally {
      library.close();
    }
  });
});

describe("TestFindLibraryDarwin", { skip: process.platform !== "darwin" && "macOS only" }, function () {
  it("test_dyld_shared_cache", function () {
    assert.equal(c.find_library("c"), "/usr/lib/libc.dylib");
    assert.equal(c.find_library("CoreFoundation"), "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
    assert.equal(typeof new c.CDLL(c.find_library("CoreFoundation")).CFStringGetLength, "function");
  });
});

describe("TestFindLibraryLinux", { skip: process.platform !== "linux" && "Linux only" }, function () {
  it("test_sonames", function () {
    for (const [name, pattern, symbol, kind, value, expected] of [
      ["c", /(^|\/)libc\.so(\.\d+)*$/, "abs", c.c_int, -3, 3],
      ["m", /(^|\/)lib[cm]\.so(\.\d+)*$/, "fabs", c.c_double, -1.5, 1.5],
    ]) {
      const resolved = c.find_library(name);
      assert.equal(typeof resolved, "string");
      assert.match(resolved, pattern);
      const library = new c.CDLL(resolved);
      try {
        const fn = library[symbol];
        fn.argtypes = [kind];
        fn.restype = kind;
        assert.equal(fn(value), expected);
      } finally {
        library.close();
      }
    }
  });
});

describe("TestFindLibraryWindows", { skip: process.platform !== "win32" && "Windows only" }, function () {
  it("test_kernel32", function () {
    const name = c.find_library("kernel32");
    assert.equal(typeof name, "string");
    assert.equal(path.win32.basename(name).toLowerCase(), "kernel32.dll");
    const library = new c.WinDLL(name);
    try {
      const get_process_id = library.GetCurrentProcessId;
      get_process_id.argtypes = [];
      get_process_id.restype = c.c_uint32;
      assert.ok(get_process_id() > 0);
    } finally {
      library.close();
    }
  });

  it("test_c_runtime", function () {
    const name = c.find_library("msvcrt");
    assert.equal(typeof name, "string");
    assert.equal(path.win32.basename(name).toLowerCase(), "msvcrt.dll");
    const library = new c.CDLL(name);
    try {
      const absolute = library.abs;
      absolute.argtypes = [c.c_int];
      absolute.restype = c.c_int;
      assert.equal(absolute(-7), 7);
    } finally {
      library.close();
    }
  });

  it("test_windll_namespace", function () {
    const get_tick_count = c.windll.kernel32.GetTickCount;
    get_tick_count.argtypes = [];
    get_tick_count.restype = c.c_uint32;
    assert.ok(get_tick_count() > 0);
  });
});

describe("TestWindowsParamflags", { skip: process.platform !== "win32" && "Windows only" }, function () {
  let user32;
  beforeEach(() => {
    user32 = new c.WinDLL("user32.dll");
  });

  it("test_single_output", function () {
    const desktop = user32.GetDesktopWindow;
    desktop.argtypes = [];
    desktop.restype = c.c_void_p;
    const prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32));
    const function_ = prototype(
      ["GetWindowThreadProcessId", user32],
      [
        [1, "hWnd"],
        [2, "pid"],
      ],
    );
    assert.ok(function_(desktop()) > 0);
  });

  it("test_named_input", function () {
    const desktop = user32.GetDesktopWindow;
    desktop.argtypes = [];
    desktop.restype = c.c_void_p;
    const prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32));
    const function_ = prototype(
      ["GetWindowThreadProcessId", user32],
      [
        [1, "hWnd"],
        [2, "pid"],
      ],
    );
    assert.ok(function_({ hWnd: desktop() }) > 0);
  });

  it("test_default_input", function () {
    const prototype = c.WINFUNCTYPE(c.c_int32, c.c_void_p);
    const function_ = prototype(["IsWindow", user32], [[1, "hWnd", null]]);
    assert.equal(function_(), 0);
    assert.equal(function_(null), 0);
  });

  it("test_missing_input", function () {
    const prototype = c.WINFUNCTYPE(c.c_uint32, c.c_void_p, c.POINTER(c.c_uint32));
    const function_ = prototype(
      ["GetWindowThreadProcessId", user32],
      [
        [1, "hWnd"],
        [2, "pid"],
      ],
    );
    assert.throws(() => function_(), TypeError);
  });

  it("test_nonpointer_output_rejected", function () {
    const prototype = c.WINFUNCTYPE(c.c_int32, c.c_uint32);
    assert.throws(() => prototype(["IsWindow", user32], [[2, "value"]]), TypeError);
  });
});
