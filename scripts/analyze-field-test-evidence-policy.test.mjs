import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBatteryOptimizationFinding } from "./analyze-field-test-evidence.mjs";

const callbackFailure = {
  severity: "FAIL",
  code: "callback_gap_120s",
  message: "3 callback delivery gaps exceeded 120 seconds.",
  category: "runtime",
};

const legacyOptimizationWarning = {
  severity: "WARN",
  code: "battery_optimization_enabled",
  message: "legacy warning",
  category: "environment",
};

test("optimization ON becomes INFO without weakening callback failures", () => {
  const findings = normalizeBatteryOptimizationFinding(
    [callbackFailure, legacyOptimizationWarning],
    { start_battery_optimization_enabled: true },
  );

  assert.deepEqual(
    findings.filter((item) => item.code === "callback_gap_120s"),
    [callbackFailure],
  );
  assert.equal(
    findings.some((item) => item.code === "battery_optimization_enabled"),
    false,
  );
  assert.deepEqual(
    findings.filter((item) => item.code === "battery_optimization_observed"),
    [
      {
        severity: "INFO",
        code: "battery_optimization_observed",
        message:
          "Battery optimization was enabled at start. This is the standard product condition and is recorded for comparison, not treated as a defect by itself.",
        category: "environment",
      },
    ],
  );
});

test("optimization OFF removes the legacy warning without adding an observation", () => {
  const findings = normalizeBatteryOptimizationFinding(
    [legacyOptimizationWarning],
    { start_battery_optimization_enabled: false },
  );
  assert.deepEqual(findings, []);
});
