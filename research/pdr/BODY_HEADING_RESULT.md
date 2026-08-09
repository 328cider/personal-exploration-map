# Android-compatible body-heading gate result

- Date: 2026-08-09
- Experiment: `ronin-body-heading-v1`
- Phase reached: development only
- Decision: stop the classical horizontal-acceleration PCA family
- Product integration: none
- Personal walking pilot: not authorized

## Answer first

All 90 preregistered causal PCA configurations failed the development gate on
four already-inspected RoNIN sequences. No configuration was frozen, so the
three untouched validation sequences were not downloaded or evaluated. The
thresholds were not relaxed after seeing the result.

The experiment also found and corrected a semantic defect in the existing raw
RoNIN adapter. Raw `game_rv` is Android `x,y,z,w`; adapter v1 incorrectly treated
it as synchronized `w,x,y,z`. Adapter v2 preserves the raw order. Corrected
device-heading performance is catastrophic and agrees with the underlying
product risk: the phone may rotate independently of the pedestrian.

This exhausts the preregistered classical PCA family, not body-heading research
as a whole. A learned method or a direct velocity-vector estimator remains a
separate future gate and must use a clean split, 50/100 Hz Android-compatible
inputs, reproducible training provenance, and commercially usable artifacts.

## Input-semantics correction

The official RoNIN compiler reads raw rows as `[timestamp,x,y,z,w]` and reorders
them to synchronized `[w,x,y,z]`. That direction matters. After the v2 fix, the
four development sequences have mean reference-frame gravity of 9.74–9.87
`m/s²` on Z, horizontal mean magnitude of 0.001–0.017 `m/s²`, and p95 causal
orientation lag of 19.4–24.2 ms. These physical checks would not pass under the
old interpretation.

The correction supersedes the earlier platform-fused figures in the public
replay and heading/stride diagnostic. On `a054_1`, corrected device-heading MAE
is 90.7 degrees at 50 Hz and 93.7 degrees at 100 Hz; turn MAE is 75.7 and 82.6
degrees, and both paths are mirrored. The corresponding `imu6` gyro baseline is
78.4 and 77.0 degrees heading MAE. No previous product decision becomes more
favorable.

The prior rate-stable step-detector decision is unaffected: its selection and
validation consume accelerometer timestamps and values, not Game Rotation
Vector. Its secondary `imu6` trajectory diagnostic also uses gyro integration,
so the adapter-v2 change does not alter the claimed rate-stability result.

Primary evidence:

- [RoNIN official raw compiler at the audited revision](https://github.com/Sachini/ronin/blob/805b7f0f28bb164ce89ada9ac05a9470dbe3d715/source/preprocessing/compile_dataset_h5.py)
- [Android Game Rotation Vector definition](https://source.android.com/docs/core/interaction/sensors/sensor-types)
- [Android `SensorManager` coordinate transform](https://developer.android.com/reference/android/hardware/SensorManager)

## Preregistered candidate result

The candidate grid combined five trailing windows, two weighting modes, three
smoothing constants, and three anisotropy thresholds. Every estimator used only
accelerometer, Game Rotation Vector, and causal sensor timestamps. Truth was
loaded by the separate evaluator after inference.

The best diagnostic-only configuration was
`bhpca-w1000-e-s500-a20`. It was not eligible:

| Aggregate | Result | Gate |
|---|---:|---:|
| Eligible configurations | 0 / 90 | at least one needed for freeze |
| Worst-sequence mean heading MAE | 96.4 degrees | validation would require <45 degrees per run |
| Subject-balanced mean heading MAE | 84.5 degrees | diagnostic only |
| Subject-balanced turn MAE | 45.0 degrees | validation would require <=30 degrees per run |
| Worst p95 50/100 Hz disagreement | 179.7 degrees | <=10 degrees |
| Future-sample violations | 0 | 0 |

Its per-sequence mean 50/100 Hz heading MAE ranged from 66.9 to 96.4 degrees.
Each development sequence rejected it on the preregistered p95 rate-disagreement
gate. Near-180-degree flips expose the unresolved PCA axis ambiguity; a good
median rate agreement cannot hide that tail failure.

Direct Game Rotation Vector baselines were also catastrophic:

| Sequence | Device | Heading MAE at 50/100 Hz |
|---|---|---:|
| `a049_1` | `asus7` | 76.1 degrees |
| `a051_3` | `asus4` | 63.0 degrees |
| `a052_2` | `samsung1` | 99.7 degrees |
| `a054_1` | `asus4` | 90.2 degrees |

The RoNIN paper independently reports about 89.1-degree unseen-subject error for
direct device heading and about 15.6 degrees for its learned heading model,
which supports the conclusion that device yaw and body heading are different
quantities. It does not validate the released checkpoint for this product.
[RoNIN paper](https://arxiv.org/abs/1905.12853)

## Untouched validation preservation

`a050_1`, `a019_3`, and `a058_1` remain recorded as `not-fetched`. The protocol
permits validation only after a development survivor is frozen. Because there
was no survivor, downloading these sequences would add no valid evidence and
would consume their untouched status.

## Official learned-model audit

The official `ronin_body_heading.zip` was downloaded only in the network-enabled
Docker fetch service, bounded to 5 MiB, and hashed. The 593,429-byte archive hash
is `83ea966b21e14ab9605511033e398aeb8b2e4ecfbc771624df4fdaa5e20a5634`.
The checkpoint was never deserialized; only ZIP metadata and the 393-byte JSON
configuration were read.

The metadata confirms a 1,000-frame, five-second window at 200 Hz. Its sensor
subset is Android-obtainable only on devices exposing Game Rotation Vector, but
the required rate exceeds the project's 50–100 Hz capture contract. The official
README says the published model includes private training data and cannot be
fully reproduced; it also describes released models as trained on the entire
dataset. The custom data/model license permits non-commercial scientific
research and prohibits commercial product use. The model is therefore
`benchmark-demo-only-do-not-run-or-ship`.

Artifact details are pinned in
`datasets/manifests/ronin-body-heading-model.json`. Official sources:

- [RoNIN dataset and model record](https://www.frdr-dfdr.ca/repo/dataset/816d1e8c-1fc3-47ff-b8ea-a36ff51d682a)
- [Revision-pinned RoNIN code](https://github.com/Sachini/ronin/tree/805b7f0f28bb164ce89ada9ac05a9470dbe3d715)

## Decision and next boundary

- Stop this PCA family at development; do not tune it on validation.
- Keep the validation sequences untouched for a materially different,
  preregistered candidate family.
- Do not use direct device orientation as pedestrian body heading.
- Do not run or ship the official checkpoint and do not place its GPL code in
  product packages.
- Do not specify a real-device capture or ask for a personal walking pilot yet.
- The next defensible experiment is either a cleanly trained 50/100 Hz learned
  heading benchmark or a direct 2D velocity-vector benchmark. It must separate
  train/user/device/sequence groups, forbid released-test tuning, and produce
  locally trainable weights under product-compatible terms before any Android
  capture contract is narrowed.
