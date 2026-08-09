# Benchmark-only learned body-heading headroom protocol

Status: preregistered before implementing the candidate family, fitting any
model, or retrieving any assigned validation sequence.

This experiment asks whether a small supervised causal model can improve the
body-heading blocker that defeated the classical PCA family. It is strictly a
non-commercial RoNIN benchmark. The training-data gate found zero public sources
that can authorize a product-oriented learned model, so this experiment cannot
produce shippable weights or a product Go regardless of accuracy.

## Product and architecture boundary

- User problem: estimate pedestrian turns when a passively carried Android phone
  rotates relative to the body.
- Passive-first impact: zero interaction and zero personal collection time. A
  trailing sensor window is automatic warm-up, not a calibration gesture.
- Map layer and writer: offline research over immutable public evidence. No raw
  evidence, canonical map, application command, product API, database,
  `TrackingProviderPort`, renderer, game, or `CURRENT_DIRECTION.md` is changed.
- Ownership: code, aggregate results, and non-executable manifests stay under
  `research/pdr/`. Raw rows and fitted weights remain ignored by Git.
- Build / Adopt / Benchmark: build an explainable ridge baseline to measure
  learned technical headroom. Do not adopt RoNIN code, data, or weights.
- Privacy and rights: RoNIN's artifact-specific non-commercial research license
  controls this phase. No personal data is collected and no fitted weight is
  distributed.
- Stop condition: development failure keeps validation sealed. Validation
  failure stops this family. Even a validation pass only motivates further
  research or rights/capture planning; it cannot enter the product.

## Android input, target, and causality contract

The estimator may consume only values obtainable from a future Android logger:

- `TYPE_ACCELEROMETER` x/y/z and `SensorEvent.timestamp`;
- `TYPE_GYROSCOPE` x/y/z and `SensorEvent.timestamp`; and
- `TYPE_GAME_ROTATION_VECTOR` x/y/z/w and `SensorEvent.timestamp`.

At a 10 Hz output tick it uses only samples whose sensor timestamps are no later
than that tick. A trailing window is divided into five equal-duration bins. For
accelerometer and gyroscope x/y/z, each bin contributes its mean and standard
deviation, yielding 60 time-based features. Bins with insufficient coverage do
not emit a row. The same extractor is used at 50 and 100 Hz.

The latest causal Game Rotation Vector supplies device yaw. The supervised
target is the residual angular rate over the just-completed 100 ms interval:

`body heading change - device-yaw change`, divided by elapsed sensor time.

The model predicts only this residual. Inference adds the predicted residual to
the observed device-yaw change and integrates from zero at the first output. The
target is frame-offset invariant; the estimator receives neither the initial
body heading nor a Tango/Game-RV alignment. Truth may create training targets
and evaluation metrics only.

Forbidden inference inputs include Tango pose/orientation, corrected or EKF
orientation, `align_tango_to_body`, `imu_time_offset`, future samples, completed
route geometry, subject/device ID, sequence elapsed time, and any truth-derived
normalization or per-sequence parameter.

## Locked split and anti-leakage rule

The machine-readable split is
`datasets/splits/ronin-learned-heading-v1.json`. It reuses the already-registered
classical split rather than selecting new sequences after seeing its failures.

Development uses the four already-opened subject-prefix groups in leave-one-
group-out cross-validation. Every window from the held-out sequence stays out of
feature normalization, ridge fitting, and candidate choice for that fold.
Training uses only the 50 Hz replay. The identical fold weights evaluate the
held-out sequence at both 50 and 100 Hz. Windows never cross a sequence boundary.

The three validation groups remain unfetched until all of the following are
committed: this protocol and split, candidate implementation/tests, complete
cross-validation output, selected config, all-development fitted-weight hash,
and implementation hashes. Validation cannot change code, fields, labels,
normalization, grid, weights, metrics, thresholds, or alignment.

| Role | Sequence | Subject key | State at registration |
|---|---|---|---|
| development | `a049_1` | `a049` | already opened |
| development | `a051_3` | `a051` | already opened |
| development | `a052_2` | `a052` | already opened |
| development | `a054_1` | `a054` | already opened |
| validation primary | `a050_1` | `a050` | not fetched |
| validation confirmatory | `a019_3` | `a019` | not fetched |
| validation confirmatory | `a058_1` | `a058` | not fetched |

The prefix is a conservative grouping key, not proof of person identity. Device
overlap is reported and prevents a device-generalization claim.

## Frozen candidate family

Every candidate is deterministic weighted ridge regression over the same 60
features. Feature means/scales and the intercept are fitted from training-fold
rows only. Zero-variance scales use a fixed floor of `1e-6`. The closed-form
solver uses a Moore-Penrose pseudoinverse and no random seed.

The 36-candidate grid is fixed:

- trailing window seconds: `0.5, 1.0, 2.0`;
- ridge alpha: `0.1, 10.0, 1000.0`;
- turn sample weight: `0.0, 8.0`; and
- predicted residual-rate clip: `90, 180` degrees/second.

For a training label with absolute body angular rate `r`, sample weight is
`1 + turn_weight * min(abs(r) / 30 degrees/s, 1)`. Labels are not clipped or
dropped. Residual clipping is a fixed inference robustness bound and is part of
the candidate ID.

## Development selection

For every candidate, run four leave-one-subject-prefix-out folds. Each fold fits
on three sequences at 50 Hz, then evaluates the held-out sequence at 50 and
100 Hz with the same weights. Direct device heading is a non-selectable baseline.

A candidate is development-eligible only if all of these hold:

- zero future-sample violations and at least 95% output-grid coverage in every
  held-out run;
- initialization latency no greater than `window + 0.2` seconds;
- matched 50/100 disagreement no greater than 5 degrees median and 20 degrees
  p95 on every sequence;
- worst sequence average 50/100 heading MAE below 75 degrees;
- subject-balanced turn-angle MAE below 45 degrees; and
- subject-balanced heading MAE at least 15% lower than the direct-device baseline.

Among survivors, rank lexicographically by:

1. worst sequence average 50/100 heading MAE;
2. subject-balanced mean heading MAE;
3. subject-balanced mean turn-angle MAE;
4. worst p95 50/100 disagreement; and
5. candidate ID.

If no candidate survives, stop without fetching validation. Otherwise fit the
selected config once on all four development sequences at 50 Hz, write weights
only to the ignored `research/pdr/models/` path, and commit only its SHA-256,
training-row counts, config, source hashes, and implementation hashes.

## Untouched validation gates

Use the exact all-development weights at both 50 and 100 Hz on all three sealed
groups. Report every run, including unsupported or failed runs. A benchmark
headroom pass requires:

- zero future-sample violations, at least 95% output coverage, and initialization
  within `window + 0.2` seconds for all six runs;
- median/p95 50/100 disagreement no greater than 5/20 degrees per sequence;
- heading MAE below 60 degrees and turn-angle MAE below 45 degrees for every run;
- subject-balanced heading MAE at least 20% below direct device heading; and
- no sequence-specific refit, constant offset beyond the evaluator's first
  common output, reflection, route alignment, or post-session smoothing.

`Narrow` quality additionally requires heading MAE below 45 degrees and turn MAE
at most 30 degrees in every run, median heading MAE at most 30 degrees, and no
device-specific parameter. It only justifies designing a broader authorized
capture or model study. It does not authorize product integration or a personal
pilot.

## Reproducibility and reporting

- The fitted model JSON is canonicalized with sorted keys and deterministic
  float serialization before hashing.
- Dataset member hashes, adapter version, split hash, source-code hashes,
  candidate results, selected config, row counts, and weight hash are recorded.
- The independent validator does not import the model/evaluator selection code.
- Executed notebooks contain aggregates only, never sensor rows or coefficients.
- Public benchmark performance and Android lifecycle feasibility remain separate
  decisions.

## Primary sources

- [RoNIN paper](https://arxiv.org/abs/1905.12853)
- [RoNIN official artifact](https://www.frdr-dfdr.ca/repo/dataset/816d1e8c-1fc3-47ff-b8ea-a36ff51d682a)
- [Revision-pinned official RoNIN code](https://github.com/Sachini/ronin/tree/805b7f0f28bb164ce89ada9ac05a9470dbe3d715)
- [Android motion sensors](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- [Android SensorEvent](https://developer.android.com/reference/android/hardware/SensorEvent)

