# Android-compatible body-heading protocol

Status: preregistered before retrieving any assigned validation sequence.

This experiment tests whether a small, causal classical estimator can separate
the pedestrian's changing body heading from arbitrary phone yaw. It follows the
rate-stable step experiment, where direct device yaw still produced roughly
81--96 degree body-heading MAE. It does not authorize product integration,
Android capture work, or a personal walking pilot.

## Product and architecture boundary

- User problem: preserve turns and route topology when a passively carried phone
  rotates relative to the pedestrian.
- Passive-first impact: zero interactions and zero collection time. The first
  valid motion window is an automatic warm-up, not a calibration gesture.
- Map layer: offline inference over immutable public raw evidence only. No
  canonical map, manual correction, renderer, game, product API, database, or
  `TrackingProviderPort` code is changed.
- Ownership: all artifacts stay under `research/pdr/`. Any later product method
  must remain behind `TrackingProvider` and pass a separate Android capture gate.
- Privacy: no personal data is collected. Raw public rows and model weights stay
  ignored by Git.
- Build / Adopt / Benchmark: benchmark a small explainable PCA family because it
  needs no new runtime dependency; audit the official RoNIN heading network as a
  benchmark, not a product dependency.
- Stop/rollback: there is no product code to roll back. A validation failure
  stops this classical family and preserves the body-heading blocker.
- Constitution: raw evidence remains immutable, uncertainty is explicit, and no
  truth, future trajectory, external map, or cloud service becomes a live input.

## Android input and causality contract

The candidate is a `platform-fused` method. It may read only:

- `TYPE_ACCELEROMETER` x/y/z in `m/s^2`;
- `TYPE_GAME_ROTATION_VECTOR` x/y/z/w when the optional sensor exists; and
- their `SensorEvent.timestamp`-equivalent monotonic timestamps.

The Game Rotation Vector is an Android composite of accelerometer and gyroscope
without magnetometer. It gives a gravity-aligned reference whose horizontal yaw
may drift. The method must not treat the device yaw itself as body heading.

At an accelerometer timestamp the estimator may use only the latest rotation
vector whose timestamp is no later. It transforms device-frame acceleration to
the Game Rotation Vector frame, keeps horizontal x/y, and computes a trailing
covariance. No centered window, interpolation from a future sample, Tango pose,
Tango orientation, `align_tango_to_body`, corrected/EKF orientation, body-heading
label, route geometry, platform Step Counter, or completed trajectory is allowed.

The output is relative heading in an arbitrary local frame. The first accepted
principal axis becomes zero. A single constant evaluation-frame offset at that
same timestamp is allowed only in the evaluator; it is not an inference feature
and does not rotate, reflect, or fit the later path.

If Game Rotation Vector is absent, this version is unsupported rather than a
silently degraded `imu6` method. Android capability availability and orientation
drift remain separate product gates.

## Locked data split

The machine-readable split is
`datasets/splits/ronin-body-heading-v1.json`. The four already-opened sequences
form the development pool; none can provide untouched evidence again. The three
validation sequences are the smallest compressed members in the official unseen
archive whose conservative subject-prefix keys are disjoint from all previously
opened keys and from each other.

| Role | Sequence | Subject key | Raw state at registration |
|---|---|---|---|
| development-prior | `a054_1` | `a054` | already opened |
| development-prior | `a051_3` | `a051` | already opened |
| development-prior | `a052_2` | `a052` | already opened |
| development-prior | `a049_1` | `a049` | already opened |
| validation-primary | `a050_1` | `a050` | not fetched |
| validation-confirmatory-1 | `a019_3` | `a019` | not fetched |
| validation-confirmatory-2 | `a058_1` | `a058` | not fetched |

Sequence prefixes are conservative leakage groups, not proof of participant
identity. Retained device identifiers are inspected only after retrieval. If a
device family overlaps, device generalization remains unproven.

Development truth may rank and freeze one configuration. Validation members
must remain unfetched until the selected config, implementation hashes, complete
development output, and this protocol are committed. Validation cannot change
v1 parameters, code, alignment, metrics, or gates.

## Frozen candidate family

Every candidate uses a causal 10 Hz output grid and the same algorithm:

1. use the latest causal Game Rotation Vector to rotate acceleration into its
   gravity-aligned reference frame;
2. retain horizontal x/y samples in a trailing time window;
3. compute a mean-centered 2x2 covariance with either uniform or predeclared
   horizontal-energy weights;
4. select the largest-eigenvalue axis and resolve its 180-degree ambiguity by
   choosing the sign closest to the previously accepted axis;
5. reject low-anisotropy updates and hold the last estimate;
6. optionally smooth accepted unit-axis updates using timestamp-derived
   exponential smoothing; and
7. subtract the first accepted axis to emit relative body heading.

The full grid is fixed before development ranking:

- trailing window seconds: `1.0, 1.5, 2.0, 3.0, 5.0`;
- weighting: `uniform`, `horizontal-energy`;
- accepted-axis smoothing tau seconds: `0.0, 0.25, 0.5`;
- minimum covariance anisotropy: `1.0, 1.5, 2.0`.

This produces 90 lexically versioned configs. No value outside the grid may be
introduced in v1.

## Development ranking

For each config, replay every development sequence independently at 50 and
100 Hz. Reject it if any run has a future-sample violation, initializes later
than 5 seconds, has less than 25% fresh (non-held) outputs after initialization,
or if matched 50/100 outputs differ by more than 3 degrees median or 10 degrees
at p95 on any sequence.

Among survivors, rank in this exact order:

1. minimize the worst sequence's average 50/100 all-time heading MAE;
2. minimize the subject-balanced mean all-time heading MAE;
3. minimize the subject-balanced mean turn-angle MAE;
4. minimize the worst p95 50/100 heading disagreement; and
5. choose the lexicographically smallest config ID.

Truth is used only by this declared development ranking and evaluation. Device
yaw is evaluated with the same single-offset rule as a non-selectable baseline.
The frozen rate-stable detector and `K=0.364` may be used only for a secondary
trajectory diagnostic; stride or step parameters cannot be retuned here.

## Untouched validation gates

The frozen candidate passes this research gate only if every validation sequence
at both rates has:

- zero future-sample violations;
- initialization within 5 seconds and at least 25% fresh outputs;
- matched 50/100 heading disagreement <=3 degrees median and <=10 degrees p95;
- all-time heading MAE below the 45-degree catastrophic threshold;
- turn-angle MAE <=30 degrees; and
- at least 20% lower heading MAE than direct device yaw at the same rate.

`Narrow`-quality evidence is stricter: validation median heading MAE <=20 degrees,
turn-angle MAE <=20 degrees, no mirror/catastrophic topology flag in the fixed
secondary replay, and no device-specific parameter. This public experiment can
only nominate a method for later capture design; it cannot produce a product Go.

The evaluator also reports moving-only MAE, p90 error, hold/fresh fractions,
initialization latency, 250 ms callback-batch invariance, 600 ms gap reset, and
fixed-stride topology. These secondary values cannot rescue a primary failure.

## Official learned-model audit boundary

The official RoNIN paper reports an LSTM heading model over six IMU features and
uses Android Game Rotation Vector for test-time frame normalization. The official
configuration is 200 Hz with a 1,000-frame (five-second) unroll. The repository
README states that released pretrained models were trained on the entire dataset;
therefore the checkpoint cannot provide untouched performance on these released
test sequences. Code is GPL-3.0 and the official dataset license is restricted to
non-commercial scientific research. The checkpoint remains benchmark/demo-only
unless its exact artifact terms and hash are separately verified. It will not
select or override the classical candidate or be placed in product code.

## Decision rules

- Pass: retain the frozen PCA estimator as a `platform-fused` research candidate,
  still blocked on Android lifecycle and broader device/placement validation.
- Fail with some improvement: Narrow the classical family and compare a cleanly
  trained Android-compatible learned benchmark before any capture specification.
- Catastrophic/no consistent improvement: Stop this PCA family; do not tune on
  validation or ask for a personal walking pilot.

## Primary sources

- Android Game Rotation Vector definition:
  https://source.android.com/docs/core/interaction/sensors/sensor-types
- Android `SensorManager` coordinate transform:
  https://developer.android.com/reference/android/hardware/SensorManager
- RoNIN paper: https://arxiv.org/abs/1905.12853
- Revision-pinned official RoNIN code:
  https://github.com/Sachini/ronin/tree/805b7f0f28bb164ce89ada9ac05a9470dbe3d715
- Pocket heading PCA limitations:
  https://doi.org/10.3390/s151027875

