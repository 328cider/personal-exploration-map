# Pocket PDR technology gate

- Status: Deferred experiment design, not a product implementation plan
- Reviewed: 2026-08-08
- Related: Issue #5, Issues #3 and #4, `PRODUCT_CONSTITUTION.md`
- Source: user-provided deep-research report reviewed on 2026-08-08

## Decision summary

The current decision is deliberately asymmetric.

- **IMU-only as a general GNSS replacement:** Stop-leaning
- **100–300 m relative shape between anchors:** Narrow candidate
- **Temporary GNSS-loss bridging:** Narrow candidate
- **Sparse GNSS + PDR + manual anchors:** most plausible product direction
- **Learned inertial model in the Android app now:** do not implement
- **Raw native sensor evidence and offline replay:** first technical step when Issue #5 starts

Android Step Detector is useful as a low-power walking-event source, but it does not provide stride length, body heading, initial heading, position, or drift correction. A step event is therefore a baseline input, not a mapping system.

The purpose of Issue #5 is not to prove that step counting creates a map. It is to separate and measure:

- distance-scale error;
- body-heading error;
- device-orientation discontinuity;
- phone-handling motion;
- magnetic disturbance;
- sampling gaps and batching;
- anchor burden;
- catastrophic track-shape failures.

## Why the existing architecture should remain

The current product boundaries are compatible with this experiment and should not be replaced.

```text
Android native sensor capture
  ↓ immutable, replayable raw sensor evidence
Offline / replaceable estimators
  ↓ low-rate local pose + uncertainty
TrackingProviderPort
  ↓ explicit mapping commands
mapping-engine
  ↓ map-truth rules
mapping-core
  ↓
PersonalMap snapshots and read-only renderers
```

Important invariants:

1. `mapping-core` does not ingest 50–200 Hz IMU packets.
2. Raw sensor evidence is immutable and independent of estimator version.
3. Classical PDR, RoNIN, EqNIO, and hybrid methods replay the same log.
4. Estimator outputs include model/version, coordinate frame, confidence or covariance, and source-sample range.
5. `TrackingProviderPort` receives low-rate local pose observations, not raw sensor events.
6. Manual anchors are user-confirmed evidence and enter through a canonical command.
7. Smoothing produces a derived revision; it never overwrites raw evidence.
8. Map-matching output remains optional inference and never silently becomes PersonalMap truth.
9. A model update regenerates a new derived track from the same raw evidence.
10. Geographic and local sessions remain separate until an explicit anchor transform exists.

## Entry conditions

Do not start the PDR spike merely because sensor APIs are available.

Issue #5 remains blocked until:

- Issue #3 establishes the real-device GNSS/background baseline;
- Issue #4 establishes that the mapping product has value beyond a GPS-history UI;
- emulator gates are green for normal mobile UI, completion, marker, notification, and persistence;
- a field-data collection burden acceptable to the user is defined;
- target Android versions and at least an initial device matrix are known.

The spike may prepare architecture and offline tooling earlier, but it must not make PDR a default product feature before these gates.

## Build / Adopt / Benchmark

| Capability | Decision | Candidate | Product rule |
|---|---|---|---|
| Android sensor access | **Adopt** | SensorManager, Step Detector, Rotation Vector | Do not reimplement the OEM step detector before measuring it |
| Native screen-off capture | **Build thin adapter** | Kotlin Expo module + foreground service | App lifecycle and evidence schema are product-specific |
| Raw sensor store | **Build** | chunked binary plus SQLite metadata | Lossless replay is a product invariant |
| Classical PDR | **Build small baseline** | step, stride, heading, quality gates | Required as an explainable comparison baseline |
| Learned PDR | **Benchmark only** | RoNIN, EqNIO | Do not include research code or weights in the product package |
| TLIO-style architecture | **Benchmark later** | learned displacement + covariance + filter | No general turnkey smartphone-pocket product model |
| Sparse GNSS | **Adopt** | current location provider / native provider | Strongest absolute anchor |
| Online fusion | **Build minimal after evidence** | EKF | State and measurement gates depend on product constraints |
| Session smoothing | **Benchmark** | factor graph, potentially GTSAM offline | Prove value before Android integration |
| Map matching | **Optional benchmark** | GraphHopper or equivalent | Existing roads must not become map truth |
| On-device runtime | **Adopt after model choice** | ONNX Runtime, LiteRT, ExecuTorch | Do not choose a runtime before a model wins |
| PersonalMap domain | **Build / retain** | mapping-core and mapping-engine | Map truth and session boundaries are product-specific |

## First implementation slice for Issue #5

When the gate opens, the first implementation is a measurement system, not a neural inference feature.

### Native capture

Create a Kotlin foreground sensor-capture service or local Expo module that records:

- accelerometer;
- gyroscope;
- magnetometer;
- Rotation Vector;
- Game Rotation Vector;
- gravity and linear acceleration where available;
- Step Detector and Step Counter;
- pressure where available;
- GNSS for comparison and sparse anchors;
- app/service lifecycle;
- battery and thermal metadata at low frequency.

React Native receives only low-frequency status, preview, and errors. It must not receive and persist every high-rate sensor event across the JS bridge.

### Replayable evidence

The minimum evidence model includes:

```text
SessionMetadata
  schema version
  app and device information
  Android version
  sensor capabilities, rates, FIFO and wake-up properties
  permission state
  monotonic/wall-clock anchors
  pocket condition and optional calibration

SensorSample
  sensor type
  monotonic sensor timestamp
  callback-received timestamp
  sequence and batch ids
  accuracy and values

StepEvent
  monotonic timestamp
  source: Android Step Detector or custom baseline

GnssSample
  monotonic timestamp
  geographic position, accuracy, speed and bearing
  provider and mock flag

ManualAnchor
  monotonic timestamp
  entrance, turn, same-place, floor-change or known point
  user-confirmed flag
```

Sensor event time and delivery time must remain separate. Wall clock is metadata; estimator alignment uses a monotonic clock.

### Initial sampling plan

Start with a practical capture profile rather than assuming research-dataset rates are necessary.

| Stream | Initial rate |
|---|---:|
| Accelerometer | 100 Hz |
| Gyroscope | 100 Hz |
| Magnetometer | 25–50 Hz |
| Rotation Vector | 50 Hz |
| Game Rotation Vector | 50 Hz |
| Gravity | 50 Hz |
| Linear acceleration | 50–100 Hz |
| Step Detector | event-driven |
| Step Counter | on-change |
| Pressure | 5–10 Hz |
| GNSS comparison | approximately 1 Hz |
| Battery / thermal | every 30–60 seconds |

Ablate 50 / 100 / 200 Hz only after screen-off capture, storage load, and battery are measured.

## Benchmark matrix

All estimators must replay the same raw session. Do not ask the user to repeat a route for each algorithm.

| ID | Method | Role |
|---|---|---|
| B0 | Android Step Detector + Rotation Vector + fixed/height stride | Minimum explainable baseline |
| B1 | Classical pocket PDR with raw IMU, heading gates and handling state | Practical baseline |
| B2 | RoNIN pretrained ResNet in an isolated offline environment | Public learned baseline |
| B3 | EqNIO-RoNIN pretrained in an isolated offline environment | Orientation-equivariant research comparison |
| B4 | B1 or a winning learned prior + sparse GNSS + manual anchors | Most plausible product candidate |

TLIO is not part of the first five because a general pretrained smartphone-pocket checkpoint is not available and its published domain is not the same as the product condition.

## Route matrix

The initial elimination matrix should include:

- 100 m and 300 m straight routes;
- a roughly 200 m rectangle;
- multiple turns;
- a gentle curve;
- out-and-back;
- an irregular loop;
- stairs/floor changes;
- phone removal and replacement;
- marker input while stationary;
- a magnetically disturbed area.

Pocket position and orientation are separate test factors. Early data from a few people/devices may eliminate methods, but must not be presented as generalization proof.

## Metrics

ATE alone is insufficient. At minimum report:

- origin-only endpoint drift ratio;
- SE(2)-aligned ATE for shape comparison;
- 10 m, 30 m, 50 m, and 60-second RPE;
- distance-scale error;
- heading drift per minute or per 100 m;
- turn-angle MAE;
- turn precision/recall/F1;
- topology correctness;
- false self-intersections;
- loop-closure error;
- anchors per 100 m and interaction seconds per 100 m;
- catastrophic failure rate;
- battery, thermal, sampling gaps and service restarts;
- degradation for unseen users, devices and pocket orientations.

Do not publish only a shape-aligned score: a trajectory that is rotated by 90 degrees can still appear good after optimal alignment.

## Proposed Go / Narrow / Stop gate

These are product-specific starting thresholds and must be revisited after the first field dataset.

| Metric | Go | Narrow | Stop |
|---|---:|---:|---:|
| 100–300 m endpoint drift ratio, median | <= 5% | <= 15% | > 15% |
| Endpoint drift ratio, p90 | <= 10% | <= 25% | > 30% or frequent collapse |
| 50 m RPE, median | <= 5 m | <= 10 m | > 10 m |
| 90-degree turn MAE | <= 10 degrees | <= 20 degrees | > 25 degrees |
| Turn F1 | >= 0.90 | >= 0.75 | < 0.75 |
| Topology-correct sessions | >= 90% | >= 70% | < 70% |
| Catastrophic failures | < 2% | < 10% | >= 10% |
| Manual anchors | <= 1 / 200 m | <= 1 / 100 m | > 1 / 50 m |
| Interaction interruption | <= 10 s / 300 m | <= 30 s / 300 m | heavier than manual mapping |
| Unseen-device degradation | <= 25% | supported-device limitation | per-device retuning required |
| Screen-off sensor gaps | p95 < 100 ms and no >2 s gap | works on known devices/settings | frequent multi-second gaps |
| Incremental battery | target <= 5% / h | <= 10% / h | > 10% / h or heat |
| Map recognizability | >= 90% | >= 70% | < 70% |

### Go

Short PersonalMaps remain stable across unseen people and devices with only light anchors, and uncertainty is not misrepresented as confirmed geometry.

### Narrow

The method is useful only within declared constraints such as entrance-to-exit spans, short backtracking, a known building, validated devices, one pocket orientation, or temporary GNSS loss.

This is the most plausible near-term outcome.

### Stop

Stop includes methods with acceptable averages but more than roughly 10% catastrophic sessions: 90-degree rotation, mirror image, false loop, major self-intersection, or a correction burden comparable to manual mapping.

A Stop decision does not remove GNSS mapping, PersonalMap, markers, or the blank-map product.

## Product direction if the experiment succeeds

The practical candidate is not “replace GPS with PDR.” It is:

```text
Android Step Detector
+ raw accelerometer / gyro
+ Rotation Vector and Game Rotation Vector
+ magnetic-quality gating
+ adaptive stride
+ phone-handling state
+ sparse GNSS
+ entrance / same-place anchors
+ online uncertainty-aware fusion
+ endpoint / loop smoothing after the session
```

Where GNSS is available, use a geographic frame. Bridge only the denied interval with PDR. Fully denied sessions remain in a local `(0, 0)` frame until an explicit entrance, known connection, or user-confirmed anchor exists.

## Explicit non-goals

Do not implement the following as shortcuts:

- double integration of raw acceleration as the product track;
- unconditional magnetic heading;
- presenting PDR as confirmed roads, walls or rooms;
- forced OSM snapping;
- 100–200 Hz screen-off persistence through Expo JavaScript listeners;
- Android model integration before offline comparison;
- copying GPL or unclear-license research models into product packages;
- retraining TLIO without validating domain, data rights and benefit;
- hiding catastrophic failures behind average-error metrics.

## Review triggers

Update this document when:

- Issue #3 or #4 changes the product gate;
- native sensor capture begins;
- the target Android/device matrix becomes concrete;
- a learned model or runtime is proposed for product inclusion;
- a dataset, codebase or weight license is relied on;
- anchor burden or field-test cost becomes unacceptable;
- the product scope changes from short exploration to long navigation.
