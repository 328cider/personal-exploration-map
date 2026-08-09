# PDR research branch strategy

- Research integration branch: `codex/pdr-research`, created from `origin/main`.
- First work branch: `codex/pdr/ds-foundation`.
- Capture-readiness work branch: `codex/pdr/capture-readiness`.
- Future topics: `codex/pdr/<topic>`.
- Every PDR work PR targets `codex/pdr-research`, never `main`.
- Updates from `main` are merged into `codex/pdr-research` periodically.
- No PR from research to `main` is created until the main-development side
  explicitly adopts a result.

## Conflict-avoidance rules

1. Keep research artifacts under `research/pdr/` until adoption.
2. Do not change `CURRENT_DIRECTION.md`, product APIs, database schemas, native
   capture, or `TrackingProviderPort` during the foundation phase.
3. Do not commit raw datasets, generated logs, model weights, or benchmark
   outputs.
4. Share status through Issue #5. Report public-benchmark performance and real
   Android feasibility as separate decisions.
5. A research result becomes an adoption candidate only after the compatibility,
   leakage, robustness, license, and product gates in `DATA_SCIENCE_PLAN.md` pass.

## Adoption handoff

An adoption proposal must name the exact estimator version and capability
profile, list unsupported devices and fallbacks, disclose uncertainty and
catastrophic failures, and identify the application boundary through which the
result could enter the product. The main-development side owns the decision to
open any PR to `main`.
