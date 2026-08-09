from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import tempfile
import sys
import unittest

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.body_heading_evaluation import compare_heading_rates  # noqa: E402
from pdr_research.learned_heading import (  # noqa: E402
    CANDIDATE_CONFIGS,
    FEATURE_COUNT,
    FEATURE_NAMES,
    ResidualRidgeModel,
    canonical_model_bytes,
    extract_learned_features,
    fit_residual_ridge,
    get_learned_heading_config,
    model_sha256,
    predict_learned_heading,
    read_model,
    write_model,
)
from pdr_research.synthetic import (  # noqa: E402
    drop_sensor,
    generate_fixture,
    rebatch_session,
)


def zero_residual_model(config_id: str) -> ResidualRidgeModel:
    config = get_learned_heading_config(config_id)
    return ResidualRidgeModel(
        schema_version=1,
        estimator="causal time-binned residual ridge body heading",
        config=config,
        feature_names=FEATURE_NAMES,
        feature_mean=(0.0,) * FEATURE_COUNT,
        feature_scale=(1.0,) * FEATURE_COUNT,
        coefficients=(0.0,) * FEATURE_COUNT,
        intercept_rad_s=0.0,
        trained_sequence_ids=("synthetic",),
        training_row_count=1,
        fit_rate_hz=50,
        seed=None,
    )


class LearnedHeadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = get_learned_heading_config("lhr-w0500-a0p1-t0-c090")
        self.fixture = generate_fixture(
            route="rectangle",
            sample_rate_hz=50,
            seed=19,
            include_game_rotation_vector=True,
        )

    def test_candidate_grid_is_complete_and_unique(self) -> None:
        self.assertEqual(len(CANDIDATE_CONFIGS), 36)
        self.assertEqual(
            len({config.config_id for config in CANDIDATE_CONFIGS}), 36
        )
        self.assertEqual({config.window_s for config in CANDIDATE_CONFIGS}, {0.5, 1.0, 2.0})
        self.assertEqual({config.ridge_alpha for config in CANDIDATE_CONFIGS}, {0.1, 10.0, 1000.0})
        self.assertEqual({config.turn_weight for config in CANDIDATE_CONFIGS}, {0.0, 8.0})
        self.assertEqual({config.residual_clip_deg_s for config in CANDIDATE_CONFIGS}, {90.0, 180.0})

    def test_features_are_causal_android_only_and_fixed_width(self) -> None:
        series = extract_learned_features(self.fixture.session, config=self.config)
        self.assertTrue(series.supported)
        self.assertTrue(series.rows)
        self.assertEqual(len(series.feature_names), FEATURE_COUNT)
        self.assertEqual(
            series.used_sensor_types,
            {"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE", "TYPE_GAME_ROTATION_VECTOR"},
        )
        for row in series.rows:
            self.assertEqual(len(row.features), FEATURE_COUNT)
            self.assertLessEqual(row.source_end_ns, row.timestamp_ns)
            self.assertLess(row.source_start_ns, row.timestamp_ns)

    def test_missing_required_sensor_is_explicitly_unsupported(self) -> None:
        without_gyro = drop_sensor(self.fixture.session, "TYPE_GYROSCOPE")
        series = extract_learned_features(without_gyro, config=self.config)
        self.assertFalse(series.supported)
        self.assertIn("TYPE_GYROSCOPE", series.missing_requirements)

    def test_callback_batching_cannot_change_features_or_output(self) -> None:
        original = extract_learned_features(self.fixture.session, config=self.config)
        batched = extract_learned_features(
            rebatch_session(self.fixture.session, batch_latency_ms=250),
            config=self.config,
        )
        self.assertEqual(original, batched)
        model = zero_residual_model(self.config.config_id)
        self.assertEqual(
            predict_learned_heading(original, model=model),
            predict_learned_heading(batched, model=model),
        )

    def test_prefix_cannot_change_already_published_outputs(self) -> None:
        full = extract_learned_features(self.fixture.session, config=self.config)
        cutoff = full.rows[len(full.rows) // 2].timestamp_ns
        prefix_session = replace(
            self.fixture.session,
            samples=tuple(
                sample
                for sample in self.fixture.session.samples
                if sample.sensor_timestamp_ns <= cutoff
            ),
        )
        prefix = extract_learned_features(prefix_session, config=self.config)
        model = zero_residual_model(self.config.config_id)
        full_run = predict_learned_heading(full, model=model)
        prefix_run = predict_learned_heading(prefix, model=model)
        expected = tuple(
            point for point in full_run.points if point.timestamp_ns <= prefix_run.points[-1].timestamp_ns
        )
        self.assertEqual(prefix_run.points, expected)

    def test_one_zero_residual_model_runs_at_both_rates(self) -> None:
        fixture_100 = generate_fixture(
            route="rectangle",
            sample_rate_hz=100,
            seed=19,
            include_game_rotation_vector=True,
        )
        model = zero_residual_model(self.config.config_id)
        run_50 = predict_learned_heading(
            extract_learned_features(self.fixture.session, config=self.config),
            model=model,
        )
        run_100 = predict_learned_heading(
            extract_learned_features(fixture_100.session, config=self.config),
            model=model,
        )
        comparison = compare_heading_rates(run_50, run_100)
        self.assertLessEqual(comparison.median_disagreement_deg, 1e-9)
        self.assertLessEqual(comparison.p95_disagreement_deg, 1e-9)

    def test_weighted_ridge_fit_and_serialization_are_deterministic(self) -> None:
        rows = 200
        features = np.arange(rows * FEATURE_COUNT, dtype=float).reshape(rows, FEATURE_COUNT)
        features = np.sin(features / 37.0)
        targets = np.cos(np.arange(rows) / 17.0) * 0.2
        body_rates = np.sin(np.arange(rows) / 13.0) * 0.4
        kwargs = {
            "features": features,
            "residual_targets_rad_s": targets,
            "body_rates_rad_s": body_rates,
            "config": self.config,
            "trained_sequence_ids": ("b", "a"),
        }
        left = fit_residual_ridge(**kwargs)
        right = fit_residual_ridge(**kwargs)
        self.assertEqual(left, right)
        self.assertEqual(canonical_model_bytes(left), canonical_model_bytes(right))
        self.assertEqual(model_sha256(left), model_sha256(right))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            digest = write_model(path, left)
            loaded = read_model(path)
        self.assertEqual(digest, model_sha256(left))
        self.assertEqual(loaded, left)

    def test_inference_module_has_no_dataset_truth_dependency(self) -> None:
        source = (ROOT / "pdr_research" / "learned_heading.py").read_text(encoding="utf-8")
        self.assertNotIn("TruthPoint", source)
        self.assertNotIn("pose/tango", source)
        self.assertNotIn("align_tango", source)


if __name__ == "__main__":
    unittest.main()
