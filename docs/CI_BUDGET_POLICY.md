# GitHub Actions budget policy

> Applies to humans, Codex, ChatGPT, and any other development agent.

## Purpose

Keep map-truth, mobile packaging, and Android user-flow evidence reliable while treating hosted Actions time as a finite shared resource. Local checks are the iterative feedback loop. GitHub Actions validates one reviewed pull-request head and bounded scheduled backstops.

## Mandatory agent workflow

1. Keep every pull request in Draft during implementation, review fixes, formatting, and local test iteration.
2. Do not push solely to obtain CI feedback. Group related changes and push the reviewed head once.
3. Before marking ready, run `npm run check`. For mobile or adapter changes also run `npm run mobile:check` when the local environment supports it.
4. Do not request an unchanged rerun. Reproduce product failures locally and push one consolidated correction.
5. Rerun only a failed job when logs show a concrete runner, network, cache, registry, Android SDK, or other upstream failure; record that evidence in the pull request.
6. Do not manually expand to APK, emulator, benchmark, fixture, or full validation merely for reassurance.

## CI lane ownership

- Mapping package tests, architecture boundaries, product governance, and mobile static checks are the ordinary ready-PR gates.
- Docker mobile validation runs only for Docker/dev-environment and its owning script changes.
- Field-test APK validation runs for mobile application, native packaging, SQLite adapter, dependency, and field-test build changes.
- Android emulator validation runs for mobile runtime, native, permission, tracking, storage, diagnostic, or emulator/USB harness changes.
- Pure `mapping-core`, `mapping-engine`, or `experience-sdk` changes do not build an APK merely because the mobile app consumes those packages; static integration tests and the bounded scheduled Android run are the backstop.
- Benchmark and generated-fixture workflows run only on a non-Draft relevant pull request or explicit manual execution.
- The weekly DevEx run exercises Docker, APK, and emulator paths to detect classifier omissions.
- The Field-test APK contains only `arm64-v8a` and `x86_64` in CI: current physical Android devices and the CI emulator. Do not restore four-ABI compilation without an explicit supported-device requirement.

## Fail-closed rules

Workflow, classifier, package/dependency, native build, and CI policy changes must select the expensive validation they can affect. A classifier error fails its workflow instead of silently skipping a lane. Superseded runs must cancel.

Do not add another operating system, Android API matrix, ABI, recurring workflow, artifact, or long-lived upload without a concrete product risk, measured cost, retention boundary, and repository-owner approval.

## Pull-request evidence

The final PR description records:

- local checks run on the final head;
- selected CI lanes and why they are relevant;
- any local limitation;
- evidence justifying a manual or repeated Actions execution.
