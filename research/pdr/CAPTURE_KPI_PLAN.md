# PDR capture KPI and decision plan

Status: preregistered research contract, 2026-08-09
Scope: `research/pdr/` only; no product or canonical-map write authority

## Outcome and decision boundary

The current public/synthetic work answers whether candidate processing is internally replayable. It does **not** answer whether an Android phone can preserve usable raw evidence while screen-off, whether an estimator is accurate, or whether PDR belongs in the product. This plan separates those questions so one favorable metric cannot substitute for another.

1. **Capture readiness:** can the logger preserve complete Android evidence?
2. **Evidence-program readiness:** did every preregistered user/device/placement/lifecycle cell produce usable, rights-cleared evidence without split leakage?
3. **Estimator validity:** does a frozen estimator meet accuracy and catastrophic-failure gates against independent truth?
4. **Product adoption:** do accuracy, passive UX, battery, privacy, frame, and uncertainty gates all pass?

Only (1) is implemented by the logger in this change. A capture pass is not an estimator or product pass.

## Primary KPIs

| ID | KPI | Exact definition | Grain / source | Initial decision target |
|---|---|---|---|---|
| K1 | Capture Usability Rate | `usable completed sessions / all start attempts`. An abandoned `.partial` session remains in the denominator. `usable` requires hash and schema integrity, accel+gyro, zero writer drops, monotonic clocks, no >=1 s sensor gap, minimum effective IMU coverage, and no truth-like field. | Capture program; Android bundles plus validator report | `>=90%` for capture-ready; `70-<90%` Narrow/remediate; `<70%` Stop/redesign |
| K2 | Mandatory IMU Effective Coverage | For each of accelerometer and gyroscope: `min(observed span / session duration, 1 - excess-gap duration / session duration, realized rate / min(requested rate, 50 Hz))`; session KPI is the lower sensor value. Excess gap is time beyond two requested periods. | Session, segmented by screen/app/service state | Every usable session `>=98%`; `<95%` invalid; `95-<98%` diagnostic-only |
| K3 | Evidence Readiness Rate | `planned protocol cells with the required number of usable sessions, immutable provenance, predefined split, and applicable truth/rights record / all planned cells`. A run must match program revision, participant, device, placement, route, lifecycle, motion condition, duration, rate/batch mode, optional-input requests, and wake-lock policy; matching only `cell_id` is insufficient. Missing or extra convenient cells do not change the denominator. | Capture-program ledger | `100%` before estimator comparison; below 100% cannot support a broad claim |

These targets are preregistered engineering thresholds, not measurements of current phones. They may be revised only in a new protocol before looking at the affected validation cells.

## Integrity gates inside K1

All of the following are hard gates:

- `session_manifest.json` is finalized and a `COMPLETED` marker exists.
- Every evidence file has a matching SHA-256 and byte count; unhashed files are quarantined.
- `session_id` and `schema_version` agree across every record.
- `(stream, sequence_id)` is unique; event timestamps are monotonic per sensor.
- Sequence IDs are contiguous from zero; duplicate sensor timestamps, cross-boot/out-of-session timestamps, and wrong JSON types are invalid.
- `callback_elapsed_realtime_ns >= sensor_timestamp_ns` on the same boot clock.
- Every observed sensor has capability metadata and both `TYPE_ACCELEROMETER` and `TYPE_GYROSCOPE` are observed.
- Writer drop count and fatal writer error count are zero.
- Values are finite and location availability flags agree with nullable values.
- Any field resembling ground truth, Tango/Vicon pose, true/body heading, future trajectory, or EKF pose is rejected before replay.
- A session with a required sensor rate below `0.8 * min(requested rate, 50 Hz)` is invalid.
- A >=1 s gap in either mandatory sensor is a catastrophic capture failure. A 100 ms-<1 s gap makes the session diagnostic-only.
- Required registration period/latency must match the frozen mode, selected sensor metadata must match the capability probe, and a clean stop must contain an accepted FIFO flush plus completion for every registered sensor.
- The declared screen/app lifecycle must be visible in diagnostic state intervals. Program readiness also requires the cell-specific minimum lifecycle duration and at least 95% of planned run duration.

## Driver metrics

These explain the primary KPIs but cannot independently authorize a Go decision.

| Driver | Definition / segmentation | Why it matters |
|---|---|---|
| Realized sensor rate | `(samples - 1) / sensor-time span`, p50/p95 interval, by sensor/vendor/device/mode | Detects OEM rate clipping and sensor-specific loss |
| Delivery latency | `callback_elapsed_realtime_ns - SensorEvent.timestamp`, p50/p95/max, by live vs 250 ms batch mode | Separates delayed delivery from lost sensor evidence |
| Gap profile | maximum gap and counts >=100 ms and >=1 s, by screen-on/off and app foreground/background | Exposes the failure mode public continuous datasets omit |
| Registration success | successful `registerListener` calls / requested sensors, with explicit missing/failed sensor types | Prevents silent capability downgrade |
| Completion/recovery | complete, user-stopped, OS/process-interrupted, writer-failed, exported | Makes abandoned sessions visible instead of deleting them |
| Storage cost | bytes per sensor-hour and total free/usable bytes at start/end | Determines safe run duration and rotation limits |
| Battery cost | battery percentage-point change per elapsed hour when the run has >=30 minutes of matched snapshots and is unplugged throughout; plus start/end fraction and peak battery temperature | Guardrail for passive use; short or charging runs are explicitly ineligible, not treated as zero drain |
| Thermal cost | integrated time in Android thermal status `SEVERE` or worse, using periodic snapshots plus status-change callbacks; peak battery temperature is diagnostic only | Prevents high-rate capture from hiding unacceptable device cost |
| Permission burden | prompts, denied/revoked permission, feature disabled, and start failures | Optional step/GNSS must not make IMU capture falsely unsupported |
| Screen-off continuity | K2 and gap profile restricted to screen-off intervals | Android emulator/public data cannot substitute for this real-device result |
| Callback clustering | events grouped offline by delivery timestamp proximity; never presented as an OS-provided batch ID | Measures actual batching without fabricating SensorEvent fields |

## Guardrails

- **Leakage:** zero training/evaluation label fields in live/post-session estimator inputs.
- **Raw preservation:** zero transformed values written over raw events; device axes and SI units remain as delivered.
- **Capability honesty:** zero sessions called supported when accel/gyro or the declared profile is unavailable.
- **Local-first:** zero network destinations and zero automatic upload. GNSS remains optional and app-private until explicit export.
- **Privacy:** Git contains schemas, synthetic fixtures, and summaries only; no personal capture, raw public rows, or device identifiers.
- **Passive UX:** production interaction target remains start/stop only. Research sync markers and metadata entry are instrumentation and do not count as product UX evidence.
- **Resource:** Narrow target `<=10 percentage points/hour`; Go target `<=5 points/hour`; no time in `SEVERE+` thermal state. Battery comparisons require >=30-minute matched runs with charging off.
- **Frame truth:** local PDR data never becomes geographic without an explicit anchor; Location bearing is direction of travel, not phone/body heading.

## Accuracy KPIs, held until independent truth exists

The Issue #5 metrics remain frozen: origin-only endpoint drift ratio, SE(2)-aligned ATE, distance scale error, 10/30/50 m and 60 s RPE, heading drift, 90-degree turn MAE, topology correctness, false self-intersection, loop closure error, anchors/100 m, interruption seconds/100 m, and catastrophic-session rate. Report per-session values and user-clustered confidence intervals, not window-pooled averages.

The capture logger cannot produce these metrics. Truth must be an external evaluation sidecar and never an inference feature.

## Sample-size consequences

- The one-person/one-device 3-4 run pilot can Stop or Narrow the logger, but cannot prove generalization or estimator Go.
- With zero catastrophic failures, the rule-of-three one-sided 95% upper bound is about `3/n`. Therefore a Narrow claim of `<10%` needs at least 30 independent sealed-validation sessions with zero failures; a Go claim of `<2%` needs at least 150 independent sessions with zero failures. Any failures require an exact binomial interval rather than this shortcut.
- Windows from one session are not independent samples. Confidence intervals and train/validation/test separation are grouped by participant, device, route, and session.
- A future estimator program should contain at least 10 unseen participants and 4 device models for a Narrow decision. A broad Go claim requires at least 30 unseen participants, 6 device models spanning vendors/tiers, all supported placements, and enough independent sessions to satisfy the catastrophic-failure bound.

## Cadence and ownership

- The Android app emits raw records and session completion metadata continuously; it does not calculate product claims.
- The Docker validator runs after every export and on every research PR fixture.
- Program KPIs are recalculated after each preregistered batch, include E0/C0/C1/C2 stage readiness, and report the exact plan-file SHA-256. Sealed validation is evaluated once.
- PDR research owns the KPI definitions. Main development sees only the summary and may not treat a capture-ready result as product adoption.

## Go / Narrow / Stop for the capture mechanism

- **Capture-ready:** K1 >=90%, K3 =100%, integrity pass rate =100%, plan-contract violations =0, every usable run K2 >=98%, no required-sensor or >=1 s gap failure, and all emulator/lifecycle gates pass.
- **Narrow/remediate:** K1 70-<90% or K3 70-<100%, with failures isolated to a declared OEM/API/mode and a reliable unsupported-device outcome.
- **Stop/redesign:** K1 <70%, integrity below 100%, silent drops, recurring >=1 s gaps, inability to finalize/recover sessions, required foreground operation that cannot survive screen-off, or resource/permission burden beyond Issue #5 limits.
