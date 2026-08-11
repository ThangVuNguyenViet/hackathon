from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any, Literal, Protocol

import lightgbm as lgb
import numpy as np
import xgboost as xgb
from numpy.typing import NDArray
from scipy import sparse
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier

ModelFamily = Literal["logistic", "lightgbm", "xgboost", "mlp"]
Matrix = NDArray[np.float64] | sparse.csr_matrix


class BinaryPredictor(Protocol):
    family: ModelFamily

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]: ...


@dataclass(frozen=True)
class FittedBinaryModel:
    family: ModelFamily
    estimator: Any
    hyperparameters: dict[str, Any]

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]:
        if self.family == "lightgbm":
            return np.asarray(
                self.estimator.booster_.predict(features), dtype=np.float64
            )
        return np.asarray(
            self.estimator.predict_proba(features)[:, 1], dtype=np.float64
        )


@dataclass(frozen=True)
class NativeModelArtifact:
    family: ModelFamily
    model_path: Path
    golden_predictions_path: Path
    library: str
    library_version: str


@dataclass(frozen=True)
class _LogisticNativePredictor:
    coefficients: NDArray[np.float64]
    intercept: float
    family: ModelFamily = "logistic"

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]:
        score = np.asarray(features @ self.coefficients, dtype=np.float64).reshape(-1)
        score += self.intercept
        return 1.0 / (1.0 + np.exp(-np.clip(score, -40.0, 40.0)))


@dataclass(frozen=True)
class _LightGbmNativePredictor:
    booster: lgb.Booster
    family: ModelFamily = "lightgbm"

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]:
        return np.asarray(self.booster.predict(features), dtype=np.float64)


@dataclass(frozen=True)
class _XgboostNativePredictor:
    booster: xgb.Booster
    family: ModelFamily = "xgboost"

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]:
        return np.asarray(self.booster.predict(xgb.DMatrix(features)), dtype=np.float64)


@dataclass(frozen=True)
class _MlpNativePredictor:
    coefficients: tuple[NDArray[np.float64], ...]
    intercepts: tuple[NDArray[np.float64], ...]
    activation: str
    output_activation: str
    family: ModelFamily = "mlp"

    def predict_probability(self, features: Matrix) -> NDArray[np.float64]:
        activation = features.toarray() if sparse.issparse(features) else features
        activation = np.asarray(activation, dtype=np.float64)
        for layer_index, (coefficients, intercept) in enumerate(
            zip(self.coefficients, self.intercepts, strict=True)
        ):
            activation = activation @ coefficients + intercept
            is_output = layer_index == len(self.coefficients) - 1
            function = self.output_activation if is_output else self.activation
            if function == "relu":
                activation = np.maximum(activation, 0.0)
            elif function == "tanh":
                activation = np.tanh(activation)
            elif function == "logistic":
                activation = 1.0 / (
                    1.0 + np.exp(-np.clip(activation, -40.0, 40.0))
                )
            elif function != "identity":
                raise ValueError(f"unsupported MLP activation: {function}")
        return np.asarray(activation, dtype=np.float64).reshape(-1)


def fit_binary_model(
    family: ModelFamily,
    features: Matrix,
    labels: NDArray[np.int8],
    weights: NDArray[np.float64],
    *,
    seed: int,
    hyperparameters: dict[str, Any] | None = None,
) -> FittedBinaryModel:
    parameters = dict(hyperparameters or {})
    if family == "logistic":
        defaults = {
            "C": 1.0,
            "max_iter": 1_000,
            "solver": "lbfgs",
            "random_state": seed,
        }
        defaults.update(parameters)
        estimator = LogisticRegression(**defaults)
    elif family == "lightgbm":
        defaults = {
            "n_estimators": 60,
            "learning_rate": 0.05,
            "num_leaves": 15,
            "max_depth": 5,
            "min_child_samples": 40,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "random_state": seed,
            "n_jobs": 1,
            "verbosity": -1,
            "deterministic": True,
            "force_col_wise": True,
        }
        defaults.update(parameters)
        estimator = lgb.LGBMClassifier(**defaults)
    elif family == "xgboost":
        defaults = {
            "n_estimators": 60,
            "learning_rate": 0.05,
            "max_depth": 5,
            "min_child_weight": 10,
            "subsample": 1.0,
            "colsample_bytree": 1.0,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "random_state": seed,
            "n_jobs": 1,
            "tree_method": "hist",
        }
        defaults.update(parameters)
        estimator = xgb.XGBClassifier(**defaults)
    elif family == "mlp":
        defaults = {
            "hidden_layer_sizes": (16,),
            "activation": "relu",
            "solver": "adam",
            "alpha": 0.01,
            "batch_size": "auto",
            "learning_rate_init": 0.001,
            "max_iter": 100,
            "early_stopping": True,
            "validation_fraction": 0.1,
            "n_iter_no_change": 8,
            "random_state": seed,
            "shuffle": True,
        }
        defaults.update(parameters)
        estimator = MLPClassifier(**defaults)
    else:
        raise ValueError(f"unsupported model family: {family}")
    estimator.fit(features, labels, sample_weight=weights)
    return FittedBinaryModel(family, estimator, defaults)


def _matrix_rows(features: Matrix) -> list[list[float]]:
    dense = features.toarray() if sparse.issparse(features) else np.asarray(features)
    return np.asarray(dense, dtype=np.float64).tolist()


def save_native_model(
    model: FittedBinaryModel,
    output_directory: Path | str,
    *,
    golden_features: Matrix,
) -> NativeModelArtifact:
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    if model.family == "logistic":
        library = "scikit-learn"
        model_path = output / "model.json"
        payload = {
            "schemaVersion": "kfc-logistic-model-v1",
            "library": library,
            "libraryVersion": version(library),
            "coefficients": np.asarray(model.estimator.coef_[0]).tolist(),
            "intercept": float(model.estimator.intercept_[0]),
            "classes": np.asarray(model.estimator.classes_).tolist(),
            "hyperparameters": model.hyperparameters,
        }
        model_path.write_text(
            json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
        )
    elif model.family == "lightgbm":
        library = "lightgbm"
        model_path = output / "model.txt"
        model.estimator.booster_.save_model(str(model_path))
    elif model.family == "xgboost":
        library = "xgboost"
        model_path = output / "model.json"
        model.estimator.save_model(model_path)
    else:
        library = "scikit-learn"
        model_path = output / "model.json"
        payload = {
            "schemaVersion": "kfc-mlp-model-v1",
            "library": library,
            "libraryVersion": version(library),
            "coefficients": [
                np.asarray(coefficients, dtype=np.float64).tolist()
                for coefficients in model.estimator.coefs_
            ],
            "intercepts": [
                np.asarray(intercept, dtype=np.float64).tolist()
                for intercept in model.estimator.intercepts_
            ],
            "activation": model.estimator.activation,
            "outputActivation": model.estimator.out_activation_,
            "classes": np.asarray(model.estimator.classes_).tolist(),
            "hyperparameters": model.hyperparameters,
        }
        model_path.write_text(
            json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8"
        )
    golden_path = output / "golden-predictions.json"
    golden_path.write_text(
        json.dumps(
            {
                "schemaVersion": "kfc-model-golden-predictions-v1",
                "libraryFamily": model.family,
                "library": library,
                "libraryVersion": version(library),
                "featureRows": _matrix_rows(golden_features),
                "probabilities": model.predict_probability(golden_features).tolist(),
            },
            sort_keys=True,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return NativeModelArtifact(
        model.family,
        model_path,
        golden_path,
        library,
        version(library),
    )


def load_native_predictor(artifact: NativeModelArtifact) -> BinaryPredictor:
    if artifact.family == "logistic":
        value = json.loads(artifact.model_path.read_text(encoding="utf-8"))
        if value.get("schemaVersion") != "kfc-logistic-model-v1":
            raise ValueError("unsupported logistic artifact schema")
        return _LogisticNativePredictor(
            np.asarray(value["coefficients"], dtype=np.float64),
            float(value["intercept"]),
        )
    if artifact.family == "lightgbm":
        return _LightGbmNativePredictor(
            lgb.Booster(model_file=str(artifact.model_path))
        )
    if artifact.family == "xgboost":
        booster = xgb.Booster()
        booster.load_model(artifact.model_path)
        return _XgboostNativePredictor(booster)
    value = json.loads(artifact.model_path.read_text(encoding="utf-8"))
    if value.get("schemaVersion") != "kfc-mlp-model-v1":
        raise ValueError("unsupported MLP artifact schema")
    return _MlpNativePredictor(
        tuple(
            np.asarray(coefficients, dtype=np.float64)
            for coefficients in value["coefficients"]
        ),
        tuple(
            np.asarray(intercept, dtype=np.float64)
            for intercept in value["intercepts"]
        ),
        str(value["activation"]),
        str(value["outputActivation"]),
    )
