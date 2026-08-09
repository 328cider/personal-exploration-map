# Rate-stable step detector protocol

Status: preregistered before retrieving any assigned raw sequence.

This experiment addresses one diagnosed failure in B1 v1.1.0: the same RoNIN
raw sequence and Weinberg gain produced materially different distance estimates
at 50 and 100 Hz. It does not revisit the existing Stop decision for treating
device orientation as body heading, and it cannot establish Android lifecycle,
battery, screen-off, OEM, or pocket-UX feasibility.

## Product and architecture boundary

- User problem: avoid a distance estimator whose result changes merely because
  an Android device delivers 50 rather than 100 accelerometer samples per second.
- Passive-first impact: zero added user interactions and zero collection time.
- Map layer: offline inference over immutable raw evidence only. No canonical map,
  manual correction, renderer, game overlay, or product database is changed.
- Ownership: all code and evidence remain under `research/pdr/`; product adoption
  would require a separate main-development decision behind `TrackingProvider`.
- Privacy: only the already-published, research-only RoNIN artifact is used. No
  personal data is collected and raw dataset members remain ignored by Git.
- Build / Adopt / Benchmark: implement a small explainable benchmark detector,
  informed by published peak/valley, adaptive magnitude, and temporal-threshold
  methods. It is not a claim that a bespoke detector should replace Android's
  optional `TYPE_STEP_DETECTOR` in the product.
- Stop/rollback: no product code exists to roll back. Failure preserves the
  legacy diagnostic and blocks a personal walking pilot.
- Constitution: raw evidence remains immutable, uncertainty is not hidden, and
  no existing map, cloud service, or visual ground truth becomes a live input.

## Input and causality contract

The candidate may read only `TYPE_ACCELEROMETER` values and
`SensorEvent.timestamp`-equivalent monotonic timestamps from the normalized
session. Values remain SI `m/s^2` in the Android device frame; the detector uses
only the orientation-invariant vector magnitude. It must not read Tango pose,
body heading, stride labels, device-orientation truth, synchronized future data,
or a completed trajectory.

The implementation must be online-replayable. A detected event may depend only
on samples whose timestamps are no later than that event's source end. Fixed-rate
normalization must close time buckets causally; it may not interpolate from a
future sample.

## Locked split

The machine-readable split is
`datasets/splits/ronin-rate-stability-v1.json`. Sequence assignment uses only
the official ZIP inventory and compressed sizes, before raw retrieval:

| Role | Sequence | Conservative subject key | Reason |
|---|---|---:|---|
| development | `a051_3` | `a051` | smallest eligible compressed member |
| validation-primary | `a052_2` | `a052` | next-smallest disjoint key |
| validation-confirmatory | `a049_1` | `a049` | next-smallest disjoint key |

`a054_1` is excluded because its raw data and truth informed earlier diagnostics.
The prefix is a conservative leakage group, not proof of participant identity.
Device identifiers are inspected only after retrieval; if devices overlap, this
experiment will explicitly leave device generalization unproven.

Development data may be used to choose and freeze one configuration. Validation
members remain unopened until that configuration and this ranking rule are in
Git history. Validation results cannot trigger parameter changes in v1.

## Candidate and ranking rules

The candidate family must use:

1. causal fixed-time aggregation, independent of source sample count;
2. timestamp-derived filter coefficients rather than per-sample constants;
3. acceleration-magnitude detrending;
4. a peak/valley or hysteresis decision with a timestamp-based refractory period;
5. an amplitude output compatible with the existing Weinberg sensitivity path.

Development configurations are ranked without trajectory truth:

1. reject a configuration that emits fewer than 20 events, violates causality,
   or has median detected inter-step time outside 0.25--1.25 seconds;
2. minimize relative 50/100 Hz step-count disagreement;
3. minimize relative 50/100 Hz sum of `amplitude ** 0.25` disagreement;
4. break remaining ties by the lexicographically smallest versioned config ID.

Trajectory truth is reported for interpretation but cannot affect the ranking.
The stride gain is fixed at `K=0.364` from the prior sensitivity grid and is not
re-estimated from any sequence in this experiment.

## Validation gates

The frozen detector passes the rate-stability gate only if both validation
sequences independently meet all primary criteria:

- relative 50/100 Hz step-count disagreement `<= 1%`;
- relative 50/100 Hz `sum(amplitude ** 0.25)` disagreement `<= 2%`;
- median inter-step time at each rate is within `0.25--1.25 s`;
- zero future-sample violations and identical results under 250 ms callback
  batching when sensor timestamps are unchanged.

Secondary, non-selection diagnostics include distance-scale error with the fixed
gain, truth-moving-time cadence, 600 ms gap behavior, sensor/device metadata,
and transfer/hash provenance. These can reveal a stable-but-wrong detector and
therefore cannot upgrade the experiment to product-compatible evidence.

## Interpretation

- Pass: the detector is a better rate-stable diagnostic candidate, not a PDR Go.
- Fail: Stop this detector version; do not tune on validation or start a pilot.
- Regardless of result: body-heading remains unresolved, RoNIN remains
  benchmark-only under its non-commercial terms, and Android capability/lifecycle
  gates remain separate.

## Primary sources

- Lee et al., *Step Detection Robust against the Dynamics of Smartphones*,
  Sensors 2015, https://doi.org/10.3390/s151127230
- Android `SensorEvent` reference,
  https://developer.android.com/reference/android/hardware/SensorEvent
- Android `SensorManager` reference,
  https://developer.android.com/reference/android/hardware/SensorManager
- Official RoNIN dataset description, https://ronin.cs.sfu.ca/README.txt
