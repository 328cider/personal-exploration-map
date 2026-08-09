# PDR public/synthetic research decision

Date: 2026-08-09

## Decision

The registered low-cost public/synthetic program is complete enough to make its
intended decision: **do not integrate a PDR estimator, do not define a field-test
capture specification, and do not ask for a personal walking pilot.**

This is not a universal claim that pedestrian dead reckoning is impossible. It
is a bounded conclusion that the currently auditable Android-compatible inputs,
public evidence, licenses, and tested estimator families do not support a
product candidate. More tuning on the reused RoNIN development groups would add
selection bias rather than answer the product question.

The 2026-08-09 evidence-unblocker v2 search added seven candidate lineages and
eight fresh official records. It found **zero** product- or component-training
sources, so the learned-model and personal-pilot Stop is unchanged. It did find
one narrower, non-accuracy path: CC BY 4.0 IPIN Track 3 raw Android records may
support a separately preregistered classical capture/replay benchmark after
row-level preflight. Sparse competition checkpoints cannot establish continuous
heading or distance accuracy, and IPIN 2023/2024 are one byte-identical training
lineage rather than independent replications.

## Evidence ledger

| Gate | Evidence | Decision |
|---|---|---|
| Synthetic capture/evaluation plumbing | Golden rotation, mirror, false-loop, scale, batching, jitter, and gap cases are detected with truth isolated from inference | **Pass for pipeline QA only** |
| Public input compatibility | RoNIN exposes useful Android-shaped raw streams; dataset truth and corrected poses stay label/evaluation-only | **Benchmark-compatible, not Android lifecycle evidence** |
| Product-oriented training source | Initial 8-source gate plus 7 new lineages; 0 combine Android semantics, suitable target truth, leakage-safe grouping, reproducibility, and product/derived-weight rights | **Stop** |
| IPIN classical capture/replay evidence | Android raw parser semantics and CC BY 4.0 pass; continuous heading/velocity truth and, for 2023/24, user/device grouping fail | **Benchmark-only after preflight; no accuracy/product claim** |
| Step detector rate stability | Frozen detector passes untouched 50/100 Hz agreement, but differs from Android Step Counter by 0–57.6% depending on sequence | **Pass for rate invariance; Stop for count accuracy** |
| Stride/distance | Validation distance-scale error remains about 14.3–15.0%, with unresolved step semantics and placement calibration | **Stop** |
| Classical body heading | 90 causal PCA candidates; 0 survive; axis ambiguity produces near-180° rate tails | **Stop** |
| Learned residual heading | 36 candidates / 144 held-out fits; 0 survive; best diagnostic mean MAE 91.388° and severe rate drift | **Stop** |
| Direct circular recurrent heading | 24 candidates / 96 held-out fits; 0 survive; rate stability improves, but best diagnostic mean MAE 84.303° and turn MAE 65.941° | **Stop** |
| Released RoNIN heading model | Requires 200 Hz, includes private/non-reproducible training data, and is non-commercial | **Benchmark demo only; do not run or ship** |
| Android screen-off/OEM/battery/pocket lifecycle | Public data cannot measure it; no accuracy candidate survived to justify a narrowed capture contract | **Not evaluated; deliberately gated** |
| One-person/one-device pilot | Cannot establish generalization or repair missing rights/training evidence | **Not authorized** |

Across the three registered body-heading families, **150 configurations** were
evaluated under subject-prefix separation and Android-only inference contracts;
none passed. The final direct circular family showed that the prior rate
instability was fixable, while accuracy remained decisively outside the gate.
That separates a sampling implementation defect from the unresolved semantic
problem of inferring pedestrian heading from a freely moving phone.

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
- causal residual-rate ridge; and
- causal direct circular echo-state prediction.

Not exhausted in the abstract:

- proprietary or newly licensed multi-user Android data;
- a consented multi-user, multi-device, multi-placement capture program with an
  independent heading/trajectory truth system;
- a materially new estimator backed by such a clean training source; and
- real Android lifecycle behavior after an estimator and capture profile exist.

Those are external-evidence changes, not another free hyperparameter sweep.
An IPIN classical replay is an allowed capture/evaluation-pipeline check, not an
exception to this accuracy conclusion.

## Required unblocker

Resume accuracy work only after at least one of these is documented in a new
protocol and Issue/ADR handoff:

1. artifact-specific permission covering commercial model training and derived
   weights for a technically suitable source—RuDaCoP is the first clarification
   target—or another source that passes the same gate;
2. approval and design for a consented dataset with multiple people, Android
   devices, passive placements, 50/100 Hz raw streams, monotonic timestamps,
   gaps/batching, and independent continuous body-heading or 2D trajectory
   truth; or
3. a materially distinct algorithm with a clean, rights-compatible training
   and untouched validation plan, not selected from the existing four reused
   development groups.

The highest-priority new clarification is xDR Challenge 2023 because its public
description pairs Android IMU with dense external position/quaternion truth at
about 100 Hz. Registration, row acquisition, or training still waits for an
artifact license, immutable schema/version, grouped identifiers, and explicit
derived-weight terms. `DATA_RIGHTS_CLARIFICATION_PACK.md` records the questions.

A no-walking Android capability probe may later confirm sensor availability,
FIFO, rate, wake-up mode, and permission behavior. It cannot substitute for an
accuracy survivor, so the current plan does not use it to advance to a pilot.

## Repository and product boundary

All work remains under `research/pdr/` on `codex/pdr-research`. Raw datasets,
outputs, and model weights are outside Git. `main`, product APIs, database
schema, `TrackingProviderPort`, canonical-map commands, renderer, and game
layers remain unchanged.

Main development can continue independently. Adoption requires a new explicit
decision naming the estimator version, capability profile, license basis,
uncertainty behavior, Android emulator/device evidence, and rollback condition.
