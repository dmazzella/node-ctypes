import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CDLL, c_int32 } from "node-ctypes";

const fixture = path.join(import.meta.dirname, "..", "..", "build", "fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

describe("library memory leases", { skip: !existsSync(fixture) && "native fixture not built" }, function () {
  for (const explicitClose of [false, true]) {
    it(`${explicitClose ? "logical close" : "GC of the library"} defers physical unload until the last view disappears`, { timeout: 20000 }, function () {
      const script = `
        import assert from "node:assert/strict";
        import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
        import { tmpdir } from "node:os";
        import path from "node:path";
        import * as c from "node-ctypes";
        const dir = mkdtempSync(path.join(tmpdir(), "ctypes-lease-"));
        const marker = path.join(dir, "unloaded");
        const Ptr = c.POINTER(c.c_int32);
        class Record extends c.Structure {
          static _fields_ = [["value", c.c_int32], ["pointer", Ptr]];
        }
        class Value extends c.Union { static _fields_ = [["number", c.c_int32]]; }
        class FunctionRecord extends c.Structure {
          static _fields_ = [["function", c.CFUNCTYPE(c.c_int32, c.c_int32)]];
        }
        async function collect() {
          for (let i = 0; i < 15; i++) { await new Promise(setImmediate); globalThis.gc(); }
          await new Promise(setImmediate);
        }
        function open(kind) {
          const lib = new c.CDLL(${JSON.stringify(fixture)});
          assert.equal(lib.func("fixture_set_unload_marker", c.c_int32, [c.c_char_p])(marker), 1);
          const fn = lib.func("fixture_address", c.c_size_t, [c.c_void_p]);
          const scalar = c.c_int32.in_dll(lib, "fixture_global_value");
          let value, oldOwner;
          if (kind === "scalar") value = scalar;
          else if (kind === "record") value = Record.in_dll(lib._lib, "fixture_global_record");
          else if (kind === "union") value = Value.in_dll(lib, "fixture_global_value");
          else if (kind === "pointer") value = Record.in_dll(lib, "fixture_global_record").pointer;
          else if (kind === "C-updated pointer") {
            const record = Record.in_dll(lib, "fixture_global_record");
            record.pointer = c.pointer(new c.c_int32(5));
            lib.func("fixture_reset_global_pointer", null, [])();
            value = record.pointer;
          }
          else if (kind === "C-cleared pointer") {
            const target = new c.c_int32(5);
            oldOwner = new WeakRef(target._buffer);
            value = Record.in_dll(lib, "fixture_global_record");
            value.pointer = c.pointer(target);
            lib.func("fixture_clear_global_pointer", null, [])();
            assert.equal(value.pointer, null);
          }
          else if (kind === "contents") value = c.cast(c.c_void_p.in_dll(lib, "fixture_global_pointer"), Ptr).contents;
          else if (kind === "function") value = FunctionRecord.in_dll(lib, "fixture_global_function").function;
          else if (kind === "typed copy") value = Record.from_buffer_copy(Record.in_dll(lib, "fixture_global_record"));
          else if (kind === "cleared typed copy") {
            value = Record.from_buffer_copy(Record.in_dll(lib, "fixture_global_record"));
            value.pointer = null;
          }
          else if (kind === "numeric copy") value = c.c_int32.from_buffer_copy(scalar._buffer);
          else if (kind === "Buffer") value = scalar._buffer.subarray(0);
          else if (kind === "typed array") value = new Uint8Array(scalar._buffer.buffer);
          else if (kind === "ArrayBuffer") value = scalar._buffer.buffer;
          else if (kind === "multiple views") value = [scalar, Record.in_dll(lib, "fixture_global_record")];
          if (${explicitClose}) {
            lib.close();
            assert.equal(lib.loaded, false);
            assert.throws(() => fn(null), /Library is closed/);
            assert.throws(() => fn.callAsync(null), /Library is closed/);
            assert.throws(() => lib.symbol("fixture_global_value"), /Library is not loaded/);
            assert.throws(() => c.c_int32.in_dll(lib, "fixture_global_value"), /Library is not loaded/);
            lib.close();
          }
          return { value, oldOwner, library: new WeakRef(lib._lib) };
        }
        try {
          for (const kind of ["scalar", "record", "union", "pointer", "C-updated pointer", "C-cleared pointer", "contents", "function", "typed copy", "Buffer", "typed array", "ArrayBuffer", "multiple views", "cleared typed copy", "numeric copy"]) {
            let state = open(kind);
            await collect();
            const dependent = kind !== "cleared typed copy" && kind !== "numeric copy";
            assert.equal(existsSync(marker), !dependent, kind + ": incorrect module dependency");
            assert.equal(state.library.deref(), undefined, "the lease must not keep the Library wrapper alive");
            if (state.oldOwner) assert.equal(state.oldOwner.deref(), undefined, "C cleared the pointer, but its previous owner is still retained");
            if (kind === "scalar" || kind === "contents") assert.equal(state.value.value, 42);
            if (kind === "union") assert.equal(state.value.number, 42);
            if (kind === "pointer" || kind === "C-updated pointer") assert.equal(state.value[0], 42);
            if (kind === "function") assert.equal(state.value(39), 40);
            if (kind === "record" || kind === "typed copy") {
              assert.equal(state.value.value, 7);
              assert.equal(state.value.pointer[0], 42);
            }
            if (kind === "multiple views") {
              state.value[0] = null;
              await collect();
              assert.equal(existsSync(marker), false, "the second view still needs the module");
            }
            state = null;
            await collect();
            assert.equal(existsSync(marker), true, kind + ": module lease was not released");
            unlinkSync(marker);
          }
        } finally {
          if (existsSync(marker)) unlinkSync(marker);
          rmdirSync(dir);
        }
      `;
      const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], {
        cwd: import.meta.dirname,
        timeout: 15000,
        encoding: "utf8",
      });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
    });
  }

  it("closing the current-process handle changes its logical state too", function () {
    const lib = new CDLL(null);
    const fn = process.platform === "win32" ? undefined : lib.func("abs", c_int32, [c_int32]);
    if (fn) assert.equal(fn(-7), 7);
    lib.close();
    assert.equal(lib.loaded, false);
    if (fn) assert.throws(() => fn(-7), /Library is closed/);
    lib.close();
  });
});
