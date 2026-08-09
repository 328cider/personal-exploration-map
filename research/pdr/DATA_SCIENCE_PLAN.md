# Android-compatible PDR data science plan

- Status: public/synthetic estimator program closed with no survivor; standalone
  Android capture-readiness mechanism implemented; personal walking remains gated
- Product issue: #5
- Product gate: `docs/PDR_TECHNOLOGY_GATE.md`
- Research branches: `codex/pdr-research` plus isolated `codex/pdr/*` work branches

## Decision

Public and synthetic data may be used, but a product estimator may consume only
values that a future Android app can obtain through standard Android APIs and
reproduce from retained raw evidence. Dataset ground truth, Tango/VIO pose,
motion capture, corrected body heading, future trajectory, and dataset-specific
EKF pose are labels or evaluation evidence, never product inference input.

This phase changes neither canonical map truth nor the product capture path. The
public/synthetic work narrowed the minimum profile to raw accelerometer,
gyroscope, and monotonic clocks, with all other sensors optional. A later explicit
instruction authorized a standalone research logger for that profile. It does
not reopen the estimator decision or authorize a personal walking pilot.

## Android input contract

At runtime every device must be capability-probed; sensor presence is never
assumed. Sensor values retain SI units, Android device axes, original
`SensorEvent.timestamp`, callback monotonic time, accuracy, and sensor metadata.

| Data | Android source | Role and rule |
|---|---|---|
| Raw acceleration and angular velocity | `SensorManager`, accelerometer/gyroscope and uncalibrated variants | Candidate live input; retain raw values and axes |
| Magnetic field | magnetic-field variants | Optional; use for heading only behind a magnetic-quality gate |
| Platform orientation | rotation vector / game rotation vector | Optional; never a universal requirement |
| Gravity / linear acceleration | corresponding motion sensors | Optional; record whether reproducible from raw IMU |
| Steps | step detector / step counter | Optional; Android 10+ requires activity-recognition permission |
| Pressure | pressure sensor | Optional; unsupported devices must still have an explicit path |
| Sparse GNSS | `Location` position, accuracy, speed, bearing plus availability flags | Optional anchor; bearing is motion direction, not device heading |
| Time | sensor timestamp, callback monotonic clock, `Location.getElapsedRealtimeNanos()` | Required; wall clock is not the estimator time base |
| Capability metadata | sensor vendor/version/range/resolution/power/delay/FIFO/wake-up/reporting mode | Compatibility and support decisions |
| Lifecycle, batching, gaps, battery, thermal | service and capture diagnostics | Operational evaluation only; never map truth |
| Tango/VIO, motion capture, external truth | dataset or experiment truth systems | Training label or evaluation only |
| Body heading, stride, turn, floor label | dataset annotations | Targets or evaluation only |

Continuous background capture on Android 9+ must use a foreground-service path.
Initial profiles target 50 or 100 Hz. A method requiring over 200 Hz is rejected;
one requiring over 100 Hz remains benchmark-only until a later device and power
gate. Live preview may use only samples available at that instant. A post-session
smoother may use the whole retained session but no external ground truth or
pre-existing map as estimator input.

Primary API references:

- [Android motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- [Sensor API overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)
- [`SensorEvent`](https://developer.android.com/reference/android/hardware/SensorEvent)
- [`Location`](https://developer.android.com/reference/android/location/Location)
- [Android 9 background sensor restrictions](https://developer.android.com/about/versions/pie/android-9.0-changes-all)
- [Android 12 sensor rate limits](https://developer.android.com/about/versions/12/reference/compat-framework-changes)

## Capability profiles

| Profile | Required | Optional |
|---|---|---|
| `imu6` | accelerometer, gyroscope, monotonic timestamps | uncalibrated variants |
| `platform-fused` | `imu6` | rotation vector, game rotation vector, gravity, linear acceleration, magnetometer |
| `step-enabled` | `imu6` | step detector/counter and platform-fused sensors |
| `enriched-with-pressure/GNSS` | `imu6` | all above, pressure, sparse GNSS |

An estimator declares one required profile. Optional inputs must have a defined
missing-sensor path. A device that does not meet the required profile is reported
as unsupported rather than as a supported device with silently degraded accuracy.

## Dataset compatibility gate

Before a dataset or pretrained model is used, audit every sequence and field:

1. field name, unit, axes/frame, timestamp basis, and sample rate;
2. matching Android API and `Sensor.TYPE_*` or `Location` property;
3. role: `live-input`, `post-session-input`, `training-label`,
   `evaluation-only`, or `forbidden`;
4. whether the future Kotlin logger can record the same semantic value;
5. whether platform preprocessing is reproducible from Android raw evidence;
6. device/user/placement/sequence split and leakage controls;
7. fallback or explicit unsupported status for missing required sensors;
8. license scope for research, weights, redistribution, and product inclusion.

Decisions:

- **Product-compatible**: every inference input and transformation is Android
  reproducible, rate-compatible, leak-free, and licensed for the proposed use.
- **Benchmark-only**: useful for comparison or ground-truth evaluation, but a
  platform, input, rate, preprocessing, or license condition is unresolved.
- **Reject**: depends on unavailable/forbidden input, non-reproducible corrected
  values, future information, leakage, or more than 200 Hz.

`datasets/registry.json` deliberately gives RoNIN, OxIOD, and RIDI an initial
`benchmark-only` decision. RoNIN's Android raw streams can be audited as candidate
inputs, while Tango pose and true body heading remain evaluation-only. OxIOD's
iPhone/Core Motion semantics and RIDI's processed/orientation fields must not be
treated as Android-equivalent without a field-level proof. A dataset is not
promoted merely because its benchmark accuracy is high.

Dataset sources:

- [RoNIN project](https://ronin.cs.sfu.ca/) and [official code](https://github.com/Sachini/ronin)
- [OxIOD](https://deepio.cs.ox.ac.uk/)
- [RIDI project](https://yanhangpublic.github.io/ridi/index.html) and [official code](https://github.com/higerra/ridi_imu)
- [`gnss-ins-sim`](https://github.com/Aceinna/gnss-ins-sim), usable only to test capture/evaluation plumbing, not to prove pocket-walking performance

## Execution phases

### Phase 1 — synthetic foundation (implemented)

Generate only Android-shaped raw channels. Store trajectory, body heading, and
stride in a separate truth object. Deterministically inject bias/noise, timestamp
jitter, batching, gaps, magnetic disturbance, missing sensors, device rotations,
and rate reduction. Golden tests must expose 90-degree rotation, mirror image,
false self-intersection, and distance-scale error. Synthetic motion validates the
pipeline and metrics; it is not evidence that pocket PDR works.

### Phase 2 — public-data audit (RoNIN one-sequence gate implemented)

Complete sequence-level reports for OxIOD, RoNIN, and RIDI. Evaluate B0/B1 first
using only Android-compatible fields. Audit official pretrained-model inputs and
licenses before execution. Replay the same sequences at 50/100 Hz and with gaps,
batching, and missing optional sensors. Split by dataset/user/device/placement and
sequence before windowing.

The official RoNIN FRDR terms, archive size, and published checksums are pinned.
The smallest unseen-subject sequence (`a054_1`) is fetched by HTTP Range without
downloading the 3.2 GB archive, and only `raw/imu/acce`, `raw/imu/gyro`, and
`raw/imu/game_rv` enter estimators. Cross-device synchronized time, Tango pose,
`start_frame`, and `imu_time_offset` remain evaluation-only. The same sequence is
replayed at 50/100 Hz with batch, gap, and missing-orientation scenarios. RIDI
and OxIOD still require the same artifact-specific gate.

### Phase 3 — common baselines (synthetic replay implemented; public data gated)

- B0: Android step events, optional rotation vector, fixed stride.
- B1: accelerometer and gyroscope with optional platform orientation/magnetometer
  for step, stride, and body-heading estimation.

The implemented research baseline replays B0 plus B1 `imu6`, `platform-fused`,
and `step-enabled` configurations over identical synthetic sessions. It validates
explicit unsupported/fallback states, live temporal causality, 50/100 Hz,
callback batching, gaps, magnetic rejection, and catastrophic failure reporting.
These synthetic results are pipeline evidence only and cannot produce a product
Go/Narrow/Stop decision.

The first public replay produces a Stop for B1 through v1.1.0. Correcting the
rotation-vector conversion to Android's documented azimuth convention does not
remove mirror, heading, or turn failures. A predeclared Weinberg-gain sweep
shows that distance is coefficient-sensitive, but no coefficient may be chosen
from the test sequence. The current 50/100 Hz distance disagreement must be
resolved before calibration, native capture, or a personal pilot.

Replay identical input per estimator and report results by capability profile.
Keep live estimates distinct from post-session smoothing.

### Phase 4 — native capability probe and logger (desk implementation complete; no walking)

The standalone Kotlin APK and offline validator now implement the derived sensor
types, 50/100 Hz live/batch modes, permissions, capability metadata, FIFO flush,
app-private bundle lifecycle, hashes, lifecycle/resource diagnostics, and local
export. Android 15 CI uses a no-walking batched run. The next C0 step is a real
device capability/stationary probe only; it is not estimator or pocket-walking
evidence.

### Phase 5 — minimal personal pilot (gated)

Freeze capture and estimator versions first. Then collect only three or four runs
from one person and one device, replaying the same log through every estimator.
Measure screen-off gaps, foreground-service survival, domain shift, battery, and
thermal behavior. These runs can support Stop or Narrow, never a general Go.

## Reproducibility and acceptance

- Every inference field has an Android mapping; unknown mappings are zero.
- Automated validation rejects labels/evaluation fields in inference features.
- Adapters explicitly declare unit, axis, timestamp, and rate transformations.
- 50/100 Hz, batch, gap, and missing-sensor robustness can be replayed.
- Live outputs cannot reference a source sample later than their output time.
- Splits happen at dataset/user/device/placement/sequence level before windows.
- Runs record fixed seed, dataset content hash, estimator version, and capability
  profile.
- Public-data accuracy and real-Android feasibility are reported separately.
- No raw dataset, model weights, or product schema changes are committed here.

## Stop conditions

Stop or narrow a candidate if it requires a forbidden input, cannot reproduce its
preprocessing from Android raw evidence, depends on an unsupported rate, has no
legally usable artifact path, leaks windows across sequences/users/devices, hides
catastrophic geometry behind aligned averages, or needs interaction comparable to
manual mapping. Public/synthetic work cannot pass screen-off, OEM power, battery,
thermal, or pocket-UX gates.
