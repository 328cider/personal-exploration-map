# PDR public-data rights and artifact clarification pack

Date: 2026-08-09
Status: prepared, not sent

## Purpose and boundary

This pack turns unresolved public-data candidates into answerable owner/legal
questions. It is not legal advice and does not infer permission from public
access, a paper license, a code license, or a citation request. No dataset row,
credential, model weight, or personal trace is requested until the applicable
artifact has an explicit answer.

An answer reopens a candidate only when it identifies the licensor, exact
artifact/version, permitted purpose, model/weight treatment, redistribution
boundary, and any privacy or attribution conditions. Technical, split, and
Android-semantic gates still apply separately.

## Priority order

| Priority | Candidate | Why ask | What still blocks after a positive rights answer |
|---|---|---|---|
| 1 | xDR Challenge 2023 | Closest technical match: Android phone IMU and about 100 Hz LiDAR position/quaternion truth | Immutable archive/schema, axes/timestamps, user/device/placement IDs, reproducible preprocessing |
| 2 | RuDaCoP | Strongest known diversity across people, devices, placements, and foot-IMU trajectory truth | Immutable artifact/version and checksums; exact preprocessing provenance |
| 3 | Wang WDE | 100 Hz phone IMU, per-stride truth, five carrying modes | Stable subject IDs and an executable held-out-user split |
| 4 | Wang SLE | 100 Hz Android 9-axis phone IMU and per-stride truth | Stable subject IDs and broader passive placements |
| 5 | RIDI / OxIOD | Useful Android-oriented trajectory benchmarks | Archive-specific raw semantics, stable artifact hashes, grouped split keys |
| 6 | FDA Wearables | Good Android step/contact and placement evidence | Rights for derived weights; target remains auxiliary rather than full-PDR |
| 7 | ForestBack / EL-SLE | Recent paper claims may be useful if complete artifacts appear | Public schema/data/notebook, provenance, split keys, then rights; rights alone are insufficient |

IPIN does not need a rights request for the current benchmark boundary because
its Zenodo artifacts are CC BY 4.0. It still cannot supply continuous heading or
velocity supervision.

## Minimum questions for every artifact

The response must cover all applicable items in writing:

1. Who owns or is authorized to license the dataset artifact?
2. Which exact archive/version/checksum does the answer cover?
3. May an organization use it for commercial research and development?
4. May it train, fine-tune, validate, or select a machine-learning model?
5. May the resulting learned parameters or model weights be used in and
   distributed with a commercial product, without redistributing source rows?
6. Are trained weights considered a derivative of the data, and if so what
   attribution, notice, share-alike, field-of-use, or distribution terms apply?
7. May transformed features, aggregate metrics, adapters, and benchmark results
   be published or redistributed?
8. May the raw artifact be retained by project collaborators and CI/research
   infrastructure, and for how long?
9. Do consent/privacy terms permit the proposed training and evaluation use?
10. Are there separate terms for code, data, ground truth, pretrained weights,
    and competition-only access?

Silence, a download link, “free,” “open,” a paper's CC license, or an MIT/GPL
code file is not a positive answer to these questions.

## Source-specific addenda

### xDR Challenge 2023

- Ask the AIST/committee contact for the data-use terms before preregistration or
  credential acquisition.
- Request a versioned file manifest/checksum and column specification without
  requesting participant rows.
- Ask whether challenge participation limits use to the event, academic work,
  or non-commercial research.
- Ask separately about commercial learned weights and publication of aggregate
  benchmark results.
- Request stable user/device/placement/sequence identifiers sufficient for a
  split before windows are generated.

Acceptance evidence: signed terms, institutional license, or an artifact page
that explicitly grants the proposed use and identifies the covered archive.

### RuDaCoP

- Clarify whether “downloaded freely” is only an access statement.
- Request a stable version/checksum and the party authorized to license the
  phone streams and foot-IMU-derived truth.
- Ask whether product training and distribution of derived weights are allowed.
- Ask whether per-person, device, and placement identifiers may be used for
  leakage-safe split construction and aggregate reporting.

Acceptance evidence: artifact-specific written terms plus an immutable
manifest. Temporary email/download links alone do not pass.

### Wang WDE and SLE

- Ask whether the GitHub data files at the pinned commits are covered by an
  explicit data license distinct from the journal article.
- Ask whether commercial training and distribution of derived weights are
  permitted.
- Request stable anonymized subject IDs; file/stride identifiers must not be
  presented as a held-out-user split.
- Confirm that participants consented to the proposed reuse and that phone-mode
  labels may be published in aggregate.

Acceptance evidence: a repository LICENSE/data statement naming the files and
an owner response covering weights and subject grouping.

### RIDI, OxIOD, and FDA Wearables

- RIDI/OxIOD: distinguish code licenses from data and pretrained-model terms;
  request immutable archive/version hashes and commercial-weight permission.
- FDA/Synapse: clarify whether “research and development and/or educational”
  includes commercial R&D and whether the redistribution restriction applies to
  learned weights, transformed features, or only source records.
- A positive answer does not upgrade FDA to trajectory supervision; its use
  remains step/contact/placement robustness unless a separate target passes.

### ForestBack and EL-SLE

Do not lead with a weight-license request. First request the missing public
artifact contract:

- exact repository/release and checksum;
- README/schema with units, frames, timestamps, device/OS and preprocessing;
- label provenance and group identifiers;
- the ForestBack analysis notebook claimed by the paper; and
- an artifact-specific license.

No raw member should be opened merely to reverse-engineer an absent contract.

## Ready-to-send owner template

Subject: Clarification of dataset terms and immutable artifact for Android PDR research

> We are evaluating the dataset **[dataset and exact version]** for a pedestrian
> dead-reckoning research project whose future inference inputs are limited to
> ordinary Android phone sensors. Ground-truth pose/heading/stride data would be
> used only as training labels or evaluation truth.
>
> Before accessing participant rows or training a model, could you confirm in
> writing: (1) the exact archive/version/checksum covered; (2) the party
> authorized to grant permission; (3) whether commercial research and model
> training are permitted; (4) whether resulting model weights may be used and
> distributed in a commercial product without source-row redistribution; (5)
> attribution, notice, derivative, privacy, retention, or reporting conditions;
> and (6) whether code, data, ground truth, and supplied weights have different
> terms?
>
> We also need a schema describing units, coordinate frames, timestamp basis,
> preprocessing, and stable anonymized user/device/placement/sequence keys. We
> are not requesting personal identifiers.
>
> A link to authoritative existing terms is sufficient if it explicitly covers
> these points. Thank you.

## Decision recording template

For each received answer, create a new versioned audit record containing:

- source, responder role, date, and unmodified authoritative URL/document hash;
- exact artifact/version/checksum covered;
- answers to the ten minimum questions, each `yes`, `no`, or `unresolved`;
- technical gate changes justified by separate schema evidence;
- resulting allowed and blocked actions; and
- reviewer/date. Do not overwrite this v2 result or reinterpret an ambiguous
  response as permission.

No outbound request has been sent by this research branch. Sending one and
accepting legal terms remain owner-authorized external actions.
