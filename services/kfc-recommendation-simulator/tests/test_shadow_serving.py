from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import cloudpickle
import lightgbm as lgb
import mlflow.pyfunc
import numpy as np
import pandas as pd
from mlflow.exceptions import MlflowException
from sklearn.isotonic import IsotonicRegression

from kfc_recommendation_simulator.rankers import (
    FeatureSchema,
    KerasRanker,
    LightGBMArtifactRanker,
    ProbabilityCalibrator,
)
from kfc_recommendation_simulator.serving import (
    FEATURE_CONTRIBUTION_LIMIT,
    OUTPUT_COLUMNS,
    QUALIFICATION_RESULT_DIGESTS,
    PlacementModel,
    QualifiedShadowModel,
    build_serving_signature,
    verify_qualification_result,
)
from kfc_recommendation_simulator.serving import bundle as serving_bundle
from kfc_recommendation_simulator.serving.bundle import (
    save_qualified_shadow_model,
    stage_qualification_results,
)


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
        },
        trusted_manifest_digest="test-immutable-trusted-manifest-digest",
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


def _write_real_ranker(
    qualification_root: Path,
    *,
    placement: str,
    ranker_name: str,
    numeric_features: tuple[str, ...],
) -> dict[str, str]:
    model_root = qualification_root / "models" / ranker_name
    model_root.mkdir(parents=True)
    schema = FeatureSchema(
        vocabularies={},
        numeric_means={feature: 0.0 for feature in numeric_features},
        numeric_scales={feature: 1.0 for feature in numeric_features},
        categorical_features=(),
        numeric_features=numeric_features,
        schema_version=f"{placement}-feature-schema-v1",
    )
    schema.save(model_root / "feature-schema.json")
    training_frame = pd.DataFrame(
        [
            {
                feature: float((row + 1) * (column + 1) * 1_000)
                for column, feature in enumerate(numeric_features)
            }
            for row in range(8)
        ]
    )
    if ranker_name == "lightgbm":
        dataset = lgb.Dataset(
            schema.tree_frame(training_frame),
            label=np.array([0, 1, 0, 1, 0, 1, 0, 1]),
        )
        booster = lgb.train(
            {
                "objective": "binary",
                "verbosity": -1,
                "seed": 2026,
                "num_leaves": 2,
                "min_data_in_leaf": 1,
                "num_threads": 1,
            },
            dataset,
            num_boost_round=2,
        )
        model_file = model_root / "model.lightgbm.txt"
        booster.save_model(str(model_file))
    else:
        import tensorflow as tf

        tf.keras.utils.set_random_seed(2026)
        numeric_input = tf.keras.Input(
            shape=(len(numeric_features),),
            dtype=tf.float32,
            name="numeric",
        )
        output = tf.keras.layers.Dense(
            1,
            activation="sigmoid",
            kernel_initializer="zeros",
            bias_initializer="zeros",
        )(numeric_input)
        scorer = tf.keras.Model(inputs={"numeric": numeric_input}, outputs=output)
        model_file = model_root / "model.keras"
        scorer.save(model_file)

    calibrator = ProbabilityCalibrator(
        "isotonic",
        IsotonicRegression(out_of_bounds="clip").fit(
            np.array([0.0, 0.25, 0.75, 1.0]),
            np.array([0.0, 0.0, 1.0, 1.0]),
        ),
    )
    calibrator.save(model_root / "calibrator.joblib")
    _write_json(
        model_root / "ranker-manifest.json",
        {
            "calibration": "isotonic",
            "ranker": ranker_name,
            "reasonCodeMapping": {
                feature: "test_evidence" for feature in numeric_features
            },
        },
    )
    return {
        filename: _file_digest(model_root / filename)
        for filename in (
            "ranker-manifest.json",
            "feature-schema.json",
            model_file.name,
            "calibrator.joblib",
        )
    }


def _create_real_qualified_pyfunc(root: Path) -> tuple[Path, dict[str, object]]:
    qualifications: dict[str, Path] = {}
    qualification_digests: dict[str, str] = {}
    artifact_digests: dict[str, dict[str, str]] = {}
    for placement, ranker_name, numeric_features in (
        (
            "smart_cross_sell",
            "lightgbm",
            (
                "feature_price_delta_vnd",
                "feature_discount_vnd",
                "feature_budget_vnd",
            ),
        ),
        (
            "modifier_upsell",
            "keras",
            (
                "feature_price_delta_vnd",
                "feature_discount_vnd",
                "feature_budget_vnd",
                "feature_remaining_budget_vnd",
            ),
        ),
    ):
        qualification_root = root / f"{placement}-qualification"
        qualification_root.mkdir()
        result = {
            "learnedWinner": ranker_name,
            "placement": placement,
            "profile": "qualification",
            "qualification": {"passed": True},
            "schemaVersion": "qualification-v1",
        }
        result_digest = _canonical_digest(result)
        qualification_digests[placement] = result_digest
        result["contentDigest"] = result_digest
        result_path = qualification_root / "benchmark-result.json"
        _write_json(result_path, result)
        artifact_digests[placement] = {
            "benchmark-result.json": _file_digest(result_path),
            **_write_real_ranker(
                qualification_root,
                placement=placement,
                ranker_name=ranker_name,
                numeric_features=numeric_features,
            ),
        }
        qualifications[placement] = qualification_root

    output = root / "mlflow-model"
    tracking_uri = mlflow.get_tracking_uri()
    test_tracking_uri = f"sqlite:///{root / 'mlflow.db'}"
    try:
        mlflow.set_tracking_uri(test_tracking_uri)
        with (
            patch.dict(
                QUALIFICATION_RESULT_DIGESTS,
                qualification_digests,
                clear=True,
            ),
            patch.dict(
                serving_bundle.QUALIFIED_ARTIFACT_DIGESTS,
                artifact_digests,
                clear=True,
            ),
        ):
            manifest = save_qualified_shadow_model(
                smart_cross_sell_qualification=qualifications["smart_cross_sell"],
                modifier_upsell_qualification=qualifications["modifier_upsell"],
                output_directory=output,
            )
    finally:
        mlflow.set_tracking_uri(tracking_uri)
    return output, manifest


class ShadowServingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._package_directory = tempfile.TemporaryDirectory()
        cls._model_path, cls._bundle_manifest = _create_real_qualified_pyfunc(
            Path(cls._package_directory.name)
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls._package_directory.cleanup()

    def _copy_packaged_model(self, root: Path) -> Path:
        copy = root / "mlflow-model"
        shutil.copytree(self._model_path, copy)
        return copy

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
        self.assertEqual(
            [
                "test-immutable-trusted-manifest-digest",
                "test-immutable-trusted-manifest-digest",
            ],
            output["model_revision"].tolist(),
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
        loaded = mlflow.pyfunc.load_model(self._model_path)
        python_model = loaded.unwrap_python_model()
        self.assertIsInstance(
            python_model._placements["smart_cross_sell"].ranker,
            LightGBMArtifactRanker,
        )
        self.assertIsInstance(
            python_model._placements["modifier_upsell"].ranker,
            KerasRanker,
        )
        self.assertTrue(
            all(
                isinstance(placement.calibrator, ProbabilityCalibrator)
                for placement in python_model._placements.values()
            )
        )
        self.assertEqual(
            (
                "feature_price_delta_vnd",
                "feature_discount_vnd",
                "feature_budget_vnd",
            ),
            python_model._placements["smart_cross_sell"].numeric_features,
        )
        self.assertEqual(
            {"feature_discount_vnd": "test_evidence"},
            {
                feature: reason
                for feature, reason in python_model._placements[
                    "smart_cross_sell"
                ].reason_code_mapping.items()
                if feature == "feature_discount_vnd"
            },
        )

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
                for name in (
                    "placement",
                    "feature_schema",
                    "eligible",
                    "action_id",
                )
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
                "model_revision": ("DataType.string", True),
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

    def test_saved_pyfunc_discards_persisted_preloaded_placements(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_path = self._copy_packaged_model(Path(temporary_directory))
            pickle_path = model_path / "python_model.pkl"
            with pickle_path.open("rb") as source:
                python_model = cloudpickle.load(source)
            python_model._placements = {
                placement: replace(
                    _placement_model(placement, intercept),
                    feature_schema_id=metadata["featureSchema"],
                    model_artifact_id=metadata["modelArtifactId"],
                    calibration_id=metadata["calibrationId"],
                )
                for placement, intercept, metadata in (
                    (
                        "smart_cross_sell",
                        0.2,
                        self._bundle_manifest["placements"]["smart_cross_sell"],
                    ),
                    (
                        "modifier_upsell",
                        0.5,
                        self._bundle_manifest["placements"]["modifier_upsell"],
                    ),
                )
            }
            with pickle_path.open("wb") as destination:
                cloudpickle.dump(python_model, destination)

            loaded = mlflow.pyfunc.load_model(model_path).unwrap_python_model()

            self.assertIsInstance(
                loaded._placements["smart_cross_sell"].ranker,
                LightGBMArtifactRanker,
            )
            self.assertIsInstance(
                loaded._placements["modifier_upsell"].ranker,
                KerasRanker,
            )

    def test_saved_pyfunc_rejects_tampered_trusted_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_path = self._copy_packaged_model(Path(temporary_directory))
            manifest_path = next(
                (model_path / "artifacts").rglob("trusted-artifact-manifest.json")
            )
            manifest_path.write_text("{}\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "trusted manifest digest"):
                mlflow.pyfunc.load_model(model_path)

    def test_saved_pyfunc_rejects_each_tampered_qualified_artifact(self) -> None:
        for relative_path in (
            Path("lightgbm/model.lightgbm.txt"),
            Path("keras/model.keras"),
            Path("lightgbm/calibrator.joblib"),
            Path("keras/calibrator.joblib"),
            Path("lightgbm/feature-schema.json"),
            Path("keras/feature-schema.json"),
            Path("lightgbm/ranker-manifest.json"),
            Path("keras/ranker-manifest.json"),
        ):
            with (
                self.subTest(relative_path=relative_path),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                model_path = self._copy_packaged_model(Path(temporary_directory))
                artifact_path = model_path / "artifacts" / relative_path
                artifact_path.write_bytes(artifact_path.read_bytes() + b"tampered")

                with self.assertRaisesRegex(ValueError, "artifact digest mismatch"):
                    mlflow.pyfunc.load_model(model_path)


if __name__ == "__main__":
    unittest.main()
