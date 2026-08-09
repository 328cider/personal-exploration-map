# Android heading convention and stride-gain diagnostic

- Date: 2026-08-09
- Dataset: official RoNIN unseen-subject sequence `a054_1`
- Estimator: B1 v1.1.0 and versioned stride-gain variants
- Evidence scope: benchmark diagnostic only
- Product integration: none

## Answer first

Correcting the quaternion conversion to Android's actual azimuth convention is
necessary, but it does not make device orientation a usable body-heading
estimate. Platform-fused heading MAE falls from the prior convention's roughly
76 degrees to about 66.5–66.8 degrees, while the reconstructed path remains
mirrored and turn MAE worsens to 58.9–60.4 degrees. Device orientation must not
be presented as body heading.

Distance is highly sensitive to the uncalibrated Weinberg coefficient. On this
single sequence, predeclared `K=0.364` reduces distance-scale error from
49.6–60.8% to 6.7–13.3%, but it may not be selected from this test sequence.
Published work treats `K` as empirical and dependent on person, speed, and
carrying mode. The result narrows the problem to calibration and rate-stable
step detection; it is not a product Go and does not authorize a personal pilot.

## Coordinate convention audit

Android's official `SensorManager.getOrientation()` source computes 3x3-matrix
azimuth as `atan2(R[1], R[4])`. Android defines azimuth relative to the device Y
axis and north, whereas this research frame uses mathematical heading with zero
on +X. B1 v1.1.0 therefore applies:

```text
android_azimuth = atan2(R[1], R[4])
math_heading = pi/2 - android_azimuth
relative_heading = wrap(math_heading - first_math_heading)
```

This uses only the current and first rotation-vector samples. It does not use
Tango orientation, body-heading truth, later samples, or route geometry.

Primary definition:
[AOSP SensorManager.java (`android16-qpr2-release`)](https://android.googlesource.com/platform/frameworks/base/+/android16-qpr2-release/core/java/android/hardware/SensorManager.java)

## Stride sensitivity method

The estimator uses the input-only peak-to-valley acceleration amplitude:

```text
step_length = K * amplitude ** 0.25
```

The diagnostic predeclares `K = 0.364, 0.400, 0.450, 0.640`. It evaluates all
values and deliberately makes no selection. `K=0.364` is included because a
published smartphone GNSS/PDR experiment reports that empirical value; the same
paper and broader literature do not establish it as universal. Other studies
fit `K` by person, walking speed, gender, and phone-carrying mode.

Sources:

- [An Effective GNSS/PDR Fusion Positioning Algorithm on Smartphones](https://pmc.ncbi.nlm.nih.gov/articles/PMC10935304/)
- [A Context-Aware Smartphone-Based 3D Indoor Positioning Using PDR](https://pmc.ncbi.nlm.nih.gov/articles/PMC9782146/)

The RoNIN test truth is used only after all outputs are produced. Selecting or
fitting `K` from these results would be test leakage and is explicitly forbidden.

## Results

All 16 records are causal and use the same raw Android-compatible streams. The
truth distance is about 381.2 m.

| Rate | Profile | K | Estimated distance | Scale error | Heading MAE | Turn MAE | Mirror |
|---:|---|---:|---:|---:|---:|---:|---|
| 50 Hz | `imu6` | 0.364 | 406.9 m | 6.7% | 78.4° | 44.3° | no |
| 50 Hz | `imu6` | 0.400 | 439.2 m | 15.2% | 78.4° | 44.3° | no |
| 50 Hz | `imu6` | 0.450 | 477.4 m | 25.2% | 78.4° | 44.3° | no |
| 50 Hz | `imu6` | 0.640 | 570.2 m | 49.6% | 78.4° | 44.3° | no |
| 50 Hz | `platform-fused` | 0.364 | 406.9 m | 6.7% | 66.8° | 60.4° | yes |
| 100 Hz | `imu6` | 0.364 | 432.1 m | 13.3% | 77.0° | 43.5° | no |
| 100 Hz | `imu6` | 0.400 | 466.2 m | 22.3% | 77.0° | 43.5° | no |
| 100 Hz | `imu6` | 0.450 | 508.6 m | 33.4% | 77.0° | 43.5° | no |
| 100 Hz | `imu6` | 0.640 | 613.2 m | 60.8% | 77.0° | 43.5° | no |
| 100 Hz | `platform-fused` | 0.364 | 432.1 m | 13.3% | 66.5° | 58.9° | yes |

Only representative platform rows are shown because changing `K` cannot change
heading or mirroring. The executed notebook retains all 16 records. The roughly
25 m difference between 50 and 100 Hz at the same `K` also exposes sample-rate
sensitivity in the current peak detector.

## Decision and next gate

- **Heading:** Stop treating device rotation-vector azimuth as body heading.
- **Stride:** Retain the sensitivity harness, but do not select `K` from this
  test sequence and do not treat a fixed coefficient as universal.
- **Step detection:** Require a rate-stability gate before any coefficient
  calibration; the same raw sequence should not change its walking distance
  materially between 50 and 100 Hz.
- **Personal pilot:** Do not start. Heading remains catastrophic and public data
  already exposes cheaper failures.
- **Android feasibility:** Still separate and unknown; this artifact has no real
  callback, screen-off, FIFO, battery, thermal, or OEM lifecycle evidence.
