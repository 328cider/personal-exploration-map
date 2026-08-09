# Learned PDR training-data compatibility result

- Audit date: 2026-08-09
- Preregistered candidates: 8
- New sensor rows downloaded: 0
- Model weights downloaded or trained: 0
- Product-training-compatible sources: **0**
- Decision: **stop product-oriented learned training**

## Answer first

No audited public source can currently support a product-oriented learned body-
heading or direct-horizontal-velocity model under the Android input contract.
This is not a claim that learning is technically ineffective. It is a finding
that input semantics, continuous labels, group splits, reproducible artifacts,
and product/derived-weight rights do not all coexist in any of the eight locked
candidates.

RuDaCoP is the strongest technical candidate: it documents Android-origin raw
phone sensors, many people/devices/placements, and continuous foot-IMU-derived
trajectory labels. Its official distribution page says the data may be
downloaded freely after a purpose explanation, but it states no dataset license,
commercial-ML grant, redistribution term, or derived-weight right. Downloadable
therefore does not mean product-trainable.

IDOL demonstrates the opposite failure mode. Zenodo records it as CC BY 4.0 and
it has excellent subject IDs, 100 Hz data, and continuous pose truth. However,
the phone stream is from an iPhone 8 rigidly attached to a LiDAR-VIO rig. Apple
CoreMotion/device semantics and fixed-rig behavior cannot stand in for a future
Android phone in natural passive placement.

The stop preserves the untouched RoNIN validation sequences, avoids generating
non-shippable weights by accident, and does not ask the user for a walking pilot.
No product API, database, `TrackingProviderPort`, canonical map, or main branch
was changed.

## Target-specific decision matrix

| Source | Android-capturable product input | Continuous heading/2D target | Artifact/product rights | Gate result |
|---|---|---|---|---|
| RoNIN | Yes: raw IMU plus optional Game Rotation Vector | Yes, Tango-derived labels only | Explicit non-commercial scientific-research restriction | **Benchmark-only** |
| RIDI | Technically promising Android collector | Yes, Tango-derived labels only | Dataset and derived-weight rights absent from official data page; MIT covers code only | **Reject-unresolved** |
| OxIOD | No complete audited Android raw IMU subset in the accessible synchronized schema | Yes | No dataset/product license on official page | **Reject-unresolved** |
| ADVIO | No: raw phone IMU is iPhone; Pixel export is ARCore pose | Yes | CC BY-NC 4.0 | **Benchmark-only** |
| IDOL | No: iPhone 8 fixed to a LiDAR-VIO rig | Yes | CC BY 4.0 | **Benchmark-only** |
| FDA Wearables | Yes: Samsung S22 uncalibrated accelerometer/gyroscope | No continuous body-heading or 2D trajectory truth | R&D/education access, no redistribution; commercial training/derived weights unstated | **Reject-unresolved** |
| Dryad walking | Android-only subset is possible, pending row-level semantics | Distance and gaps only; GNSS/device heading is not body heading | CC0-1.0 | **Auxiliary-only** |
| RuDaCoP | Yes; strongest multi-person/device/placement match | Yes, foot-IMU-derived labels only | Official page has no artifact license or derived-weight terms | **Reject-unresolved** |

The classifications are for the named body-heading/direct-velocity target.
Dryad may still support a narrower distance/gap experiment, and FDA may be
scientifically useful for step/contact and placement robustness after its access
terms are respected. Neither becomes trajectory supervision by relabeling a
GNSS bearing, route category, foot-contact stream, or total distance.

The earlier general adapter registry retains `benchmark-only` for RIDI and
OxIOD. That status means their metadata/schema can be studied as a benchmark; it
does not authorize model training. For this narrower training-data gate,
artifact rights and immutable provenance are required facts, so the stricter
`reject-unresolved` decision controls downloads and learned weights.

## Evidence that changed the decision

### Rights are a model input gate, not paperwork after training

- The RoNIN artifact-specific license permits non-commercial scientific research
  and prohibits commercial product/service use. The official GPL code license
  does not broaden the dataset or weight grant.
- ADVIO's official Zenodo record and repository identify CC BY-NC 4.0.
- RIDI and OxIOD expose download links but no artifact-specific dataset license
  or product/derived-weight grant on their official pages.
- The FDA/Synapse access page grants research/development and educational access
  and prohibits redistribution. It does not explicitly settle commercial model
  training or distribution of derived weights.
- RuDaCoP's “downloaded freely” wording is an access statement, not a license.
- IDOL's CC BY 4.0 and Dryad's CC0-1.0 are explicit rights evidence, but technical
  target/input fitness still applies independently.

This is a conservative engineering gate, not legal advice. An owner or legal
clarification can change an `unknown` right in a new audit version; it cannot be
silently inferred in v1.

### Platform similarity is not semantic equivalence

ADVIO's rig contains a Pixel, but the official data layout documents raw
accelerometer, gyroscope, and magnetometer under the iPhone directory and only
ARCore poses under Pixel. IDOL likewise documents raw iPhone and Stencil IMU
fields. Neither provides a natural-placement Android `SensorEvent` stream for
the learned product feature contract.

OxIOD includes Nexus recordings, but its accessible synchronized header mixes
platform attitude, gravity, user acceleration, and magnetic fields. Those Apple
or platform-fused quantities are not silently mapped to Android raw
accelerometer semantics.

### Truth remains outside inference

Every candidate has an explicit field-role map. Tango/Vicon/Stencil pose,
foot-mounted IMU trajectory, pressure-walkway contact, known fixation points,
and corrected/platform orientations are training labels, evaluation-only, or
forbidden. The executable validator rejects any such field in the inference
feature list. All eligible live fields name an ordinary Android sensor or
`Location` API.

## Reproducibility and QA

`scripts/audit_training_data_sources.py` fetched eight bounded official metadata
sources totaling about 0.22 MB. It fetched no archives, sensor rows, or weights.
Raw byte hashes are retained. Dynamic FDA/Google Sites scaffolding is separated
from a canonical hash of the extracted claims, so a nonce does not masquerade as
a scientific change.

The machine-readable decision is
`datasets/manifests/learned-training-data-v1.json`. The independent validator:

- recomputes all eight classifications from the eight gate states;
- verifies the preregistered candidate set and order;
- checks every inference field against an Android API mapping;
- rejects label/evaluation/forbidden fields as features;
- verifies current official metadata against locked evidence hashes; and
- asserts the zero-compatible Stop decision.

The executed result contains 391 independent assertions. The aggregate notebook
loads no sensor row and renders the same 0/3/1/4 product/benchmark/auxiliary/
reject classification.

## Next research boundary

Do not start product-oriented model training and do not initiate a personal
walking pilot from this result. The allowed autonomous follow-ups are narrower:

1. seek artifact-specific commercial-training and derived-weight clarification
   for RuDaCoP first, then RIDI/OxIOD/FDA;
2. if technical headroom itself must be measured, preregister a benchmark-only
   learned family whose weights are non-shippable and outside Git;
3. keep RoNIN's untouched validation subjects sealed until the learned family,
   public-only training split, 50/100 Hz transforms, and gates are frozen; and
4. design a future consented, multi-person/device/placement Android capture
   contract only if public rights cannot be resolved—not as an immediate
   one-person pilot.

## Primary sources

- [RoNIN official artifact](https://www.frdr-dfdr.ca/repo/dataset/816d1e8c-1fc3-47ff-b8ea-a36ff51d682a)
- [RIDI official project page](https://yanhangpublic.github.io/ridi/index.html)
- [OxIOD official project page](http://deepio.cs.ox.ac.uk/)
- [ADVIO official repository](https://github.com/AaltoVision/ADVIO/tree/346e5968b49d361b87142f66c5c665cc6a8e8dfe)
- [ADVIO Zenodo record](https://zenodo.org/records/1476931)
- [IDOL Zenodo record](https://zenodo.org/records/4484093)
- [FDA Wearables catalog record](https://cdrh-rst.fda.gov/open-access-wearables-dataset-evaluate-factors-impacting-accuracy-smartphone-gait-metrics)
- [FDA/Synapse dataset](https://www.synapse.org/Synapse:syn51850495)
- [Dryad walking dataset](https://datadryad.org/dataset/doi:10.5061/dryad.n2z34tn5q)
- [RuDaCoP paper](https://arxiv.org/abs/1908.03609)
- [RuDaCoP official distribution page](http://gartseev.ru/projects/ipin2019)
