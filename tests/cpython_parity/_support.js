import path from "node:path";
import { addressof, sizeof, string_at } from "node-ctypes";

export const LIBC = process.platform === "win32" ? "msvcrt.dll" : process.platform === "darwin" ? "libc.dylib" : "libc.so.6";
export const FIXTURE = path.join(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`);

export function bytes(value) {
  return Buffer.from(string_at(addressof(value), sizeof(value)), "latin1");
}
