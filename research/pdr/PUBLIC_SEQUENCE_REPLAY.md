# First public-sequence replay: RoNIN `a054_1`

- Date: 2026-08-09
- Artifact: official RoNIN FRDR unseen-subject test archive
- Input adapter: `ronin-raw-hdf5-v1`
- Product integration: none
- Decision: stop the current B0/B1 configurations; continue research without a personal pilot

## Answer first

The strict Android-input gate works on a real public sequence, but none of the
current baseline configurations is a product candidate. B0 is unsupported
because the compatible adapter does not mix the raw Step Counter with the
dataset's cross-device synchronization metadata. Every supported B1 run has at
least one catastrophic distance, heading, endpoint, or mirror failure. Turn MAE
is also high at about 38–44 degrees across 76 evaluated turn events, but remains
below the separate 45-degree catastrophic-turn threshold.

This is a useful negative result. The synthetic matrix had already exposed phone
orientation as a dominant risk; the public sequence confirms that device
Game Rotation Vector is not body heading and that the current generic
acceleration-peak step/stride rule substantially over-counts distance.

## Legal and retrieval gate

The official custom license permits non-commercial scientific research and
prohibits commercial product/service use and redistribution without SFU's prior
written permission. The exact `LICENSE.txt` SHA-256, official archive checksum,
archive size, and DOI are pinned in
`datasets/artifacts/ronin-unseen-test.json`.

The unseen-subject archive is 3,211,376,453 bytes. The range reader transferred
67,114,615 bytes to extract only `a054_1/data.hdf5` and `info.json`; it did not
download the full archive. ZIP CRC and extracted member SHA-256 were verified.
Raw data remains in the ignored `research/pdr/data/` directory and is not in Git.

## Input and truth separation

| Role | Fields | Rule |
|---|---|---|
| Live input | `raw/imu/acce`, `raw/imu/gyro`, `raw/imu/game_rv` | Android API values and raw IMU system timestamps only |
| Evaluation-only | `synced/time`, `pose/tango_pos`, `pose/tango_ori`, `start_frame`, `imu_time_offset` | selects and aligns truth after estimator output |
| Forbidden | `pose/ekf_ori`, `align_tango_to_body` | never enters the estimator |
| Excluded in this adapter | `raw/imu/step` | using it with synchronized truth requires dataset time-alignment metadata; therefore B0 is unsupported |

The raw accelerometer and gyro streams are about 334 Hz and Game Rotation Vector
is about 201 Hz. These rates are source properties, not product requirements.
The adapter performs causal bucket aggregation to 50/100 Hz and retains the
last timestamp in each bucket. Game Rotation Vector is additionally capped at
50 Hz. Its artifact quaternion order is explicitly converted from `w,x,y,z` to
Android-like `x,y,z,w`.

The artifact does not retain callback time, sensor accuracy/capability metadata,
FIFO, wake-up state, battery, thermal, or lifecycle gaps. Callback time is set
equal to sensor time for replay and this limitation remains a separate Android
capability gate.

## Results

The matrix contains 32 records: 2 rates, 4 scenarios, and 4 estimator
configurations. Twenty-four B1 records are supported, eight B0 records are
explicitly unsupported, and future-sample violations are zero. A 250 ms callback
batch leaves all sensor-time metrics unchanged. A 600 ms sensor gap increases
reported uncertainty for every supported estimator at both rates.

Ideal raw-stream results:

| Rate | Profile | Truth / estimated distance | Distance-scale error | Endpoint drift | Heading MAE | Result |
|---:|---|---:|---:|---:|---:|---|
| 50 Hz | `imu6` | 381.2 / 570.5 m | 49.7% | 0.111 | 78.4° | catastrophic distance and heading |
| 50 Hz | `platform-fused` | 381.2 / 570.5 m | 49.7% | 0.991 | 75.9° | mirrored plus catastrophic distance/endpoint/heading |
| 50 Hz | `step-enabled` fallback | 381.2 / 570.5 m | 49.7% | 0.991 | 75.9° | same failure; no compatible step events |
| 100 Hz | `imu6` | 381.2 / 613.4 m | 60.9% | 0.122 | 77.0° | catastrophic distance and heading |
| 100 Hz | `platform-fused` | 381.2 / 613.4 m | 60.9% | 1.097 | 76.1° | mirrored plus catastrophic distance/endpoint/heading |
| 100 Hz | `step-enabled` fallback | 381.2 / 613.4 m | 60.9% | 1.097 | 76.1° | same failure; no compatible step events |

Endpoint drift alone would understate the `imu6` failure because distance scale
and heading are catastrophic while turn MAE is also high. No shape or ICP
alignment is used.
Tango orientation and the evaluation-only `align_tango_to_body` label define
body heading and the evaluation frame; the estimator never sees that information.

## Decision and next gate

- **Public performance:** Stop B0/B1 version 1.0.0 as product candidates in
  their current form. Keep them as diagnostic baselines.
- **Android feasibility:** Not evaluated by this public sequence. The callback,
  screen-off, FIFO, OEM power, battery, and thermal gates remain open.
- **Personal pilot:** Do not start. Current methods already fail a cheaper public
  gate.
- **Research narrowing:** Separate body-heading inference from device
  orientation and replace the generic peak/stride rule before another pilot.
  RIDI and OxIOD still require artifact-specific license and raw-input audits;
  a successful benchmark there would not override the Android capability gate.
