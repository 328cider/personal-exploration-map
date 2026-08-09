# SQLite raw numeric evidence special-value probe

- Status: bounded experiment; no production schema decision
- Related: Issues #99 and #92
- Scope: Node 22 `node:sqlite`; Expo SQLite / Android equivalence is not claimed

## Question

The logical PersonalMap bundle can represent every JavaScript number with
`ecmascript-number-string-v1`, including `NaN`, `+Infinity`, `-Infinity`, and `-0`.
That does not prove the current canonical SQLite schema preserves those values before export.

The current raw tables store coordinates, accuracy, speed, heading, confidence, and related values in
SQLite `REAL` or `INTEGER` columns. This experiment records whether the JavaScript-to-SQLite binding and
SQLite storage round-trip the special values exactly.

## Repeatable probe

```text
node --no-warnings scripts/experiments/sqlite-special-number-probe.mjs
```

The probe covers:

- nullable `REAL`;
- `REAL NOT NULL`;
- `INTEGER NOT NULL`;
- finite `1.5`;
- `NaN`;
- positive and negative infinity;
- negative zero.

For each cell it records insert success/failure, SQLite `typeof(value)`, SQLite `quote(value)`, the
JavaScript value returned by `node:sqlite`, `Number.isNaN`, `Number.isFinite`, and
`Object.is(value, -0)`.

The experiment deliberately does **not** assert that a preferred result occurred. CI validates only
that the probe produced a complete, parseable result matrix.

## Preliminary local Node 22 observation

A preliminary run in the development container used Node `v22.16.0` and SQLite `3.49.1`.
It observed:

| Input | Nullable REAL | NOT NULL REAL / INTEGER |
|---|---|---|
| finite `1.5` | returned as `1.5` | returned as `1.5` (SQLite affinity may keep REAL) |
| `NaN` | inserted as SQLite `NULL` | insert failed due to the `NOT NULL` constraint |
| `+Infinity` | returned as `+Infinity` | returned as `+Infinity` |
| `-Infinity` | returned as `-Infinity` | returned as `-Infinity` |
| `-0` | returned as positive `0` | returned as positive `0` |

This is an early stop signal, not a cross-platform conclusion. The path-scoped GitHub Actions workflow
records the authoritative Node 22 JSON for this repository as the seven-day
`sqlite-special-number-probe-node22` artifact.

## Interpretation

If the GitHub artifact confirms the preliminary observation, the current SQLite numeric columns cannot
support an exact claim for all raw JavaScript numeric evidence:

- `NaN` is either normalized to `NULL` or rejected by `NOT NULL`;
- the sign of `-0` is lost;
- infinities may survive, but that does not repair the two failing cases.

Therefore the logical bundle encoder is necessary but not sufficient for a lossless backup sourced from
the current database. A later production change must preserve the original provider value before SQLite
numeric normalization, for example by separating an exact raw token/payload from normalized numeric
columns used for filtering and mapping. That design requires its own schema migration, provenance rules,
and Android/Expo verification.

## Boundaries and next decision

This experiment does not:

- change the SQLite schema or migration version;
- modify provider validation or rejection behavior;
- change canonical map writes;
- alter the frozen S0 APK;
- claim Node `node:sqlite` and Expo SQLite are identical;
- decide the final raw-payload representation;
- measure raw-sample ordering.

Until the storage follow-up is complete, code and documentation must distinguish these two facts:

1. the logical bundle format can encode special JavaScript values exactly;
2. the current canonical SQLite store may already have normalized or rejected some original values.
