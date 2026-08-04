from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .metrics import ndcg


class InsufficientRankingEvidence(ValueError):
    """Raised when canonical eligible-set NDCG cannot be identified."""


def evaluate_opportunity_ndcg(
    eligible_rows: Sequence[Mapping[str, Any]],
    *,
    score_by_candidate: Mapping[str, float],
    k: int,
) -> float:
    missing = sum(
        row.get("selectedThroughCheckout") is None for row in eligible_rows
    )
    if missing:
        raise InsufficientRankingEvidence(
            f"{missing} of {len(eligible_rows)} eligible candidates lack "
            "candidate-level relevance required for ideal DCG"
        )
    ordered = sorted(
        eligible_rows,
        key=lambda row: (
            -score_by_candidate[str(row["candidateId"])],
            str(row["candidateId"]),
        ),
    )
    relevance = [int(bool(row["selectedThroughCheckout"])) for row in ordered]
    return ndcg(relevance, k=k)
