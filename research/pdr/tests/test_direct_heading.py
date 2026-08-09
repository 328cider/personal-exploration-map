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
from pdr_research.direct_heading import (  # noqa: E402
    CANDIDATE_CONFIGS,
    DIRECT_INPUT_COUNT,
    RESERVOIR_SEED,
    RESERVOIR_SIZE,
    CircularReservoirModel,
    build_direct_inputs,
    canonical_model_bytes,
    fit_direct_circular_readout,
    get_direct_heading_config,
    model_sha256,
    predict_direct_heading,
    read_model,
    write_model,
)
from pdr_research.learned_heading import (  # noqa: E402
    extract_learned_features,
    get_learned_heading_config,
)
from pdr_research.synthetic import (  # noqa: E402
    drop_sensor,
    generate_fixture,
    rebatch_session,
)


def constant_model(series, config) -> CircularReservoirModel:
    return CircularReservoirModel(
        schema_version=1,
        estimator="causal direct circular echo-state body heading",
        config=config,
        input_names=series.input_names,
        input_mean=(0.0,) * DIRECT_INPUT_COUNT,
        input_scale=(1.0,) * DIRECT_INPUT_COUNT,
        readout_coefficients=((0.0, 0.0),)
        * (RESERVOIR_SIZE + DIRECT_INPUT_COUNT),
        readout_intercept=(0.0, 1.0),
        trained_sequence_ids=("synthetic",),
        training_row_count=1,
        fit_rate_hz=50,
        seed=RESERVOIR_SEED,
    )


class DirectHeadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = get_direct_heading_config("dch-w0500-l25-g50-a00001")
        self.feature_config = get_learned_heading_config(
            "lhr-w0500-a0p1-t0-c090"
        )
        self.fixture = generate_fixture(
            route="rectangle",
            sample_rate_hz=50,
            seed=23,
            include_game_rotation_vector=True,
        )

    def direct_series(self, fixture=None):
        fixture = fixture or self.fixture
        learned = extract_learned_features(
            fixture.session, config=self.feature_config
        )
        return build_direct_inputs(learned)

    def test_candidate_grid_is_complete_and_unique(self) -> None:
        self.assertEqual(len(CANDIDATE_CONFIGS), 24)
        self.assertEqual(len({item.config_id for item in CANDIDATE_CONFIGS}), 24)
        self.assertEqual({item.window_s for item in CANDIDATE_CONFIGS}, {0.5, 1.0})
        self.assertEqual(
            {item.reservoir_leak for item in CANDIDATE_CONFIGS}, {0.25, 0.75}
        )
        self.assertEqual(
            {item.recurrent_gain for item in CANDIDATE_CONFIGS}, {0.5, 0.9}
        )
        self.assertEqual(
            {item.readout_ridge_alpha for item in CANDIDATE_CONFIGS},
            {1.0, 100.0, 10000.0},
        )
        self.assertEqual({item.reservoir_size for item in CANDIDATE_CONFIGS}, {64})
        self.assertEqual({item.reservoir_seed for item in CANDIDATE_CONFIGS}, {20260809})

    def test_inputs_are_causal_android_only_and_fixed_width(self) -> None:
        series = self.direct_series()
        self.assertTrue(series.supported)
        self.assertTrue(series.rows)
        self.assertEqual(len(series.input_names), DIRECT_INPUT_COUNT)
        self.assertEqual(
            series.used_sensor_types,
            {
                "TYPE_ACCELEROMETER",
                "TYPE_GYROSCOPE",
                "TYPE_GAME_ROTATION_VECTOR",
            },
        )
        for row in series.rows:
            self.assertEqual(len(row.inputs), DIRECT_INPUT_COUNT)
            self.assertLessEqual(row.source_end_ns, row.timestamp_ns)
            self.assertLess(row.source_start_ns, row.timestamp_ns)

    def test_missing_required_sensor_remains_explicitly_unsupported(self) -> None:
        missing = drop_sensor(self.fixture.session, "TYPE_GAME_ROTATION_VECTOR")
        learned = extract_learned_features(missing, config=self.feature_config)
        direct = build_direct_inputs(learned)
        self.assertFalse(direct.supported)
        self.assertIn("TYPE_GAME_ROTATION_VECTOR", direct.missing_requirements)

    def test_callback_batching_cannot_change_inputs_or_output(self) -> None:
        original = self.direct_series()
        batched_fixture = replace(
            self.fixture,
            session=rebatch_session(self.fixture.session, batch_latency_ms=400),
        )
        batched = self.direct_series(batched_fixture)
        self.assertEqual(original, batched)
        model = constant_model(original, self.config)
        self.assertEqual(
            predict_direct_heading(original, model=model),
            predict_direct_heading(batched, model=model),
        )

    def test_prefix_cannot_change_published_outputs(self) -> None:
        full = self.direct_series()
        cutoff = full.rows[len(full.rows) // 2].timestamp_ns
        prefix_fixture = replace(
            self.fixture,
            session=replace(
                self.fixture.session,
                samples=tuple(
                    sample
                    for sample in self.fixture.session.samples
                    if sample.sensor_timestamp_ns <= cutoff
                ),
            ),
        )
        prefix = self.direct_series(prefix_fixture)
        model = constant_model(full, self.config)
        full_run = predict_direct_heading(full, model=model)
        prefix_run = predict_direct_heading(prefix, model=model)
        expected = tuple(
            point
            for point in full_run.points
            if point.timestamp_ns <= prefix_run.points[-1].timestamp_ns
        )
        self.assertEqual(prefix_run.points, expected)

    def test_constant_circular_readout_is_rate_stable(self) -> None:
        fixture_100 = generate_fixture(
            route="rectangle",
            sample_rate_hz=100,
            seed=23,
            include_game_rotation_vector=True,
        )
        at_50 = self.direct_series()
        at_100 = self.direct_series(fixture_100)
        model = constant_model(at_50, self.config)
        comparison = compare_heading_rates(
            predict_direct_heading(at_50, model=model),
            predict_direct_heading(at_100, model=model),
        )
        self.assertLessEqual(comparison.median_disagreement_deg, 1e-12)
        self.assertLessEqual(comparison.p95_disagreement_deg, 1e-12)

    def test_fit_and_serialization_are_deterministic(self) -> None:
        series = self.direct_series()
        count = len(series.rows)
        angles = np.sin(np.arange(count) / 29.0) * 0.7
        targets = np.column_stack((np.sin(angles), np.cos(angles)))
        rates = np.gradient(angles, 0.1)
        kwargs = {
            "series": (series,),
            "circular_targets": (targets,),
            "body_rates_rad_s": (rates,),
            "config": self.config,
            "trained_sequence_ids": ("synthetic",),
        }
        left = fit_direct_circular_readout(**kwargs)
        right = fit_direct_circular_readout(**kwargs)
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
        source = (ROOT / "pdr_research" / "direct_heading.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("TruthPoint", source)
        self.assertNotIn("pose/tango", source)
        self.assertNotIn("align_tango", source)
        self.assertNotIn("load_ronin", source)


if __name__ == "__main__":
    unittest.main()
