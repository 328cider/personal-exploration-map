# Rate-stable step detector result

## Outcome

The frozen detector **passes the preregistered 50/100 Hz rate-stability gate on
both untouched validation sequences**, but it **does not pass a step-count
accuracy or PDR product gate**. The candidate remains Stop for product adoption
and for a personal walking pilot.

- Validation step-count disagreement: `0.00%` and `0.44%` (gate `<= 1%`).
- Validation amplitude-score disagreement: `0.05%` and `0.15%` (gate `<= 2%`).
- Callback batching changed no result; future-sample violations were zero.
- B1 distance-scale error still spans `14.3--15.0%` on validation.
- B1 body-heading MAE remains `81.1--85.7 degrees` on validation.
- The post-freeze Android Step Counter comparison ranges from exact agreement to
  `57.6%` custom-detector overcount, proving that rate stability alone can hide a
  stable-but-wrong detector.

This is benchmark-only evidence. RoNIN's terms do not permit product use, and
public replay cannot establish screen-off capture, foreground-service survival,
OEM power policy, battery, thermal behavior, or pocket UX.

## Leakage-controlled order of operations

1. Commit `f7601f2` preregistered the split, ranking, and gates using only the
   official archive inventory. Previously inspected `a054_1` was excluded.
2. Only development `a051_3` was range-fetched and inspected.
3. Four registered configs were ranked without trajectory truth. The winner was
   `rs25-a010-p025-r025`.
4. Commit `d11982a` froze detector parameters, code hashes, and the development
   output while both validation members were still unfetched.
5. Validation `a052_2` and `a049_1` were then fetched and evaluated together.
   Validation did not trigger tuning.
6. The platform Step Counter comparison was added only after the frozen
   validation result. It is a secondary Android comparator, not a new selector.

The three conservative subject keys and retained device identifiers are
disjoint (`a051/asus4`, `a052/samsung1`, `a049/asus7`). This is useful evidence
against same-sequence leakage, but three sequences do not establish population,
placement, or device-family generalization.

## Android-compatible method

The detector reads only raw accelerometer `x/y/z` in `m/s^2` and monotonic sensor
timestamps. It does not read Game Rotation Vector, Tango pose, body-heading
truth, stride truth, platform Step Counter, or future samples.

The frozen implementation:

1. closes causal 40 ms magnitude buckets on a 25 Hz monotonic-clock grid;
2. uses timestamp-derived exponential coefficients for a 0.75 s baseline and
   0.08 s smoothing filter;
3. detects a peak/valley hysteresis cycle with a 0.10 `m/s^2` activation gate,
   0.25 `m/s^2` prominence, and 0.25 s refractory period;
4. resets across observation gaps longer than 200 ms;
5. emits only after the bucket and falling edge are observable.

The fixed-time grid is important because Android treats a requested sampling
period as a hint; actual events can arrive faster or slower. `SensorEvent.timestamp`
is the monotonic event-time basis, while callback batching must not change the
estimate. Android also documents accelerometer SI units and gravity semantics.

The design is informed by published peak/valley, adaptive magnitude, and temporal
threshold work, but it is not a reproduction of the paper and does not inherit
its reported accuracy. The cited study also warns that static device-pose changes
can cause false steps, which this public replay does not resolve.

Primary sources:

- [Android SensorEvent](https://developer.android.com/reference/android/hardware/SensorEvent)
- [Android SensorManager](https://developer.android.com/reference/android/hardware/SensorManager)
- [Lee et al. 2015, Step Detection Robust against the Dynamics of Smartphones](https://doi.org/10.3390/s151127230)
- [Official RoNIN data description](https://ronin.cs.sfu.ca/README.txt)

## Frozen results

| Sequence | Role / device | Detector count 50 / 100 | Count rate diff | Amplitude rate diff | B1 distance-scale error | B1 heading MAE |
|---|---|---:|---:|---:|---:|---:|
| `a051_3` | development / `asus4` | 427 / 426 | 0.234% | 0.107% | 19.5--19.7% | 95.8--95.9 deg |
| `a052_2` | validation-primary / `samsung1` | 589 / 589 | 0.000% | 0.053% | 14.3--14.4% | 85.5--85.7 deg |
| `a049_1` | validation-confirmatory / `asus7` | 454 / 452 | 0.441% | 0.147% | 14.9--15.0% | 81.1--81.2 deg |

The prior local-peak detector's count disagreement was `3.85%`, `5.42%`, and
`8.68%` on these sequences. Fixed-grid normalization therefore addresses the
specific sample-rate failure it targeted.

The distance and heading columns are secondary truth diagnostics and were not
used to choose the config. Heading remains decisively outside the Issue #5
Go/Narrow thresholds. Distance is also too close to or beyond the Narrow/Stop
boundary to justify capture work, especially with only two validation sequences.

## Stable-but-wrong check

RoNIN also retains `raw/imu/step`, documented as Android
`TYPE_STEP_COUNTER`. Because it is normally obtainable on supporting Android
devices, it is a valid optional platform comparator. It is not manual step truth:
the OEM algorithm is opaque, sensor availability varies, and counter jumps lose
exact event timing. Counter deltas nevertheless expose a critical failure mode.

| Sequence | Platform counter delta | Custom count 50 / 100 | Signed count error 50 / 100 |
|---|---:|---:|---:|
| `a051_3` | 271 | 427 / 426 | +57.56% / +57.20% |
| `a052_2` | 559 | 589 / 589 | +5.37% / +5.37% |
| `a049_1` | 452 | 454 / 452 | +0.44% / 0.00% |

`a052_2` contains 26 callback jumps representing 50 increments without precise
per-step timestamps; the cumulative counter still recovers the total delta.
Its first post-start callback jumps by seven, so the conservative boundary
minimum is 553 rather than the 559 point delta. No finite boundary maximum is
claimed because the stream has no callback after the evaluation end. The other
two sequences have unit first-boundary increments and minima equal to their
point deltas. These limitations reinforce that this is a platform comparator,
not ground truth.
The heterogeneous disagreement means the detector cannot yet claim consistent
gait-event semantics across people/devices. No post-validation threshold was
tuned to hide this result.

## Robustness and reproducibility

- 250 ms callback batching is exactly invariant because sensor timestamps drive
  processing.
- A 600 ms synthetic observation gap produces no event whose source range spans
  the gap; the filter state resets.
- Fixed code/config hashes are checked before validation replay.
- An independent standard-library validator recomputed 62 assertions covering
  split cardinality, hashes, ranking, rate ratios, gates, platform ratios, and
  claim boundaries.
- The three selected members transferred 205,538,149 bytes by HTTP Range; the
  3,211,376,453-byte archive was not downloaded wholesale.
- Raw rows, outputs, and model weights remain ignored by Git. The committed
  notebook contains only aggregate results.
- All execution uses the existing Docker image; Windows npm/Python environments
  are untouched.

Reproducibility anchors:

- split: `datasets/splits/ronin-rate-stability-v1.json`
- frozen config: `datasets/splits/ronin-rate-stability-v1-frozen.json`
- sequence metadata: `datasets/manifests/ronin-rate-stability-v1.json`
- executed notebook: `notebooks/06_rate_stable_step_detector.ipynb`
- independent QA: `scripts/validate_step_rate_stability.py`

## Decision and next gates

| Question | Decision |
|---|---|
| Is the new detector insensitive to 50 vs 100 Hz on two untouched sequences? | **Pass** |
| Is its step count established as correct/generalizable? | **No; Stop** |
| Is stride/distance ready? | **No; Stop pending count semantics and calibration** |
| Is body heading ready? | **No; Stop** |
| Is Android capture/lifecycle ready? | Not evaluated |
| Start a personal walking pilot? | **No** |

The next lowest-cost work is not another stride coefficient sweep. It is to:

1. promote the optional Android Step Counter to a clearly versioned B0 comparator
   while preserving jump/availability limitations;
2. test adaptive peak/valley or walking-state gating against counter deltas on
   additional disjoint public sequences, with a new preregistered split;
3. separately pursue body-heading estimation that does not equate phone and body
   orientation;
4. only after those survive, define the no-walking Android capability probe.

No product API, database schema, `TrackingProviderPort`, canonical map, native
capture path, `CURRENT_DIRECTION.md`, or `main` content changed in this work.
