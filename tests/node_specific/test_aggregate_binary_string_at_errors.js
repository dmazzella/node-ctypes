import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArgumentError, string_at, wstring_at } from "node-ctypes";

describe("Node binary string conversion errors", function () {
  it("preserves the address conversion cause", function () {
    for (const read of [string_at, wstring_at]) {
      assert.throws(
        () => read({}),
        (error) => error instanceof ArgumentError && error.cause instanceof TypeError && error.message === `argument 1: TypeError: ${error.cause.message}`,
      );
    }
  });

  it("retains the exact adapter exception without swallowing it", function () {
    const sentinel = new Error("address adapter sentinel");
    const source = {
      get _as_parameter_() {
        throw sentinel;
      },
    };
    assert.throws(
      () => string_at(source, 0),
      (error) => error instanceof ArgumentError && error.cause === sentinel && error.message === "argument 1: Error: address adapter sentinel",
    );
  });

  it("keeps buffer bounds errors distinct from address conversion errors", function () {
    const bytes = Buffer.from([0, 0xff]);
    assert.throws(
      () => string_at(bytes, 3),
      (error) => error instanceof RangeError && !(error instanceof ArgumentError) && /buffer length/.test(error.message),
    );
  });
});
