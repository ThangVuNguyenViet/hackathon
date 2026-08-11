from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any


def count_invalid_rows(
    *,
    training_rows: Iterable[Mapping[str, Any]],
    journey_rows: Iterable[Mapping[str, Any]],
    scorer_requests: Iterable[Mapping[str, Any]],
) -> dict[str, int]:
    counters = {
        "invalidPropensity": 0,
        "invalidFulfilmentMode": 0,
        "invalidShownLabel": 0,
        "missingTerminalJourney": 0,
        "invalidScorerCandidateShape": 0,
    }
    for row in training_rows:
        shown = row.get("shown") is True
        propensity = row.get("exposurePropensity")
        if shown and (
            isinstance(propensity, bool)
            or not isinstance(propensity, (int, float))
            or not 0 < float(propensity) <= 1
        ):
            counters["invalidPropensity"] += 1
        if row.get("fulfilmentMode") not in {"pickup", "delivery"}:
            counters["invalidFulfilmentMode"] += 1
        labels = (row.get("selected"), row.get("selectedThroughCheckout"))
        if (shown and any(value is None for value in labels)) or (
            not shown and any(value is not None for value in labels)
        ):
            counters["invalidShownLabel"] += 1
    for row in journey_rows:
        if row.get("terminalState") not in {
            "checkout_completed",
            "order_abandoned",
        }:
            counters["missingTerminalJourney"] += 1
    for request in scorer_requests:
        candidates = request.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            counters["invalidScorerCandidateShape"] += 1
    return counters
