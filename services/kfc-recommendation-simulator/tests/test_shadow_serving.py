from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from kfc_recommendation_simulator.serving import (
    FEATURE_CONTRIBUTION_LIMIT,
    OUTPUT_COLUMNS,
    QUALIFICATION_RESULT_DIGESTS,
    PlacementModel,
    QualifiedShadowModel,
    build_serving_signature,
    verify_qualification_result,
)
from kfc_recommendation_simulator.serving.bundle import stage_qualification_results


class _LinearRanker:
    def __init__(self, intercept: float) -> None:
        self.intercept = intercept

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray:
        return (
            self.intercept
            + frame["feature_discount_vnd"].to_numpy(dtype="float64") / 100_000
        )


class _SquareCalibrator:
    kind = "square"

    def predict(self, probabilities: np.ndarray) -> np.ndarray:
        return np.square(probabilities)


def _placement_model(placement: str, intercept: float) -> PlacementModel:
    numeric_features = ("feature_price_delta_vnd", "feature_discount_vnd")
    if placement == "modifier_upsell":
        numeric_features = (*numeric_features, "feature_budget_vnd")
    return PlacementModel(
        placement=placement,
        feature_schema_id=f"{placement}-feature-schema-v1",
        model_artifact_id=f"{placement}-model-v1",
        calibration_id=f"{placement}-square-calibration-v1",
        ranker=_LinearRanker(intercept),
        calibrator=_SquareCalibrator(),
        categorical_features=(),
        numeric_features=numeric_features,
        reason_code_mapping={"feature_discount_vnd": "promotion_value"},
    )


def _model() -> QualifiedShadowModel:
    return QualifiedShadowModel(
        {
            "smart_cross_sell": _placement_model("smart_cross_sell", 0.2),
            "modifier_upsell": _placement_model("modifier_upsell", 0.5),
        }
    )


def _input_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "placement": "smart_cross_sell",
                "feature_schema": "smart_cross_sell-feature-schema-v1",
                "eligible": True,
                "action_id": "item:41035",
                "feature_price_delta_vnd": 20_000,
                "feature_discount_vnd": 10_000,
            },
            {
                "placement": "modifier_upsell",
                "feature_schema": "modifier_upsell-feature-schema-v1",
                "eligible": True,
                "action_id": "modifier:20752:2:41091",
                "feature_price_delta_vnd": 7_000,
                "feature_discount_vnd": 10_000,
                "feature_budget_vnd": 100_000,
            },
        ]
    )


class ShadowServingTest(unittest.TestCase):
    def test_signature_exposes_eligible_features_and_complete_score_output(
        self,
    ) -> None:
        signature = build_serving_signature()

        self.assertEqual(
            ["placement", "feature_schema", "eligible", "action_id"],
            signature.inputs.input_names()[:4],
        )
        self.assertIn("modifier_path", signature.inputs.input_names())
        self.assertIn("feature_remaining_budget_vnd", signature.inputs.input_names())
        self.assertEqual(list(OUTPUT_COLUMNS), signature.outputs.input_names())

    def test_feature_schema_validation_rejects_unfiltered_and_malformed_rows(
        self,
    ) -> None:
        model = _model()
        frame = _input_frame()

        unfiltered = frame.copy()
        unfiltered.loc[0, "eligible"] = False
        with self.assertRaisesRegex(ValueError, "already-eligible"):
            model.predict(None, unfiltered)

        wrong_schema = frame.copy()
        wrong_schema.loc[0, "feature_schema"] = "wrong-schema"
        with self.assertRaisesRegex(ValueError, "feature schema"):
            model.predict(None, wrong_schema)

        with self.assertRaisesRegex(ValueError, "feature_discount_vnd"):
            model.predict(None, frame.drop(columns=["feature_discount_vnd"]))

        foreign_feature = frame.copy()
        foreign_feature.loc[0, "feature_budget_vnd"] = 100_000
        with self.assertRaisesRegex(ValueError, "outside feature schema"):
            model.predict(None, foreign_feature)

    def test_placement_router_calibrates_and_scores_each_candidate(self) -> None:
        output = _model().predict(None, _input_frame())

        self.assertEqual(
            ["item:41035", "modifier:20752:2:41091"],
            output["action_id"].tolist(),
        )
        np.testing.assert_allclose(
            output["calibrated_probability"].to_numpy(),
            np.array([0.09, 0.36]),
        )
        np.testing.assert_allclose(
            output["expected_value_score"].to_numpy(),
            np.array([1_800.0, 2_520.0]),
        )
        self.assertEqual(
            [
                "smart_cross_sell-model-v1",
                "modifier_upsell-model-v1",
            ],
            output["model_artifact_id"].tolist(),
        )

    def test_batch_output_and_feature_contributions_are_deterministic_and_bounded(
        self,
    ) -> None:
        model = _model()
        frame = _input_frame()

        first = model.predict(None, frame)
        second = model.predict(None, frame)

        pd.testing.assert_frame_equal(first, second)
        self.assertEqual(list(OUTPUT_COLUMNS), list(first.columns))
        for encoded in first["feature_contributions"]:
            contributions = json.loads(encoded)
            self.assertLessEqual(len(contributions), FEATURE_CONTRIBUTION_LIMIT)
            self.assertTrue(
                all(
                    -1 <= contribution["contribution"] <= 1
                    for contribution in contributions
                )
            )

    def test_qualification_digest_gate_checks_declared_and_canonical_content(
        self,
    ) -> None:
        payload = {
            "contentDigest": (
                "fbd5076dd8bd2c524bcb39aa8b659993be6e667f9bd2d64981187c14dc51edad"
            ),
            "placement": "smart_cross_sell",
            "schemaVersion": "qualification-v1",
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            result_path = Path(temporary_directory) / "benchmark-result.json"
            result_path.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            verified = verify_qualification_result(
                result_path,
                "fbd5076dd8bd2c524bcb39aa8b659993be6e667f9bd2d64981187c14dc51edad",
            )
            self.assertEqual(payload, verified)

            with self.assertRaisesRegex(ValueError, "qualification digest mismatch"):
                verify_qualification_result(result_path, "0" * 64)

    def test_qualification_gate_pins_both_reviewed_result_digests(self) -> None:
        self.assertEqual(
            {
                "smart_cross_sell": (
                    "e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80"
                ),
                "modifier_upsell": (
                    "75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26"
                ),
            },
            QUALIFICATION_RESULT_DIGESTS,
        )

    def test_packaging_stages_same_named_results_under_distinct_artifact_names(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            smart = root / "smart"
            modifier = root / "modifier"
            smart.mkdir()
            modifier.mkdir()
            (smart / "benchmark-result.json").write_text(
                '{"placement":"smart"}\n',
                encoding="utf-8",
            )
            (modifier / "benchmark-result.json").write_text(
                '{"placement":"modifier"}\n',
                encoding="utf-8",
            )

            with stage_qualification_results(
                {
                    "smart_cross_sell": smart,
                    "modifier_upsell": modifier,
                }
            ) as artifacts:
                paths = [Path(path) for path in artifacts.values()]
                self.assertEqual(2, len({path.name for path in paths}))
                self.assertEqual(
                    ['{"placement":"modifier"}', '{"placement":"smart"}'],
                    sorted(path.read_text(encoding="utf-8").strip() for path in paths),
                )


if __name__ == "__main__":
    unittest.main()
