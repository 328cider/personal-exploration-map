import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePersonalMapBundleNumber,
  encodePersonalMapBundleNumber,
  PersonalMapBundleNumberDecodeError,
} from "../src/index.ts";

const FINITE_VALUES = [
  0,
  1,
  -1,
  1.25,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  1e-7,
  1e21,
] as const;

test("finite values round-trip through the canonical string representation", () => {
  for (const value of FINITE_VALUES) {
    const token = encodePersonalMapBundleNumber(value);
    const restored = decodePersonalMapBundleNumber(token);
    assert.equal(restored, value, token);
  }
});

test("NaN, infinities, and negative zero preserve exact JavaScript semantics", () => {
  assert.ok(Number.isNaN(decodePersonalMapBundleNumber("NaN")));
  assert.equal(
    decodePersonalMapBundleNumber("+Infinity"),
    Number.POSITIVE_INFINITY,
  );
  assert.equal(
    decodePersonalMapBundleNumber("-Infinity"),
    Number.NEGATIVE_INFINITY,
  );
  assert.ok(Object.is(decodePersonalMapBundleNumber("-0"), -0));
});

test("non-canonical aliases are rejected to keep hashes and diffs stable", () => {
  for (const token of [
    "",
    " 1",
    "1 ",
    "01",
    "1.0",
    "+1",
    "nan",
    "Infinity",
    "+infinity",
    "-0.0",
    "0e0",
  ]) {
    assert.throws(
      () => decodePersonalMapBundleNumber(token),
      (error: unknown) => {
        assert.ok(error instanceof PersonalMapBundleNumberDecodeError);
        assert.equal(error.token, token);
        return true;
      },
    );
  }
});
