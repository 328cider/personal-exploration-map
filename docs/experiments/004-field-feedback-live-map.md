# Experiment 004: first field feedback — resilient end and map growth

Status: active
Date: 2026-08-08

## Observation

The first Android field-test produced two high-priority findings.

1. `探索を終了` surfaced an error and the user could not finish the exploration.
2. Hiding the map until the end removed the core pleasure of seeing unknown space become a personal map.

The user also correctly challenged whether a thin GNSS polyline is meaningfully different from a generic location-history timeline.

## Product interpretation

Passive-first does **not** mean map-invisible.

The normal state remains screen-off and pocketed, but whenever the user intentionally opens the app, a read-only preview should show the PersonalMap growing. Rendering must pause while the app is backgrounded and must not create a reason to stare at the screen continuously.

A GNSS-only thin line is an M0 transport mechanism, not the final differentiator. The differentiating map must evolve toward:

- explored-space / uncertainty representation rather than false precision;
- multiple independent ExplorationSessions growing one PersonalMap;
- confirmed discoveries and user meaning;
- optional supporting basemap that never becomes canonical truth;
- later GNSS/PDR/anchor fusion for GPS-poor spaces, gated by evidence.

## Immediate fixes

- Exploration completion must not be blocked by an operational provider-stop failure.
- Stop failure remains a diagnostic warning, while canonical evidence is finalized.
- The recording screen receives a foreground-only periodic PersonalMap preview.
- Preview refreshes when the app returns to foreground and at a conservative interval while visible.

## Next product experiment

After the completion bug and live preview are fixed, implement and compare a coverage-first rendering prototype:

- canonical accepted track remains unchanged;
- renderer derives a translucent explored corridor/cell layer using recorded accuracy;
- low-confidence areas look uncertain rather than like exact roads;
- no basemap matching or invented road geometry;
- compare recognition and perceived differentiation against the thin-line version.

## Success criteria

- A user can always leave recording mode without losing evidence, even if provider shutdown fails.
- Opening the app during exploration visibly shows progress within about 10 seconds.
- Screen-off recording remains the default and incurs no live-render polling.
- Users describe the result as a growing explored map, not merely a GPS history line.
