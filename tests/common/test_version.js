import assert, { strictEqual, throws } from "node:assert";
import { describe, it, before, after } from "node:test";
import { Version } from "node-ctypes";

describe("Version", { skip: true }, function () {
  it("should have correct major, minor, and patch versions", function () {
    strictEqual(Version.major, 0);
    strictEqual(Version.minor, 1);
    strictEqual(Version.patch, 0);
  });

  it("should return correct version string", function () {
    strictEqual(Version.toString(), "0.1.0");
  });
});
