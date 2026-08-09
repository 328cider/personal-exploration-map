# IPIN 2022 classical Android-input replay result

Date: 2026-08-09

## Answer first

The preregistered replay is **pipeline-compatible on the four selected IPIN
2022 sequences**. Both User03 development sequences and both untouched User05
validation sequences passed every raw-input and replay gate with the frozen B1
configuration. The validation maximum disagreements between 50 and 100 Hz were
0.855% for step count, 0.808% for the step-amplitude score, 0.850% for derived
travelled distance, and 1.159% for endpoint separation relative to the longer
derived distance.

This is **not a heading, distance, endpoint, Android-lifecycle, or product
accuracy result**. No continuous trajectory or body-heading target was loaded.
The derived distances and endpoints below are pipeline diagnostics with no
truth comparison. Product adoption and a personal walking pilot remain Stop.

## Frozen execution control

- The four archive members, User03/User05 split, estimator, detector, stride
  gain, rates, and thresholds were registered in
  `IPIN_CLASSICAL_PROTOCOL.md` before any selected raw member was opened.
- Development used two User03 sequences. Its implementation and output were
  frozen in commit `ab709181b81a343cdf5feb7ad9fbfea1bbb546e5` before validation
  data was fetched.
- Validation used two different-user User05 sequences, was run once, and did
  not trigger a parameter change.
- Only `ACCE`, `GYRO`, and optional `MAGN` rows were admitted. `AHRS`, `POSI`,
  GNSS, radio observations, maps, completed path shape, and future samples were
  excluded from inference.
- Ground-truth rows loaded, platform-AHRS rows used, and model weights loaded
  were all zero.

The selected members were extracted with HTTP Range requests. The two phases
transferred 6,383,308 bytes against a 444,265,064-byte archive and did not
download the full archive. Raw members, detailed outputs, and QA outputs remain
ignored outside Git; their hashes are frozen in
`datasets/manifests/ipin-classical-result-v1.json`.

## Dataset and grain

The unit of evaluation is one complete preregistered IPIN sequence, never an
overlapping window. Four sequences contain 169,280 eligible raw sensor rows and
15,927,346 uncompressed source bytes. Development and validation users are
disjoint.

| Phase | Sequence | Eligible rows | Common IMU coverage | Raw ACC/GYRO rate | Magnetometer |
|---|---|---:|---:|---:|---|
| development | `trial12-user03` | 46,910 | 188.958 s | 99.010 Hz | present, 49.751 Hz |
| development | `trial13-user03` | 49,824 | 200.691 s | 99.010 Hz | present, 49.751 Hz |
| untouched validation | `trial12-user05` | 35,239 | 176.689 s | 100.000 Hz | absent |
| untouched validation | `trial13-user05` | 37,307 | 187.054 s | 100.000 Hz | absent |

All four sequences had strictly increasing required sensor timestamps, median
accelerometer norm within the preregistered 5-15 m/s² plausibility band, at
least 30 seconds of common IMU coverage, and zero raw accelerometer/gyroscope
gaps over 200 ms. The absence of `MAGN` in both untouched sequences is useful:
the required profile is genuinely accelerometer + gyroscope, rather than an
accidental magnetometer dependency.

## Replay results

| Sequence | Steps 50/100 Hz | Step diff | Amplitude diff | Derived-distance diff | Endpoint ratio |
|---|---:|---:|---:|---:|---:|
| `trial12-user03` | 266 / 264 | 0.752% | 0.245% | 0.243% | 0.608% |
| `trial13-user03` | 255 / 255 | 0.000% | 0.196% | 0.195% | 1.443% |
| `trial12-user05` | 234 / 232 | 0.855% | 0.808% | 0.850% | 1.159% |
| `trial13-user05` | 242 / 243 | 0.412% | 0.279% | 0.319% | 0.538% |

Across the eight sequence/rate replays:

- callback batching changed zero estimator outputs;
- removing the magnetometer changed zero estimator outputs;
- every injected 600 ms gap was registered and did not lower terminal
  uncertainty;
- all stressed outputs stayed finite and causal; and
- future-sample violations were zero.

The independent standard-library validator recomputed the input gates, rate
ratios, endpoint separation, robustness gates, source hashes, frozen code
hashes, split, acquisition accounting, aggregate manifest, and notebook hash.
It passed 378 assertions. The aggregate-only notebook executed top-to-bottom
with all four code cells completed and no errors.

## Android capture implication

This result narrows the reusable capture/replay contract to:

- required raw `Sensor.TYPE_ACCELEROMETER` and `Sensor.TYPE_GYROSCOPE`;
- optional `Sensor.TYPE_MAGNETIC_FIELD` that cannot be assumed present;
- original sensor timestamps as the estimator time basis;
- a 50 or 100 Hz processing target; and
- explicit batch and gap preservation with visible uncertainty response.

It does not validate a real callback monotonic clock. IPIN `AppTimestamp` is
only aligned as a diagnostic proxy. It also does not validate screen-off
collection, foreground-service behavior, permissions, FIFO behavior, OEM power
policy, battery, thermal behavior, or pocket UX.

## Validation assessment

**Ready to share with caveats for capture/evaluation-pipeline design.** The
frozen method, different-user holdout, source provenance, calculations, and
claim boundary are independently verified. It is **not ready to support an
accuracy, product, or pilot decision**, because the source has no continuous
target truth for the quantities being estimated and supplies no real Android
lifecycle evidence.

The next accuracy step is unchanged: wait for a rights-compatible source with
continuous independent target truth, or an explicitly approved multi-user,
multi-device, multi-placement capture program. Another sweep over these IPIN
sequences would only optimize self-consistency and cannot answer accuracy.

## Reproduction artifacts

- Protocol: `IPIN_CLASSICAL_PROTOCOL.md`
- Preregistration: `datasets/manifests/ipin-classical-preregistration-v1.json`
- Development freeze: `datasets/manifests/ipin-classical-development-v1.json`
- Final aggregate manifest: `datasets/manifests/ipin-classical-result-v1.json`
- Parser and normalizer: `pdr_research/ipin.py`
- Frozen analysis: `scripts/analyze_ipin_classical.py`
- Independent QA: `scripts/validate_ipin_classical.py`
- Executed aggregate notebook: `notebooks/12_ipin_classical_replay.ipynb`

All executable checks run in the existing research Docker image. No Windows
npm, Node, Python package, raw dataset, or model-weight installation is needed.
