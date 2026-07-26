from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from kfc_recommendation_simulator.benchmark import _compose_slate, _slice_metrics
from kfc_recommendation_simulator.benchmark_data import (
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
)
from kfc_recommendation_simulator.rankers import (
    FeatureSchema,
    select_calibrator,
)


def _feature_frame(rows: int = 6) -> pd.DataFrame:
    frame = pd.DataFrame(index=range(rows))
    for column in CATEGORICAL_FEATURES:
        frame[column] = [f"{column}-{index % 2}" for index in range(rows)]
    for index, column in enumerate(NUMERIC_FEATURES):
        frame[column] = np.arange(rows, dtype="float64") + index
    return frame


class BenchmarkContractTest(unittest.TestCase):
    def test_feature_schema_maps_unseen_categories_to_unknown_bucket(self) -> None:
        train = _feature_frame()
        train["feature_text_embedding_00"] = np.linspace(0, 1, len(train))
        schema = FeatureSchema.fit(
            train,
            extra_numeric_features=("feature_text_embedding_00",),
        )
        candidate = train.iloc[[0]].copy()
        candidate["candidate_id"] = "unseen-candidate"
        candidate["feature_text_embedding_00"] = 0.25
        tensors = schema.tensor_inputs(candidate)
        self.assertEqual(0, tensors["candidate_id"][0])
        self.assertEqual(len(NUMERIC_FEATURES) + 1, tensors["numeric"].shape[1])

    def test_slate_composer_caps_four_and_enforces_category_diversity(self) -> None:
        frame = pd.DataFrame(
            {
                "candidate_id": [f"candidate-{index}" for index in range(6)],
                "product_code": [f"product-{index}" for index in range(6)],
                "category": ["A", "A", "A", "B", "C", "D"],
                "score": [10, 9, 8, 7, 6, 5],
                "feature_price_delta_vnd": [20_000] * 6,
                "feature_budget_vnd": [300_000] * 6,
                "feature_cart_subtotal_vnd": [100_000] * 6,
            }
        )
        slate = _compose_slate(frame)
        self.assertEqual(4, len(slate))
        categories = list(slate["category"])
        self.assertTrue(all(categories.count(category) <= 2 for category in categories))
        self.assertNotIn(categories[3], categories[:3])

    def test_calibrator_is_bounded_and_reports_brier_and_ece(self) -> None:
        labels = np.array([0, 0, 0, 1, 1, 1])
        raw = np.array([0.05, 0.2, 0.4, 0.6, 0.8, 0.95])
        calibrator, metrics = select_calibrator(labels, raw)
        predicted = calibrator.predict(np.array([0.0, 0.5, 1.0]))
        self.assertTrue(np.all((0 <= predicted) & (predicted <= 1)))
        self.assertEqual({"logistic", "isotonic"}, set(metrics))
        self.assertTrue(
            all({"brier", "ece"} == set(values) for values in metrics.values())
        )

    def test_evaluation_slices_are_reported_independently(self) -> None:
        requests = pd.DataFrame(
            {
                "held_out_store": [False, True, False],
                "cold_product_available": [False, False, True],
                "expected_incremental_aov_vnd": [10.0, 20.0, 30.0],
                "cold_product_expected_incremental_aov_vnd": [1.0, 2.0, 3.0],
                "ndcg_at_5": [0.1, 0.2, 0.3],
                "cold_product_ndcg_at_5": [0.4, 0.5, 0.6],
                "precision_at_3": [0.2, 0.3, 0.4],
                "cold_product_precision_at_3": [0.5, 0.6, 0.7],
                "category_diversity": [0.5, 0.6, 0.7],
                "slate_size": [3, 4, 3],
            }
        )
        metrics = _slice_metrics(requests)
        self.assertEqual(2, metrics["main"]["request_count"])
        self.assertEqual(
            20.0, metrics["held_out_store"]["expected_incremental_aov_vnd"]
        )
        self.assertEqual(3.0, metrics["cold_product"]["expected_incremental_aov_vnd"])


if __name__ == "__main__":
    unittest.main()
