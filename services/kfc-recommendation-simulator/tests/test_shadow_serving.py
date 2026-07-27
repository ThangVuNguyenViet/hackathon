from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import mlflow.pyfunc
import numpy as np
import pandas as pd
from mlflow.exceptions import MlflowException

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
    numeric_features = (
        "feature_price_delta_vnd",
        "feature_discount_vnd",
        "feature_budget_vnd",
    )
    if placement == "modifier_upsell":
        numeric_features = (*numeric_features, "feature_remaining_budget_vnd")
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
                "feature_budget_vnd": 100_000,
            },
            {
                "placement": "modifier_upsell",
                "feature_schema": "modifier_upsell-feature-schema-v1",
                "eligible": True,
                "action_id": "modifier:20752:2:41091",
                "feature_price_delta_vnd": 7_000,
                "feature_discount_vnd": 10_000,
                "feature_budget_vnd": 100_000,
                "feature_remaining_budget_vnd": 50_000,
            },
        ]
    )


def _canonical_digest(payload: object) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _create_reloadable_pyfunc(
    root: Path,
) -> tuple[Path, dict[str, Path]]:
    artifacts_root = root / "source-artifacts"
    artifacts_root.mkdir()
    artifacts: dict[str, Path] = {}
    placements: dict[str, dict[str, object]] = {}
    qualification_digests: dict[str, str] = {}
    model_files = {
        "smart_cross_sell": "model.lightgbm.txt",
        "modifier_upsell": "model.keras",
    }
    for placement, ranker in (
        ("smart_cross_sell", "lightgbm"),
        ("modifier_upsell", "keras"),
    ):
        placement_root = artifacts_root / placement
        model_root = placement_root / f"{placement}-model"
        model_root.mkdir(parents=True)
        result_payload = {
            "placement": placement,
            "schemaVersion": "qualification-v1",
        }
        qualification_digest = _canonical_digest(result_payload)
        qualification_digests[placement] = qualification_digest
        result_payload["contentDigest"] = qualification_digest
        result_path = placement_root / f"{placement}-benchmark-result.json"
        _write_json(result_path, result_payload)
        feature_schema_path = model_root / "feature-schema.json"
        ranker_manifest_path = model_root / "ranker-manifest.json"
        calibrator_path = model_root / "calibrator.joblib"
        model_path = model_root / model_files[placement]
        _write_json(
            feature_schema_path,
            {
                "schemaVersion": f"{placement}-feature-schema-v1",
            },
        )
        _write_json(ranker_manifest_path, {"ranker": ranker})
        calibrator_path.write_bytes(f"{placement}-calibrator".encode())
        model_path.write_bytes(f"{placement}-model".encode())
        file_digests = {
            "benchmark-result.json": _file_digest(result_path),
            "feature-schema.json": _file_digest(feature_schema_path),
            "ranker-manifest.json": _file_digest(ranker_manifest_path),
            "calibrator.joblib": _file_digest(calibrator_path),
            model_files[placement]: _file_digest(model_path),
        }
        placements[placement] = {
            "calibrationId": f"{placement}-square-calibration-v1",
            "featureSchema": f"{placement}-feature-schema-v1",
            "fileDigests": file_digests,
            "modelArtifactId": f"{placement}-model-v1",
            "ranker": ranker,
        }
        artifacts[f"{placement}_result"] = result_path
        artifacts[f"{placement}_model"] = model_root
    manifest_payload = {
        "placements": placements,
        "qualificationResultDigests": qualification_digests,
        "schemaVersion": "kfc-qualified-shadow-artifact-manifest-v1",
    }
    manifest_digest = _canonical_digest(manifest_payload)
    manifest_payload["contentDigest"] = manifest_digest
    manifest_path = artifacts_root / "trusted-artifact-manifest.json"
    _write_json(manifest_path, manifest_payload)
    artifacts["trusted_manifest"] = manifest_path

    output = root / "mlflow-model"
    mlflow.pyfunc.save_model(
        path=output,
        python_model=QualifiedShadowModel(
            {
                "smart_cross_sell": _placement_model("smart_cross_sell", 0.2),
                "modifier_upsell": _placement_model("modifier_upsell", 0.5),
            },
            trusted_manifest_digest=manifest_digest,
        ),
        artifacts={key: str(path) for key, path in artifacts.items()},
        signature=build_serving_signature(),
        pip_requirements=[],
    )
    return output, artifacts


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
        foreign_feature.loc[0, "feature_remaining_budget_vnd"] = 100_000
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

    def test_saved_pyfunc_reloads_with_complete_typed_mlflow_signature(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_path, _ = _create_reloadable_pyfunc(Path(temporary_directory))
            loaded = mlflow.pyfunc.load_model(model_path)

            output = loaded.predict(_input_frame())
            self.assertEqual(
                ["item:41035", "modifier:20752:2:41091"],
                output["action_id"].tolist(),
            )
            input_specs = {
                spec.name: (str(spec.type), spec.required)
                for spec in loaded.metadata.get_input_schema()
            }
            self.assertEqual(
                {
                    "placement": ("DataType.string", True),
                    "feature_schema": ("DataType.string", True),
                    "eligible": ("DataType.boolean", True),
                    "action_id": ("DataType.string", True),
                },
                {
                    name: input_specs[name]
                    for name in ("placement", "feature_schema", "eligible", "action_id")
                },
            )
            self.assertEqual(
                {
                    "candidate_id",
                    "category",
                    "product_code",
                    "feature_cart_anchor",
                    "feature_store_id",
                    "feature_mission",
                    "feature_time_window",
                    "modifier_path",
                },
                {
                    name
                    for name, (data_type, required) in input_specs.items()
                    if data_type == "DataType.string" and not required
                },
            )
            self.assertEqual(
                {
                    "feature_price_delta_vnd",
                    "feature_discount_vnd",
                    "feature_party_size",
                    "feature_budget_vnd",
                    "feature_cart_subtotal_vnd",
                    "feature_customer_order_count",
                    "feature_customer_item_order_count",
                    "feature_customer_category_order_count",
                    "feature_store_item_order_count",
                    "feature_global_item_order_count",
                    "feature_store_local_hour",
                    "feature_store_local_day_of_week",
                },
                {
                    name
                    for name, (data_type, required) in input_specs.items()
                    if data_type == "DataType.long" and not required
                },
            )
            self.assertEqual(
                {
                    "feature_discount_ratio",
                    "feature_basket_association_score",
                    "feature_remaining_budget_vnd",
                    "feature_price_to_remaining_budget_ratio",
                },
                {
                    name
                    for name, (data_type, required) in input_specs.items()
                    if data_type == "DataType.double" and not required
                },
            )
            output_specs = {
                spec.name: (str(spec.type), spec.required)
                for spec in loaded.metadata.get_output_schema()
            }
            self.assertEqual(
                {
                    "action_id": ("DataType.string", True),
                    "calibrated_probability": ("DataType.double", True),
                    "expected_value_score": ("DataType.double", True),
                    "model_artifact_id": ("DataType.string", True),
                    "calibration_id": ("DataType.string", True),
                    "feature_schema": ("DataType.string", True),
                    "feature_contributions": ("DataType.string", True),
                },
                output_specs,
            )

            with self.assertRaises(MlflowException):
                loaded.predict(_input_frame().drop(columns=["action_id"]))
            wrong_type = _input_frame()
            wrong_type["feature_discount_vnd"] = "not-a-number"
            with self.assertRaises(MlflowException):
                loaded.predict(wrong_type)

    def test_saved_pyfunc_rejects_tampered_trusted_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_path, _ = _create_reloadable_pyfunc(Path(temporary_directory))
            manifest_path = next(
                (model_path / "artifacts").rglob("trusted-artifact-manifest.json")
            )
            manifest_path.write_text("{}\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "trusted manifest digest"):
                mlflow.pyfunc.load_model(model_path)

    def test_saved_pyfunc_rejects_each_tampered_qualified_artifact(self) -> None:
        for filename in (
            "model.lightgbm.txt",
            "model.keras",
            "calibrator.joblib",
            "feature-schema.json",
            "ranker-manifest.json",
        ):
            with (
                self.subTest(filename=filename),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                model_path, _ = _create_reloadable_pyfunc(Path(temporary_directory))
                artifact_path = next((model_path / "artifacts").rglob(filename))
                artifact_path.write_bytes(artifact_path.read_bytes() + b"tampered")

                with self.assertRaisesRegex(ValueError, "artifact digest mismatch"):
                    mlflow.pyfunc.load_model(model_path)


if __name__ == "__main__":
    unittest.main()
