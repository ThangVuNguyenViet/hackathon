from __future__ import annotations

import json
import math
import shutil
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss

from .benchmark_data import CATEGORICAL_FEATURES, NUMERIC_FEATURES

COUNT_FEATURES = {
    "feature_customer_order_count",
    "feature_customer_item_order_count",
    "feature_customer_category_order_count",
    "feature_store_item_order_count",
    "feature_global_item_order_count",
}
MONEY_FEATURES = {
    "feature_price_delta_vnd",
    "feature_discount_vnd",
    "feature_budget_vnd",
    "feature_cart_subtotal_vnd",
}


def expected_calibration_error(
    labels: np.ndarray, probabilities: np.ndarray, bins: int = 10
) -> float:
    edges = np.linspace(0, 1, bins + 1)
    result = 0.0
    for lower, upper in pairwise(edges):
        mask = (probabilities >= lower) & (
            probabilities <= upper if upper == 1 else probabilities < upper
        )
        if not np.any(mask):
            continue
        result += float(np.mean(mask)) * abs(
            float(np.mean(labels[mask])) - float(np.mean(probabilities[mask]))
        )
    return result


@dataclass
class FeatureSchema:
    vocabularies: dict[str, list[str]]
    numeric_means: dict[str, float]
    numeric_scales: dict[str, float]
    numeric_features: tuple[str, ...] = NUMERIC_FEATURES

    @classmethod
    def fit(
        cls,
        frame: pd.DataFrame,
        *,
        extra_numeric_features: tuple[str, ...] = (),
    ) -> FeatureSchema:
        numeric_features = (*NUMERIC_FEATURES, *extra_numeric_features)
        vocabularies = {
            column: sorted(frame[column].fillna("__missing__").astype(str).unique())
            for column in CATEGORICAL_FEATURES
        }
        numeric = _numeric_frame(frame, numeric_features)
        means = {column: float(numeric[column].mean()) for column in numeric_features}
        scales = {
            column: max(float(numeric[column].std(ddof=0)), 1e-6)
            for column in numeric_features
        }
        return cls(vocabularies, means, scales, numeric_features)

    def tree_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        transformed = _numeric_frame(frame, self.numeric_features)
        for column in CATEGORICAL_FEATURES:
            transformed[column] = pd.Categorical(
                frame[column].fillna("__missing__").astype(str),
                categories=self.vocabularies[column],
            )
        return transformed[[*CATEGORICAL_FEATURES, *self.numeric_features]]

    def tensor_inputs(self, frame: pd.DataFrame) -> dict[str, np.ndarray]:
        inputs: dict[str, np.ndarray] = {}
        for column in CATEGORICAL_FEATURES:
            lookup = {
                value: index + 1
                for index, value in enumerate(self.vocabularies[column])
            }
            inputs[column] = (
                frame[column]
                .fillna("__missing__")
                .astype(str)
                .map(lookup)
                .fillna(0)
                .astype("int32")
                .to_numpy()
            )
        numeric = _numeric_frame(frame, self.numeric_features)
        inputs["numeric"] = np.column_stack(
            [
                (numeric[column].to_numpy(dtype="float32") - self.numeric_means[column])
                / self.numeric_scales[column]
                for column in self.numeric_features
            ]
        ).astype("float32")
        return inputs

    def save(self, path: Path) -> None:
        path.write_text(
            json.dumps(
                {
                    "schemaVersion": "smart-cross-sell-feature-schema-v1",
                    "categoricalFeatures": list(CATEGORICAL_FEATURES),
                    "numericFeatures": list(self.numeric_features),
                    "vocabularies": self.vocabularies,
                    "numericMeans": self.numeric_means,
                    "numericScales": self.numeric_scales,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: Path) -> FeatureSchema:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            vocabularies=payload["vocabularies"],
            numeric_means=payload["numericMeans"],
            numeric_scales=payload["numericScales"],
            numeric_features=tuple(payload["numericFeatures"]),
        )


def _numeric_frame(
    frame: pd.DataFrame,
    numeric_features: tuple[str, ...] = NUMERIC_FEATURES,
) -> pd.DataFrame:
    transformed = pd.DataFrame(index=frame.index)
    for column in numeric_features:
        values = (
            pd.to_numeric(frame[column], errors="coerce").fillna(0).astype("float64")
        )
        if column in COUNT_FEATURES:
            values = np.log1p(values.clip(lower=0))
        elif column in MONEY_FEATURES:
            values = values / 100_000.0
        transformed[column] = values
    return transformed


class Ranker(Protocol):
    name: str

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray: ...

    def save(self, directory: Path) -> None: ...


@dataclass
class TreeRanker:
    name: str
    model: Any
    schema: FeatureSchema

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray:
        return np.asarray(
            self.model.predict_proba(self.schema.tree_frame(frame))[:, 1],
            dtype="float64",
        )

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        if self.name == "lightgbm":
            self.model.booster_.save_model(str(directory / "model.lightgbm.txt"))
        elif self.name == "xgboost":
            self.model.save_model(directory / "model.xgboost.json")
        else:
            joblib.dump(self.model, directory / "model.joblib")
        self.schema.save(directory / "feature-schema.json")


@dataclass
class LightGBMArtifactRanker:
    name: str
    booster: Any
    schema: FeatureSchema
    model_path: Path

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray:
        return np.asarray(
            self.booster.predict(self.schema.tree_frame(frame)),
            dtype="float64",
        )

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / "model.lightgbm.txt"
        if self.model_path.resolve() != destination.resolve():
            shutil.copy2(self.model_path, destination)
        self.schema.save(directory / "feature-schema.json")


@dataclass
class TFRSRanker:
    name: str
    scorer: Any
    schema: FeatureSchema

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray:
        return np.asarray(
            self.scorer.predict(
                self.schema.tensor_inputs(frame),
                batch_size=8192,
                verbose=0,
            )
        ).reshape(-1)

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.scorer.save(directory / "model.keras")
        self.schema.save(directory / "feature-schema.json")


@dataclass
class ProbabilityCalibrator:
    kind: str
    model: Any

    def predict(self, probabilities: np.ndarray) -> np.ndarray:
        clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
        if self.kind == "logistic":
            logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
            return self.model.predict_proba(logits)[:, 1]
        return np.clip(self.model.predict(clipped), 0, 1)

    def save(self, path: Path) -> None:
        joblib.dump(self, path)

    @classmethod
    def load(cls, path: Path) -> ProbabilityCalibrator:
        calibrator = joblib.load(path)
        if not isinstance(calibrator, cls):
            raise TypeError(f"unexpected calibrator artifact: {path}")
        return calibrator


def load_ranker(directory: Path, name: str) -> Ranker:
    schema = FeatureSchema.load(directory / "feature-schema.json")
    if name in {"lightgbm", "lightgbm_embeddings"}:
        import lightgbm as lgb

        model_path = directory / "model.lightgbm.txt"
        return LightGBMArtifactRanker(
            "lightgbm",
            lgb.Booster(model_file=str(model_path)),
            schema,
            model_path,
        )
    if name == "xgboost":
        import xgboost as xgb

        model = xgb.XGBClassifier()
        model.load_model(directory / "model.xgboost.json")
        return TreeRanker(name, model, schema)
    if name == "tfrs":
        import os

        os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
        import tensorflow as tf

        return TFRSRanker(
            name,
            tf.keras.models.load_model(directory / "model.keras", compile=False),
            schema,
        )
    raise ValueError(f"unsupported ranker artifact: {name}")


def select_calibrator(
    labels: np.ndarray, raw_probabilities: np.ndarray
) -> tuple[ProbabilityCalibrator, dict[str, dict[str, float]]]:
    clipped = np.clip(raw_probabilities, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
    logistic = ProbabilityCalibrator(
        "logistic",
        LogisticRegression(C=1.0, max_iter=500, random_state=2026).fit(logits, labels),
    )
    isotonic = ProbabilityCalibrator(
        "isotonic",
        IsotonicRegression(out_of_bounds="clip").fit(clipped, labels),
    )
    candidates = {"logistic": logistic, "isotonic": isotonic}
    metrics = {}
    for name, calibrator in candidates.items():
        probabilities = calibrator.predict(raw_probabilities)
        metrics[name] = {
            "brier": float(brier_score_loss(labels, probabilities)),
            "ece": expected_calibration_error(labels, probabilities),
        }
    isotonic_gain = metrics["logistic"]["brier"] - metrics["isotonic"]["brier"]
    selected = isotonic if isotonic_gain >= 0.002 else logistic
    return selected, metrics


def inverse_propensity_weights(frame: pd.DataFrame, clip: float) -> np.ndarray:
    propensities = np.clip(
        frame["action_propensity"].to_numpy(dtype="float64"), 1e-9, 1
    )
    return np.minimum(1 / propensities, clip)


def fit_lightgbm(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    *,
    schema: FeatureSchema,
    params: dict[str, Any],
    propensity_clip: float,
) -> TreeRanker:
    import lightgbm as lgb

    model = lgb.LGBMClassifier(
        objective="binary",
        random_state=2026,
        verbosity=-1,
        n_jobs=1,
        **params,
    )
    model.fit(
        schema.tree_frame(train),
        train["success"].to_numpy(),
        sample_weight=inverse_propensity_weights(train, propensity_clip),
        categorical_feature=list(CATEGORICAL_FEATURES),
        eval_set=[(schema.tree_frame(validation), validation["success"].to_numpy())],
        eval_sample_weight=[inverse_propensity_weights(validation, propensity_clip)],
        callbacks=[lgb.early_stopping(30, verbose=False)],
    )
    return TreeRanker("lightgbm", model, schema)


def fit_xgboost(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    *,
    schema: FeatureSchema,
    params: dict[str, Any],
    propensity_clip: float,
) -> TreeRanker:
    import xgboost as xgb

    model = xgb.XGBClassifier(
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=2026,
        n_jobs=1,
        tree_method="hist",
        enable_categorical=True,
        early_stopping_rounds=30,
        **params,
    )
    model.fit(
        schema.tree_frame(train),
        train["success"].to_numpy(),
        sample_weight=inverse_propensity_weights(train, propensity_clip),
        eval_set=[(schema.tree_frame(validation), validation["success"].to_numpy())],
        sample_weight_eval_set=[
            inverse_propensity_weights(validation, propensity_clip)
        ],
        verbose=False,
    )
    return TreeRanker("xgboost", model, schema)


def fit_tfrs(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    *,
    schema: FeatureSchema,
    params: dict[str, Any],
    propensity_clip: float,
) -> TFRSRanker:
    import os

    # tensorflow-recommenders 0.7.x uses the Keras 2 compatibility package
    # when paired with TensorFlow 2.16+.
    os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
    os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")
    os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "1")
    os.environ.setdefault("TF_NUM_INTEROP_THREADS", "1")
    import tensorflow as tf
    import tensorflow_recommenders as tfrs

    tf.keras.utils.set_random_seed(2026)
    tf.config.experimental.enable_op_determinism()
    inputs: dict[str, Any] = {}
    encoded = []
    embedding_dimension = int(params["embedding_dimension"])
    for column in CATEGORICAL_FEATURES:
        input_layer = tf.keras.Input(shape=(), dtype=tf.int32, name=column)
        inputs[column] = input_layer
        vocabulary_size = len(schema.vocabularies[column]) + 1
        dimension = min(
            embedding_dimension,
            max(4, math.ceil(math.log2(vocabulary_size + 1)) * 2),
        )
        encoded.append(
            tf.keras.layers.Embedding(vocabulary_size + 1, dimension)(input_layer)
        )
    numeric_input = tf.keras.Input(
        shape=(len(schema.numeric_features),), dtype=tf.float32, name="numeric"
    )
    inputs["numeric"] = numeric_input
    encoded.append(numeric_input)
    combined = tf.keras.layers.Concatenate()(encoded)
    hidden = combined
    for units in (128, 64, 32):
        hidden = tf.keras.layers.Dense(
            units,
            activation="relu",
            kernel_regularizer=tf.keras.regularizers.l2(params["l2"]),
        )(hidden)
        hidden = tf.keras.layers.Dropout(params["dropout"])(hidden)
    output = tf.keras.layers.Dense(1, activation="sigmoid")(hidden)
    scorer = tf.keras.Model(inputs=inputs, outputs=output, name="compact_tfrs_scorer")

    class WeightedRankingModel(tfrs.Model):
        def __init__(self) -> None:
            super().__init__()
            self.scorer = scorer
            self.task = tfrs.tasks.Ranking(loss=tf.keras.losses.BinaryCrossentropy())

        def call(self, features: dict[str, Any]) -> Any:
            return self.scorer(
                {
                    key: value
                    for key, value in features.items()
                    if not key.startswith("_")
                }
            )

        def compute_loss(self, features: dict[str, Any], training: bool = False) -> Any:
            predictions = self(features)
            return self.task(
                labels=features["_label"],
                predictions=predictions,
                sample_weight=features["_weight"],
                compute_metrics=not training,
            )

    def dataset(frame: pd.DataFrame, shuffle: bool) -> Any:
        values = schema.tensor_inputs(frame)
        values["_label"] = frame["success"].to_numpy(dtype="float32").reshape(-1, 1)
        values["_weight"] = inverse_propensity_weights(frame, propensity_clip).astype(
            "float32"
        )
        result = tf.data.Dataset.from_tensor_slices(values)
        options = tf.data.Options()
        options.experimental_deterministic = True
        result = result.with_options(options)
        if shuffle:
            result = result.shuffle(
                min(len(frame), 100_000),
                seed=2026,
                reshuffle_each_iteration=True,
            )
        return result.batch(int(params["batch_size"])).prefetch(tf.data.AUTOTUNE)

    model = WeightedRankingModel()
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=params["learning_rate"])
    )
    model.fit(
        dataset(train, True),
        validation_data=dataset(validation, False),
        epochs=int(params["epochs"]),
        verbose=0,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss",
                patience=2,
                restore_best_weights=True,
            )
        ],
    )
    return TFRSRanker("tfrs", scorer, schema)
