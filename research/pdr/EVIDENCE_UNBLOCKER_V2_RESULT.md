# PDR evidence unblocker v2 result

- Audit date: 2026-08-09
- Preregistered candidates: 7 candidate lineages / 8 official source records
- Official metadata transferred: 1,964,895 bytes
- Raw sensor rows downloaded: 0
- Full dataset archives downloaded: 0
- Model weights downloaded or trained: 0
- Product- or component-training-compatible sources: **0**
- Android-input benchmark-only sources: **2 IPIN lineages**
- Decision: **keep product-oriented learned training and personal pilot stopped**

## Answer first

The second public-evidence search did not find a source that simultaneously has
ordinary Android inference inputs, target-quality labels, leakage-safe grouping,
immutable provenance, and explicit product/derived-weight rights. It therefore
does not reopen learned body-heading, direct-velocity, or stride-length training.

It did find one bounded route that was absent from the previous decision: IPIN
Track 3 has a CC BY 4.0 archive and an official parser with Android raw
accelerometer, gyroscope, magnetometer, SI units, device-axis values, and both
application and sensor timestamps. IPIN can test an Android-shaped capture and
classical replay pipeline after a separate raw-row preflight. Its tiny scoring
checkpoint files do not provide continuous body heading or velocity, so it
cannot train or validate the missing learned target.

IPIN 2023 and 2024 are one training corpus, not two replications. All 54
normalized training members have identical paths after year normalization,
uncompressed sizes, and CRCs; they also share the same parser hash.

No product API, database schema, `TrackingProviderPort`, canonical map, main
branch, model weight, or personal trace was changed.

## Gate result

| Candidate | Scope | Android/raw semantics | Target and split | Rights/provenance | Result |
|---|---|---|---|---|---|
| IPIN 2022 Track 3 | Full PDR | Pass; official Android parser and raw SI fields | Continuous target fails; nine user IDs support a benchmark split; actual rate needs row preflight | CC BY 4.0, immutable Zenodo record | **Product-input benchmark-only** |
| IPIN 2023/2024 lineage | Full PDR | Pass; same official parser | Continuous target and user/device split fail; rate needs preflight | CC BY 4.0; both releases immutable but training members duplicate | **Product-input benchmark-only** |
| xDR Challenge 2023 | Full PDR | Android AQUOS sense6 IMU at about 100 Hz; detailed columns/frames not public | About 100 Hz LiDAR position/quaternion truth; group keys unknown | Registration-gated; artifact license, weight rights, version/checksum absent | **Reject-unresolved** |
| Wang SLE | Distance component | Android Huawei Mate 9 raw 9-axis IMU, 100 Hz | Per-stride foot X-IMU truth; stable subject IDs absent and placement narrow | Pinned artifact, but no data license or weight grant | **Reject-unresolved** |
| Wang WDE | Distance component | Huawei Mate 9 acceleration/gyro, 100 Hz, five carrying modes | Per-stride foot NGIMU truth; stable subject IDs absent | Pinned artifact, but no data license or weight grant | **Reject-unresolved** |
| ForestBack | Full PDR | Not auditable without a schema | Paper claims heading/trajectory; group and label provenance unverified | Repository has only `Dataset.zip`; archive index has two CSVs but no claimed notebook, README, or license | **Reject-unresolved** |
| EL-SLE | Distance component | Paper reports five Android phones; no artifact schema | Paper reports VIO-labelled data over 31.5 km / 8.1 h; executable splits unavailable | Article has no Data Availability section, supplement, or public dataset link | **Reject-unresolved** |

`reject-unresolved` is deliberately conservative. It does not say the underlying
data are poor; it says public visibility or paper publication is not permission
to acquire rows, train weights, or make product claims.

## Android input and truth boundary

The two IPIN benchmark candidates admit only `ACCE`, `GYRO`, and `MAGN` raw
fields as live inputs, with optional sparse GNSS available only through an
Android `Location` equivalent. Platform `AHRS`, position-reference records, and
competition ground truth are evaluation-only or forbidden. Sensor timestamps
remain the inertial time basis.

xDR LiDAR pose, Wang foot-IMU stride truth, ForestBack claimed heading/trajectory,
and EL-SLE camera/VIO labels never enter inference. The executable manifest maps
every eligible field to a normal Android API and rejects every training,
evaluation, or forbidden field from the inference list.

This keeps public-data performance separate from future Android feasibility:
none of these artifacts demonstrates screen-off delivery, foreground-service
survival, OEM power management, battery, thermal behavior, or pocket UX.

## Evidence details that changed or narrowed the path

### IPIN is useful, but only for a different question

The IPIN parser makes capture semantics much clearer than the earlier candidate
set. The archive can therefore help verify adapter parsing, timestamp choice,
device axes, downsampling, gaps/batching, and a classical no-truth replay.

It cannot answer whether estimated body heading or travelled distance is
correct over time. The indexed competition truth files are small waypoint or
scoring records rather than dense body-heading/velocity labels. A visually
plausible path must not be reported as accuracy.

IPIN 2022 is preferred for any split-sensitive descriptive analysis because its
training member paths expose nine user IDs. The 2023/2024 lineage exposes only
trial/repetition in member paths and cannot support a held-out-user claim.

### xDR 2023 is the technical rights-clarification priority

Its public page describes the desired pairing—ordinary Android phone IMU and
dense external position/orientation truth at about 100 Hz. However, access is by
ID/password after preregistration, and the public page does not state an
artifact license, commercial training right, derived-weight right, immutable
archive version, full schema, or grouped identifiers. No registration or row
download was performed. `DATA_RIGHTS_CLARIFICATION_PACK.md` defines the exact
evidence needed before that changes.

### Distance artifacts do not yet authorize a stride model

Wang SLE and WDE provide better stride supervision than the previous public
set, and WDE's five phone modes are especially relevant to passive placement.
At their pinned commits, neither repository contains a `LICENSE*`/`COPYING`
file, and neither README exposes stable subject IDs for a verified held-out-user
split. Paper publication and repository visibility do not fill either gap.

### Recent paper claims were not promoted to artifacts

ForestBack's paper metadata claims 36 trials, 42,474 samples, a dataset, and an
analysis notebook. The pinned repository tree contains only `Dataset.zip`; its
remote central directory exposes one raw and one summary CSV but no notebook,
README, or license. The raw CSV was not opened to reverse-engineer missing
terms.

EL-SLE reports five Android phones and VIO-assisted labels, but the official
article XML has no Data Availability section, supplementary material, or public
dataset link. It is evidence about a method, not an executable public dataset.

## Reproducibility and independent QA

The bounded source audit reads official JSON/HTML/XML, immutable GitHub trees,
three remote ZIP central directories, and only the allowed IPIN README/parser
members. It records transferred bytes and canonical evidence hashes while
asserting zero raw rows, full archives, and model weights.

Independent validation completed with **424 assertions** across the seven
candidates and eight fresh source records. It recomputed classifications,
verified the frozen order, checked every field role and Android mapping, proved
the IPIN duplicate lineage, compared current evidence hashes, and enforced the
0/2/5 training/benchmark/unresolved result.

The earlier eight-source gate was also freshly fetched (216,743 metadata bytes,
zero sensor rows) and passed its current **395 assertions**. ADVIO's Zenodo JSON,
the FDA page, and the dynamic RuDaCoP page changed raw transport bytes, while
their canonical audited claims did not change. The old validator was corrected
to treat raw hashes as diagnostics and canonical evidence hashes as the
scientific invariant. Existing RuDaCoP/RIDI/OxIOD/FDA blockers therefore remain.

The machine-readable decision is
`datasets/manifests/evidence-unblocker-v2.json`; the executed aggregate notebook
is `notebooks/11_evidence_unblocker_v2.ipynb`. Two clean Docker executions
produced the same notebook SHA-256
`c63e15d82ecc9ff8cb64880125c54217ecd75086826c68b12cc456b3c3c3d526`.

## Authorized next step and stop boundary

The only new autonomous accuracy action is:

1. write a separate preregistration for an **offline classical IPIN benchmark**;
2. preflight the smallest legally obtained IPIN subset for actual sample-rate,
   timestamp monotonicity, axes, missing records, and user/sequence identifiers;
3. use only raw Android-compatible fields, apply identical 50/100 Hz and
   gap/batching perturbations, and keep platform AHRS/POSI/truth out of input;
4. report capture/robustness behavior without claiming continuous heading or
   distance accuracy.

Product-oriented learned training, xDR/Wang/ForestBack/EL-SLE row acquisition,
product integration, Android walking capture, and a personal pilot remain
stopped. A later rights clarification must pass the entire technical gate; it
does not automatically authorize adoption.

## Primary sources

- [IPIN 2022 Track 3](https://zenodo.org/records/7612915)
- [IPIN 2023 Track 3](https://zenodo.org/records/8362205)
- [IPIN 2024 Track 3](https://zenodo.org/records/13931119)
- [AIST xDR Challenge 2023](https://unit.aist.go.jp/rihsa/xDR-Challenge-2023/)
- [Wang SLE artifact](https://github.com/Archeries/StrideLengthEstimation/tree/c96f67c79a81a8f2098eee051dd41c0c1ba1d102)
- [Wang WDE artifact](https://github.com/wq1989/WalkingDistanceEstimation/tree/634ac708a71aeae30d41814546f85ebfc71e1411)
- [ForestBack paper](https://arxiv.org/abs/2606.14421) and [pinned artifact](https://github.com/Aueaphum2541/ForestBack-Dataset/tree/02924917f21ea218d464649494197058d6d51cbe)
- [EL-SLE article](https://doi.org/10.3390/s22186864)
