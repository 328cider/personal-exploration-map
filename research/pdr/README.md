# PDR research workspace

This directory is an isolated, offline-first research workspace for heading and
distance estimation. It does not change product APIs, the database schema, or
`TrackingProviderPort`.

Start with:

- `BRANCH_STRATEGY.md` for integration and handoff rules;
- `DATA_SCIENCE_PLAN.md` for the Android-compatible data contract and gates;
- `datasets/registry.json` for the initial public-dataset audit;
- `notebooks/01_synthetic_foundation.ipynb` for the executable Phase 1 example.

Run the research checks from the repository root:

```powershell
python -m unittest discover -s research/pdr/tests -v
python research/pdr/scripts/audit_datasets.py
```

The code intentionally uses only the Python standard library. Raw datasets,
derived datasets, model weights, and benchmark outputs belong in the ignored
`data/`, `models/`, and `outputs/` directories and must not be committed.

## Boundary

The research code may produce versioned, uncertainty-bearing estimator output.
It does not write canonical map state. Product adoption requires a separate
decision by the main-development side and a future implementation behind the
existing tracking-provider boundary.
