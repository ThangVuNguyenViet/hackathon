from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from .models import InputPaths, LoggingPolicy, Placement, WorldConfig

TASTE_DIMENSIONS = (
    "spice",
    "crispiness",
    "savory",
    "sweet",
    "beverage",
    "indulgence",
    "portability",
    "sharing",
)
MISSIONS = (
    "solo_meal",
    "quick_lunch",
    "snack",
    "family_meal",
    "group_gathering",
    "value_seeking",
    "treat",
    "promotion_seeking",
)
SLATE_SIZES = {
    Placement.LOCAL_FAVORITES: 5,
    Placement.SMART_CROSS_SELL: 3,
    Placement.MODIFIER_UPSELL: 3,
    Placement.SANITY_SINGLE_UPSELL: 1,
}
POSITION_EXAMINATION = (1.0, 0.72, 0.50, 0.35, 0.25)


@dataclass(frozen=True)
class SimulationTables:
    requests: list[dict[str, Any]]
    candidates: list[dict[str, Any]]
    impressions: list[dict[str, Any]]
    outcomes: list[dict[str, Any]]
    oracle: list[dict[str, Any]]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _stable_unit(seed: int, *parts: object) -> float:
    payload = "|".join((str(seed), *(str(part) for part in parts))).encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big") / 2**64


def _stable_vector(seed: int, identity: str) -> np.ndarray:
    values = [_stable_unit(seed, identity, dimension) for dimension in TASTE_DIMENSIONS]
    return np.asarray(values, dtype=np.float64) * 2.0 - 1.0


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


def _flatten_modifier_options(
    groups: Iterable[dict[str, Any]],
    prefix: tuple[str, ...] = (),
) -> Iterable[tuple[tuple[str, ...], dict[str, Any]]]:
    for group in groups:
        path = (*prefix, str(group["groupId"]))
        for option in group["options"]:
            yield path, option
            yield from _flatten_modifier_options(option.get("modifierGroups", []), path)


def _product_candidates(
    menu: list[dict[str, Any]],
    basket_item_id: str,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for item in menu:
        reason = None
        if not item["available"]:
            reason = "catalog_unavailable"
        elif item["itemId"] == basket_item_id:
            reason = "already_in_basket"
        elif item["priceVnd"] == 0:
            reason = "promotion_evidence_missing"
        candidates.append(
            {
                "candidate_id": f"item:{item['itemId']}",
                "item_id": str(item["itemId"]),
                "name": item["name"],
                "category": item["category"],
                "price_delta_vnd": int(item["priceVnd"]),
                "action_kind": "add_item",
                "modifier_path": None,
                "eligible": reason is None,
                "eligibility_reason": reason or "eligible",
            }
        )
    return candidates


def _modifier_candidates(
    modifier_trees: list[dict[str, Any]],
    basket_item_id: str,
) -> list[dict[str, Any]]:
    tree = next(
        (entry for entry in modifier_trees if str(entry["itemId"]) == basket_item_id),
        None,
    )
    if tree is None:
        return []
    candidates: list[dict[str, Any]] = []
    for path, option in _flatten_modifier_options(tree["modifierGroups"]):
        candidates.append(
            {
                "candidate_id": (
                    f"modifier:{basket_item_id}:{'/'.join(path)}:{option['modifierId']}"
                ),
                "item_id": basket_item_id,
                "name": option["name"],
                "category": "modifier",
                "price_delta_vnd": int(option["priceDeltaVnd"]),
                "action_kind": "set_modifier",
                "modifier_path": "/".join((*path, str(option["modifierId"]))),
                "eligible": not bool(option["default"]),
                "eligibility_reason": (
                    "already_default" if option["default"] else "eligible"
                ),
            }
        )
    return candidates


def _policy_for(
    rng: np.random.Generator,
    config: WorldConfig,
) -> LoggingPolicy:
    policies = list(LoggingPolicy)
    weights = [config.logging_policy_weights[policy] for policy in policies]
    return policies[int(rng.choice(len(policies), p=weights))]


def _policy_score(
    policy: LoggingPolicy,
    candidate: dict[str, Any],
    basket_item_id: str,
    seed: int,
) -> float:
    identity = candidate["candidate_id"]
    if policy is LoggingPolicy.POPULARITY:
        return _stable_unit(seed, "popularity", identity)
    if policy is LoggingPolicy.BASKET_ASSOCIATION:
        return _stable_unit(seed, "association", basket_item_id, identity)
    if policy is LoggingPolicy.PROMOTION_BIASED:
        discount_signal = 1.0 / (1.0 + max(candidate["price_delta_vnd"], 0) / 40_000)
        return 0.8 * discount_signal + 0.2 * _stable_unit(seed, "promo", identity)
    return _stable_unit(seed, "randomized", identity)


def _utility_components(
    *,
    candidate: dict[str, Any],
    taste: np.ndarray,
    basket_item_id: str,
    mission: str,
    budget_vnd: int,
    world_seed: int,
) -> dict[str, float]:
    profile = _stable_vector(world_seed, candidate["candidate_id"])
    taste_match = float(np.dot(taste, profile) / len(TASTE_DIMENSIONS))
    affinity = _stable_unit(
        world_seed, "affinity", basket_item_id, candidate["candidate_id"]
    ) * 2 - 1
    mission_match = _stable_unit(
        world_seed, "mission", mission, candidate["candidate_id"]
    ) * 2 - 1
    price_ratio = candidate["price_delta_vnd"] / max(budget_vnd, 1)
    price_response = -min(price_ratio, 2.0)
    diversity = _stable_unit(world_seed, "diversity", candidate["category"]) - 0.5
    total = (
        1.35 * taste_match
        + 0.95 * affinity
        + 0.65 * mission_match
        + 0.85 * price_response
        + 0.35 * diversity
    )
    return {
        "taste_match": taste_match,
        "basket_affinity": affinity,
        "mission_match": mission_match,
        "price_response": price_response,
        "diversity_effect": diversity,
        "total_utility": total,
    }


def simulate(config: WorldConfig, inputs: InputPaths) -> SimulationTables:
    menu: list[dict[str, Any]] = _read_json(inputs.menu_items)
    stores: list[dict[str, Any]] = _read_json(inputs.stores)
    modifiers: list[dict[str, Any]] = _read_json(inputs.modifiers)
    customizable_ids = {
        str(tree["itemId"]) for tree in modifiers if tree.get("modifierGroups")
    }
    basket_menu = [
        item
        for item in menu
        if item["available"] and item["priceVnd"] > 0 and str(item["itemId"]) in customizable_ids
    ]
    if not basket_menu:
        raise ValueError("No customizable basket items in fixture snapshot")

    traffic_rng = np.random.default_rng(config.traffic_seed)
    logging_rng = np.random.default_rng(config.logging_seed)
    requests: list[dict[str, Any]] = []
    candidate_rows: list[dict[str, Any]] = []
    impressions: list[dict[str, Any]] = []
    outcomes: list[dict[str, Any]] = []
    oracle_rows: list[dict[str, Any]] = []
    start = datetime(2026, 1, 1, tzinfo=UTC)

    for journey_index in range(config.journey_count):
        journey_id = f"journey-{journey_index:06d}"
        store = stores[int(traffic_rng.integers(0, len(stores)))]
        basket_item = basket_menu[int(traffic_rng.integers(0, len(basket_menu)))]
        basket_item_id = str(basket_item["itemId"])
        mission = MISSIONS[int(traffic_rng.integers(0, len(MISSIONS)))]
        party_size = int(traffic_rng.integers(1, 7))
        budget_vnd = int(traffic_rng.choice((80_000, 120_000, 180_000, 260_000)))
        day_offset = int(traffic_rng.integers(0, config.horizon_days))
        hour = int(traffic_rng.choice((10, 12, 14, 18, 20)))
        occurred_at = (start + timedelta(days=day_offset, hours=hour)).isoformat()
        taste = np.asarray(
            [
                _stable_unit(config.world_seed, journey_id, dimension) * 2 - 1
                for dimension in TASTE_DIMENSIONS
            ]
        )

        requests.append(
            {
                "journey_id": journey_id,
                "store_id": store["storeId"],
                "store_name": store["name"],
                "occurred_at": occurred_at,
                "mission": mission,
                "party_size": party_size,
                "budget_vnd": budget_vnd,
                "basket_item_id": basket_item_id,
                "basket_item_name": basket_item["name"],
                "basket_subtotal_vnd": int(basket_item["priceVnd"]),
            }
        )

        basket_subtotal = int(basket_item["priceVnd"])
        for placement in Placement:
            request_id = f"{journey_id}:{placement.value}"
            candidates = (
                _modifier_candidates(modifiers, basket_item_id)
                if placement is Placement.MODIFIER_UPSELL
                else _product_candidates(menu, basket_item_id)
            )
            eligible = [candidate for candidate in candidates if candidate["eligible"]]
            if not eligible:
                continue
            policy = _policy_for(logging_rng, config)
            slate_size = min(SLATE_SIZES[placement], len(eligible))
            scored = sorted(
                eligible,
                key=lambda candidate: (
                    -_policy_score(
                        policy, candidate, basket_item_id, config.logging_seed
                    ),
                    candidate["candidate_id"],
                ),
            )
            slate = scored[:slate_size]
            policy_probability = config.logging_policy_weights[policy]
            if policy is LoggingPolicy.RANDOMIZED_EXPLORATION:
                slate_probability = 1.0 / math.perm(len(eligible), slate_size)
            else:
                slate_probability = 1.0
            joint_propensity = policy_probability * slate_probability

            utility_by_id: dict[str, dict[str, float]] = {}
            for candidate in candidates:
                components = _utility_components(
                    candidate=candidate,
                    taste=taste,
                    basket_item_id=basket_item_id,
                    mission=mission,
                    budget_vnd=budget_vnd,
                    world_seed=config.world_seed,
                )
                utility_by_id[candidate["candidate_id"]] = components
                candidate_rows.append(
                    {
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": placement.value,
                        **candidate,
                        "feature_price_delta_vnd": candidate["price_delta_vnd"],
                        "feature_category": candidate["category"],
                        "feature_mission": mission,
                        "feature_party_size": party_size,
                        "feature_budget_vnd": budget_vnd,
                        "feature_basket_subtotal_vnd": basket_subtotal,
                    }
                )
                if candidate["eligible"]:
                    base_probability = float(
                        1.0 / (1.0 + math.exp(-(components["total_utility"] - 0.35)))
                    )
                    oracle_rows.append(
                        {
                            "request_id": request_id,
                            "journey_id": journey_id,
                            "placement": placement.value,
                            "candidate_id": candidate["candidate_id"],
                            **components,
                            "latent_taste_vector": taste.tolist(),
                            "base_response_probability": base_probability,
                            "common_random_draw": _stable_unit(
                                config.outcome_seed,
                                journey_id,
                                placement.value,
                                candidate["candidate_id"],
                            ),
                        }
                    )

            displayed_utilities = np.asarray(
                [
                    utility_by_id[candidate["candidate_id"]]["total_utility"]
                    + math.log(POSITION_EXAMINATION[position])
                    for position, candidate in enumerate(slate)
                ]
                + [0.0]
            )
            choice_probabilities = _softmax(displayed_utilities)
            outcome_draw = _stable_unit(
                config.outcome_seed, journey_id, placement.value, "choice"
            )
            chosen_index = int(
                np.searchsorted(np.cumsum(choice_probabilities), outcome_draw)
            )
            selected_candidate = (
                slate[chosen_index] if chosen_index < len(slate) else None
            )

            impression_id = f"impression:{request_id}"
            for position, candidate in enumerate(slate):
                impressions.append(
                    {
                        "impression_id": impression_id,
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": placement.value,
                        "candidate_id": candidate["candidate_id"],
                        "position": position + 1,
                        "logging_policy": policy.value,
                        "logging_policy_probability": policy_probability,
                        "slate_probability_given_policy": slate_probability,
                        "joint_slate_propensity": joint_propensity,
                        "examination_probability": POSITION_EXAMINATION[position],
                    }
                )

            if selected_candidate is None:
                outcome_kind = "non_selection"
                selected_candidate_id = None
                gross_delta = 0
            else:
                outcome_kind = "selected_and_added"
                selected_candidate_id = selected_candidate["candidate_id"]
                gross_delta = int(selected_candidate["price_delta_vnd"])
                basket_subtotal += gross_delta
            checkout_probability = min(
                0.92,
                max(
                    0.35,
                    0.78
                    - max(basket_subtotal - budget_vnd, 0)
                    / max(budget_vnd, 1)
                    * 0.35,
                ),
            )
            checkout_draw = _stable_unit(
                config.outcome_seed, journey_id, placement.value, "checkout"
            )
            outcomes.append(
                {
                    "outcome_id": f"outcome:{request_id}",
                    "impression_id": impression_id,
                    "request_id": request_id,
                    "journey_id": journey_id,
                    "placement": placement.value,
                    "outcome_kind": outcome_kind,
                    "selected_candidate_id": selected_candidate_id,
                    "basket_mutation_succeeded": selected_candidate is not None,
                    "gross_incremental_value_vnd": gross_delta,
                    "basket_subtotal_after_vnd": basket_subtotal,
                    "checked_out": checkout_draw < checkout_probability,
                }
            )

    return SimulationTables(
        requests=requests,
        candidates=candidate_rows,
        impressions=impressions,
        outcomes=outcomes,
        oracle=oracle_rows,
    )
