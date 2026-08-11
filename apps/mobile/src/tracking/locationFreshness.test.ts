import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLocationFreshness,
  formatLocationAge,
  freshnessMessage,
} from "./locationFreshness.ts";

test("missing and non-finite timestamps remain unknown", () => {
  assert.deepEqual(classifyLocationFreshness(null, 100_000), {
    state: "missing",
    ageMs: null,
  });
  assert.deepEqual(classifyLocationFreshness(Number.NaN, 100_000), {
    state: "missing",
    ageMs: null,
  });
});

test("small clock jitter is clamped while material future timestamps fail", () => {
  assert.deepEqual(classifyLocationFreshness(100_500, 100_000), {
    state: "fresh",
    ageMs: 0,
  });
  assert.deepEqual(classifyLocationFreshness(102_000, 100_000), {
    state: "future",
    ageMs: null,
  });
});

test("30 seconds is fresh and older observations are stale", () => {
  assert.deepEqual(classifyLocationFreshness(70_000, 100_000), {
    state: "fresh",
    ageMs: 30_000,
  });
  assert.deepEqual(classifyLocationFreshness(69_999, 100_000), {
    state: "stale",
    ageMs: 30_001,
  });
});

test("age text stays compact and coordinate free", () => {
  assert.equal(formatLocationAge(2_503), "3秒前");
  assert.equal(formatLocationAge(380_256), "6分前");
  assert.equal(formatLocationAge(7_200_000), "2時間前");
  assert.equal(
    freshnessMessage({ state: "stale", ageMs: 380_256 }),
    "位置更新が遅れています（6分前）",
  );
});
