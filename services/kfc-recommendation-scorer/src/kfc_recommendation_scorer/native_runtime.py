from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .bundle import BundleUnavailable, QualifiedBundle
from .contract import (
    parse_automatic_scorer_request,
    parse_automatic_scorer_response,
)

Matrix = NDArray[np.float64]


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BundleUnavailable("qualified_bundle_artifact_invalid") from error
    if not isinstance(value, dict):
        raise BundleUnavailable("qualified_bundle_artifact_invalid")
    return value


@dataclass(frozen=True)
class FeatureEncoder:
    categorical: tuple[str, ...]
    numeric: tuple[str, ...]
    categories: dict[str, tuple[str, ...]]
    scales: dict[str, float]
    feature_names: tuple[str, ...]

    @classmethod
    def load(cls, path: Path) -> FeatureEncoder:
        value = _json(path)
        if value.get("schemaVersion") != "kfc-feature-encoder-v1":
            raise BundleUnavailable("feature_encoder_schema_invalid")
        encoder = cls(
            tuple(value["categoricalFields"]),
            tuple(value["numericFields"]),
            {name: tuple(items) for name, items in value["categories"].items()},
            {name: float(scale) for name, scale in value["numericScales"].items()},
            tuple(value["featureNames"]),
        )
        expected = encoder.numeric + tuple(
            f"{field}={category}"
            for field in encoder.categorical
            for category in encoder.categories[field]
        )
        if encoder.feature_names != expected:
            raise BundleUnavailable("feature_encoder_order_invalid")
        return encoder

    def transform(self, rows: list[Mapping[str, Any]]) -> Matrix:
        output = np.zeros((len(rows), len(self.feature_names)), dtype=np.float64)
        for row_index, row in enumerate(rows):
            offset = 0
            for field in self.numeric:
                raw = row.get(field)
                if raw is not None:
                    output[row_index, offset] = float(raw) / self.scales.get(field, 1.0)
                offset += 1
            for field in self.categorical:
                raw = "__NULL__" if row.get(field) is None else str(row[field])
                known = self.categories[field]
                category = raw if raw in known else "__UNKNOWN__"
                if category not in known:
                    raise BundleUnavailable("feature_encoder_unknown_category_missing")
                output[row_index, offset + known.index(category)] = 1.0
                offset += len(known)
        return output


def _json_predictor(path: Path) -> Callable[[Matrix], Matrix]:
    value = _json(path)
    schema = value.get("schemaVersion")
    if schema == "kfc-logistic-model-v1":
        coefficients = np.asarray(value["coefficients"], dtype=np.float64)
        intercept = float(value["intercept"])

        def logistic(features: Matrix) -> Matrix:
            score = features @ coefficients + intercept
            return 1.0 / (1.0 + np.exp(-np.clip(score, -40.0, 40.0)))

        return logistic
    if schema != "kfc-mlp-model-v1":
        raise BundleUnavailable("native_model_schema_invalid")
    coefficients = tuple(
        np.asarray(item, dtype=np.float64) for item in value["coefficients"]
    )
    intercepts = tuple(
        np.asarray(item, dtype=np.float64) for item in value["intercepts"]
    )
    hidden_activation = str(value["activation"])
    output_activation = str(value["outputActivation"])

    def mlp(features: Matrix) -> Matrix:
        activation = features
        for index, (weights, intercept) in enumerate(
            zip(coefficients, intercepts, strict=True)
        ):
            activation = activation @ weights + intercept
            function = (
                output_activation
                if index == len(coefficients) - 1
                else hidden_activation
            )
            if function == "relu":
                activation = np.maximum(activation, 0.0)
            elif function == "tanh":
                activation = np.tanh(activation)
            elif function == "logistic":
                activation = 1.0 / (1.0 + np.exp(-np.clip(activation, -40.0, 40.0)))
            elif function != "identity":
                raise BundleUnavailable("native_mlp_activation_invalid")
        return np.asarray(activation, dtype=np.float64).reshape(-1)

    return mlp


def _predictor(family: str, path: Path) -> Callable[[Matrix], Matrix]:
    if family in {"logistic", "mlp"}:
        return _json_predictor(path)
    if family == "lightgbm":
        import lightgbm as lgb

        booster = lgb.Booster(model_file=str(path))
        return lambda features: np.asarray(booster.predict(features), dtype=np.float64)
    if family == "xgboost":
        import xgboost as xgb

        booster = xgb.Booster()
        booster.load_model(path)
        return lambda features: np.asarray(
            booster.predict(xgb.DMatrix(features)), dtype=np.float64
        )
    raise BundleUnavailable("native_model_family_invalid")


def _calibrator(path: Path) -> Callable[[Matrix], Matrix]:
    value = _json(path)
    if value.get("schemaVersion") != "kfc-probability-calibrator-v1":
        raise BundleUnavailable("calibrator_schema_invalid")
    parameters = value["parameters"]
    if value.get("method") == "sigmoid":
        slope = float(parameters["slope"])
        intercept = float(parameters["intercept"])

        def sigmoid(probability: Matrix) -> Matrix:
            values = np.clip(probability, 1e-8, 1 - 1e-8)
            logits = np.log(values / (1.0 - values))
            score = slope * logits + intercept
            return 1.0 / (1.0 + np.exp(-np.clip(score, -40.0, 40.0)))

        return sigmoid
    if value.get("method") == "isotonic":
        x = np.asarray(parameters["x"], dtype=np.float64)
        y = np.asarray(parameters["y"], dtype=np.float64)
        return lambda probability: np.interp(probability, x, y, left=y[0], right=y[-1])
    raise BundleUnavailable("calibrator_method_invalid")


@dataclass(frozen=True)
class TypeRuntime:
    encoder: FeatureEncoder
    selection: Callable[[Matrix], Matrix]
    joint: Callable[[Matrix], Matrix]
    selection_calibrator: Callable[[Matrix], Matrix]
    joint_calibrator: Callable[[Matrix], Matrix]


def _load_type(bundle: QualifiedBundle, recommendation_type: str) -> TypeRuntime:
    root = bundle.root / "models" / recommendation_type
    family = str(bundle.manifest["champions"][recommendation_type])
    model_name = "model.txt" if family == "lightgbm" else "model.json"
    selection = _predictor(family, root / "selection" / model_name)
    joint = _predictor(family, root / "joint" / model_name)
    for head, predictor in (("selection", selection), ("joint", joint)):
        golden = _json(root / head / "golden-predictions.json")
        expected = np.asarray(golden["probabilities"], dtype=np.float64)
        actual = predictor(np.asarray(golden["featureRows"], dtype=np.float64))
        if actual.shape != expected.shape or not np.allclose(
            actual, expected, rtol=1e-10, atol=1e-12
        ):
            raise BundleUnavailable("native_model_golden_prediction_mismatch")
    return TypeRuntime(
        FeatureEncoder.load(root / "feature-encoder.json"),
        selection,
        joint,
        _calibrator(root / "selection-calibrator.json"),
        _calibrator(root / "joint-calibrator.json"),
    )


class QualifiedBundleRuntime:
    def __init__(self, bundle: QualifiedBundle) -> None:
        self.bundle = bundle
        self.types = {
            recommendation_type: _load_type(bundle, recommendation_type)
            for recommendation_type in sorted(bundle.manifest["champions"])
        }

    def score(self, request_value: Any) -> dict[str, Any]:
        request = parse_automatic_scorer_request(request_value).to_wire()
        recommendation_type = request["recommendationType"]
        if request["model"] != self.bundle.model_binding(recommendation_type):
            raise BundleUnavailable("scorer_model_binding_mismatch")
        runtime = self.types[recommendation_type]
        features = runtime.encoder.transform(
            [candidate["features"] for candidate in request["candidates"]]
        )
        selection = runtime.selection_calibrator(runtime.selection(features))
        joint = np.minimum(selection, runtime.joint_calibrator(runtime.joint(features)))
        response = {
            "schemaVersion": "kfc-automatic-scorer-v1",
            "requestId": request["requestId"],
            "model": request["model"],
            "scores": [
                {
                    "candidateId": candidate["candidateId"],
                    "selectionProbability": float(selection[index]),
                    "jointProbability": float(joint[index]),
                    "explanationValues": {},
                }
                for index, candidate in enumerate(request["candidates"])
            ],
        }
        return parse_automatic_scorer_response(response).to_wire()
