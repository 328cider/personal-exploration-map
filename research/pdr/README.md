# PDR research workspace

This directory is an isolated, offline-first research workspace for heading and
distance estimation. It does not change product APIs, the database schema, or
`TrackingProviderPort`.

Start with:

- `BRANCH_STRATEGY.md` for integration and handoff rules;
- `DATA_SCIENCE_PLAN.md` for the Android-compatible data contract and gates;
- `PUBLIC_DATASET_AUDIT.md` for the revision-pinned Phase 2 findings;
- `BASELINE_REPLAY.md` for the synthetic-only Phase 3 B0/B1 results;
- `PUBLIC_SEQUENCE_REPLAY.md` for the first raw-Android public sequence result;
- `HEADING_STRIDE_DIAGNOSTIC.md` for the Android azimuth correction and
  predeclared stride-gain sensitivity;
- `RATE_STABILITY_PROTOCOL.md` for the preregistered split and validation gates;
- `RATE_STABILITY_RESULT.md` for the frozen detector result and the post-freeze
  Android Step Counter comparison;
- `BODY_HEADING_PROTOCOL.md` for the preregistered causal body-heading split,
  candidate family, and untouched validation gates;
- `BODY_HEADING_RESULT.md` for the adapter-v2 correction, 90-candidate
  development Stop, untouched validation state, and official-model audit;
- `LEARNED_TRAINING_DATA_PROTOCOL.md` for the preregistered rights, Android
  semantics, target-fitness, and clean-split gate before any learned model;
- `LEARNED_TRAINING_DATA_RESULT.md` for the eight-source audit, zero-compatible
  Stop decision, and the boundary before any learned model or personal pilot;
- `LEARNED_HEADING_PROTOCOL.md` for the preregistered non-shippable RoNIN ridge
  benchmark that measures learned body-heading headroom after the data gate;
- `LEARNED_HEADING_RESULT.md` for the 36-candidate residual-ridge development
  Stop, rate-instability diagnosis, and still-sealed validation groups;
- `DIRECT_HEADING_PROTOCOL.md` for the preregistered direct circular recurrent
  headroom test that leaves those validation groups sealed;
- `DIRECT_HEADING_RESULT.md` for its rate-stable but inaccurate 24-candidate
  development Stop and the resulting public-evidence research boundary;
- `RESEARCH_DECISION.md` for the consolidated answer on what is exhausted,
  what remains externally blocked, and why no pilot or product adoption follows;
- `datasets/registry.json` for the initial public-dataset audit;
- `notebooks/01_synthetic_foundation.ipynb` for the executable Phase 1 example;
- `notebooks/02_public_dataset_audit.ipynb` for the executed metadata audit;
- `notebooks/03_common_baselines.ipynb` for the executed common-baseline matrix;
- `notebooks/04_ronin_public_sequence.ipynb` for the first raw public replay;
- `notebooks/05_heading_stride_diagnostic.ipynb` for the executed heading and
  stride sensitivity diagnostic.
- `notebooks/06_rate_stable_step_detector.ipynb` for leakage-controlled
  development/validation and independent result QA;
- `notebooks/07_body_heading_gate.ipynb` for the executed body-heading Stop and
  metadata-only official-model audit.
- `notebooks/08_learned_training_data_gate.ipynb` for the executed aggregate-only
  rights, Android-input, target-fitness, and leakage audit.
- `notebooks/09_learned_heading_headroom.ipynb` for the executed aggregate-only
  leave-one-group-out residual-ridge Stop.
- `notebooks/10_direct_heading_headroom.ipynb` for the executed aggregate-only
  direct circular recurrent Stop and rate-stability comparison.

Run the research checks from the repository root:

All research checks run in Docker, not through a Windows npm, Node, or Python
installation:

```powershell
docker compose -f research/pdr/compose.yaml build pdr-audit
docker compose -f research/pdr/compose.yaml run --rm pdr-audit `
  python -m unittest discover -s research/pdr/tests -v
docker compose -f research/pdr/compose.yaml run --rm pdr-audit `
  python research/pdr/scripts/audit_datasets.py --strict-ready
```

Mount legally obtained archives under the ignored `research/pdr/data/` path.
The preflight commands emit metadata and quality counts only, never raw rows.

The official RoNIN unseen-subject archive supports range retrieval, so the
research fetcher can list or extract one sequence without downloading 3.2 GB:

```powershell
docker compose -f research/pdr/compose.yaml run --rm pdr-fetch `
  python research/pdr/scripts/fetch_ronin_sequence.py --list-sequences
docker compose -f research/pdr/compose.yaml run --rm pdr-fetch `
  python research/pdr/scripts/fetch_ronin_sequence.py --sequence a054_1
docker compose -f research/pdr/compose.yaml run --rm pdr-audit `
  python research/pdr/scripts/analyze_heading_stride.py `
  --sequence-root /data/ronin/a054_1 `
  --output /outputs/ronin-a054_1-heading-stride.json
```

`pdr-fetch` is the only research service with network access. `pdr-audit` stays
network-disabled. Both install dependencies inside Docker; no Windows npm or
Python environment is created.

The network range fetcher uses only the Python standard library. HDF5/notebook
work uses version-pinned Python packages inside the research Docker image. Raw
datasets, derived datasets, model weights, and benchmark outputs belong in the
ignored `data/`, `models/`, and `outputs/` directories and must not be committed.
The small `models/registry.json` metadata allowlist is the only tracked exception;
it contains no weights or executable model payload.

## Boundary

The research code may produce versioned, uncertainty-bearing estimator output.
It does not write canonical map state. Product adoption requires a separate
decision by the main-development side and a future implementation behind the
existing tracking-provider boundary.
