# PDR evidence unblocker v2 protocol

Status: preregistered on 2026-08-09 before loading any newly discovered sensor
rows or model weights.

## Answer first

This audit asks whether public evidence discovered after the first eight-source
training-data gate can legitimately reopen either body-heading/2D training or
stride-length training. It also asks whether a source that cannot train a
product model can still support an Android-compatible classical replay.

No source is promoted because it is downloadable, recent, or reports a strong
paper result. The artifact must independently pass Android input, target,
leakage, provenance, and rights checks.

## Product and architecture boundary

- User problem: reduce direction and distance uncertainty without asking for a
  personal walking pilot before public evidence is exhausted.
- Passive-first cost: zero new user interaction and zero field-test time.
- Map layer: research reads raw evidence and evaluation labels; it does not
  write the canonical map, accepted track, or manual corrections.
- Application boundary: none. Product APIs, the DB schema, `TrackingProvider`,
  `CURRENT_DIRECTION.md`, and main-development code remain unchanged.
- Ownership: all artifacts stay under `research/pdr/` on a
  `codex/pdr/*` branch targeting `codex/pdr-research` only.
- Build / Adopt / Benchmark: adopt public schemas and benchmark protocols where
  compatible; build only the bounded metadata audit and leakage guards.
- Privacy: no personal location data, credentials, or protected dataset rows
  are collected. Repository archives and model weights are not committed.
- Stop condition: zero rights-clear, group-splittable source with the required
  target keeps product-oriented learned training stopped.

This is consistent with the product constitution: raw observations remain
evidence, uncertainty is not hidden, existing maps/cloud services are not made
mandatory, and no game or renderer receives mutation authority.

## Discovery window and frozen scope

Discovery used official repository records, publisher papers, institutional
competition pages, Zenodo, and GitHub. Search terms covered Android smartphone
IMU, pedestrian inertial odometry, body heading, stride length, xDR/IPIN, VIO
ground truth, and newly released 2024-2026 datasets.

The machine-readable candidate order is frozen in
`datasets/evidence_unblocker_candidates_v2.json`:

1. IPIN 2022 Track 3.
2. The IPIN 2023/2024 Track 3 training-data lineage.
3. xDR Challenge 2023.
4. Wang et al. SLE.
5. Wang et al. WDE.
6. ForestBack.
7. EL-SLE.

The following discoveries are screened out before deep audit:

- xDR Challenge 2025: iOS/ARKit/UWB/navigation-robot problem and request-gated
  data, not an Android raw-IMU-only product input contract.
- URWalking optical-flow data: dataset marked "coming soon" and camera input
  would violate the current passive sensor contract.
- HAR-PMD and similar HAR corpora: Android raw signals but activity labels only,
  with no stride, continuous body heading, or trajectory truth.
- IPIN foot-mounted tracks: sensor placement cannot be reproduced by a normally
  carried phone.

Adding a candidate after this freeze requires a new protocol version.

## Bounded acquisition rule

- Fetch official JSON/HTML/XML, immutable GitHub trees/README files, and ZIP
  central directories only.
- Small README/parser/aggregate files may be read from an archive using verified
  HTTP Range requests.
- Do not open raw sensor-log members, train a model, or download a full archive.
- Record transferred bytes, immutable commit/record identifiers, extracted
  evidence hashes, and the fact that raw sensor rows and model weights are zero.
- A 404 for an immutable `LICENSE*` path is evidence of absence at that commit,
  not evidence that no separate permission could ever exist.

## Gate dimensions

Each candidate receives `pass`, `fail`, or `unknown` for exactly these gates:

1. `android_inputs`: every inference field maps to a normal Android API and no
   ground truth, VIO, map, camera, or foot IMU enters inference.
2. `raw_semantics`: units, axes/frames, sensor timestamp, and value provenance
   are explicit enough to implement an adapter without guessing.
3. `target_supervision`: the source provides the target for its frozen scope:
   continuous body heading/2D motion for `full-pdr`, or per-stride distance for
   `distance-component`.
4. `rate_50_100_hz`: capture and replay can operate at 50/100 Hz without a
   mandatory rate above the Android product contract.
5. `group_split`: user/device/placement/sequence keys prevent overlapping-window
   and identity leakage for the claimed conclusion.
6. `provenance`: official artifact, collection device, labels, and preprocessing
   are traceable; paper claims alone do not pass an artifact gate.
7. `rights`: the dataset artifact itself grants commercial reuse/adaptation at
   least as clearly as CC BY 4.0 and does not prohibit the intended use. A paper
   license, public URL, citation request, or GitHub visibility is insufficient.
8. `deployment`: preprocessing and live inference use only allowed Android raw
   data; labels and future samples remain isolated.

## Classification rules

- `product-training-compatible`: all eight gates pass for `full-pdr`.
- `component-training-compatible`: all eight gates pass for a narrower frozen
  component such as stride length.
- `product-input-benchmark-only`: rights are known, Android inputs are usable,
  but one or more training/generalization gates fail; only the explicitly listed
  replay or evaluation use is allowed.
- `reject-incompatible`: rights are known but the product input itself is
  incompatible.
- `reject-unresolved`: artifact rights are unknown. This overrides promising
  technical properties and prevents row/model acquisition.

Unknown rights never inherit from a paper, code license, hosting platform, or
the word "open". A rights-clear source can still fail target or split fitness.

## Acceptance checks

- Candidate order and source URLs match the frozen registry.
- Every live field has an Android API mapping; every label/evaluation/forbidden
  field has no Android API mapping and cannot enter `inference_features`.
- IPIN 2023 and 2024 are tested for byte-identical training members by normalized
  path, uncompressed size, and CRC; duplicate corpora count once as evidence.
- Sparse checkpoint truth is not promoted to continuous body-heading truth.
- Missing `LICENSE*`, README, notebook, public artifact, or group ID remains an
  explicit failure/unknown rather than an inferred permission or capability.
- Existing RuDaCoP, RIDI, OxIOD, and FDA rights blockers are freshly revalidated
  with the v1 source audit before changing the stop decision.
- The notebook and result document are generated from the committed manifest,
  and independent validation recomputes classifications and evidence digests.

## Authorized next action

If no training source passes but a rights-clear Android-input benchmark remains,
the only newly authorized follow-up is an offline classical replay after a
separate preregistration and raw-data preflight. Learned training, product code,
and a personal pilot remain stopped.
