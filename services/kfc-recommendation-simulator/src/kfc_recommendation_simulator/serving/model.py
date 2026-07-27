from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mlflow.pyfunc
import numpy as np
import pandas as pd
from mlflow.models import ModelSignature
from mlflow.types.schema import ColSpec, Schema

from ..feature_contracts import (
    CATEGORICAL_FEATURES,
    MODIFIER_CATEGORICAL_FEATURES,
    MODIFIER_NUMERIC_FEATURES,
    NUMERIC_FEATURES,
)
from ..rankers import ProbabilityCalibrator, Ranker, load_ranker

QUALIFICATION_RESULT_DIGESTS = {
    "smart_cross_sell": (
        "e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80"
    ),
    "modifier_upsell": (
        "75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26"
    ),
}
QUALIFIED_RANKERS = {
    "smart_cross_sell": "lightgbm",
    "modifier_upsell": "keras",
}
CONTROL_COLUMNS = ("placement", "feature_schema", "eligible", "action_id")
OUTPUT_COLUMNS = (
    "action_id",
    "model_revision",
    "calibrated_probability",
    "expected_value_score",
    "model_artifact_id",
    "calibration_id",
    "feature_schema",
    "feature_contributions",
)
FEATURE_CONTRIBUTION_LIMIT = 5
TRUSTED_ARTIFACT_MANIFEST_SCHEMA = "kfc-qualified-shadow-artifact-manifest-v1"

_SMART_CATEGORICAL_FEATURES = tuple(CATEGORICAL_FEATURES)
_SMART_NUMERIC_FEATURES = tuple(NUMERIC_FEATURES)
_MODIFIER_CATEGORICAL_FEATURES = tuple(MODIFIER_CATEGORICAL_FEATURES)
_MODIFIER_NUMERIC_FEATURES = (
    *NUMERIC_FEATURES,
    *MODIFIER_NUMERIC_FEATURES,
)
_ALL_CATEGORICAL_FEATURES = tuple(
    dict.fromkeys((*_SMART_CATEGORICAL_FEATURES, *_MODIFIER_CATEGORICAL_FEATURES))
)
_ALL_NUMERIC_FEATURES = tuple(
    dict.fromkeys((*_SMART_NUMERIC_FEATURES, *_MODIFIER_NUMERIC_FEATURES))
)
_INTEGER_FEATURES = {
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
}


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_qualification_result(
    path: Path,
    required_digest: str,
) -> dict[str, Any]:
    result = json.loads(path.read_text(encoding="utf-8"))
    declared_digest = result.get("contentDigest")
    digest_payload = dict(result)
    digest_payload.pop("contentDigest", None)
    canonical_digest = _canonical_digest(digest_payload)
    if declared_digest != required_digest or canonical_digest != required_digest:
        raise ValueError(
            "qualification digest mismatch for "
            f"{path}: required {required_digest}, declared {declared_digest}, "
            f"canonical {canonical_digest}"
        )
    return result


def verify_trusted_artifact_manifest(
    artifacts: Mapping[str, str],
    trusted_digest: str,
) -> dict[str, Any]:
    manifest_path = Path(artifacts["trusted_manifest"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    declared_digest = manifest.get("contentDigest")
    digest_payload = dict(manifest)
    digest_payload.pop("contentDigest", None)
    canonical_digest = _canonical_digest(digest_payload)
    if (
        declared_digest != trusted_digest
        or canonical_digest != trusted_digest
        or manifest.get("schemaVersion") != TRUSTED_ARTIFACT_MANIFEST_SCHEMA
    ):
        raise ValueError(
            "trusted manifest digest mismatch: "
            f"required {trusted_digest}, declared {declared_digest}, "
            f"canonical {canonical_digest}"
        )
    placements = manifest.get("placements")
    qualification_digests = manifest.get("qualificationResultDigests")
    if not isinstance(placements, dict) or set(placements) != set(QUALIFIED_RANKERS):
        raise ValueError("trusted manifest placements do not match serving placements")
    if not isinstance(qualification_digests, dict) or set(qualification_digests) != set(
        QUALIFIED_RANKERS
    ):
        raise ValueError(
            "trusted manifest qualification digests do not match serving placements"
        )

    for placement, ranker in QUALIFIED_RANKERS.items():
        metadata = placements[placement]
        if not isinstance(metadata, dict) or metadata.get("ranker") != ranker:
            raise ValueError(f"trusted manifest ranker mismatch for {placement}")
        model_filename = (
            "model.lightgbm.txt" if placement == "smart_cross_sell" else "model.keras"
        )
        required_files = {
            "benchmark-result.json",
            "ranker-manifest.json",
            "feature-schema.json",
            "calibrator.joblib",
            model_filename,
        }
        file_digests = metadata.get("fileDigests")
        if not isinstance(file_digests, dict) or set(file_digests) != required_files:
            raise ValueError(f"trusted manifest file set mismatch for {placement}")
        paths = {
            "benchmark-result.json": Path(artifacts[f"{placement}_result"]),
            **{
                filename: Path(artifacts[f"{placement}_model"]) / filename
                for filename in required_files - {"benchmark-result.json"}
            },
        }
        for filename, path in paths.items():
            actual_digest = _file_digest(path)
            if actual_digest != file_digests[filename]:
                raise ValueError(
                    "artifact digest mismatch for "
                    f"{placement}/{filename}: required {file_digests[filename]}, "
                    f"actual {actual_digest}"
                )
    return manifest


def build_serving_signature() -> ModelSignature:
    inputs = [
        ColSpec("string", "placement"),
        ColSpec("string", "feature_schema"),
        ColSpec("boolean", "eligible"),
        ColSpec("string", "action_id"),
        *(
            ColSpec("string", feature, required=False)
            for feature in _ALL_CATEGORICAL_FEATURES
        ),
        *(
            ColSpec(
                "long" if feature in _INTEGER_FEATURES else "double",
                feature,
                required=False,
            )
            for feature in _ALL_NUMERIC_FEATURES
        ),
    ]
    outputs = [
        ColSpec("string", "action_id"),
        ColSpec("string", "model_revision"),
        ColSpec("double", "calibrated_probability"),
        ColSpec("double", "expected_value_score"),
        ColSpec("string", "model_artifact_id"),
        ColSpec("string", "calibration_id"),
        ColSpec("string", "feature_schema"),
        ColSpec("string", "feature_contributions"),
    ]
    return ModelSignature(inputs=Schema(inputs), outputs=Schema(outputs))


@dataclass(frozen=True)
class PlacementModel:
    placement: str
    feature_schema_id: str
    model_artifact_id: str
    calibration_id: str
    ranker: Ranker
    calibrator: ProbabilityCalibrator
    categorical_features: tuple[str, ...]
    numeric_features: tuple[str, ...]
    reason_code_mapping: Mapping[str, str]

    @property
    def feature_columns(self) -> tuple[str, ...]:
        return (*self.categorical_features, *self.numeric_features)


def _artifact_identity(prefix: str, path: Path) -> str:
    return f"{prefix}-{_file_digest(path)[:16]}"


def _load_placement_model(
    *,
    placement: str,
    model_directory: Path,
) -> PlacementModel:
    ranker_name = QUALIFIED_RANKERS[placement]
    manifest = json.loads(
        (model_directory / "ranker-manifest.json").read_text(encoding="utf-8")
    )
    schema = json.loads(
        (model_directory / "feature-schema.json").read_text(encoding="utf-8")
    )
    if manifest.get("ranker") != ranker_name:
        raise ValueError(
            f"{placement} requires {ranker_name}, found {manifest.get('ranker')}"
        )
    if placement == "smart_cross_sell":
        model_file = model_directory / "model.lightgbm.txt"
    else:
        model_file = model_directory / "model.keras"
    calibration_file = model_directory / "calibrator.joblib"
    return PlacementModel(
        placement=placement,
        feature_schema_id=schema["schemaVersion"],
        model_artifact_id=_artifact_identity(
            f"{placement}-{ranker_name}",
            model_file,
        ),
        calibration_id=_artifact_identity(
            f"{placement}-{manifest['calibration']}-calibration",
            calibration_file,
        ),
        ranker=load_ranker(model_directory, ranker_name),
        calibrator=ProbabilityCalibrator.load(calibration_file),
        categorical_features=tuple(schema["categoricalFeatures"]),
        numeric_features=tuple(schema["numericFeatures"]),
        reason_code_mapping=manifest["reasonCodeMapping"],
    )


class QualifiedShadowModel(mlflow.pyfunc.PythonModel):
    def __init__(
        self,
        placements: Mapping[str, PlacementModel] | None = None,
        *,
        trusted_manifest_digest: str | None = None,
    ) -> None:
        self._placements = dict(placements or {})
        self._trusted_manifest_digest = trusted_manifest_digest

    def load_context(self, context: mlflow.pyfunc.PythonModelContext) -> None:
        self._placements = {}
        if self._trusted_manifest_digest is None:
            raise ValueError("trusted manifest digest is required to load artifacts")
        manifest = verify_trusted_artifact_manifest(
            context.artifacts,
            self._trusted_manifest_digest,
        )
        loaded_placements: dict[str, PlacementModel] = {}
        for placement, required_digest in manifest[
            "qualificationResultDigests"
        ].items():
            verify_qualification_result(
                Path(context.artifacts[f"{placement}_result"]),
                required_digest,
            )
            placement_model = _load_placement_model(
                placement=placement,
                model_directory=Path(context.artifacts[f"{placement}_model"]),
            )
            metadata = manifest["placements"][placement]
            if (
                placement_model.model_artifact_id != metadata["modelArtifactId"]
                or placement_model.calibration_id != metadata["calibrationId"]
                or placement_model.feature_schema_id != metadata["featureSchema"]
            ):
                raise ValueError(
                    f"trusted artifact identities do not match {placement} model"
                )
            loaded_placements[placement] = placement_model
        self._placements = loaded_placements

    def predict(
        self,
        context: mlflow.pyfunc.PythonModelContext | None,
        model_input: pd.DataFrame,
        params: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        del context, params
        if self._trusted_manifest_digest is None:
            raise ValueError("trusted manifest digest is required for prediction")
        frame = self._validate_input(model_input)
        if frame.empty:
            return pd.DataFrame(columns=OUTPUT_COLUMNS)

        output_rows: list[dict[str, Any]] = []
        for placement, placement_rows in frame.groupby(
            "placement",
            sort=False,
            dropna=False,
        ):
            bundle = self._placements[str(placement)]
            probabilities = self._calibrated_probabilities(bundle, placement_rows)
            contributions = self._feature_contributions(
                bundle,
                placement_rows,
                probabilities,
            )
            expected_values = probabilities * placement_rows[
                "feature_price_delta_vnd"
            ].to_numpy(dtype="float64")
            for position, (_, row) in enumerate(placement_rows.iterrows()):
                output_rows.append(
                    {
                        "_input_order": int(row["_input_order"]),
                        "action_id": str(row["action_id"]),
                        "model_revision": self._trusted_manifest_digest,
                        "calibrated_probability": float(probabilities[position]),
                        "expected_value_score": float(expected_values[position]),
                        "model_artifact_id": bundle.model_artifact_id,
                        "calibration_id": bundle.calibration_id,
                        "feature_schema": bundle.feature_schema_id,
                        "feature_contributions": contributions[position],
                    }
                )
        output = pd.DataFrame(output_rows).sort_values(
            "_input_order",
            kind="stable",
        )
        return output.loc[:, OUTPUT_COLUMNS].reset_index(drop=True)

    def _validate_input(self, model_input: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(model_input, pd.DataFrame):
            raise TypeError("model input must be a pandas DataFrame")
        frame = model_input.copy()
        missing_controls = [
            column for column in CONTROL_COLUMNS if column not in frame.columns
        ]
        if missing_controls:
            raise ValueError(f"missing serving columns: {missing_controls}")
        if frame.empty:
            frame["_input_order"] = pd.Series(dtype="int64")
            return frame
        if not frame["eligible"].map(lambda value: value is True).all():
            raise ValueError("shadow scoring accepts only already-eligible rows")
        unknown_placements = sorted(
            set(frame["placement"].astype(str)) - set(self._placements)
        )
        if unknown_placements:
            raise ValueError(f"unsupported placements: {unknown_placements}")

        allowed_features = {
            feature
            for bundle in self._placements.values()
            for feature in bundle.feature_columns
        }
        unknown_columns = set(frame.columns) - set(CONTROL_COLUMNS) - allowed_features
        if unknown_columns:
            raise ValueError(
                f"unexpected non-feature columns: {sorted(unknown_columns)}"
            )
        for placement, rows in frame.groupby("placement", sort=False):
            bundle = self._placements[str(placement)]
            foreign_features = [
                feature
                for feature in allowed_features - set(bundle.feature_columns)
                if feature in frame.columns and rows[feature].notna().any()
            ]
            if foreign_features:
                raise ValueError(
                    f"{placement} has values outside feature schema: "
                    f"{sorted(foreign_features)}"
                )
            missing_features = [
                feature
                for feature in bundle.feature_columns
                if feature not in frame.columns or rows[feature].isna().any()
            ]
            if missing_features:
                raise ValueError(
                    f"{placement} missing feature values: {missing_features}"
                )
            if not rows["feature_schema"].eq(bundle.feature_schema_id).all():
                raise ValueError(
                    f"{placement} feature schema must be {bundle.feature_schema_id}"
                )
            for feature in bundle.numeric_features:
                numeric = pd.to_numeric(rows[feature], errors="coerce")
                if numeric.isna().any() or not np.isfinite(numeric).all():
                    raise ValueError(
                        f"{placement} has invalid numeric feature {feature}"
                    )
            for feature in bundle.categorical_features:
                if not rows[feature].map(lambda value: isinstance(value, str)).all():
                    raise ValueError(
                        f"{placement} has invalid categorical feature {feature}"
                    )
            if (
                "candidate_id" in bundle.feature_columns
                and not rows["action_id"].eq(rows["candidate_id"]).all()
            ):
                raise ValueError(
                    f"{placement} action_id must equal the exact candidate_id"
                )
        if (
            not frame["action_id"]
            .map(lambda value: isinstance(value, str) and bool(value))
            .all()
        ):
            raise ValueError("action_id must be a non-empty string")
        frame["_input_order"] = np.arange(len(frame), dtype="int64")
        return frame

    @staticmethod
    def _calibrated_probabilities(
        bundle: PlacementModel,
        frame: pd.DataFrame,
    ) -> np.ndarray:
        raw = np.asarray(
            bundle.ranker.predict_probability(frame),
            dtype="float64",
        )
        calibrated = np.asarray(bundle.calibrator.predict(raw), dtype="float64")
        return np.clip(calibrated, 0, 1)

    def _feature_contributions(
        self,
        bundle: PlacementModel,
        frame: pd.DataFrame,
        calibrated_probabilities: np.ndarray,
    ) -> list[str]:
        contribution_features = [
            feature
            for feature in bundle.feature_columns
            if feature in bundle.reason_code_mapping
        ]
        counterfactual_frames = []
        for feature in contribution_features:
            counterfactual = frame.copy()
            counterfactual[feature] = (
                "__missing__" if feature in bundle.categorical_features else 0.0
            )
            counterfactual_frames.append(counterfactual)
        if counterfactual_frames:
            counterfactual_probabilities = self._calibrated_probabilities(
                bundle,
                pd.concat(counterfactual_frames, ignore_index=True),
            ).reshape(len(contribution_features), len(frame))
        else:
            counterfactual_probabilities = np.empty((0, len(frame)))

        per_feature: dict[str, np.ndarray] = {}
        for feature_index, feature in enumerate(contribution_features):
            per_feature[feature] = np.clip(
                calibrated_probabilities - counterfactual_probabilities[feature_index],
                -1,
                1,
            )

        encoded: list[str] = []
        for row_index in range(len(frame)):
            contributions = [
                {
                    "feature": feature,
                    "reason_code": bundle.reason_code_mapping[feature],
                    "contribution": round(float(values[row_index]), 8),
                }
                for feature, values in per_feature.items()
                if abs(float(values[row_index])) > 1e-12
            ]
            contributions.sort(
                key=lambda contribution: (
                    -abs(contribution["contribution"]),
                    contribution["feature"],
                )
            )
            encoded.append(
                json.dumps(
                    contributions[:FEATURE_CONTRIBUTION_LIMIT],
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
            )
        return encoded
