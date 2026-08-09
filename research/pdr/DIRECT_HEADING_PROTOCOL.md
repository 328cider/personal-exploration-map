# Benchmark-only direct circular body-heading protocol

Status: preregistered before implementing this candidate family, fitting its
readout, or retrieving any assigned validation sequence.

This experiment tests the one technically distinct learned direction left by
the residual-ridge Stop: predict circular body-heading state directly with a
causal recurrent state, instead of integrating a learned residual angular rate
for several minutes. It remains a non-commercial RoNIN benchmark. The public
training-data gate found no source that authorizes a product-oriented model, so
accuracy cannot make these weights shippable or authorize product integration.

## Product and architecture boundary

- User problem: estimate pedestrian turns while an Android phone changes pose
  relative to the body during passive carrying.
- Passive-first impact: zero interaction and zero personal collection time. The
  trailing sensor window is automatic warm-up, never a calibration gesture.
- Map authority: immutable public evidence is replayed offline. No raw evidence,
  derived/canonical map, application command, product API, database,
  `TrackingProviderPort`, renderer, game, or `CURRENT_DIRECTION.md` changes.
- Ownership: code and aggregate results remain in `research/pdr/`. Dataset rows
  and fitted weights remain ignored by Git.
- Build / Adopt / Benchmark: build a small deterministic echo-state baseline to
  measure headroom; do not adopt or distribute RoNIN data, code, or weights.
- Privacy and safety: no personal data or field run. Failure stops before any
  personal pilot. A pass would still require an authorized training source and
  Android lifecycle work.

The four development sequences have already informed earlier classical and
residual-model decisions. Their cross-validation result is therefore iterative
development evidence, not a final generalization estimate. Only the three still
sealed groups can provide untouched confirmation.

## Android input and causal feature contract

At each 10 Hz output tick, the estimator may consume only current and past:

- `TYPE_ACCELEROMETER` x/y/z and `SensorEvent.timestamp`;
- `TYPE_GYROSCOPE` x/y/z and `SensorEvent.timestamp`; and
- `TYPE_GAME_ROTATION_VECTOR` x/y/z/w and `SensorEvent.timestamp`.

The existing causal extractor divides a trailing window into five equal-time
bins. Accelerometer and gyroscope x/y/z mean and standard deviation in each bin
produce 60 features. Three causal device-yaw features are appended:

1. sine of Game-RV device yaw relative to the first output in the current
   contiguous segment;
2. cosine of that relative device yaw; and
3. current device-yaw change divided by elapsed sensor time, clipped to
   plus/minus 360 degrees/second before training-fold normalization.

This gives 63 recurrent inputs. The relative device yaw is accumulated only
from observed Game-RV changes and resets at a gap; it is not a truth alignment.
Every feature source timestamp must be no later than its output tick. The same
time-based extractor and 10 Hz recurrent update are used for 50 and 100 Hz raw
replays.

Forbidden inference inputs include Tango pose/orientation, corrected or EKF
orientation, body-heading labels, `align_tango_to_body`, `imu_time_offset`,
subject/device ID, absolute sequence time, future samples, completed trajectory,
route geometry, and any truth-derived normalization or parameter.

## Supervision, recurrent state, and output

For each training sequence, truth body heading is made relative to the first
feature row and encoded as sine/cosine. Truth is used only by the training and
evaluation harness. Reservoir state and the device-yaw anchor reset between
sequences and after a feature gap; windows and state never cross a boundary.

All candidates use a 64-unit deterministic leaky ring reservoir. The input
matrix and bias vector are generated once with NumPy PCG64 seed `20260809`,
uniform values in `[-1, 1]`, input scale `0.25`, and bias scale `0.10`. The
signed recurrent ring has unit-magnitude links with sign `-1` when the unit
index is divisible by three and `+1` otherwise. For standardized input `z_t`:

`proposal_t = tanh(0.25 W_in z_t + 0.10 b + gain W_ring state_(t-1))`

`state_t = (1 - leak) state_(t-1) + leak proposal_t`

A two-output weighted ridge readout consumes `[1, state_t, z_t]` and predicts
sine/cosine. Its angle is made relative to the first predicted angle in each
segment, using that current first prediction only. No later constant alignment
is allowed. A raw output-vector norm below `1e-6` repeats the previous heading
and is marked non-fresh; every held-out run must retain at least 95% fresh
outputs. Input means/scales and readout weights use training groups only. The
scale floor is `1e-6`; only the intercept is unpenalized.

Training sample weight is
`1 + 4 * min(abs(body angular rate) / 30 degrees/s, 1)`. The label itself is
not clipped or dropped.

## Locked split and candidate grid

The machine-readable split is
`datasets/splits/ronin-direct-heading-v1.json`. It preserves the exact prior
development and validation assignments. Split occurs by complete subject-prefix
group before window extraction. The prefix is a conservative leakage group, not
proof of participant identity. Device overlap is reported and prevents a
device-generalization claim.

| Role | Sequence | Subject key | State at registration |
|---|---|---|---|
| development | `a049_1` | `a049` | already opened |
| development | `a051_3` | `a051` | already opened |
| development | `a052_2` | `a052` | already opened |
| development | `a054_1` | `a054` | already opened |
| validation primary | `a050_1` | `a050` | not fetched |
| validation confirmatory | `a019_3` | `a019` | not fetched |
| validation confirmatory | `a058_1` | `a058` | not fetched |

The 24 candidates cross:

- trailing window seconds: `0.5, 1.0`;
- reservoir leak: `0.25, 0.75`;
- recurrent gain: `0.5, 0.9`; and
- readout ridge alpha: `1, 100, 10000`.

Reservoir size, random seed, input/bias scales, ring signs, turn weight, feature
schema, output rate, solver, and output anchoring are fixed rather than tuned.
Fit on 50 Hz rows only; evaluate the identical normalization, reservoir, and
readout at 50 and 100 Hz.

## Development selection and Stop rule

Run leave-one-subject-prefix-out over all four development groups. A candidate
is eligible only if every held-out run has zero future-sample violations, at
least 95% output coverage, at least 95% fresh output, and initialization no
later than `window + 0.2` seconds; every sequence has median/p95 matched 50/100
heading disagreement at most 5/20 degrees; worst-sequence average 50/100 heading
MAE is below 75 degrees; subject-balanced turn-angle MAE is below 45 degrees;
and subject-balanced heading MAE improves at least 15% over matched-grid direct
device heading.

Rank survivors lexicographically by worst-sequence mean heading MAE,
subject-balanced mean heading MAE, mean turn MAE, worst p95 rate disagreement,
then candidate ID. If none survives, stop without fetching validation or
writing all-development weights. Otherwise freeze the winning config, fit once
on all four 50 Hz development sequences, keep weights in the ignored models
path, and commit only hashes and aggregate evidence.

## Untouched validation gate

Validation may run only with the frozen implementation and all-development
weight hash. It cannot change inputs, state update, grid, normalization, labels,
metrics, thresholds, alignment, or missing-output handling. For all three
groups at both rates, require the same causality/coverage/freshness/rate gates,
heading MAE below 60 degrees, and turn MAE below 45 degrees. Aggregate heading
MAE must improve at least 20% over matched direct device heading.

`Narrow` additionally requires every heading MAE below 45 degrees, every turn
MAE at most 30 degrees, and median heading MAE at most 30 degrees. Even a Narrow
result is benchmark headroom only: it does not authorize product use, Android
lifecycle feasibility, or a personal pilot.

## Reproducibility and reporting

- Record dataset-member, protocol, split, implementation, and fold-model hashes.
- Commit complete aggregate candidate/fold metrics, never sensor rows,
  coefficients, reservoir matrices, or fitted weights.
- An independent validator must reconstruct the grid, decisions, rankings,
  split isolation, hash locks, and validation/model absence without importing
  estimator or selector code.
- The executed notebook reads aggregate JSON only.
- Public benchmark performance and Android device feasibility remain separate.

## Primary sources

- [RoNIN paper](https://arxiv.org/abs/1905.12853)
- [RoNIN official artifact](https://www.frdr-dfdr.ca/repo/dataset/816d1e8c-1fc3-47ff-b8ea-a36ff51d682a)
- [Android motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- [Android SensorEvent](https://developer.android.com/reference/android/hardware/SensorEvent)
