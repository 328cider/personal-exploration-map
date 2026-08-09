# Phase 3 common baseline replay

- Date: 2026-08-09
- Scope: synthetic Android-shaped evidence only
- Product integration: none
- Decision authority: pipeline validation only; no Go/Narrow/Stop decision

## Answer first

B0 and B1 now replay the same immutable `NormalizedSensorSession` through a
common live-output contract. The implementation proves that capability rejection,
50/100 Hz execution, callback batching independence, sensor gaps, optional-sensor
fallbacks, magnetic rejection, temporal causality, and catastrophic geometry
flags can be exercised before any personal walking collection.

It does **not** prove pocket-PDR accuracy. In the 160-run synthetic matrix, the
injected 90-degree phone-orientation change produced catastrophic failures for
every baseline profile. B1 `imu6` also produced false intersections in otherwise
low-drift ideal fixtures. Those failures are intentionally visible rather than
hidden behind a median or shape alignment.

## Implemented baseline contracts

| Baseline | Required inputs | Optional path | Missing-input behavior |
|---|---|---|---|
| B0 | Step Detector and one of Rotation Vector / Game Rotation Vector | fixed 0.72 m stride | unsupported; no silent custom-step or gyro fallback |
| B1 `imu6` | accelerometer and gyroscope | custom acceleration-peak steps, adaptive bounded stride | unsupported if either raw IMU stream is absent |
| B1 `platform-fused` | accelerometer and gyroscope | Game/Rotation Vector when present; gyro fallback | supported with an explicit fallback flag |
| B1 `step-enabled` | accelerometer and gyroscope | Android steps when present; custom-step fallback | supported with an explicit fallback flag |

All variants emit local, origin-relative metre positions with uncertainty and an
inclusive source-sample range. Live validation rejects output that cites a future
sample. Estimator code accepts only the normalized sensor session; truth enters
through the separate evaluation function.

The magnetometer is not yet used for heading. Normal samples are marked
quality-checked-but-unused; any out-of-range norm or invalid accuracy rejects the
magnetic path. This is deliberately conservative until tilt compensation and
device-specific calibration can be validated.

## Replay matrix

Each route/rate/scenario fixture is created once and passed unchanged to all four
estimator configurations.

| Dimension | Values |
|---|---|
| Route | straight, rectangle, out-and-back, irregular loop |
| Rate | 50 Hz, 100 Hz |
| Scenario | all optional inputs, 250 ms callback batching, 600 ms gap, IMU6-only, phone handling plus magnetic anomaly |
| Seed | 23 |
| Total records | 160 |

Observed pipeline results:

- B0 rejected all 8 IMU6-only records because Step Detector and platform
  orientation were unavailable.
- Every supported record had zero future-sample violations.
- The 250 ms callback-batching scenario matched the ideal sensor-time metrics.
- The 90-degree phone-handling scenario had a catastrophic rate of 1.0 for all
  four baseline configurations.
- The B1 IMU6 ideal scenario had a 0.375 catastrophic rate from false
  self-intersections despite a 0.025 median endpoint-drift ratio.
- B1 platform-fused and step-enabled ideal scenarios had zero catastrophic
  sessions in this synthetic matrix. This is a pipeline observation only, not an
  Android or unseen-user accuracy claim.

## Validation report

### Overall assessment: Share with caveats

The replay architecture and automated gates are ready to use on a legally
retrievable, field-audited sequence. The estimator accuracy is not ready for a
product decision.

### Methodology review

- Question answered: can common baselines consume only Android-shaped inputs and
  expose capability/failure behavior reproducibly?
- Evidence grain: one complete synthetic session per route/rate/scenario.
- Comparison: every estimator receives the same session object; no per-estimator
  walk or fixture is generated.
- Truth use: evaluation only, after live estimator output is complete.
- Time basis: sensor monotonic timestamp; callback time is retained but does not
  drive the estimator.

### Material caveats

1. Synthetic step and orientation signals are easier than uncontrolled pocket
   motion and cannot establish real accuracy.
2. Phone orientation is not body heading. The injected orientation discontinuity
   correctly breaks every current baseline; body-heading/handling inference is
   still unresolved.
3. The 600 ms gap verifies replay and uncertainty growth, not Android screen-off
   reliability.
4. No public sequence is executed because artifact terms and exact sequence
   manifests remain unresolved.
5. Battery, thermal, FIFO, wake-up behavior, OEM background limits, and domain
   shift require the later native capability and pilot gates.

### Calculation spot-checks

- Record count: 4 routes × 2 rates × 5 scenarios × 4 estimator configurations
  = 160.
- B0 IMU6-only support: 0/8, as required by its declared contract.
- Future-sample violations: 0 across all supported records.
- Handling/magnetic catastrophic rate: 1.0 for each estimator configuration.
- Batch comparison: ideal and 250 ms batch median drift/catastrophic rate are
  equal for every supported configuration.

## Next gate

Do not move to personal walking collection. The next admissible evidence is one
legally retrievable sequence per public dataset with saved artifact terms, content
hash, sequence manifest, and adapter preflight. Run the same B0/B1 inputs at 50
and 100 Hz. If no sequence can meet that gate, proceed to a no-walking Android
capability probe rather than weakening the input contract.
