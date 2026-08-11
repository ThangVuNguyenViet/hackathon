from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def clipped_inverse_propensity_weights(
    propensities: NDArray[np.float64], *, maximum_weight: float
) -> NDArray[np.float64]:
    values = np.asarray(propensities, dtype=np.float64)
    if maximum_weight < 1 or not np.isfinite(maximum_weight):
        raise ValueError("maximum weight must be finite and at least one")
    if (
        values.ndim != 1
        or not np.all(np.isfinite(values))
        or np.any(values <= 0)
        or np.any(values > 1)
    ):
        raise ValueError("propensities must be finite values in (0, 1]")
    return np.minimum(1.0 / values, maximum_weight)


def effective_sample_size(weights: NDArray[np.float64]) -> float:
    values = np.asarray(weights, dtype=np.float64)
    if values.ndim != 1 or len(values) == 0 or np.any(values <= 0):
        raise ValueError("weights must be a non-empty positive vector")
    return float(values.sum() ** 2 / np.square(values).sum())
