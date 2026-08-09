# Benchmark-only learned body-heading headroom result

- Experiment: `ronin-learned-heading-v1`
- Development groups: 4, leave-one-subject-prefix-out
- Candidates: 36
- Cross-validation fits: 144
- Eligible candidates: **0**
- Validation groups fetched: **0 of 3**
- Fitted final model written: **no**
- Decision: **stop the residual-ridge family**

## Answer first

A causal supervised linear model over Android-capturable accelerometer,
gyroscope, and Game Rotation Vector inputs does not recover body heading on the
four-sequence development pool. Every preregistered candidate failed the
development gates, so the three untouched validation subjects remain unfetched
and no fitted weight file was created.

The best diagnostic configuration by the locked “fewest gate failures, then
score” rule was `lhr-w2000-a10-t0-c090`. Across held-out subjects and both rates
it produced:

- subject-balanced heading MAE: **91.388°**;
- worst-sequence mean heading MAE: **93.714°**;
- subject-balanced turn MAE: **69.615°**;
- worst p95 50/100 Hz disagreement: **168.610°**; and
- direct-device mean MAE: **89.394°**, so learned improvement was **-2.23%**.

The model was worse than the matched-grid device-heading baseline on average.
This is not a product candidate, not an Android lifecycle result, and not a
reason to ask for a personal walking pilot.

## What was tested

Every candidate used the same causal pipeline:

1. read only Android-shaped raw accelerometer, gyroscope, Game Rotation Vector,
   and sensor timestamps;
2. summarize a trailing 0.5, 1, or 2 second window into 60 time-binned mean/std
   features;
3. fit weighted ridge regression on three complete 50 Hz subject groups to
   predict body-turn rate minus observed device-yaw rate;
4. apply the identical fold weights to the held-out group at 50 and 100 Hz; and
5. add the predicted residual to device-yaw change and integrate from zero.

The grid crossed three windows, three ridge penalties, two turn weights, and two
residual-rate clips. Split assignment preceded all windowing. Feature scaling,
intercept, and weights came only from the three training groups in each fold.

Tango body heading generated supervision and metrics only. Tango pose,
alignment, corrected/EKF orientation, subject/device ID, future samples, and
route geometry never entered feature extraction or prediction.

## Held-out diagnostic detail

| Held-out group | Learned MAE 50 Hz | Learned MAE 100 Hz | Device baseline | Median rate disagreement | p95 rate disagreement |
|---|---:|---:|---:|---:|---:|
| `a049` | 88.609° | 91.231° | 73.332° | 81.804° | 168.610° |
| `a051` | 94.166° | 85.480° | 63.877° | 107.477° | 167.649° |
| `a052` | 94.577° | 92.851° | 128.651° | 11.641° | 46.685° |
| `a054` | 91.141° | 93.052° | 91.717° | 4.081° | 31.986° |

The numerically lowest mean-MAE candidate reached 87.132°, but it still failed
11 declared checks. Diagnostic ranking therefore does not hide a near-pass.

## Failure anatomy

All 36 candidates failed each of the three aggregate requirements:

- worst-sequence heading MAE below 75°;
- subject-balanced turn MAE below 45°; and
- at least 15% improvement over device heading.

Across the 144 candidate/held-out combinations, 142 violated median 50/100 rate
agreement and 143 violated p95 agreement. By contrast, no candidate failed
causality, initialization, output coverage, or missing-output checks. Each
sequence produced the same number of 10 Hz feature rows at 50 and 100 Hz.

This pattern separates a model failure from a pipeline failure. Small
rate-dependent feature differences are amplified by repeatedly integrating a
learned residual angular rate. Cross-subject residual bias is also enough to
rotate a multi-minute trajectory catastrophically. Stronger clipping and ridge
regularization were already in the locked grid and did not fix it.

## Verification

- Eight synthetic/unit tests cover the 36-config registry, Android-only field
  set, fixed 60-feature schema, future-sample exclusion, prefix causality,
  callback-batch invariance, missing-sensor rejection, exact zero-residual
  50/100 Hz behavior, deterministic fitting, and deterministic model hashing.
- The independent validator does not import the learned estimator or selection
  code. It recomputed all scores, rejection reasons, and eligibility across 144
  folds with **1,493 assertions**.
- It confirmed all three validation directories are absent, the failed model
  path does not exist, and no validation result was generated.
- The complete aggregate cross-validation manifest is committed; it contains no
  sensor row and no coefficient.

## Decision and next boundary

Stop this residual-rate ridge family. Do not relax the gates, select the 87°
candidate, or retrieve validation for post-hoc tuning.

The remaining technically distinct learned direction is a causal recurrent
model that predicts circular heading state directly rather than integrating a
slightly biased residual at every 100 ms. That is a new family and requires a
new preregistration while the same three validation groups remain sealed. It
would still be a non-shippable RoNIN benchmark because the public training-data
rights gate remains failed for product use.
