# PDR public/synthetic research decision

Date: 2026-08-09

## Decision

The registered low-cost public/synthetic program is complete enough to make its
intended accuracy decision: **do not integrate a PDR estimator and do not treat
a personal walking pilot as authorized accuracy evidence.** A later explicit
instruction authorized a separate capture-readiness workstream: define the data
contract and KPI plan, build the standalone Android capability probe/logger, and
exhaust emulator/desk validation. That work does not reopen estimator tuning or
authorize product adoption.

This is not a universal claim that pedestrian dead reckoning is impossible. It
is a bounded conclusion that the currently auditable Android-compatible inputs,
public evidence, licenses, and tested estimator families do not support a
product candidate. More tuning on the reused public sequences would add
selection bias rather than answer the product question.

The final authorized IPIN 2022 classical replay is now complete. Its fixed B1
pipeline passed all parser, 50/100 Hz agreement, callback-batch, optional-sensor,
causality, and injected-gap gates on two User03 development sequences and a
single untouched run over two User05 validation sequences. Both validation
sequences omit magnetometer records and still pass with raw accelerometer and
gyroscope. This establishes a bounded capture/replay plumbing contract, not
heading or distance accuracy: IPIN supplies no continuous target truth for
those quantities and no real Android lifecycle evidence.

## Evidence ledger

| Gate | Evidence | Decision |
|---|---|---|
| Synthetic capture/evaluation plumbing | Golden rotation, mirror, false-loop, scale, batching, jitter, and gap cases are detected with truth isolated from inference | **Pass for pipeline QA only** |
| Public input compatibility | RoNIN exposes useful Android-shaped raw streams; dataset truth and corrected poses stay label/evaluation-only | **Benchmark-compatible, not Android lifecycle evidence** |
| Product-oriented training source | Initial 8-source gate plus 7 new lineages; 0 combine Android semantics, suitable target truth, leakage-safe grouping, reproducibility, and product/derived-weight rights | **Stop** |
| IPIN classical capture/replay | Four preregistered sequences, different-user validation, 169,280 eligible rows; 4/4 raw gates and 4/4 replay gates pass; validation rate differences stay below 0.855%/0.808%/0.850% for step/amplitude/derived distance | **Pass for pipeline compatibility only; no accuracy/product claim** |
| Step detector rate stability | Frozen detector passes untouched 50/100 Hz agreement, but differs from Android Step Counter by 0–57.6% depending on sequence | **Pass for rate invariance; Stop for count accuracy** |
| Stride/distance | Validation distance-scale error remains about 14.3–15.0%, with unresolved step semantics and placement calibration | **Stop** |
| Classical body heading | 90 causal PCA candidates; 0 survive; axis ambiguity produces near-180° rate tails | **Stop** |
| Learned residual heading | 36 candidates / 144 held-out fits; 0 survive; best diagnostic mean MAE 91.388° and severe rate drift | **Stop** |
| Direct circular recurrent heading | 24 candidates / 96 held-out fits; 0 survive; rate stability improves, but best diagnostic mean MAE 84.303° and turn MAE 65.941° | **Stop** |
| Released RoNIN heading model | Requires 200 Hz, includes private/non-reproducible training data, and is non-commercial | **Benchmark demo only; do not run or ship** |
| Android capture mechanism | Standalone research APK and offline bundle gate are now the authorized next layer; it must pass Docker/emulator checks before any no-walking device probe | **Implementation/desk validation authorized; not product evidence** |
| Android screen-off/OEM/battery/pocket lifecycle | Public data and emulator cannot measure it | **Not evaluated; real-device walking still gated** |
| One-person/one-device pilot | Cannot establish generalization or repair missing rights/training evidence | **Not authorized** |

Across the three registered body-heading families, **150 configurations** were
evaluated under subject-prefix separation and Android-only inference contracts;
none passed. The final direct circular family showed that the prior rate
instability was fixable, while accuracy remained decisively outside the gate.
That separates a sampling implementation defect from the unresolved semantic
problem of inferring pedestrian heading from a freely moving phone.

The IPIN run answers a different question. It shows that an Android-shaped
accelerometer/gyroscope pipeline can preserve rate, batch, missing-magnetometer,
and gap behavior on four preregistered sequences. It does not add a fourth
body-heading estimator family or repair the missing truth needed for accuracy.

## What has and has not been exhausted

Exhausted within this research version:

- the declared synthetic robustness matrix;
- OxIOD/RoNIN/RIDI compatibility auditing plus the broader eight-source learned
  training-data gate;
- the second public-evidence gate covering IPIN 2022-2024, xDR 2023, Wang
  SLE/WDE, ForestBack, and EL-SLE, including duplicate-lineage and artifact
  completeness checks;
- common B0/B1 replay under identical 50/100 Hz inputs;
- fixed-time step-rate normalization;
- causal classical horizontal-motion PCA;
- causal residual-rate ridge;
- causal direct circular echo-state prediction; and
- the separately preregistered IPIN 2022 classical capture/replay check with a
  development freeze and one untouched different-user validation run.

Not exhausted in the abstract:

- proprietary or newly licensed multi-user Android data;
- a consented multi-user, multi-device, multi-placement capture program with an
  independent heading/trajectory truth system;
- a materially new estimator backed by such a clean training source; and
- real Android lifecycle behavior after an estimator and capture profile exist.

Those are external-evidence changes, not another free hyperparameter sweep.
The completed IPIN replay closes its authorized pipeline question and does not
create an exception to the accuracy conclusion.

## Required unblocker

Resume accuracy work only after at least one of these is documented in a new
protocol and Issue/ADR handoff:

1. artifact-specific permission covering commercial model training and derived
   weights for a technically suitable source—xDR Challenge 2023 is the first
   clarification target—or another source that passes the same gate;
2. approval and design for a consented dataset with multiple people, Android
   devices, passive placements, 50/100 Hz raw streams, monotonic timestamps,
   gaps/batching, and independent continuous body-heading or 2D trajectory
   truth; or
3. a materially distinct algorithm with a clean, rights-compatible training
   and untouched validation plan, not selected from the existing four reused
   development groups.

xDR Challenge 2023 remains the highest-priority clarification because its
public description pairs Android IMU with dense external position/quaternion
truth at about 100 Hz. Registration, row acquisition, or training still waits
for an artifact license, immutable schema/version, grouped identifiers, and
explicit derived-weight terms. `DATA_RIGHTS_CLARIFICATION_PACK.md` records the
questions.

A no-walking Android capability probe and raw logger are now implemented as a
separate evidence-quality prerequisite. They confirm schema, availability,
FIFO, requested/delivered rate, wake-up mode, lifecycle, file integrity, and
permission behavior. They cannot substitute for an accuracy survivor. The
machine-readable collection template remains explicitly marked
`desk-template-not-authorized-for-personal-collection`; walking starts only
after its emulator and no-walking capability gates pass and a separately
reviewed APK revision enables it. The current APK enforces this boundary by
rejecting `walk` and `mixed` requests in the foreground service, not only by
hiding them in the UI.

## Repository and product boundary

Implementation remains under `research/pdr/` on `codex/pdr-research`, with one
isolated GitHub Actions workflow that builds/tests only that standalone APK.
Raw datasets, captures, outputs, and model weights are outside Git. `main`,
product APIs, database schema, `TrackingProviderPort`, canonical-map commands,
renderer, and game layers remain unchanged.

Main development can continue independently. Adoption requires a new explicit
decision naming the estimator version, capability profile, license basis,
uncertainty behavior, Android emulator/device evidence, and rollback condition.
