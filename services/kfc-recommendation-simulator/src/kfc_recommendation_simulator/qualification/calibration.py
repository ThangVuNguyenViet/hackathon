from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


@dataclass(frozen=True)
class CalibrationModel:
    method: Literal["sigmoid", "isotonic"]
    parameters: dict[str, Any]

    def predict(self, probability: NDArray[np.float64]) -> NDArray[np.float64]:
        values = np.clip(np.asarray(probability, dtype=np.float64), 1e-8, 1 - 1e-8)
        if self.method == "sigmoid":
            logits = np.log(values / (1.0 - values))
            score = float(self.parameters["slope"]) * logits + float(
                self.parameters["intercept"]
            )
            return 1.0 / (1.0 + np.exp(-np.clip(score, -40.0, 40.0)))
        x = np.asarray(self.parameters["x"], dtype=np.float64)
        y = np.asarray(self.parameters["y"], dtype=np.float64)
        return np.interp(values, x, y, left=y[0], right=y[-1])

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": "kfc-probability-calibrator-v1",
            "method": self.method,
            "parameters": self.parameters,
        }


def select_calibrator(
    *,
    row_count: int,
    positive_count: int,
    negative_count: int,
    sigmoid_brier: float,
    isotonic_brier: float,
    sigmoid: CalibrationModel,
    isotonic: CalibrationModel,
) -> CalibrationModel:
    isotonic_has_support = (
        row_count >= 1_000 and positive_count >= 100 and negative_count >= 100
    )
    improvement = sigmoid_brier - isotonic_brier
    if isotonic_has_support and improvement >= 0.002:
        return isotonic
    return sigmoid


def enforce_joint_probability_bound(
    selection_probability: NDArray[np.float64],
    joint_probability: NDArray[np.float64],
) -> NDArray[np.float64]:
    selection = np.asarray(selection_probability, dtype=np.float64)
    joint = np.asarray(joint_probability, dtype=np.float64)
    if selection.shape != joint.shape:
        raise ValueError("selection and joint probability shapes must match")
    return np.minimum(np.clip(joint, 0.0, 1.0), np.clip(selection, 0.0, 1.0))


def weighted_brier_score(
    labels: NDArray[np.int8],
    probability: NDArray[np.float64],
    weights: NDArray[np.float64],
) -> float:
    return float(np.average(np.square(probability - labels), weights=weights))


def fit_calibrator(
    raw_probability: NDArray[np.float64],
    labels: NDArray[np.int8],
    weights: NDArray[np.float64],
) -> tuple[CalibrationModel, dict[str, Any]]:
    raw = np.clip(np.asarray(raw_probability, dtype=np.float64), 1e-8, 1 - 1e-8)
    y = np.asarray(labels, dtype=np.int8)
    sample_weight = np.asarray(weights, dtype=np.float64)
    logits = np.log(raw / (1.0 - raw)).reshape(-1, 1)
    if len(np.unique(y)) < 2:
        mean = float(np.average(y, weights=sample_weight))
        sigmoid = CalibrationModel(
            "sigmoid",
            {
                "slope": 0.0,
                "intercept": float(np.log((mean + 1e-8) / (1 - mean + 1e-8))),
            },
        )
    else:
        platt = LogisticRegression(C=1_000_000.0, solver="lbfgs", max_iter=300)
        platt.fit(logits, y, sample_weight=sample_weight)
        sigmoid = CalibrationModel(
            "sigmoid",
            {
                "slope": float(platt.coef_[0][0]),
                "intercept": float(platt.intercept_[0]),
            },
        )
    isotonic_estimator = IsotonicRegression(out_of_bounds="clip")
    isotonic_estimator.fit(raw, y, sample_weight=sample_weight)
    isotonic = CalibrationModel(
        "isotonic",
        {
            "x": isotonic_estimator.X_thresholds_.astype(float).tolist(),
            "y": isotonic_estimator.y_thresholds_.astype(float).tolist(),
        },
    )
    sigmoid_brier = weighted_brier_score(y, sigmoid.predict(raw), sample_weight)
    isotonic_brier = weighted_brier_score(y, isotonic.predict(raw), sample_weight)
    positive_count = int(y.sum())
    selected = select_calibrator(
        row_count=len(y),
        positive_count=positive_count,
        negative_count=len(y) - positive_count,
        sigmoid_brier=sigmoid_brier,
        isotonic_brier=isotonic_brier,
        sigmoid=sigmoid,
        isotonic=isotonic,
    )
    return selected, {
        "rowCount": len(y),
        "positiveCount": positive_count,
        "negativeCount": len(y) - positive_count,
        "sigmoidBrier": sigmoid_brier,
        "isotonicBrier": isotonic_brier,
        "selectedMethod": selected.method,
        "isotonicMinimumSupportMet": (
            len(y) >= 1_000 and positive_count >= 100 and len(y) - positive_count >= 100
        ),
        "isotonicImprovementRequired": 0.002,
    }
