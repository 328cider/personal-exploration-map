# Benchmark-only direct circular body-heading result

- Experiment: `ronin-direct-heading-v1`
- Development groups: 4, leave-one-subject-prefix-out
- Candidates: 24
- Cross-validation fits: 96
- Eligible candidates: **0**
- Validation groups fetched: **0 of 3**
- Fitted final model written: **no**
- Decision: **stop the direct circular echo-state family**

## Answer first

Direct circular prediction fixed the residual model's 50/100 Hz instability,
but it did not recover accurate body heading across held-out subject-prefix
groups. Every preregistered candidate failed all three aggregate accuracy and
improvement gates. The validation subjects therefore remain sealed, no model
weights were written, and a personal walking pilot is still not justified.

The best diagnostic configuration by the locked “fewest gate failures, then
score” rule was `dch-w0500-l25-g50-a00001`: a 0.5 second window, 0.25 leak,
0.5 recurrent gain, and ridge alpha 1. Across held-out groups and both rates:

- subject-balanced heading MAE: **84.303°**;
- worst-sequence mean heading MAE: **91.002°**;
- subject-balanced turn MAE: **65.941°**;
- worst p95 50/100 Hz disagreement: **18.869°**;
- matched direct-device heading MAE: **87.050°**; and
- learned improvement over that baseline: **3.16%**, below the required 15%.

The model family was structurally more rate-stable, not accurate enough.

## What was tested

Each candidate used a causal 10 Hz pipeline over Android-capturable data:

1. form 60 trailing time-bin accelerometer/gyroscope features;
2. append sine/cosine of causal relative Game-RV device yaw and clipped current
   device-yaw rate;
3. update a deterministic 64-unit leaky ring reservoir;
4. fit a weighted ridge readout on three complete 50 Hz groups to predict body
   heading as sine/cosine directly; and
5. replay the identical fold normalization, reservoir, and readout on the held-
   out group at both 50 and 100 Hz.

The grid crossed two windows, two leak values, two recurrent gains, and three
readout penalties. Split assignment preceded windowing and recurrent state.
State and device-yaw anchors reset at every sequence or feature gap.

Tango body heading produced only training targets and evaluation metrics. Tango
pose, alignment, corrected/EKF orientation, user/device identity, future
samples, and route geometry never entered inference.

## Held-out diagnostic detail

| Held-out group | Heading MAE 50 Hz | Heading MAE 100 Hz | Device baseline | Turn MAE 50/100 Hz | Median rate disagreement | p95 rate disagreement |
|---|---:|---:|---:|---:|---:|---:|
| `a049` | 91.222° | 90.782° | 75.056° | 68.960° / 68.497° | 1.496° | 13.294° |
| `a051` | 76.807° | 76.827° | 63.017° | 59.937° / 60.085° | 0.452° | 5.722° |
| `a052` | 81.819° | 81.859° | 120.133° | 62.630° / 63.246° | 1.186° | 8.994° |
| `a054` | 87.747° | 87.359° | 89.994° | 72.766° / 71.408° | 2.158° | 18.869° |

The numerically lowest subject-balanced heading MAE was 82.983° at alpha 100,
only a 4.67% improvement over its baseline; its worst-sequence mean was 94.787°
and turn MAE was 65.581°. It was not a near-pass hidden by diagnostic ranking.

## Failure anatomy

All 24 candidates failed each aggregate requirement:

- worst-sequence mean heading MAE below 75°;
- subject-balanced turn MAE below 45°; and
- at least 15% improvement over matched direct device heading.

The recurrence itself was well behaved. Across 96 candidate/held-out pairs,
none violated median rate agreement and only two violated p95 agreement. There
were zero causality, coverage, freshness, or missing-output failures. This is a
large structural improvement over residual-rate integration, where 142 of 144
pairs failed median and 143 of 144 failed p95 agreement.

The remaining error is therefore not primarily sampling-rate amplification. A
small deterministic recurrent readout cannot infer the changing phone-to-body
relationship consistently from these motion windows and four reused development
groups. It helps the particularly bad `a052` device-heading sequence, but hurts
others; the held-out result does not generalize consistently.

## Verification

- Eight focused tests cover the 24-config registry, Android-only 63-input
  schema, causal source bounds, missing-sensor behavior, callback batching,
  prefix invariance, exact constant-output rate stability, deterministic fitting,
  canonical serialization, and absence of dataset-truth dependencies.
- The independent validator does not import the estimator or selection code. It
  recomputed the split, gates, rankings, and baseline consistency across all 96
  folds with **1,481 assertions**.
- It confirmed that all three validation directories and the final model path
  are absent and that no validation result exists.
- The committed development manifest contains aggregate metrics and hashes only,
  never sensor rows, reservoir matrices, coefficients, or weights.

## Decision and research boundary

Stop this direct circular echo-state family. Do not relax the gates, select the
82.983° candidate, tune another reservoir on these reused development groups,
or retrieve validation post hoc.

Together with the classical PCA Stop, residual-ridge Stop, and zero-compatible
public training-data gate, this exhausts the registered low-cost public/synthetic
body-heading paths. It does not prove that body heading is impossible. It means
the next accuracy experiment requires a materially new evidence source:
explicit product/model rights to a multi-user, multi-device, multi-placement
Android dataset with body-heading or trajectory truth, or a separately approved
authorized capture program designed for that purpose.

Because no estimator survives, the plan's Phase 4 capture specification cannot
yet be derived and the no-walking capability probe would not validate accuracy.
Do not ask for a one-person pilot; it cannot repair the missing generalizable
training evidence or establish product feasibility.
