from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from .calibration import weighted_brier_score


def expected_calibration_error(
    labels: NDArray[np.int8],
    probability: NDArray[np.float64],
    weights: NDArray[np.float64],
    *,
    bins: int = 10,
) -> float:
    y = np.asarray(labels, dtype=np.float64)
    p = np.asarray(probability, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    total = float(w.sum())
    error = 0.0
    for index in range(bins):
        lower = index / bins
        upper = (index + 1) / bins
        mask = (p >= lower) & ((p < upper) if index < bins - 1 else (p <= upper))
        if not np.any(mask):
            continue
        bin_weight = float(w[mask].sum())
        error += (
            bin_weight
            / total
            * abs(
                float(np.average(p[mask], weights=w[mask]))
                - float(np.average(y[mask], weights=w[mask]))
            )
        )
    return error


def binary_metrics(
    labels: NDArray[np.int8],
    probability: NDArray[np.float64],
    weights: NDArray[np.float64],
) -> dict[str, float]:
    y = np.asarray(labels, dtype=np.int8)
    p = np.asarray(probability, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    null_probability = np.full(len(y), np.average(y, weights=w), dtype=np.float64)
    return {
        "brier": weighted_brier_score(y, p, w),
        "nullBrier": weighted_brier_score(y, null_probability, w),
        "ece": expected_calibration_error(y, p, w),
        "positiveRate": float(np.average(y, weights=w)),
    }


def probability_quantiles(
    probability: NDArray[np.float64],
) -> dict[str, float]:
    values = np.clip(np.asarray(probability, dtype=np.float64), 0.0, 1.0)
    percentiles = (0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1)
    if values.size == 0:
        return {
            f"p{int(percentile * 100):02d}": 0.0
            for percentile in percentiles
        }
    return {
        f"p{int(percentile * 100):02d}": float(np.quantile(values, percentile))
        for percentile in percentiles
    }


def normal_mean_interval(values: NDArray[np.float64]) -> dict[str, float]:
    array = np.asarray(values, dtype=np.float64)
    mean = float(array.mean()) if len(array) else 0.0
    if len(array) < 2:
        return {"estimate": mean, "lower95": mean, "upper95": mean}
    standard_error = float(array.std(ddof=1) / math.sqrt(len(array)))
    return {
        "estimate": mean,
        "lower95": mean - 1.959963984540054 * standard_error,
        "upper95": mean + 1.959963984540054 * standard_error,
    }


def ndcg(relevance: list[float], *, k: int) -> float:
    if not relevance:
        return 0.0
    observed = relevance[:k]
    dcg = sum(value / math.log2(index + 2) for index, value in enumerate(observed))
    ideal = sorted(relevance, reverse=True)[:k]
    ideal_dcg = sum(value / math.log2(index + 2) for index, value in enumerate(ideal))
    return dcg / ideal_dcg if ideal_dcg else 0.0


def recall_at_k(relevance: list[int], *, k: int) -> float:
    positives = sum(relevance)
    return sum(relevance[:k]) / positives if positives else 0.0
