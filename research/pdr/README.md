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
- `datasets/registry.json` for the initial public-dataset audit;
- `notebooks/01_synthetic_foundation.ipynb` for the executable Phase 1 example;
- `notebooks/02_public_dataset_audit.ipynb` for the executed metadata audit;
- `notebooks/03_common_baselines.ipynb` for the executed common-baseline matrix;
- `notebooks/04_ronin_public_sequence.ipynb` for the first raw public replay.

Run the research checks from the repository root:

```powershell
python -m unittest discover -s research/pdr/tests -v
python research/pdr/scripts/audit_datasets.py
```

Public sequence preflight and any non-standard Python dependency run in Docker,
not through a Windows npm or Node installation:

```powershell
docker compose -f research/pdr/compose.yaml build pdr-audit
docker compose -f research/pdr/compose.yaml run --rm pdr-audit
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
```

`pdr-fetch` is the only research service with network access. `pdr-audit` stays
network-disabled. Both install dependencies inside Docker; no Windows npm or
Python environment is created.

The network range fetcher uses only the Python standard library. HDF5/notebook
work uses version-pinned Python packages inside the research Docker image. Raw
datasets, derived datasets, model weights, and benchmark outputs belong in the
ignored `data/`, `models/`, and `outputs/` directories and must not be committed.

## Boundary

The research code may produce versioned, uncertainty-bearing estimator output.
It does not write canonical map state. Product adoption requires a separate
decision by the main-development side and a future implementation behind the
existing tracking-provider boundary.
