## Summary

<!-- What changed, why, and which Issue does this address? -->

## User problem and value

<!-- Describe the real exploration situation. Avoid describing only implementation work. -->

## Product-constitution review

### Constitution alignment

- [ ] I read `PRODUCT_CONSTITUTION.md` before implementing this change.
- [ ] This PR does not silently redefine the product purpose or durable invariants.
- [ ] `CURRENT_DIRECTION.md` was treated as a short-term plan, not as permission to override the constitution.

Relevant invariant(s) and rationale:

<!-- Cite the relevant sections and explain any tension. -->

### Passive-first UX

- [ ] The normal exploration flow can still work without continuous screen attention or a continuously raised camera.
- [ ] Any new interaction and its interruption time are described below.

Added or changed user actions:

<!-- Start → pocket → optional discovery → end → review. Include approximate taps/time. -->

### Map truth

Primary layer changed:

- [ ] Raw evidence
- [ ] Accepted / rejected quality decision
- [ ] Derived personal map
- [ ] Manual correction or anchor
- [ ] Optional inference
- [ ] Game / presentation overlay only

Observed, derived, manually confirmed, and inferred information remain distinguishable because:

<!-- Explain uncertainty, gaps, and provenance. -->

### Map-write authority

- [ ] Canonical map writes pass through an explicit controlled application boundary.
- [ ] UI, renderer, game, and experience code do not directly mutate canonical domain state.
- [ ] A game-initiated real-map correction requires user confirmation before becoming an explicit map command, or is not applicable.

Canonical writer and command / boundary used:

<!-- Name the responsible application boundary and explain any exception. Do not justify placement only by predicted reuse. -->

### Build / Adopt / Benchmark

Existing apps, OSS, standards, platform APIs, and research checked:

<!-- Name them, include license implications, and explain Adopt / Build / Benchmark. -->

- [ ] This PR does not reimplement a commodity capability without a documented reason.
- [ ] New dependencies are justified by current measured need, not only possible future use.

### Replaceable game layer

- [ ] Mapping remains usable with Fog, achievements, stories, collection, and other game layers disabled.
- [ ] Game or presentation code has read-only access to canonical map state and cannot modify raw evidence or core acceptance decisions.

### Privacy and safety

- [ ] Location-history ownership, storage, deletion, export, and sharing impact were considered.
- [ ] The UX does not encourage prolonged walking-screen attention or unsafe exploration incentives.
- [ ] Cloud, account, analytics, or sharing changes include explicit consent and threat-impact analysis, or are not applicable.

## Validation

<!-- Tests, device conditions, experiment metrics, screenshots, and known limits. -->

- [ ] `node scripts/check-product-governance.mjs`
- [ ] `node scripts/check-architecture-boundaries.mjs`
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] Mobile changes include applicable real-device evidence, or explain why not yet available.

Success criteria:

Failure / Narrow / Stop / rollback criteria:

## Constitution change

- [ ] This PR does **not** change `PRODUCT_CONSTITUTION.md`.

If unchecked, all of the following are mandatory:

- owner-approved dedicated Issue:
- Build / Buy re-evaluation:
- new ADR:
- migration impact:
- related templates and governance checks updated:

## Out of scope

<!-- Explicitly list work intentionally deferred, especially game features, cloud, PDR, and speculative infrastructure. -->
