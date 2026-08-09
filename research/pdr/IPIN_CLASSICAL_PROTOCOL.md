# IPIN 2022 Android-raw classical replay protocol

Status: preregistered on 2026-08-09 before opening any selected raw log member.

## Answer first

This experiment asks one bounded question: can a CC BY 4.0 IPIN 2022 Android
raw stream be parsed into the existing `NormalizedSensorSession` contract and
replayed causally at 50/100 Hz without platform AHRS, position truth, future
samples, or callback-batch dependence?

It does **not** ask whether the output heading, distance, or path is accurate.
The archive does not supply dense body-heading or velocity truth for these
training logs. A plausible-looking trajectory cannot pass an accuracy or product
gate.

## Product and implementation boundary

- User problem: reduce uncertainty about whether the public-data capture and
  replay pipeline can consume values a future Android logger can actually emit.
- Passive-first UX: zero user interaction and zero field-test time.
- Map layer: ignored raw evidence is read; aggregate diagnostics and disposable
  estimator output are derived. No canonical map or accepted track is written.
- Canonical writer/application boundary: none is called or changed.
- Ownership: adapter and analysis remain under `research/pdr/`; product core,
  engine, adapters, renderer, game, DB, and `TrackingProviderPort` are unchanged.
- Build / Adopt / Benchmark: adopt the official IPIN parser/schema and existing
  frozen B1 implementation; build only a bounded adapter and aggregate QA.
- Mapping without game: unchanged; this experiment has no game dependency.
- Privacy/safety: public CC BY 4.0 logs only, no personal capture, no outbound
  sharing of raw rows, and no raw path committed to Git.
- Success: pipeline compatibility only. It cannot authorize product adoption or
  a walking pilot.
- Stop/rollback: missing raw IMU, unrecoverable timestamp semantics, label/input
  leakage, noncausal output, or nonfinite replay stops this source. Research
  files can be removed without a product migration.
- Constitution: raw evidence remains separate from derived output, uncertainty
  and gaps remain visible, and no cloud/map dependency or canonical mutation is
  introduced.

## Frozen artifact and selected members

- Record: Zenodo `7612915`.
- Archive: `2022_IPIN_Competition_Track03.zip`.
- Archive size: `444265064` bytes.
- Archive MD5 recorded by Zenodo: `5b2876681bb7855e0f562ec2ab4510c1`.
- License: CC BY 4.0.
- Official parser SHA-256:
  `e0b41d486f8721d0e624d0f6fbe65d8dedc0ce58433b70df6b0b005ef626855e`.
- Training inventory: 89 members / nine user identifiers, established from the
  ZIP central directory without opening a raw member.

The four selected members form a fixed two-user by two-trial matrix. User 03 is
development-only; User 05 remains unopened until the adapter, algorithm, and
development report are frozen in a separate commit.

| Role | Member | Uncompressed bytes | Compressed bytes | CRC32 |
|---|---|---:|---:|---|
| development | `IPIN2022_T3_TrainingTrial12_User03.txt` | 5,446,160 | 1,588,575 | `29e5bdd2` |
| development | `IPIN2022_T3_TrainingTrial13_User03.txt` | 5,443,237 | 1,641,006 | `a898667e` |
| untouched validation | `IPIN2022_T3_TrainingTrial12_User05.txt` | 2,630,710 | 623,160 | `172a4638` |
| untouched validation | `IPIN2022_T3_TrainingTrial13_User05.txt` | 2,407,239 | 611,307 | `28e93e74` |

Selection is deterministic and deliberately small: the same two trials for one
development and one held-out user, with about 4.46 MB compressed total. Two
users do not establish population, device, or placement generalization.

## Frozen field roles

| IPIN record/column | Role in this experiment | Android equivalent / rule |
|---|---|---|
| `ACCE`; SensorTimestamp; xyz; accuracy | live input | `Sensor.TYPE_ACCELEROMETER`, `SensorEvent.timestamp`, values, accuracy |
| `GYRO`; SensorTimestamp; xyz; accuracy | live input | `Sensor.TYPE_GYROSCOPE`, `SensorEvent.timestamp`, values, accuracy |
| `MAGN`; SensorTimestamp; xyz; accuracy | diagnostic optional input | `Sensor.TYPE_MAGNETIC_FIELD`; quality only, never heading |
| AppTimestamp | lifecycle/callback proxy | preserved separately; not estimator time and not claimed to be an actual callback-clock capture |
| `AHRS` | forbidden | platform-corrected orientation is not passed to the estimator |
| `POSI` | evaluation-only | sparse position marks; never input and no dense accuracy claim |
| `GNSS` | evaluation-only in this experiment | bearing is movement direction, not body/phone heading |
| `IMUL` / `IMUX` | forbidden | external/reference IMU, not normally carried-phone product input |
| Wi-Fi, BLE, RFID, maps | forbidden | existing infrastructure/map dependencies are outside the frozen contract |

Only ordinary Android accelerometer/gyroscope data are required. Magnetometer
may be retained as a quality diagnostic but the B1 `imu6` output must be exactly
unchanged when it is removed.

## Acquisition and provenance

1. Use verified HTTP Range reads against the Zenodo archive; never download the
   444 MB archive as a whole.
2. Extract only the member assigned to the current phase into ignored
   `research/pdr/data/ipin2022/` storage.
3. Verify central-directory size and CRC during extraction and save a SHA-256 in
   the aggregate manifest.
4. Commit no raw row, archive, derived row-level data, model, or credential.
5. Emit only counts, timestamp/rate quantiles, gap counts, value summaries,
   estimator aggregates, hashes, and failure flags.

## Frozen adapter

- Parse semicolon-delimited `ACCE`, `GYRO`, and `MAGN` rows with exactly two
  timestamps, three SI values, and integer accuracy.
- Retain line order for provenance and reject malformed/nonfinite eligible rows.
- Use SensorTimestamp as the estimator time basis. Convert to integer
  nanoseconds relative to the earliest eligible sensor timestamp without
  changing deltas.
- Preserve AppTimestamp relative to its own session origin as the callback proxy;
  do not infer real callback latency from the cross-clock offset.
- Segment/report nonpositive deltas and gaps; never repair time by wall clock.
- Create causal 50 and 100 Hz buckets. Average continuous IMU values within a
  closed bucket, use the last eligible timestamp/callback proxy, and never
  interpolate an empty bucket or future value.
- Keep source member path, size, CRC, SHA-256, parser hash, adapter version, and
  all excluded record types in provenance.

## Frozen estimator and comparisons

No parameter search is allowed.

- Estimator: existing B1 `imu6` only.
- Step detector: `rs25-a010-p025-r025`, already frozen on RoNIN.
- Weinberg gain: `0.64`.
- Fallback stride: `0.66 m`.
- Heading: causal integration of device gyro z, relative to zero.
- Magnetometer: quality flag only; never corrects heading.
- Modes not run: B0, platform-fused B1, learned heading, direct recurrent heading,
  offline smoother, supplied competition solution.

The B1 path is a diagnostic signal. Device gyro-z heading is not pedestrian body
heading under arbitrary placement.

## Metrics and gates

### Raw compatibility gate, per selected member

- eligible malformed or nonfinite rows: exactly zero;
- `ACCE` and `GYRO`: nonempty and at least 30 seconds of common coverage;
- positive SensorTimestamp deltas: 100%;
- median `ACCE` and `GYRO` rate: between 40 and 120 Hz;
- median accelerometer norm: between 5 and 15 `m/s^2`;
- all gaps over 200 ms are counted and create explicit segment/uncertainty
  diagnostics rather than being silently filled;
- AppTimestamp and SensorTimestamp statistics are reported separately;
- `AHRS`, `POSI`, `GNSS`, `IMUL`, and `IMUX` appear in no inference feature list.

### 50/100 Hz replay gate, per member

- future-sample violations: zero;
- nonfinite estimate values: zero;
- rate-stable step-count relative difference: at most 2%;
- rate-stable amplitude-quarter-power relative difference: at most 3%;
- derived travelled-distance relative difference: at most 3%;
- 50/100 endpoint separation divided by the longer travelled distance: at most
  5% (self-consistency only, not endpoint truth);
- replacing callback timestamps/batch IDs while preserving sensor timestamps
  changes no estimator point;
- removing magnetometer changes no B1 estimator point.

### Deterministic gap stress

Remove eligible samples from a 600 ms interval centered at 50% of common IMU
coverage. The replay must remain finite and causal, register an additional gap,
and end with uncertainty no lower than the unperturbed run. No accuracy or path
similarity threshold is attached to this destructive stress.

## Frozen decision labels

- `pipeline-compatible`: every raw and replay gate passes on both untouched
  validation members. Meaning is limited to this parser/replay contract.
- `narrow-pipeline-only`: rows parse, but one or more robustness/rate gates fail;
  document the failure and do not tune on validation.
- `stop-source`: eligible raw semantics cannot be recovered without guessing,
  label leakage occurs, or output is noncausal/nonfinite.

Even `pipeline-compatible` leaves product adoption, accuracy, Android lifecycle,
capture specification, and personal pilot at Stop.

## Execution order

1. Commit this protocol and the machine-readable preregistration.
2. Range-fetch only the two User 03 development members.
3. implement/test the parser, adapter, and aggregate analysis; record development
   results without changing gates or parameters.
4. Commit the adapter and frozen development result while User 05 remains
   unfetched.
5. Range-fetch both User 05 members together and run once.
6. Publish aggregate validation, independent QA, deterministic notebook, and the
   bounded decision. Validation cannot trigger tuning.
