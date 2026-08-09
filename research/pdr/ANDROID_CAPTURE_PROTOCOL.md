# Android PDR capture protocol v1

Status: implementation contract, 2026-08-09
Target: standalone research APK under `research/pdr/android-capture/`

## User problem and constitutional fit

The research needs raw evidence that future Android devices can actually collect while the user walks with the phone put away. The logger records evidence only; it does not draw a map, mutate `PersonalMap`, call `TrackingProviderPort`, or make a PDR accuracy claim. It preserves the one-pass, passive-first, raw-evidence, uncertainty, frame, and local-first invariants. Games and renderers are absent.

Research-only interaction consists of entering pseudonymous run metadata, starting/stopping a run, and optionally creating synchronization markers for an external truth system. This interaction is not evidence that the final product UX is acceptable.

## Build / Adopt / Benchmark decision

| Capability | Decision | Reason |
|---|---|---|
| Sensor access and metadata | Adopt Android `SensorManager`, `Sensor`, `SensorEvent` | Platform is the source of truth for availability, timestamps, units, FIFO, rate, wake-up, and reporting mode |
| Continuous screen-off execution | Build a thin Kotlin foreground-service research adapter | Android 9+ suppresses continuous sensor events for ordinary background apps |
| Foreground-service classification | `specialUse`, plus `location` only when GNSS is enabled | Raw research motion capture has no more specific permission-free type; subtype is declared and actual Play use would require review |
| Optional location | Adopt `LocationManager` / `Location` | Avoids a Google Play Services requirement and preserves availability flags and monotonic time |
| Log serialization | Build small JSONL writer using platform `org.json` | Inspectable, dependency-free, streamable, and adequate before product schema adoption |
| File integrity/export | Adopt SHA-256, ZIP, app-private storage, and Storage Access Framework | Standard, local-only, no backend or account needed |
| Capture QA | Build research-only Python validator | Product code must not decide research evidence validity |
| PDR estimator | Benchmark offline only | No surviving accuracy candidate and no compatible continuous-truth training source |

The APK intentionally declares no `INTERNET` and no `HIGH_SAMPLING_RATE_SENSORS` permission.

## Supported Android inputs

All availability is probed at runtime. Only accelerometer and gyroscope are mandatory.

| Sensor / source | Requested behavior | Role |
|---|---|---|
| `TYPE_ACCELEROMETER` | 50 or 100 Hz; SI m/s²; raw device axes | mandatory live input |
| `TYPE_GYROSCOPE` | 50 or 100 Hz; SI rad/s; raw device axes | mandatory live input |
| uncalibrated accelerometer/gyro | same request when present; includes platform-defined bias values | optional live input |
| magnetic / uncalibrated magnetic | requested when present; never trusted as heading without an offline quality gate | optional live input |
| rotation vector / game rotation vector | requested when present; device/platform fused and never mandatory | optional live input |
| gravity / linear acceleration | requested when present; derived platform channels kept distinguishable from raw | optional live input |
| step detector / counter | enabled only with `ACTIVITY_RECOGNITION` on Android 10+ | optional live input |
| pressure | 5 Hz request when present | optional live input |
| `Location` | 1 Hz GPS-provider request after explicit location permission | optional sparse anchor; bearing is travel direction |

The logger records the requested period and maximum report latency but never claims the device delivered that rate. Version 1 modes are:

- `live-50`: 20,000 µs sensor period, 0 µs maximum report latency.
- `live-100`: 10,000 µs, 0 µs latency.
- `batch-50-250`: 20,000 µs, 250,000 µs latency.
- `batch-100-250`: 10,000 µs, 250,000 µs latency.

No method requiring >200 Hz is eligible. The shared replay floor remains 50 Hz.

## Time contract

- `SensorEvent.timestamp` is the estimator time for sensor events.
- `Location.getElapsedRealtimeNanos()` is the estimator time for locations.
- `SystemClock.elapsedRealtimeNanos()` is captured at each callback for delivery diagnostics.
- Wall time is provenance/display only and cannot order estimator samples.
- Times are comparable only within the same device boot. A reboot or impossible clock relation invalidates the session.
- The logger does not create a synthetic batch ID. Offline QA infers callback clustering from delivery timestamps.

## Bundle contract

An active session is stored as `<session-id>.partial` in app-private storage. A clean stop closes all writers, calculates SHA-256 and byte counts, writes `session_manifest.json`, creates `COMPLETED`, and atomically renames the directory to `<session-id>.complete`. Interrupted `.partial` directories remain visible as failed attempts.

Before finalization, the service calls the platform FIFO flush once for all registered sensors, continues accepting callbacks, waits for `onFlushCompleted` for every registered sensor, unregisters listeners, drains both sensor and main callback queues, and only then closes the writer. A rejected/timed-out flush or callback-drain timeout makes the finalized attempt invalid; it cannot be reported as a clean complete run.

```text
<session-id>.complete/
  session_start.json
  capabilities-00000.jsonl
  sensor_events-00000.jsonl
  sensor_events-00001.jsonl       # rotated at 32 MiB when needed
  location_events-00000.jsonl     # only when enabled and permitted
  diagnostic_events-00000.jsonl
  session_manifest.json
  COMPLETED
```

Every non-final file is listed in the manifest with stream, records, bytes, and SHA-256. JSONL is UTF-8, one object per line, schema `pdr-capture/v1`. The authoritative per-field Android API, role, unit, and required state is [`capture-schema/v1/field-contract.json`](capture-schema/v1/field-contract.json).
The exact `SensorEvent.values` index layout, unit, and variable-length rule for
every requested sensor is frozen in
[`capture-schema/v1/sensor-value-layouts.json`](capture-schema/v1/sensor-value-layouts.json).

## Provenance and grouping

Before start, the run freezes:

- random session UUID;
- capture-program ID and positive revision;
- app-local random device pseudonym (never Android ID, serial, IMEI, account, or advertising ID);
- pseudonymous participant code;
- placement enum: `front-left`, `front-right`, `rear-left`, `rear-right`, `hand`, `bag`, `other-declared`;
- route/protocol cell ID and planned duration;
- declared lifecycle protocol and motion condition, both checked against observed diagnostic intervals;
- split assignment: `development`, `tuning`, or `sealed-validation` from a prewritten ledger;
- APK version/research revision/build type, Android API/release, manufacturer/model, and build fingerprint;
- permission states and requested capture mode;
- sensor capability metadata.

Participant, device, placement, route, and session are indivisible split keys. The same person or device cannot enter both development and sealed validation merely under a new run ID.

Program aggregation does not trust a cell ID by itself. A run counts only when all frozen dimensions match and its observed duration is at least 95% of plan; screen-on/off, app-background, and notification-return cells also need their preregistered minimum state duration. The KPI output records the SHA-256 of the exact plan file and stage-level readiness.

The v1 APK deliberately creates `development` runs only. It cannot manually
label a run as tuning or sealed validation. Those modes require a future import
of a frozen, machine-validated program plan so an operator cannot relabel a run
after seeing it.

This APK revision also exposes and accepts only `no-walking` and `stationary`
motion conditions. `walk` and `mixed` remain schema values solely so a future,
separately reviewed APK can execute the preregistered C1/C2 cells without
changing historical records. Both the UI and foreground service reject those
conditions in the current revision.

## Diagnostics kept separate from map truth

Diagnostic events include service start/stop, screen interactive/non-interactive, activity visible/hidden and notification source, sensor registration result, FIFO flush request and `onFlushCompleted`, permission state/change, writer queue drops/errors, periodic battery state, Android thermal status snapshots and change callbacks, free storage, location provider state, user stop, process/task removal, and operator sync marker. They explain delivery and lifecycle only.

The validator derives evidence bytes, storage delta, battery start/end, battery percentage-points/hour eligibility, maximum battery temperature, and time in `THERMAL_STATUS_SEVERE` or worse. A battery rate is deliberately absent unless at least 30 minutes of unplugged matched snapshots exist.

## Ground truth and synchronization

The Android bundle contains **no ground-truth fields**. A future accuracy study stores truth in a separately permissioned sidecar keyed by session and timestamp. Accepted truth sources are external motion capture, a separately logged high-grade reference, or a surveyed route whose limited accuracy claim is explicit. Tango/ARCore/VIO, known route, body heading, stride, floor, and turn labels are evaluation/training-only.

Before and after an externally tracked run, the operator creates a sync marker and performs a distinctive stationary three-axis motion visible to both systems. Clock offset/drift, matched markers, residual synchronization error, and truth-system accuracy are recorded in the sidecar. Alignment may be used for evaluation; it cannot transform live inputs or leak validation trajectories into preprocessing.

Known-path-only truth can evaluate endpoint, distance, discrete turns, topology, and loop closure. It cannot support continuous ATE/heading claims. A continuous claim requires timestamped continuous reference with declared uncertainty.

## Preregistered collection stages

### E0 — no-walking emulator and synthetic injection

- Clean install, capability view, required-sensor-missing outcome, start/stop/finalize/export.
- 50/100 Hz modes, optional-permission denied paths, screen-off/home/return, notification stop, process interruption, and low-storage/writer-failure fixtures.
- Validate the exact exported bundle with the same capture-quality validator used for physical runs.
- Exercise a batched mode in Android 15 CI so the asynchronous FIFO-flush path is not covered only by mocks.
- The normal physical verdict is never overridden. A separate E0 plumbing gate may tolerate only the virtual sensor's `continuity-gap` and `insufficient-imu-coverage` findings when integrity is 100%, writer drops are zero, both mandatory streams sustain at least 45 Hz for 10 seconds, median intervals are at most 25 ms, and no mandatory gap reaches one second.
- An E0 plumbing pass records `product_usable: false`, `counts_toward_capture_kpis: false`, and `physical_sensor_evidence: false` whenever the ordinary validator rejects virtual-sensor timing.
- Passing E0 is not real sensor, screen-off, battery, OEM, pocket, K1/K2, or estimator evidence.

### C0 — real-device capability probe, no walking

- Enumerate all sensors, FIFO/rate/wake-up metadata and permission states.
- Run 2 minutes stationary screen-on and 5 minutes stationary screen-off at live-50 and live-100.
- Reject devices missing accel/gyro. Record optional-sensor absence without downgrading the minimum pipeline.
- Do not ask the user to walk until C0 bundles pass integrity and continuity QA.

The machine template expands these into four separate C0 cells: screen-on live-50/live-100 and screen-off live-50/live-100. It also preregisters four E0 rate/batch cells and future C1 transition, live, batch, and notification-return cells. The current APK cannot execute the C1 walking cells. The checked-in template remains explicitly unauthorized and has rights flags false for personal cells.

### C1 — minimum one-person operational pilot

Only after E0 and C0 pass, collect the same raw session for all offline estimators:

1. 10 minutes live-100, screen-on then screen-off transition.
2. 15 minutes live-100, screen-off pocket walk.
3. 15 minutes batch-100-250, same placement and comparable route.
4. 30 minutes screen-off lifecycle run including notification return; optional if the first three reveal a Stop failure.

This pilot measures capture/domain/resource behavior only. It cannot yield a broad Go.

### C2 — multi-user/device/placement accuracy program

Requires a new preregistration, participant consent, retention policy, external truth contract, and rights for research/model-derived artifacts. Use a grouped, balanced design; do not let prolific participants dominate.

- Development: at least 12 participants, 6 device models across at least 3 vendors and price tiers, four pocket placements balanced, two route families, and repeated runs.
- Sealed Narrow validation: at least 30 independent sessions across at least 10 unseen participants and 4 device models, including device models absent from development where feasible.
- Broad Go validation: at least 150 independent sessions, at least 30 unseen participants, 6 device models, every supported placement/lifecycle cell, and user-clustered uncertainty intervals.
- Freeze the estimator and preprocessing before sealed validation. Replay identical logs across all methods.

## Privacy, retention, and export

- App-private storage is the default; export requires an explicit Storage Access Framework destination.
- No network permission, cloud sync, analytics SDK, account, advertising ID, or hardware identifier.
- GNSS is off by default and its presence is visible in the run configuration.
- Exported bundles use pseudonyms. The participant-code key and consent ledger live outside Git and outside the capture bundle.
- Raw personal bundles, truth sidecars, model weights, and precise paths are ignored by Git. Keep only aggregate, non-identifying QA summaries.
- The capture program must choose a deletion deadline before C2. Until then, do not begin C2.

## Acceptance and stop conditions

The implementation is desk-ready when the standalone APK builds in Docker, unit tests pass, a no-walking emulator flow completes capture/FIFO flush/finalization/extraction, the ordinary Python validator emits its unmodified physical-quality verdict, the separate E0 plumbing gate accepts no finding beyond its narrow virtual-timing allowance, malformed/incomplete/leaking fixtures are rejected, and the app never imports product/core packages.

Stop or redesign before personal walking if the emulator/capability probe cannot distinguish unsupported devices, any raw record can be silently dropped, incomplete sessions disappear, local export cannot be verified, or the service cannot maintain the declared foreground lifecycle. Stop the estimator program if a suitable independent truth/rights design is unavailable; more tuning on label-poor public data is not a substitute.

## Android primary sources

- [Sensors overview and background restrictions](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)
- [Motion sensors and step permission](https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion)
- [SensorEvent reference](https://developer.android.com/reference/android/hardware/SensorEvent)
- [SensorManager FIFO flush](https://developer.android.com/reference/android/hardware/SensorManager#flush%28android.hardware.SensorEventListener%29)
- [Thermal status listener](https://developer.android.com/reference/android/os/PowerManager.OnThermalStatusChangedListener)
- [Android 9 sensor restrictions](https://developer.android.com/about/versions/pie/android-9.0-changes-all)
- [Foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Foreground-service start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Location reference](https://developer.android.com/reference/android/location/Location)
