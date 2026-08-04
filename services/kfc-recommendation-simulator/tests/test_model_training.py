from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from kfc_recommendation_simulator.qualification.features import FeatureEncoder
from kfc_recommendation_simulator.qualification.models import (
    fit_binary_model,
    load_native_predictor,
    save_native_model,
)


class FeatureEncoderTest(unittest.TestCase):
    def test_unseen_categorical_identity_maps_to_explicit_unknown_column(self) -> None:
        """Catches cold candidates silently becoming an all-zero category."""

        encoder = FeatureEncoder.fit(
            [{"category": "chicken", "price": 10.0}],
            categorical_fields=("category",),
            numeric_fields=("price",),
        )

        encoded = encoder.transform([{"category": "unseen", "price": 20.0}])

        self.assertEqual(
            encoder.feature_names,
            ("price", "category=__UNKNOWN__", "category=chicken"),
        )
        np.testing.assert_allclose(encoded.toarray(), [[20.0, 1.0, 0.0]])

    def test_encoder_round_trip_preserves_golden_matrix(self) -> None:
        """Catches serving feature order drifting from training order."""

        rows = [
            {"mode": "pickup", "price": 1.0},
            {"mode": "delivery", "price": 2.0},
        ]
        encoder = FeatureEncoder.fit(
            rows,
            categorical_fields=("mode",),
            numeric_fields=("price",),
        )

        restored = FeatureEncoder.from_dict(encoder.to_dict())

        self.assertEqual(restored.feature_names, encoder.feature_names)
        np.testing.assert_allclose(
            restored.transform(rows).toarray(), encoder.transform(rows).toarray()
        )


class NativeModelArtifactTest(unittest.TestCase):
    def test_all_challengers_round_trip_without_pickle(self) -> None:
        """Catches opaque pickle artifacts or predictions changing after reload."""

        features = np.asarray(
            [[float(index % 2), float(index) / 40.0] for index in range(40)],
            dtype=np.float64,
        )
        labels = np.asarray([index % 2 for index in range(40)], dtype=np.int8)
        weights = np.ones(40, dtype=np.float64)
        expected_suffixes = {
            "logistic": ".json",
            "lightgbm": ".txt",
            "xgboost": ".json",
            "mlp": ".json",
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for family in expected_suffixes:
                with self.subTest(family=family):
                    fitted = fit_binary_model(
                        family,
                        features,
                        labels,
                        weights,
                        seed=73,
                    )
                    before = fitted.predict_probability(features[:5])
                    artifact = save_native_model(
                        fitted,
                        root / family,
                        golden_features=features[:5],
                    )
                    self.assertEqual(
                        artifact.model_path.suffix, expected_suffixes[family]
                    )
                    self.assertFalse(
                        any(
                            path.suffix in {".pkl", ".pickle"}
                            for path in (root / family).rglob("*")
                        )
                    )
                    golden = json.loads(
                        artifact.golden_predictions_path.read_text(encoding="utf-8")
                    )
                    self.assertEqual(golden["libraryFamily"], family)
                    restored = load_native_predictor(artifact)
                    np.testing.assert_allclose(
                        restored.predict_probability(features[:5]),
                        before,
                        rtol=1e-6,
                        atol=1e-8,
                    )


if __name__ == "__main__":
    unittest.main()
