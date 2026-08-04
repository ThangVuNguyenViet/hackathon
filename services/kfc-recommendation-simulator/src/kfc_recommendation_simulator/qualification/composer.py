from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScoredCandidate:
    candidate_id: str
    category_id: str
    price_impact_vnd: int
    joint_probability: float

    @property
    def expected_retained_value_vnd(self) -> float:
        return self.joint_probability * self.price_impact_vnd


def compose_candidates(
    *,
    recommendation_type: str,
    candidates: list[ScoredCandidate],
    abstention_threshold: float,
    remaining_budget_vnd: int,
    desired_smart_size: int,
) -> tuple[ScoredCandidate, ...]:
    eligible = sorted(
        (
            candidate
            for candidate in candidates
            if candidate.joint_probability >= abstention_threshold
            and candidate.joint_probability > 0
        ),
        key=lambda candidate: (
            -candidate.expected_retained_value_vnd,
            candidate.candidate_id,
        ),
    )
    if recommendation_type != "smart_cross_sell":
        return tuple(eligible[:1])
    if desired_smart_size not in {3, 4}:
        raise ValueError("Smart desired size must be three or four")
    selected: list[ScoredCandidate] = []
    categories: set[str] = set()
    composed_price = 0
    for candidate in eligible:
        if (
            candidate.category_id in categories
            or composed_price + candidate.price_impact_vnd > remaining_budget_vnd
        ):
            continue
        categories.add(candidate.category_id)
        selected.append(candidate)
        composed_price += candidate.price_impact_vnd
        if len(selected) == desired_smart_size:
            break
    return tuple(selected) if len(selected) >= 3 else ()
