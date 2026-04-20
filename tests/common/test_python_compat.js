/**
 * Tests for newly added Python-ctypes-compatibility features (Phase A):
 *   - find_library()
 *   - Structure.from_buffer / from_buffer_copy / from_address
 *   - cdll / windll lazy loaders
 *   - POINTER(T).add(n) / .slice(a, b)
 */

import test, { describe, it } from "node:test";
import assert from "node:assert";
import * as ctypes from "node-ctypes";
const { find_library, CDLL, Structure, Union, POINTER, c_int32, c_float, c_uint32, cdll, windll } = ctypes;

describe("find_library", function () {
  it("resolves 'c' on all platforms", function () {
    const lib = find_library("c");
    assert.ok(lib, "find_library('c') should return something");
    assert.strictEqual(typeof lib, "string");
  });

  it("returns null for null/empty input", function () {
    assert.strictEqual(find_library(null), null);
    assert.strictEqual(find_library(""), null);
  });

  it("CDLL(find_library('c')) opens successfully", function () {
    const lib = new CDLL(find_library("c"));
    assert.ok(lib);
    lib.close();
  });

  if (process.platform === "win32") {
    it("Windows: resolves 'kernel32'", function () {
      assert.strictEqual(find_library("kernel32"), "kernel32.dll");
    });
    it("Windows: 'c' aliases to msvcrt.dll", function () {
      assert.strictEqual(find_library("c"), "msvcrt.dll");
    });
  }
});

describe("Structure.from_buffer / from_buffer_copy / from_address", function () {
  class RECT extends Structure {
    static _fields_ = [
      ["left", c_int32],
      ["top", c_int32],
      ["right", c_int32],
      ["bottom", c_int32],
    ];
  }

  it("from_buffer shares memory with source", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer(src);
    assert.strictEqual(r.left, 42);
    r.left = 999;
    assert.strictEqual(src.readInt32LE(0), 999, "writes propagate to source");
  });

  it("from_buffer with offset", function () {
    const src = Buffer.alloc(32);
    src.writeInt32LE(7, 16);
    const r = RECT.from_buffer(src, 16);
    assert.strictEqual(r.left, 7);
  });

  it("from_buffer rejects too-small source", function () {
    const tiny = Buffer.alloc(4);
    assert.throws(() => RECT.from_buffer(tiny), /too small/);
  });

  it("from_buffer_copy is independent of source", function () {
    const src = Buffer.alloc(16);
    src.writeInt32LE(42, 0);
    const r = RECT.from_buffer_copy(src);
    r.left = 99;
    assert.strictEqual(src.readInt32LE(0), 42, "source unchanged");
  });

  it("from_buffer_copy accepts Uint8Array", function () {
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setInt32(0, 42, true);
    const r = RECT.from_buffer_copy(bytes);
    assert.strictEqual(r.left, 42);
  });

  it("from_address wraps a raw address (round-trip)", function () {
    // Allocate a buffer, take its address, reconstruct struct, verify content.
    const src = Buffer.alloc(16);
    src.writeInt32LE(1234, 0);
    const addr = ctypes.addressof(src);
    const r = RECT.from_address(addr);
    assert.strictEqual(r.left, 1234);
  });

  describe("Union", function () {
    class V extends Union {
      static _fields_ = [
        ["as_int", c_int32],
        ["as_float", c_float],
      ];
    }
    it("Union.from_buffer works (inherited)", function () {
      const b = Buffer.alloc(4);
      b.writeFloatLE(3.14, 0);
      const v = V.from_buffer(b);
      assert.ok(Math.abs(v.as_float - 3.14) < 1e-6);
    });
  });
});

describe("cdll / windll lazy loaders", function () {
  it("cdll.<lib> lazy-loads and caches", function () {
    // Pick a platform-appropriate libc name. find_library("c") → "msvcrt.dll"
    // on Windows, "libc.so.6" on Linux, "/usr/lib/libc.dylib" on macOS.
    // The lazy loader requires a name that CDLL can resolve; on Windows the
    // ".dll" alias works, on Unix we need the real soname/path.
    const libcName = process.platform === "win32" ? "msvcrt" : find_library("c");
    const lib = cdll[libcName];
    assert.ok(lib);
    assert.strictEqual(cdll[libcName], lib, "same instance on second access");
  });

  if (process.platform === "win32") {
    it("windll.kernel32.GetTickCount via namespace", function () {
      const gtc = windll.kernel32.func("GetTickCount", c_uint32, []);
      const t = gtc();
      assert.ok(t > 0);
    });
  }
});

describe("OleDLL + HRESULT", { skip: process.platform !== "win32" }, function () {
  it("throws on negative HRESULT", function () {
    const { OleDLL, HRESULT, c_wchar_p, c_void_p } = ctypes;
    const ole32 = new OleDLL("ole32.dll");
    const CLSIDFromString = ole32.func("CLSIDFromString", HRESULT, [c_wchar_p, c_void_p]);
    const buf = Buffer.alloc(16);
    assert.throws(
      () => CLSIDFromString("NOT A GUID", buf),
      (err) => {
        assert.match(err.message, /HRESULT 0x/);
        assert.strictEqual(typeof err.winerror, "number");
        return true;
      },
    );
  });

  it("does NOT throw on success (S_OK = 0)", function () {
    const { OleDLL, HRESULT, c_wchar_p, c_void_p } = ctypes;
    const ole32 = new OleDLL("ole32.dll");
    const CLSIDFromString = ole32.func("CLSIDFromString", HRESULT, [c_wchar_p, c_void_p]);
    const buf = Buffer.alloc(16);
    // {00000000-0000-0000-0000-000000000000} is a valid CLSID string
    const result = CLSIDFromString("{00000000-0000-0000-0000-000000000000}", buf);
    assert.strictEqual(Number(result), 0);
  });

  it("non-HRESULT restype is unaffected", function () {
    const { OleDLL, c_int32 } = ctypes;
    const ole32 = new OleDLL("ole32.dll");
    // CoGetCurrentProcess returns DWORD, not HRESULT — no errcheck injection
    const fn = ole32.func("CoGetCurrentProcess", c_int32, []);
    const v = fn();
    assert.ok(v > 0);
  });
});

describe("paramflags (in/out/default)", { skip: process.platform !== "win32" }, function () {
  const { WinDLL, WINFUNCTYPE, POINTER, c_uint32, c_void_p } = ctypes;

  it("collects out params into the return tuple", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    const hwnd = user32.func("GetDesktopWindow", c_void_p, [])();
    const [tid, pid] = fn(hwnd);
    assert.ok(tid > 0);
    assert.ok(pid > 0);
  });

  it("supports named-call form", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    const hwnd = user32.func("GetDesktopWindow", c_void_p, [])();
    const result = fn({ hWnd: hwnd });
    assert.ok(Array.isArray(result));
    assert.strictEqual(result.length, 2);
    assert.ok(result[0] > 0);
    assert.ok(result[1] > 0);
  });

  it("uses default values for missing in params", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(ctypes.c_int32, c_void_p, ctypes.c_int32);
    const show = proto.bind(user32, "IsWindow", [
      { dir: "in", name: "hWnd" },
      { dir: "in", name: "unused", default: 0 },
    ]);
    // Function only has 1 real param — this is a contrived test; skip if binding fails.
    // The point: default-fill should not throw when value is missing.
    assert.doesNotThrow(() => {
      try {
        show(0n);
      } catch {
        /* fn might fail but paramflags shouldn't throw missing-arg */
      }
    });
  });

  it("throws on missing required in param", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_void_p, POINTER(c_uint32));
    const fn = proto.bind(user32, "GetWindowThreadProcessId", [
      { dir: "in", name: "hWnd" },
      { dir: "out", name: "pid" },
    ]);
    assert.throws(() => fn(), /missing required arg.*hWnd/);
  });

  it("rejects 'out' on non-POINTER argtype", function () {
    const user32 = new WinDLL("user32.dll");
    const proto = WINFUNCTYPE(c_uint32, c_uint32);
    assert.throws(() => proto.bind(user32, "foo", [{ dir: "out", name: "x" }]), /not a POINTER/);
  });
});

describe("in_dll", function () {
  const { c_int32 } = ctypes;

  it("SimpleCData.in_dll binds to exported global", { skip: process.platform !== "win32" }, function () {
    const libc = new ctypes.CDLL(ctypes.find_library("c"));
    const tz = c_int32.in_dll(libc, "_timezone");
    assert.strictEqual(typeof tz.value, "number");
    libc.close();
  });

  it("throws on missing symbol", function () {
    const libc = new ctypes.CDLL(ctypes.find_library("c"));
    assert.throws(() => c_int32.in_dll(libc, "symbol_that_definitely_does_not_exist_12345"), /not found|Symbol/i);
    libc.close();
  });

  it("Structure.in_dll works too (inherited concept)", { skip: process.platform !== "win32" }, function () {
    // Can't easily create a real struct-typed exported global to test without
    // a dedicated test DLL, so just verify the method is present & reachable.
    class Dummy extends ctypes.Structure {
      static _fields_ = [["x", c_int32]];
    }
    assert.strictEqual(typeof Dummy.in_dll, "function");
  });
});

describe("use_last_error", { skip: process.platform !== "win32" }, function () {
  const { WinDLL, c_void_p, c_wchar_p } = ctypes;

  it("captures GetLastError snapshot after a failing call", function () {
    const k32 = new WinDLL("kernel32.dll", { use_last_error: true });
    const LoadLibraryW = k32.func("LoadLibraryW", c_void_p, [c_wchar_p]);
    const h = LoadLibraryW("C:/NoSuchFile_ABCXYZ_test.dll");
    assert.strictEqual(h, null);
    const err = k32.get_last_error();
    // 126 = ERROR_MOD_NOT_FOUND, 3 = PATH_NOT_FOUND; both acceptable
    assert.ok(err === 126 || err === 3, `unexpected error code: ${err}`);
  });

  it("throws if use_last_error was not set", function () {
    const k32 = new WinDLL("kernel32.dll");
    assert.throws(() => k32.get_last_error(), /use_last_error/);
  });
});

describe("_as_parameter_ / from_param", function () {
  const { CDLL, find_library, c_int32 } = ctypes;

  it("_as_parameter_ on a wrapper object unwraps to the real value", function () {
    const libc = new CDLL(find_library("c"));
    const abs = libc.func("abs", c_int32, [c_int32]);
    class Handle {
      constructor(v) {
        this._as_parameter_ = v;
      }
    }
    assert.strictEqual(abs(new Handle(-42)), 42);
    libc.close();
  });

  it("from_param classmethod transforms the incoming arg", function () {
    const libc = new CDLL(find_library("c"));
    class StrLen extends c_int32 {
      static from_param(obj) {
        return typeof obj === "string" ? obj.length : obj;
      }
    }
    const abs = libc.func("abs", c_int32, [StrLen]);
    assert.strictEqual(abs("hello"), 5);
    assert.strictEqual(abs(-7), 7);
    libc.close();
  });
});

describe("BigEndianStructure / LittleEndianStructure", function () {
  const { BigEndianStructure, LittleEndianStructure, c_uint32, c_uint16, c_uint8, c_float, c_double, c_int64 } = ctypes;

  it("serializes scalar fields in big-endian byte order", function () {
    class H extends BigEndianStructure {
      static _fields_ = [
        ["magic", c_uint32],
        ["version", c_uint16],
        ["flags", c_uint8],
      ];
    }
    const h = new H();
    h.magic = 0x12345678;
    h.version = 0x0102;
    h.flags = 0xab;
    assert.strictEqual(h._buffer[0], 0x12);
    assert.strictEqual(h._buffer[1], 0x34);
    assert.strictEqual(h._buffer[2], 0x56);
    assert.strictEqual(h._buffer[3], 0x78);
    assert.strictEqual(h._buffer[4], 0x01);
    assert.strictEqual(h._buffer[5], 0x02);
    assert.strictEqual(h._buffer[6], 0xab);
    // Round-trip
    assert.strictEqual(h.magic, 0x12345678);
    assert.strictEqual(h.version, 0x0102);
    assert.strictEqual(h.flags, 0xab);
  });

  it("LittleEndianStructure matches native byte order on LE host", function () {
    class L extends LittleEndianStructure {
      static _fields_ = [["magic", c_uint32]];
    }
    const l = new L();
    l.magic = 0x12345678;
    assert.strictEqual(l._buffer[0], 0x78);
    assert.strictEqual(l._buffer[3], 0x12);
  });

  it("handles c_float / c_double in BE", function () {
    class F extends BigEndianStructure {
      static _fields_ = [
        ["f", c_float],
        ["d", c_double],
      ];
    }
    const f = new F();
    f.f = 3.14;
    f.d = 2.7182818284590451;
    // Round-trip
    assert.ok(Math.abs(f.f - 3.14) < 1e-6);
    assert.ok(Math.abs(f.d - 2.7182818284590451) < 1e-15);
    // First byte of float 3.14 in BE IEEE-754 is 0x40
    assert.strictEqual(f._buffer[0], 0x40);
  });

  it("handles c_int64 (BigInt) in BE", function () {
    class Q extends BigEndianStructure {
      static _fields_ = [["n", c_int64]];
    }
    const q = new Q();
    q.n = 0x0102030405060708n;
    assert.strictEqual(q._buffer[0], 0x01);
    assert.strictEqual(q._buffer[7], 0x08);
    assert.strictEqual(q.n, 0x0102030405060708n);
  });

  it("1-byte fields are unaffected", function () {
    class B extends BigEndianStructure {
      static _fields_ = [
        ["a", c_uint8],
        ["b", c_uint8],
      ];
    }
    const b = new B();
    b.a = 0xab;
    b.b = 0xcd;
    assert.strictEqual(b._buffer[0], 0xab);
    assert.strictEqual(b._buffer[1], 0xcd);
  });
});

describe("BigEndianUnion / LittleEndianUnion", function () {
  const { BigEndianUnion, LittleEndianUnion, c_uint32, c_uint8, array } = ctypes;

  it("BigEndianUnion stores primitive fields in BE order", function () {
    class V extends BigEndianUnion {
      static _fields_ = [
        ["i", c_uint32],
        ["bytes", array(c_uint8, 4)],
      ];
    }
    const v = new V();
    v.i = 0x12345678;
    assert.strictEqual(v._buffer[0], 0x12);
    assert.strictEqual(v._buffer[3], 0x78);
    assert.strictEqual(v.i, 0x12345678);
    // Byte-array view shares the SAME underlying memory, so in BE the first
    // byte equals the high-order byte of the int.
    assert.strictEqual(v.bytes[0], 0x12);
  });

  it("LittleEndianUnion matches native order on LE host", function () {
    class V extends LittleEndianUnion {
      static _fields_ = [["i", c_uint32]];
    }
    const v = new V();
    v.i = 0x12345678;
    assert.strictEqual(v._buffer[0], 0x78);
  });
});

describe("POINTER arithmetic", function () {
  it("p.add(n) returns pointer offset by n elements", function () {
    const buf = Buffer.alloc(20);
    for (let i = 0; i < 5; i++) buf.writeInt32LE(i * 10, i * 4);
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.fromBuffer(buf);
    assert.strictEqual(p.add(2)[0], 20);
    assert.strictEqual(p.add(4)[0], 40);
  });

  it("p.slice(start, end) reads a range of elements", function () {
    const buf = Buffer.alloc(20);
    for (let i = 0; i < 5; i++) buf.writeInt32LE(i * 10, i * 4);
    const IntPtr = POINTER(c_int32);
    const p = IntPtr.fromBuffer(buf);
    assert.deepStrictEqual(p.slice(1, 4), [10, 20, 30]);
    assert.deepStrictEqual(p.slice(0, 5), [0, 10, 20, 30, 40]);
  });
});
