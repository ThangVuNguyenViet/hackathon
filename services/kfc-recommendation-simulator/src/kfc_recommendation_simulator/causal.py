from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from typing import Any

CONDITIONS = (
    "automatic",
    "no_recommendation",
    "random_eligible",
    "popularity",
    "ablate_local_favorite",
    "ablate_for_you",
    "ablate_modifier_upsell",
    "ablate_smart_cross_sell",
)


def _compact_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _policy_name(condition: str) -> str:
    if condition == "no_recommendation":
        return "no_recommendation"
    if condition == "random_eligible":
        return "random_uniform_without_replacement"
    if condition == "popularity":
        return "popularity_descending_v1"
    return "automatic_proxy_scorer_composer_v1"


def _automatic_order(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        candidates,
        key=lambda candidate: (
            -float(candidate["automaticScore"]),
            str(candidate["candidateId"]),
        ),
    )


def _popularity_order(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        candidates,
        key=lambda candidate: (
            -int(candidate["localDemandCount"]),
            str(candidate["candidateId"]),
        ),
    )


def _random_order(
    candidates: list[dict[str, Any]], priorities: Mapping[str, float]
) -> list[dict[str, Any]]:
    return sorted(
        candidates,
        key=lambda candidate: (
            priorities[str(candidate["candidateId"])],
            str(candidate["candidateId"]),
        ),
    )


def _slate(
    *,
    candidates: list[dict[str, Any]],
    recommendation_type: str,
    condition: str,
    desired_smart_size: int,
    random_priorities: Mapping[str, float],
) -> tuple[list[dict[str, Any]], float, float]:
    if condition == "random_eligible":
        ordered = _random_order(candidates, random_priorities)
    elif condition == "popularity":
        ordered = _popularity_order(candidates)
    else:
        ordered = _automatic_order(candidates)
    target = {
        "local_favorite": 3,
        "for_you": 3,
        "modifier_upsell": 3,
        "smart_cross_sell": desired_smart_size,
    }[recommendation_type]
    if recommendation_type == "smart_cross_sell" and condition not in {
        "random_eligible",
        "popularity",
    }:
        diverse: list[dict[str, Any]] = []
        seen_categories: set[str] = set()
        for candidate in ordered:
            category = str(candidate["categoryId"])
            if category in seen_categories:
                continue
            seen_categories.add(category)
            diverse.append(candidate)
            if len(diverse) == target:
                break
        slate = diverse
    else:
        slate = ordered[:target]
    if condition != "random_eligible" or not slate:
        return slate, 1.0, 1.0
    population = len(candidates)
    slate_size = len(slate)
    permutations = math.prod(range(population - slate_size + 1, population + 1))
    return slate, 1.0 / permutations, slate_size / population


def _slate_id(
    journey_id: str, recommendation_type: str, candidate_ids: list[str]
) -> str:
    digest = hashlib.sha256("\0".join(candidate_ids).encode()).hexdigest()[:16]
    return f"slate:{journey_id}:{recommendation_type}:{digest}"


def _suppressed_placement(
    *,
    journey_id: str,
    recommendation_type: str,
    sequence: int,
    condition: str,
    cart_subtotal: int,
    cart_line_count: int,
    parent_line_id: str | None,
) -> dict[str, Any]:
    return {
        "opportunityId": f"opportunity:{journey_id}:{sequence}",
        "sequence": sequence,
        "recommendationType": recommendation_type,
        "status": "suppressed",
        "emptyReason": None,
        "prerequisiteState": "treatment_suppressed",
        "policyName": _policy_name(condition),
        "parentCartLineId": parent_line_id,
        "createdCartLineId": None,
        "eligibleCandidateIds": [],
        "popularityOrderCandidateIds": [],
        "slateId": None,
        "slatePropensity": None,
        "outcomeClass": "suppressed",
        "cartSubtotalBeforeVnd": cart_subtotal,
        "cartSubtotalAfterVnd": cart_subtotal,
        "cartLineCountBefore": cart_line_count,
        "cartLineCountAfter": cart_line_count,
        "members": [],
    }


def _empty_placement(
    *,
    journey_id: str,
    recommendation_type: str,
    sequence: int,
    condition: str,
    empty_reason: str,
    prerequisite_state: str,
    cart_subtotal: int,
    cart_line_count: int,
    parent_line_id: str | None,
) -> dict[str, Any]:
    placement = _suppressed_placement(
        journey_id=journey_id,
        recommendation_type=recommendation_type,
        sequence=sequence,
        condition=condition,
        cart_subtotal=cart_subtotal,
        cart_line_count=cart_line_count,
        parent_line_id=parent_line_id,
    )
    placement.update(
        {
            "status": "empty",
            "emptyReason": empty_reason,
            "prerequisiteState": prerequisite_state,
            "outcomeClass": "empty",
        }
    )
    return placement


def _ready_placement(
    *,
    journey_id: str,
    recommendation_type: str,
    sequence: int,
    condition: str,
    candidates: list[dict[str, Any]],
    desired_smart_size: int,
    random_priorities: Mapping[str, float],
    selection_draw: float,
    choice_draw: float,
    removal_draw: float,
    affinity: float,
    cart_subtotal: int,
    cart_line_count: int,
    parent_line_id: str | None,
) -> dict[str, Any]:
    slate, slate_propensity, member_propensity = _slate(
        candidates=candidates,
        recommendation_type=recommendation_type,
        condition=condition,
        desired_smart_size=desired_smart_size,
        random_priorities=random_priorities,
    )
    if not slate:
        return _empty_placement(
            journey_id=journey_id,
            recommendation_type=recommendation_type,
            sequence=sequence,
            condition=condition,
            empty_reason="no_eligible_candidates",
            prerequisite_state="eligible_candidates_exhausted",
            cart_subtotal=cart_subtotal,
            cart_line_count=cart_line_count,
            parent_line_id=parent_line_id,
        )
    selection_probability = min(0.88, 0.18 + 0.52 * affinity)
    selected_position: int | None = None
    if selection_draw < selection_probability:
        selected_position = min(int(choice_draw * len(slate)), len(slate) - 1)
        outcome_class = "accepted"
    elif selection_draw < selection_probability + 0.22:
        outcome_class = "dismissed"
    else:
        outcome_class = "ignored"
    candidate_ids = [str(candidate["candidateId"]) for candidate in slate]
    slate_id = _slate_id(journey_id, recommendation_type, candidate_ids)
    members: list[dict[str, Any]] = []
    created_line_id: str | None = None
    next_subtotal = cart_subtotal
    next_line_count = cart_line_count
    for position, candidate in enumerate(slate, start=1):
        selected = selected_position == position - 1
        price = int(candidate["priceImpactVnd"])
        if selected:
            next_subtotal += price
            if recommendation_type != "modifier_upsell":
                next_line_count += 1
                created_line_id = f"line:{journey_id}:{sequence}"
        members.append(
            {
                "actionId": (
                    f"action:{journey_id}:{recommendation_type}:"
                    f"{candidate['candidateId']}"
                ),
                "candidateId": candidate["candidateId"],
                "categoryId": candidate["categoryId"],
                "priceImpactVnd": price,
                "renderedPosition": position,
                "slatePropensity": slate_propensity,
                "selectionPropensity": member_propensity,
                "behaviorSelectionProbability": selection_probability / len(slate),
                "selected": selected,
                "removalDraw": removal_draw if selected else None,
            }
        )
    return {
        "opportunityId": f"opportunity:{journey_id}:{sequence}",
        "sequence": sequence,
        "recommendationType": recommendation_type,
        "status": "ready",
        "emptyReason": None,
        "prerequisiteState": "satisfied",
        "policyName": _policy_name(condition),
        "parentCartLineId": parent_line_id,
        "createdCartLineId": created_line_id,
        "eligibleCandidateIds": [
            str(candidate["candidateId"]) for candidate in candidates
        ],
        "popularityOrderCandidateIds": [
            str(candidate["candidateId"]) for candidate in _popularity_order(candidates)
        ],
        "slateId": slate_id,
        "slatePropensity": slate_propensity,
        "outcomeClass": outcome_class,
        "cartSubtotalBeforeVnd": cart_subtotal,
        "cartSubtotalAfterVnd": next_subtotal,
        "cartLineCountBefore": cart_line_count,
        "cartLineCountAfter": next_line_count,
        "members": members,
    }


def simulate_conditions(
    *,
    journey: Mapping[str, Any],
    customer: Mapping[str, Any],
    affinity: float,
    starter_candidates: list[dict[str, Any]],
    modifier_candidates_by_parent: Mapping[str, list[dict[str, Any]]],
    smart_candidates: list[dict[str, Any]],
    exogenous: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    journey_id = str(journey["journeyId"])
    starter_type = (
        "for_you" if int(customer["completedOrderCount"]) > 0 else "local_favorite"
    )
    for condition in CONDITIONS:
        cart_subtotal = int(journey["cartSubtotalVnd"])
        cart_line_count = int(journey["initialCartLineCount"])
        path: list[dict[str, Any]] = []
        placements = (starter_type, "modifier_upsell", "smart_cross_sell")
        starter_line_id: str | None = None
        starter_item_id: str | None = None
        for sequence, recommendation_type in enumerate(placements, start=1):
            ablated = condition == f"ablate_{recommendation_type}"
            if condition == "no_recommendation" or ablated:
                placement = _suppressed_placement(
                    journey_id=journey_id,
                    recommendation_type=recommendation_type,
                    sequence=sequence,
                    condition=condition,
                    cart_subtotal=cart_subtotal,
                    cart_line_count=cart_line_count,
                    parent_line_id=starter_line_id,
                )
            elif recommendation_type == starter_type:
                placement = _ready_placement(
                    journey_id=journey_id,
                    recommendation_type=recommendation_type,
                    sequence=sequence,
                    condition=condition,
                    candidates=starter_candidates,
                    desired_smart_size=3,
                    random_priorities=exogenous["randomPriorities"][
                        recommendation_type
                    ],
                    selection_draw=exogenous["selectionDraws"][recommendation_type],
                    choice_draw=exogenous["choiceDraws"][recommendation_type],
                    removal_draw=exogenous["removalDraws"][recommendation_type],
                    affinity=affinity,
                    cart_subtotal=cart_subtotal,
                    cart_line_count=cart_line_count,
                    parent_line_id=None,
                )
            elif recommendation_type == "modifier_upsell":
                if starter_line_id is None or starter_item_id is None:
                    placement = _empty_placement(
                        journey_id=journey_id,
                        recommendation_type=recommendation_type,
                        sequence=sequence,
                        condition=condition,
                        empty_reason="parent_cart_line_not_found",
                        prerequisite_state="starter_did_not_create_parent_line",
                        cart_subtotal=cart_subtotal,
                        cart_line_count=cart_line_count,
                        parent_line_id=None,
                    )
                else:
                    placement = _ready_placement(
                        journey_id=journey_id,
                        recommendation_type=recommendation_type,
                        sequence=sequence,
                        condition=condition,
                        candidates=list(
                            modifier_candidates_by_parent.get(starter_item_id, [])
                        ),
                        desired_smart_size=3,
                        random_priorities=exogenous["randomPriorities"][
                            recommendation_type
                        ],
                        selection_draw=exogenous["selectionDraws"][recommendation_type],
                        choice_draw=exogenous["choiceDraws"][recommendation_type],
                        removal_draw=exogenous["removalDraws"][recommendation_type],
                        affinity=affinity,
                        cart_subtotal=cart_subtotal,
                        cart_line_count=cart_line_count,
                        parent_line_id=starter_line_id,
                    )
            elif cart_line_count == 0:
                placement = _empty_placement(
                    journey_id=journey_id,
                    recommendation_type=recommendation_type,
                    sequence=sequence,
                    condition=condition,
                    empty_reason="empty_cart",
                    prerequisite_state="modifier_resolved_cart_still_empty",
                    cart_subtotal=cart_subtotal,
                    cart_line_count=cart_line_count,
                    parent_line_id=None,
                )
            else:
                cart_item_ids = {
                    value
                    for value in (
                        journey.get("initialCartItemId"),
                        starter_item_id,
                    )
                    if value is not None
                }
                eligible_smart = [
                    candidate
                    for candidate in smart_candidates
                    if candidate["sellableItemId"] not in cart_item_ids
                ]
                placement = _ready_placement(
                    journey_id=journey_id,
                    recommendation_type=recommendation_type,
                    sequence=sequence,
                    condition=condition,
                    candidates=eligible_smart,
                    desired_smart_size=int(journey["desiredSmartSlateSize"]),
                    random_priorities=exogenous["randomPriorities"][
                        recommendation_type
                    ],
                    selection_draw=exogenous["selectionDraws"][recommendation_type],
                    choice_draw=exogenous["choiceDraws"][recommendation_type],
                    removal_draw=exogenous["removalDraws"][recommendation_type],
                    affinity=affinity,
                    cart_subtotal=cart_subtotal,
                    cart_line_count=cart_line_count,
                    parent_line_id=None,
                )
            path.append(placement)
            cart_subtotal = int(placement["cartSubtotalAfterVnd"])
            cart_line_count = int(placement["cartLineCountAfter"])
            if (
                recommendation_type == starter_type
                and placement["outcomeClass"] == "accepted"
            ):
                starter_line_id = placement["createdCartLineId"]
                selected = next(
                    member for member in placement["members"] if member["selected"]
                )
                starter_item_id = next(
                    candidate["sellableItemId"]
                    for candidate in starter_candidates
                    if candidate["candidateId"] == selected["candidateId"]
                )

        accepted_members = [
            member
            for placement in path
            for member in placement["members"]
            if member["selected"]
        ]
        checkout_probability = min(0.95, 0.58 + 0.06 * len(accepted_members))
        checkout = float(exogenous["checkoutDraw"]) < checkout_probability
        retained: list[dict[str, Any]] = []
        removed: list[dict[str, Any]] = []
        if checkout:
            for member in accepted_members:
                if float(member["removalDraw"]) < 0.10:
                    removed.append(member)
                else:
                    retained.append(member)
        revenue = sum(int(member["priceImpactVnd"]) for member in retained)
        checkout = checkout and int(journey["cartSubtotalVnd"]) + revenue > 0
        selected_ids = [str(member["actionId"]) for member in accepted_members]
        retained_ids = [str(member["actionId"]) for member in retained]
        removed_ids = [str(member["actionId"]) for member in removed]
        for placement in path:
            for member in placement["members"]:
                member["retained"] = member["actionId"] in retained_ids
                member["removed"] = member["actionId"] in removed_ids
        results[condition] = {
            "seed": int(journey["seed"]),
            "journeyId": journey_id,
            "pairedComparisonRef": f"pair:{journey_id}",
            "condition": condition,
            "latentAffinity": affinity,
            "starterRecommendationType": starter_type,
            "baseCartSubtotalVnd": int(journey["cartSubtotalVnd"]),
            "selectedActionIdsJson": _compact_json(selected_ids),
            "retainedActionIdsJson": _compact_json(retained_ids),
            "removedActionIdsJson": _compact_json(removed_ids),
            "treatmentRevenueVnd": revenue,
            "potentialSelection": bool(selected_ids),
            "checkout": checkout,
            "terminalState": ("checkout_completed" if checkout else "order_abandoned"),
            "finalMerchandiseSubtotalVnd": (
                int(journey["cartSubtotalVnd"]) + revenue if checkout else 0
            ),
            "treatmentPathJson": _compact_json(path),
            "_path": path,
        }
    return results
