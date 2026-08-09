# Phase 2 public dataset and pretrained-model audit

- Audit date: 2026-08-09
- Scope: official papers, official project pages, and revision-pinned official code
- Raw rows downloaded: none
- Current result: no public dataset/model is product-compatible yet

## Answer first

RoNIN is the strongest dataset for Android-like raw evidence, but the official
pretrained pipeline is not a drop-in product candidate. Its official loader
rotates accelerometer and gyroscope features using platform orientation; during
training/validation the orientation source may be selected using
ground-truth-derived error and may be a dataset EKF output. Test mode forces the
Android Game Rotation Vector. The released model therefore remains
**benchmark-only**, while a newly trained, explicitly Android-compatible subset
remains a future candidate.

RIDI has Android sensor origins and an MIT code repository, but the published
pipeline synchronizes to 200 Hz and uses linear acceleration, gravity,
magnetometer, and a rotation vector. It also contains post-session optimization
and evaluation-time ground-truth alignment paths. Its model and dataset artifact
rights are not established by the code license. It remains **benchmark-only**.

OxIOD mixes Apple and Android devices. The documented synchronized sensor header
contains platform attitude, gravity, user acceleration, and magnetic fields but
does not expose a directly equivalent Android raw accelerometer channel. Only
the gyroscope columns currently pass the strict Android semantic gate. The
official site was unavailable during this audit and no artifact license was
verified. It remains **benchmark-only**.

## Evidence and grain

The evidence inventory is machine-readable in `datasets/source_evidence.json`.
Code references are pinned to commits so later upstream changes cannot silently
change the audit. The intended analytical grain is one sensor sequence. A future
download must record dataset, user, device, placement, and sequence before any
window extraction.

Primary references:

- [RoNIN paper](https://arxiv.org/abs/1905.12853)
- [RoNIN official code at the audited revision](https://github.com/Sachini/ronin/tree/805b7f0f28bb164ce89ada9ac05a9470dbe3d715)
- [OxIOD paper](https://arxiv.org/abs/1809.07491)
- [OxIOD extended paper](https://arxiv.org/abs/2001.04061)
- [OxIOD official site](https://deepio.cs.ox.ac.uk/)
- [RIDI paper](https://arxiv.org/abs/1712.09004)
- [RIDI official code at the audited revision](https://github.com/higerra/ridi_imu/tree/ce5d772a1ef8ce590121f0f0b254910bc07a2949)
- [RIDI/Tango Android collector](https://github.com/higerra/TangoIMURecorder/tree/ca8657b9460a1157c3e9570ec8a6c16e0072b263)

## Findings

| Severity | Finding | Evidence | Product impact | Remediation |
|---|---|---|---|---|
| High | RoNIN official training feature preprocessing can be selected with ground-truth-derived orientation error | `source/data_utils.py::select_orientation_source` compares game-RV, gyro-integration, and optional EKF errors; train/validation do not force game-RV | Official checkpoint behavior is not a clean Android-only training contract | Retrain with a fixed declared orientation source or an `imu6` method; never select preprocessing using truth error |
| High | RoNIN globalizes six raw channels with optional platform orientation | `source/data_glob_speed.py` rotates gyro/acceleration with the selected quaternion | No fallback on devices lacking Game Rotation Vector; platform variation becomes model input | Evaluate `platform-fused` separately from `imu6`, with sensor-absence rejection/fallback |
| High | OxIOD synchronized features are not cross-platform raw IMU | Official paper reports iPhone 7P/6/5 and Nexus 5; released header is platform attitude, rotation rate, gravity, user acceleration, magnetic field | Apple Core Motion semantics cannot be treated as Android `SensorEvent` semantics | Restrict to audited Nexus/raw files if the artifact exposes them; otherwise use only as benchmark evidence |
| High | Data/model artifact licenses are unresolved | RoNIN code is GPL-3.0, RIDI code is MIT, but neither code license establishes dataset/weight product rights; OxIOD site terms were unavailable | Research comparison may be possible, but redistribution/product inclusion is blocked | Capture the exact terms accompanying every downloaded archive and checkpoint before download/use |
| Medium | RoNIN and RIDI reference pipelines assume 200 Hz | Official code uses 200 Hz windows/interpolation and per-minute constants | Conflicts with initial 50/100 Hz capture profile | Downsample before any baseline comparison; a model that fails at 100 Hz stays benchmark-only |
| Medium | RIDI processed files mix input, optional platform features, and truth | Official generator writes gyro/acceleration/linear-acceleration/gravity/magnet plus Tango position/orientation and rotation vector into one CSV | A naive column slice can leak truth | Adapter roles and automatic inference-column checks are mandatory |
| Medium | Published results do not establish Android lifecycle feasibility | Public data are continuous offline sequences | Screen-off gaps, OEM power control, foreground service, battery, and thermal behavior remain untested | Keep real-device feasibility as a separate gate after method narrowing |

## Dataset-specific field decisions

### RoNIN

The revision-pinned compiler documents raw Android streams and the synchronized
groups `gyro_uncalib`, `acce`, `game_rv`, plus Tango pose and optional EKF
orientation. Raw acceleration, angular velocity, time, and optional Game Rotation
Vector map to Android APIs. Corrected Tango pose, Tango-to-body alignment, and EKF
orientation are labels/evaluation/forbidden fields.

The official velocity loader subtracts a sequence initial gyro bias, applies
dataset acceleration bias/scale, chooses an orientation source, rotates the six
channels to a global/heading-agnostic frame, and derives the target velocity from
Tango positions. The body-heading loader derives its target from Tango orientation
and a Tango-to-body alignment. Labels are acceptable as supervision; the
ground-truth-dependent orientation-selection path is not acceptable as product
preprocessing.

### RIDI

The official generator fixes the processed timeline to the roughly 200 Hz Tango
pose/rotation-vector stream and emits a CSV containing input and truth columns.
The strict adapter permits Android gyro/accelerometer plus optional Android
linear-acceleration, gravity, magnetometer, and rotation-vector streams. Tango
position/orientation is evaluation-only.

The official runtime normally derives initial global orientation from gravity and
magnetometer, uses rotation-vector orientation, and performs local/global
optimization. A command-line option can use Tango orientation, and the evaluation
path may register an initial portion to ground truth. Those paths are prohibited
for product inference and must not influence reported unaligned product metrics.

### OxIOD

The official papers report 158 sequences, 42.5 km, 14.72 hours, four attachment
types, five users, and four phone families: three iPhone generations and Nexus 5.
The synchronized header describes rotation rate, platform attitude, gravity, user
acceleration, and magnetic fields. Because raw total acceleration and exact
platform calibration semantics are not established by the accessible official
material, only timestamp and angular-rate columns are currently eligible as
candidate Android-like inputs. This is insufficient to reproduce the published
models.

## Automated preflight

`datasets/adapter_specs.json` is the executable allowlist. It keeps inference
columns separate from truth even when the source stores both in one table.
`pdr_research.preflight` checks required columns/HDF paths, null inference values,
timestamp uniqueness and monotonicity, and observed rate. It does not print or
commit raw rows.

Run mounted data in Docker:

```powershell
docker compose -f research/pdr/compose.yaml run --rm pdr-audit `
  python research/pdr/scripts/preflight_dataset.py `
  --adapter ridi-processed-csv-v1 --input /data/processed/data.csv
```

For RoNIN, create a metadata-only HDF inventory first, then audit that inventory.
The inventory contains paths, shapes, dtypes, and timestamp quality only.

## Decision and next gate

Do not download full datasets or checkpoints until the exact artifact terms can
be saved next to a content hash. The next safe implementation work is to validate
the adapters against one legally retrievable sequence per dataset, then replay
only approved columns at 50/100 Hz. No public benchmark result can pass the
screen-off, OEM power, battery, thermal, or pocket-UX gates.
