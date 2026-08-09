# Standalone Android PDR capture logger

This is an isolated research APK. It does not import the product app, mapping core/engine, database, renderer, or `TrackingProviderPort`, and it has no network permission.

## Docker build

No Windows npm, Gradle, Java, Python, or Android SDK installation is required.

```bash
docker compose -f research/pdr/android-capture/compose.yaml build
docker compose -f research/pdr/android-capture/compose.yaml run --rm android-capture-build
```

The debug APK is produced at:

```text
research/pdr/android-capture/app/build/outputs/apk/debug/app-debug.apk
```

## Capture behavior

- Runtime capability probe; raw accelerometer and gyroscope are mandatory.
- Optional uncalibrated IMU, magnetic, fused orientation, gravity/linear acceleration, step, pressure, and sparse GNSS streams are never assumed.
- 50/100 Hz live modes and 50/100 Hz with 250 ms maximum report latency.
- Foreground service plus an explicit optional partial wake lock for screen-off tests.
- Clean stop waits for Android FIFO-flush completion from every registered sensor; rejected or incomplete flushes are invalid evidence.
- App-private `.partial` directory while active; finalized `.complete` bundle after hashes and manifest are durable.
- Local Storage Access Framework ZIP export only.
- Sync marker records an evaluation diagnostic; it is not a map anchor or truth value.
- Program/revision, participant, device, placement, route, lifecycle, motion condition, mode, and requested optional inputs are frozen into start and final metadata.
- Periodic and event-driven diagnostics support screen/app intervals, notification return, battery eligibility, thermal severity time, and storage accounting.
- This APK revision exposes and accepts only `no-walking` and `stationary`; the foreground service rejects `walk` and `mixed` even if a crafted intent bypasses the UI.

## Offline validation

After exporting a ZIP, mount/copy it into the PDR Docker environment and run:

Store local exports under ignored `research/pdr/captures/` (and external truth
under ignored `research/pdr/truth/`); never add either to Git.

```bash
docker compose -f research/pdr/compose.yaml run --rm pdr-audit \
  python research/pdr/scripts/validate_capture_bundle.py /path/to/export.zip
```

Only an `outcome: usable` bundle may enter estimator replay. `diagnostic-only` and `invalid` bundles remain useful for logger/OEM failure analysis but may not be silently filtered out of Capture Usability Rate.

For a preregistered batch, copy and freeze the program template before any run,
then calculate all attempts including `.partial` failures and ZIP exports.
Duplicate exports of one session do not inflate the denominator; conflicting
copies invalidate that session:

```bash
docker compose -f research/pdr/compose.yaml run --rm pdr-audit \
  python research/pdr/scripts/summarize_capture_program.py \
  --plan /path/to/frozen-program.json \
  --capture-root /path/to/pdr-captures
```

## Explicit limitations

An emulator build/pass does not verify physical sensor fidelity, actual screen-off delivery, OEM power management, pocket handling, battery consumption, or estimator accuracy. The emulator artifact retains the ordinary physical-quality verdict; the separate E0 evaluator can accept only integrity-safe virtual-sensor timing deficiencies and explicitly marks the result as not product-usable, not physical evidence, and excluded from capture KPIs. Future walking cells in the plan are not executable by this APK revision; real-device walking remains gated by [`../ANDROID_CAPTURE_PROTOCOL.md`](../ANDROID_CAPTURE_PROTOCOL.md).

The Android 15 pre-device gate clean-installs the exact uploaded APK, verifies package/min/target SDK and permission surface, cold-starts the public activity, checks visible revision/IMU capability/C0-safe defaults, exercises optional-permission denial, notification, Home/screen-off/return, walking-request rejection, finalization, export ZIP equivalence, force-stop/relaunch persistence, and the crash buffer. Its `emulator-device-readiness.json` remains explicitly non-physical and outside K1/K2/K3. A failure artifact is a reason to repair the APK before asking for any real-device run.

Do not hand off the intermediate `pdr-capture-debug-apks` artifact. Only the post-gate `pdr-capture-emulator-qualified-c0-preflight` artifact is eligible for a later C0 preparation handoff, and only after the collection plan is separately authorized. It packages the exact tested APK with SHA-256, badging, permissions, and the readiness verdict so the installed revision can be checked before spending device-test time.
