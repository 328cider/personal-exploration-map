from __future__ import annotations

from dataclasses import replace
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.contracts import (  # noqa: E402
    NormalizedSensorSession,
    SensorMetadata,
    SensorSample,
)
from pdr_research.estimators import run_b1  # noqa: E402
from pdr_research.step_detection import (  # noqa: E402
    CANDIDATE_CONFIGS,
    detect_rate_stable_steps,
    get_step_detector_config,
    summarize_step_detection,
)
from pdr_research.rate_stability import (  # noqa: E402
    RatePairResult,
    passes_validation_gate,
    rank_development_pairs,
)
from pdr_research.synthetic import rebatch_session  # noqa: E402


def walking_session(rate_hz: int, *, duration_s: float = 20.0) -> NormalizedSensorSession:
    count = round(duration_s * rate_hz) + 1
    samples = []
    for index in range(count):
        timestamp_ns = round(index / rate_hz * 1_000_000_000)
        phase = 2.0 * math.pi * 1.8 * index / rate_hz
        magnitude = 9.80665 + 1.5 * math.sin(phase) + 0.18 * math.sin(2.0 * phase)
        samples.append(
            SensorSample(
                sensor_type="TYPE_ACCELEROMETER",
                sensor_timestamp_ns=timestamp_ns,
                callback_timestamp_ns=timestamp_ns,
                values=(0.0, 0.0, magnitude),
                accuracy=3,
                sequence_id=index,
                batch_id=index,
            )
        )
        samples.append(
            SensorSample(
                sensor_type="TYPE_GYROSCOPE",
                sensor_timestamp_ns=timestamp_ns,
                callback_timestamp_ns=timestamp_ns,
                values=(0.0, 0.0, 0.0),
                accuracy=3,
                sequence_id=count + index,
                batch_id=count + index,
            )
        )
    metadata = tuple(
        SensorMetadata(
            sensor_type=sensor_type,
            android_api="android.hardware.SensorEvent.values",
            vendor="test",
            version=1,
            resolution=0.01,
            maximum_range=20.0,
            power_ma=0.1,
            min_delay_us=round(1_000_000 / rate_hz),
            max_delay_us=0,
            fifo_reserved_count=0,
            fifo_max_count=0,
            is_wake_up=False,
            reporting_mode="continuous",
        )
        for sensor_type in ("TYPE_ACCELEROMETER", "TYPE_GYROSCOPE")
    )
    return NormalizedSensorSession(
        session_id=f"analytic-{rate_hz}hz",
        capability_profile="imu6",
        sensor_metadata=metadata,
        samples=tuple(samples),
        provenance={"kind": "analytic-test"},
    )


class RateStableStepDetectionTests(unittest.TestCase):
    def test_candidate_ids_are_unique_and_version_safe(self) -> None:
        ids = [config.config_id for config in CANDIDATE_CONFIGS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(config.internal_rate_hz == 25 for config in CANDIDATE_CONFIGS))
        self.assertTrue(all(" " not in config_id for config_id in ids))

    def test_analytic_50_and_100_hz_streams_have_same_step_count(self) -> None:
        for config in CANDIDATE_CONFIGS:
            at_50 = detect_rate_stable_steps(walking_session(50), config=config)
            at_100 = detect_rate_stable_steps(walking_session(100), config=config)
            self.assertGreater(len(at_50), 20)
            self.assertEqual(len(at_50), len(at_100), config.config_id)
            summary_50 = summarize_step_detection(at_50, config_id=config.config_id)
            summary_100 = summarize_step_detection(at_100, config_id=config.config_id)
            self.assertEqual(summary_50.future_sample_violations, 0)
            self.assertEqual(summary_100.future_sample_violations, 0)

    def test_callback_batching_does_not_change_detection(self) -> None:
        session = walking_session(100)
        config = CANDIDATE_CONFIGS[1]
        batched = rebatch_session(session, batch_latency_ms=250)
        self.assertEqual(
            detect_rate_stable_steps(session, config=config),
            detect_rate_stable_steps(batched, config=config),
        )

    def test_live_prefix_cannot_change_closed_bucket_events(self) -> None:
        session = walking_session(100)
        config = CANDIDATE_CONFIGS[1]
        cutoff_ns = 12_345_000_000
        prefix = replace(
            session,
            samples=tuple(
                sample
                for sample in session.samples
                if sample.sensor_timestamp_ns <= cutoff_ns
            ),
        )
        complete = detect_rate_stable_steps(session, config=config)
        partial = detect_rate_stable_steps(prefix, config=config)
        self.assertEqual(
            tuple(step for step in complete if step.timestamp_ns <= partial[-1].timestamp_ns),
            partial,
        )

    def test_gap_resets_state_without_future_sample_use(self) -> None:
        session = walking_session(100)
        gapped = replace(
            session,
            samples=tuple(
                sample
                for sample in session.samples
                if not 8_000_000_000 <= sample.sensor_timestamp_ns < 8_600_000_000
            ),
        )
        steps = detect_rate_stable_steps(gapped, config=CANDIDATE_CONFIGS[1])
        self.assertTrue(steps)
        self.assertTrue(all(step.source_end_ns <= step.timestamp_ns for step in steps))
        self.assertFalse(
            any(
                step.source_start_ns < 8_000_000_000
                and step.source_end_ns >= 8_600_000_000
                for step in steps
            )
        )

    def test_b1_can_version_and_use_frozen_style_detector(self) -> None:
        config_id = CANDIDATE_CONFIGS[1].config_id
        run = run_b1(
            walking_session(50),
            capability_profile="imu6",
            weinberg_gain=0.364,
            step_detector_config_id=config_id,
        )
        self.assertTrue(run.supported)
        self.assertIn(config_id, run.requirement.version)
        self.assertIn(f"rate-stable-step-detector-{config_id}", run.fallback_flags)

    def test_unknown_config_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown step detector config"):
            get_step_detector_config("not-registered")

    def test_frozen_spec_matches_registered_config_and_disjoint_split(self) -> None:
        split = json.loads(
            (ROOT / "datasets" / "splits" / "ronin-rate-stability-v1.json").read_text(
                encoding="utf-8"
            )
        )
        frozen = json.loads(
            (
                ROOT
                / "datasets"
                / "splits"
                / "ronin-rate-stability-v1-frozen.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            frozen["config"],
            {
                key: value
                for key, value in get_step_detector_config(
                    frozen["config_id"]
                ).__dict__.items()
            },
        )
        subject_keys = [item["subject_key"] for item in split["assignments"]]
        self.assertEqual(len(subject_keys), len(set(subject_keys)))
        self.assertTrue(
            all(
                state == "not-fetched"
                for state in frozen["validation_state_at_freeze"].values()
            )
        )

    def test_detector_source_has_no_truth_dependency(self) -> None:
        source = (ROOT / "pdr_research" / "step_detection.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("ground_truth", source)
        self.assertNotIn("from .synthetic", source)

    def test_ranking_and_gate_use_only_rate_summaries(self) -> None:
        stable = RatePairResult(
            config_id="stable",
            at_50_hz=summarize_step_detection(
                tuple(
                    detect_rate_stable_steps(
                        walking_session(50), config=CANDIDATE_CONFIGS[1]
                    )
                ),
                config_id="stable",
            ),
            at_100_hz=summarize_step_detection(
                tuple(
                    detect_rate_stable_steps(
                        walking_session(100), config=CANDIDATE_CONFIGS[1]
                    )
                ),
                config_id="stable",
            ),
            batch_invariant=True,
        )
        unstable_summary = replace(stable.at_100_hz, event_count=stable.at_100_hz.event_count + 4)
        unstable = RatePairResult(
            config_id="unstable",
            at_50_hz=stable.at_50_hz,
            at_100_hz=unstable_summary,
            batch_invariant=True,
        )
        ranked = rank_development_pairs((unstable, stable))
        self.assertEqual(ranked[0].config_id, "stable")
        self.assertTrue(passes_validation_gate(stable))
        self.assertFalse(passes_validation_gate(unstable))


if __name__ == "__main__":
    unittest.main()
