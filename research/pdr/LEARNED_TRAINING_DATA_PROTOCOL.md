# Learned PDR training-data compatibility protocol

Status: preregistered after source discovery and before downloading any new
candidate dataset rows or training any learned estimator.

This gate asks a narrower question than model accuracy: whether a learned
body-heading or direct 2D velocity experiment can be trained from evidence whose
input semantics, splits, provenance, and rights can support a future Android
product. A high benchmark score cannot compensate for an unavailable input or a
non-commercial/unknown data grant.

## Product and architecture boundary

- User problem: obtain pedestrian direction or velocity without treating phone
  yaw as body heading.
- Passive-first impact: zero interaction and zero new collection time in this
  metadata-only phase.
- Map layer: research planning over public metadata. No raw evidence, canonical
  map, product API, database, `TrackingProviderPort`, renderer, or game code is
  changed.
- Canonical writer/application boundary: none.
- Build / Adopt / Benchmark: audit training evidence before choosing an
  architecture. No pretrained model is adopted in this phase.
- Privacy: no personal data is collected. Dataset rows and model weights remain
  outside Git.
- Stop condition: if no public source passes the product-training gate, do not
  mislabel benchmark-only training as a product model and do not request a
  personal walking pilot merely to fill a large training corpus.
- Constitution: inference remains Android-raw-only, truth stays label/evaluation
  only, and local-first product behavior is unchanged.

## Locked candidate scope

The machine-readable list is `datasets/training_data_candidates.json`. This v1
audit covers eight sources found in the prior dataset review or primary-source
discovery:

1. RoNIN;
2. RIDI;
3. OxIOD;
4. ADVIO;
5. IDOL;
6. FDA Open-Access Wearables gait data;
7. the Dryad inertial and positioning walking dataset; and
8. RuDaCoP.

Adding another source requires a v2 audit rather than changing v1 outcomes after
inspection. This phase may retrieve bounded official metadata, READMEs, license
texts, manifests, and schemas. It must not download bulk sensor rows.

## Product-training compatibility gate

A source is `product-training-compatible` only if all of the following are
supported by primary evidence:

1. **Inference inputs:** every feature can be captured through ordinary Android
   `SensorManager`, `SensorEvent`, or `Location` APIs. Apple Core Motion attitude,
   ARCore/Tango pose, mocap pose, foot IMU, known route, and ground-truth heading
   may be labels but never features.
2. **Raw semantics:** units, axes, component order, monotonic timestamp meaning,
   source rate, and any calibration are explicit enough to reproduce from the
   future Kotlin logger. A field called "orientation" is not assumed equivalent
   to an Android Rotation Vector.
3. **Target fitness:** continuous 2D trajectory/body heading is required for a
   heading or velocity target. Step events or total distance alone can support
   only an auxiliary step/stride task.
4. **Rate:** the model can be trained and evaluated at 50 and 100 Hz. A frozen
   200 Hz-only path is incompatible with the initial capture contract.
5. **Leakage controls:** subject, device, placement, and sequence identifiers are
   available before windowing. Splits occur at group level; windows from one
   sequence never cross train/validation/test.
6. **Provenance:** artifact version/hash, preprocessing, label construction,
   training code version, seed, and output weight hash can be fixed. Private or
   unavailable training rows invalidate reproducibility.
7. **Rights:** an explicit artifact-specific grant permits commercial ML
   training and the intended use/distribution of derived weights. "Public",
   "open access", a code license, a repository host default, or the ability to
   download is not sufficient. Ambiguity is a failure pending owner/legal
   clarification.
8. **Deployment:** no copyleft or runtime dependency is silently introduced into
   product packages. Architecture ideas may be cleanly implemented, but copied
   code and supplied weights retain their own terms.

## Classifications

- **Product-training-compatible:** passes all eight requirements for the named
  target. This is still not an accuracy or Android lifecycle Go.
- **Benchmark-only:** useful for scientific comparison, but license,
  preprocessing, device semantics, or collection setup blocks product training.
- **Auxiliary-only:** Android-like inputs and rights may be useful for a narrower
  step/stride/robustness task, but the source lacks continuous heading/trajectory
  labels for the learned target.
- **Reject-unresolved:** a required fact is missing or contradictory; no rows may
  be downloaded and no product claim may be based on it until resolved.

Classification is target-specific. The same dataset may be auxiliary-only for
body heading yet product-training-compatible for step detection.

## Evidence rules

- Prefer official dataset records, repositories, papers, API metadata, and
  artifact license files. Secondary catalog summaries cannot establish rights.
- Store URLs, revisions/record IDs, hashes when bounded content is retrieved,
  and a short claim supported by each source.
- Record `unknown` rather than infer a permissive license.
- Do not accept a platform marketing phrase such as "raw IMU" without checking
  actual fields and coordinate semantics.
- Do not use evaluation labels to choose inference preprocessing.
- Keep public benchmark performance and future Android feasibility as separate
  decisions.

## Decision rule for the next learned experiment

A product-oriented learned experiment may be preregistered only when at least
one source passes for the target or when a separate consented capture/rights plan
provides equivalent evidence. If none passes:

- a benchmark-only model may be run solely to estimate technical headroom;
- its weights must be marked non-shippable and kept out of Git;
- it cannot consume the untouched RoNIN body-heading validation sequences unless
  its family, clean training split, rate transforms, and evaluation gates are
  frozen first; and
- it cannot trigger a personal pilot or product capture specification.

## Acceptance

- Every candidate has a recorded target, input mapping, label fitness, split
  capability, artifact-specific license status, and classification reason.
- No source is called product-compatible from a code license alone.
- No Apple/fixed-rig platform value is silently mapped to Android live input.
- Commercial training and derived-weight use are explicit, not assumed.
- Unknown rights and missing continuous truth remain visible blockers.
- The audit is reproducible from a standard-library validator and an executed
  aggregate-only notebook.

