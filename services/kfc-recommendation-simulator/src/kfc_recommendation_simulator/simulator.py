# ruff: noqa: B023  # The nested placement callback completes before its journey loop advances.

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
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
PLACEMENT_SEQUENCE = {
    Placement.LOCAL_FAVORITE: 0,
    Placement.FOR_YOU: 0,
    Placement.MODIFIER_UPSELL: 1,
    Placement.SMART_CROSS_SELL: 2,
}
EXAMINATION_PROBABILITY = {
    Placement.LOCAL_FAVORITE: 0.94,
    Placement.FOR_YOU: 0.94,
    Placement.MODIFIER_UPSELL: 0.80,
    Placement.SMART_CROSS_SELL: 0.70,
}
SMART_CROSS_POSITION_EXAMINATION = (0.90, 0.78, 0.66, 0.54)
MODEL_TABLES = (
    "journeys",
    "requests",
    "candidates",
    "eligibility_decisions",
    "pre_policy_rankings",
    "policy_effects",
    "decisions",
    "impressions",
    "outcomes",
    "carts_checkouts",
)
EVALUATION_TABLES = ("evaluation_slices",)
ORACLE_TABLES = ("potential_outcomes",)


@dataclass
class CustomerHistory:
    completed_orders: int = 0
    item_counts: Counter[str] = field(default_factory=Counter)
    category_counts: Counter[str] = field(default_factory=Counter)
    last_item_order_at: dict[str, datetime] = field(default_factory=dict)


@dataclass(frozen=True)
class LoadedInputs:
    menu: tuple[dict[str, Any], ...]
    stores: tuple[dict[str, Any], ...]
    modifier_trees: tuple[dict[str, Any], ...]
    excluded_by_store: dict[str, frozenset[str]]
    promotions: tuple[dict[str, Any], ...]
    policies: tuple[dict[str, Any], ...]
    menu_by_id: dict[str, dict[str, Any]]
    modifiers_by_item: dict[str, dict[str, Any]]
    held_out_store_ids: frozenset[str]
    cold_product_ids: frozenset[str]
    cold_modifier_ids: frozenset[str]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def stable_unit(seed: int, *parts: object) -> float:
    payload = "|".join((str(seed), *(str(part) for part in parts))).encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big") / 2**64


def _stable_vector(seed: int, identity: str) -> np.ndarray:
    return np.asarray(
        [
            stable_unit(seed, identity, dimension) * 2 - 1
            for dimension in TASTE_DIMENSIONS
        ],
        dtype=np.float64,
    )


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, value))))


def _softmax(values: np.ndarray, temperature: float) -> np.ndarray:
    shifted = values / temperature
    shifted -= np.max(shifted)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


def _slate_compatible(
    candidate: dict[str, Any],
    selected: list[dict[str, Any]],
    position: int,
) -> bool:
    if any(
        existing["candidate_id"] == candidate["candidate_id"]
        or existing["product_code"] == candidate["product_code"]
        for existing in selected
    ):
        return False
    categories = Counter(existing["category"] for existing in selected)
    if categories[candidate["category"]] >= 2:
        return False
    return position < 4 or candidate["category"] not in categories


def _stable_subset(
    values: Iterable[str], count: int, seed: int, namespace: str
) -> frozenset[str]:
    ordered = sorted(
        set(values), key=lambda value: (stable_unit(seed, namespace, value), value)
    )
    if count > len(ordered):
        raise ValueError(f"{namespace} count {count} exceeds population {len(ordered)}")
    return frozenset(ordered[:count])


def _flatten_modifier_options(
    groups: Iterable[dict[str, Any]],
    prefix: tuple[str, ...] = (),
) -> Iterator[tuple[tuple[str, ...], dict[str, Any]]]:
    for group in groups:
        path = (*prefix, str(group["groupId"]))
        for option in group["options"]:
            yield path, option
            yield from _flatten_modifier_options(option.get("modifierGroups", []), path)


def load_inputs(config: WorldConfig, paths: InputPaths) -> LoadedInputs:
    menu = tuple(_read_json(paths.menu_items))
    stores = tuple(_read_json(paths.stores))
    modifier_trees = tuple(_read_json(paths.modifiers))
    availability = tuple(_read_json(paths.store_availability))
    promotions = tuple(_read_json(paths.promotions))
    policies = tuple(_read_json(paths.sanity_policies))
    excluded_by_store = {
        str(entry["storeId"]): frozenset(
            str(item_id) for item_id in entry["delivery"]["excludedItemIds"]
        )
        for entry in availability
    }
    all_modifier_ids = [
        str(option["modifierId"])
        for tree in modifier_trees
        for _, option in _flatten_modifier_options(tree.get("modifierGroups", []))
    ]
    return LoadedInputs(
        menu=menu,
        stores=stores,
        modifier_trees=modifier_trees,
        excluded_by_store=excluded_by_store,
        promotions=promotions,
        policies=policies,
        menu_by_id={str(item["itemId"]): item for item in menu},
        modifiers_by_item={str(tree["itemId"]): tree for tree in modifier_trees},
        held_out_store_ids=_stable_subset(
            (str(store["storeId"]) for store in stores),
            config.held_out_store_count,
            config.split_seed,
            "held-out-store",
        ),
        cold_product_ids=_stable_subset(
            (str(item["itemId"]) for item in menu),
            config.cold_product_count,
            config.split_seed,
            "cold-product",
        ),
        cold_modifier_ids=_stable_subset(
            all_modifier_ids,
            config.cold_modifier_count,
            config.split_seed,
            "cold-modifier",
        ),
    )


def _product_candidates(
    loaded: LoadedInputs,
    store_id: str,
    cart_item_ids: set[str],
) -> list[dict[str, Any]]:
    excluded = loaded.excluded_by_store.get(store_id, frozenset())
    candidates: list[dict[str, Any]] = []
    for item in loaded.menu:
        item_id = str(item["itemId"])
        reason = "eligible"
        if not item["available"]:
            reason = "catalog_unavailable"
        elif item_id in excluded:
            reason = "store_unavailable"
        elif item_id in cart_item_ids:
            reason = "already_in_cart"
        elif int(item["priceVnd"]) <= 0:
            reason = "invalid_price"
        original_price = item.get("originalPriceVnd")
        discount_vnd = (
            max(0, int(original_price) - int(item["priceVnd"]))
            if original_price is not None
            else 0
        )
        candidates.append(
            {
                "candidate_id": f"item:{item_id}",
                "target_id": item_id,
                "name": str(item["name"]),
                "category": str(item["category"]),
                "product_code": str(item["productCode"]),
                "price_delta_vnd": int(item["priceVnd"]),
                "discount_vnd": discount_vnd,
                "action_kind": "add_product",
                "modifier_path": "",
                "eligibility_reason": reason,
                "eligible": reason == "eligible",
            }
        )
    return candidates


def _modifier_candidates(
    loaded: LoadedInputs,
    store_id: str,
    cart_item_id: str,
) -> list[dict[str, Any]]:
    tree = loaded.modifiers_by_item.get(cart_item_id)
    if tree is None:
        return []
    candidates: list[dict[str, Any]] = []
    for path, option in _flatten_modifier_options(tree["modifierGroups"]):
        option_id = str(option["modifierId"])
        reason = "already_default" if bool(option["default"]) else "eligible"
        candidates.append(
            {
                "candidate_id": (
                    f"modifier:{cart_item_id}:{'/'.join(path)}:{option_id}"
                ),
                "target_id": option_id,
                "name": str(option["name"]),
                "category": "modifier",
                "product_code": option_id,
                "price_delta_vnd": int(option["priceDeltaVnd"]),
                "discount_vnd": 0,
                "action_kind": "apply_modifier",
                "modifier_path": "/".join((*path, option_id)),
                "eligibility_reason": reason,
                "eligible": reason == "eligible",
                "parent_item_id": cart_item_id,
                "store_id": store_id,
            }
        )
    return candidates


def _drift_phase(config: WorldConfig, fraction: float) -> tuple[int, Any]:
    selected_index = 0
    for index, phase in enumerate(config.drift_phases):
        if fraction >= phase.starts_at_fraction:
            selected_index = index
    return selected_index, config.drift_phases[selected_index]


def _policy_score(
    policy: LoggingPolicy,
    candidate: dict[str, Any],
    cart_anchor: str,
    store_item_count: int,
    global_item_count: int,
    seed: int,
) -> float:
    if policy is LoggingPolicy.POPULARITY:
        return math.log1p(store_item_count * 2 + global_item_count)
    if policy is LoggingPolicy.BASKET_ASSOCIATION:
        return (
            stable_unit(seed, "association", cart_anchor, candidate["candidate_id"]) * 2
            - 1
        )
    if policy is LoggingPolicy.PROMOTION_BIASED:
        discount_ratio = candidate["discount_vnd"] / max(
            candidate["price_delta_vnd"] + candidate["discount_vnd"], 1
        )
        return 3.0 * discount_ratio + stable_unit(
            seed, "promotion-tie", candidate["candidate_id"]
        )
    return 0.0


def _applicable_policies(
    loaded: LoadedInputs,
    placement: Placement,
    store_id: str,
    occurred_at: datetime,
) -> list[dict[str, Any]]:
    applicable = []
    for policy in loaded.policies:
        if not policy.get("enabled", False):
            continue
        if policy["placement"] != placement.value:
            continue
        stores = [str(value) for value in policy.get("storeIds", [])]
        if stores and store_id not in stores:
            continue
        starts_at = datetime.fromisoformat(str(policy["startsAt"]))
        ends = policy.get("endsAt")
        ends_at = datetime.fromisoformat(str(ends)) if ends else None
        if occurred_at < starts_at or (ends_at is not None and occurred_at >= ends_at):
            continue
        applicable.append(policy)
    return sorted(
        applicable,
        key=lambda policy: (
            -int(policy["priority"]),
            -int(bool(policy.get("storeIds"))),
            -datetime.fromisoformat(str(policy["startsAt"])).timestamp(),
            str(policy["policyId"]),
        ),
    )


def _hidden_components(
    *,
    candidate: dict[str, Any],
    taste: np.ndarray,
    cart_anchor: str,
    mission: str,
    budget_vnd: int,
    customer_item_count: int,
    customer_category_count: int,
    store_item_count: int,
    stage_index: int,
    drift_category: str,
    promotion_response_delta: float,
    world_seed: int,
) -> dict[str, float]:
    profile = _stable_vector(world_seed, candidate["candidate_id"])
    taste_match = float(np.dot(taste, profile) / len(TASTE_DIMENSIONS))
    basket_affinity = (
        stable_unit(world_seed, "affinity", cart_anchor, candidate["candidate_id"]) * 2
        - 1
    )
    mission_match = (
        stable_unit(world_seed, "mission", mission, candidate["candidate_id"]) * 2 - 1
    )
    price_ratio = candidate["price_delta_vnd"] / max(budget_vnd, 1)
    price_response = -min(price_ratio, 2.0)
    discount_ratio = candidate["discount_vnd"] / max(
        candidate["price_delta_vnd"] + candidate["discount_vnd"], 1
    )
    promotion_response = discount_ratio * (1.0 + promotion_response_delta)
    history_affinity = (
        math.log1p(customer_item_count * 2 + customer_category_count) / 4.0
    )
    store_popularity = math.log1p(store_item_count) / 4.0
    drift_effect = 0.45 if candidate["category"] == drift_category else 0.0
    diversity_effect = stable_unit(world_seed, "diversity", candidate["category"]) - 0.5
    fatigue_effect = -0.12 * stage_index
    total = (
        1.25 * taste_match
        + 0.85 * basket_affinity
        + 0.60 * mission_match
        + 0.80 * price_response
        + 0.80 * promotion_response
        + 0.70 * history_affinity
        + 0.40 * store_popularity
        + drift_effect
        + 0.25 * diversity_effect
        + fatigue_effect
    )
    return {
        "taste_match": taste_match,
        "basket_affinity": basket_affinity,
        "mission_match": mission_match,
        "price_response": price_response,
        "promotion_response": promotion_response,
        "history_affinity": history_affinity,
        "store_popularity": store_popularity,
        "drift_effect": drift_effect,
        "diversity_effect": diversity_effect,
        "fatigue_effect": fatigue_effect,
        "total_utility": total,
    }


def iter_simulation(
    config: WorldConfig,
    input_paths: InputPaths,
) -> Iterator[dict[str, list[dict[str, Any]]]]:
    loaded = load_inputs(config, input_paths)
    traffic_rng = np.random.default_rng(config.traffic_seed)
    logging_rng = np.random.default_rng(config.logging_seed)
    customer_histories: defaultdict[str, CustomerHistory] = defaultdict(CustomerHistory)
    store_item_counts: Counter[tuple[str, str]] = Counter()
    global_item_counts: Counter[str] = Counter()
    start = datetime(2026, 1, 1, tzinfo=UTC)
    policy_names = list(LoggingPolicy)
    policy_weights = np.asarray(
        [config.logging_policy_weights[name] for name in policy_names],
        dtype=np.float64,
    )
    all_categories = sorted({str(item["category"]) for item in loaded.menu})

    for journey_index in range(config.journey_count):
        rows = {
            name: [] for name in (*MODEL_TABLES, *EVALUATION_TABLES, *ORACLE_TABLES)
        }
        fraction = journey_index / max(config.journey_count - 1, 1)
        drift_index, drift = _drift_phase(config, fraction)
        occurred_at = start + timedelta(
            seconds=round(fraction * config.horizon_days * 86_400),
            minutes=journey_index % 60,
        )
        journey_id = f"journey-{journey_index:07d}"
        store = loaded.stores[int(traffic_rng.integers(0, len(loaded.stores)))]
        store_id = str(store["storeId"])
        identified = bool(
            stable_unit(config.traffic_seed, "identified", journey_id)
            < config.identified_customer_fraction
        )
        customer_id = (
            f"customer-{int(traffic_rng.integers(0, config.customer_pool_size)):06d}"
            if identified
            else ""
        )
        history = customer_histories[customer_id] if customer_id else CustomerHistory()
        mission = MISSIONS[int(traffic_rng.integers(0, len(MISSIONS)))]
        party_size = int(traffic_rng.integers(1, 7))
        budget_vnd = int(traffic_rng.choice((80_000, 120_000, 180_000, 260_000)))
        taste_identity = customer_id or journey_id
        taste = _stable_vector(config.world_seed, taste_identity)
        placement = (
            Placement.FOR_YOU
            if customer_id and history.completed_orders > 0
            else Placement.LOCAL_FAVORITE
        )
        cart_item_ids: list[str] = []
        cart_subtotal = 0
        latest_cart_item_id = ""
        rows["journeys"].append(
            {
                "journey_id": journey_id,
                "customer_id": customer_id,
                "identified_customer": identified,
                "prior_completed_orders": history.completed_orders,
                "store_id": store_id,
                "store_name": str(store["name"]),
                "occurred_at": occurred_at.isoformat(),
                "mission": mission,
                "party_size": party_size,
                "budget_vnd": budget_vnd,
                "starter_placement": placement.value,
            }
        )

        def run_placement(
            current_placement: Placement,
            candidates: list[dict[str, Any]],
            stage_index: int,
        ) -> list[dict[str, Any]]:
            nonlocal cart_subtotal, latest_cart_item_id
            request_id = f"{journey_id}:{stage_index}:{current_placement.value}"
            cart_anchor = latest_cart_item_id or "empty-cart"
            rows["requests"].append(
                {
                    "request_id": request_id,
                    "journey_id": journey_id,
                    "placement": current_placement.value,
                    "stage_index": stage_index,
                    "occurred_at": occurred_at.isoformat(),
                    "customer_id": customer_id,
                    "store_id": store_id,
                    "cart_revision": len(rows["carts_checkouts"]),
                    "cart_item_ids": list(cart_item_ids),
                    "cart_subtotal_vnd": cart_subtotal,
                    "prior_completed_orders": history.completed_orders,
                    "feature_store_local_hour": occurred_at.hour,
                    "feature_store_local_day_of_week": occurred_at.weekday(),
                    "feature_time_window": occurred_at.strftime("%Y-%m"),
                }
            )
            policy = policy_names[
                int(logging_rng.choice(len(policy_names), p=policy_weights))
            ]
            scores_by_policy: dict[LoggingPolicy, dict[str, float]] = {}
            hidden_by_candidate: dict[str, dict[str, float]] = {}
            for candidate in candidates:
                item_id = str(candidate.get("parent_item_id") or candidate["target_id"])
                menu_item = loaded.menu_by_id.get(item_id)
                item_category = (
                    str(menu_item["category"])
                    if menu_item is not None
                    else candidate["category"]
                )
                customer_item_count = history.item_counts[candidate["target_id"]]
                customer_category_count = history.category_counts[item_category]
                store_count = store_item_counts[(store_id, candidate["target_id"])]
                global_count = global_item_counts[candidate["target_id"]]
                rows["candidates"].append(
                    {
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": current_placement.value,
                        "candidate_id": candidate["candidate_id"],
                        "target_id": candidate["target_id"],
                        "name": candidate["name"],
                        "category": candidate["category"],
                        "product_code": candidate["product_code"],
                        "action_kind": candidate["action_kind"],
                        "modifier_path": candidate["modifier_path"],
                        "feature_price_delta_vnd": candidate["price_delta_vnd"],
                        "feature_discount_vnd": candidate["discount_vnd"],
                        "feature_discount_ratio": candidate["discount_vnd"]
                        / max(
                            candidate["price_delta_vnd"] + candidate["discount_vnd"],
                            1,
                        ),
                        "feature_basket_association_score": stable_unit(
                            config.logging_seed,
                            "association",
                            cart_anchor,
                            candidate["candidate_id"],
                        )
                        * 2
                        - 1,
                        "feature_cart_anchor": cart_anchor,
                        "feature_store_id": store_id,
                        "feature_mission": mission,
                        "feature_store_local_hour": occurred_at.hour,
                        "feature_store_local_day_of_week": occurred_at.weekday(),
                        "feature_time_window": occurred_at.strftime("%Y-%m"),
                        "feature_party_size": party_size,
                        "feature_budget_vnd": budget_vnd,
                        "feature_cart_subtotal_vnd": cart_subtotal,
                        "feature_customer_order_count": history.completed_orders,
                        "feature_customer_item_order_count": customer_item_count,
                        "feature_customer_category_order_count": customer_category_count,
                        "feature_store_item_order_count": store_count,
                        "feature_global_item_order_count": global_count,
                    }
                )
                rows["eligibility_decisions"].append(
                    {
                        "request_id": request_id,
                        "candidate_id": candidate["candidate_id"],
                        "eligible": candidate["eligible"],
                        "reason_code": candidate["eligibility_reason"],
                        "policy_version": "eligibility-policy-v1",
                    }
                )
                is_modifier = candidate["action_kind"] == "apply_modifier"
                rows["evaluation_slices"].append(
                    {
                        "request_id": request_id,
                        "candidate_id": candidate["candidate_id"],
                        "store_id": store_id,
                        "target_id": candidate["target_id"],
                        "held_out_store": store_id in loaded.held_out_store_ids,
                        "cold_product": (
                            not is_modifier
                            and candidate["target_id"] in loaded.cold_product_ids
                        ),
                        "cold_modifier": (
                            is_modifier
                            and candidate["target_id"] in loaded.cold_modifier_ids
                        ),
                        "customer_cold_start": history.completed_orders == 0,
                        "returning_customer": history.completed_orders > 0,
                        "drift_phase": drift_index,
                    }
                )
                if not candidate["eligible"]:
                    continue
                hidden = _hidden_components(
                    candidate=candidate,
                    taste=taste,
                    cart_anchor=cart_anchor,
                    mission=mission,
                    budget_vnd=budget_vnd,
                    customer_item_count=customer_item_count,
                    customer_category_count=customer_category_count,
                    store_item_count=store_count,
                    stage_index=stage_index,
                    drift_category=(
                        drift.category_bias
                        if drift.category_bias in all_categories
                        else all_categories[0]
                    ),
                    promotion_response_delta=drift.promotion_response_delta,
                    world_seed=config.world_seed,
                )
                hidden_by_candidate[candidate["candidate_id"]] = hidden
                future_subtotal = cart_subtotal + max(candidate["price_delta_vnd"], 0)
                checkout_probability = min(
                    0.94,
                    max(
                        0.30,
                        0.80
                        - max(future_subtotal - budget_vnd, 0)
                        / max(budget_vnd, 1)
                        * 0.35,
                    ),
                )
                position_examination = (
                    SMART_CROSS_POSITION_EXAMINATION
                    if current_placement is Placement.SMART_CROSS_SELL
                    else (EXAMINATION_PROBABILITY[current_placement],)
                )
                attention_probability = position_examination[0]
                acceptance_probability = _sigmoid(hidden["total_utility"] - 0.30)
                mutation_probability = 0.995
                expected_value = (
                    attention_probability
                    * acceptance_probability
                    * mutation_probability
                    * checkout_probability
                    * max(candidate["price_delta_vnd"], 0)
                )
                rows["potential_outcomes"].append(
                    {
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": current_placement.value,
                        "candidate_id": candidate["candidate_id"],
                        "latent_taste_vector": taste.tolist(),
                        **hidden,
                        "attention_probability": attention_probability,
                        "acceptance_probability": acceptance_probability,
                        "cart_mutation_probability": mutation_probability,
                        "checkout_probability_if_selected": checkout_probability,
                        "expected_net_merchandise_value_vnd": expected_value,
                        "attention_probability_by_position": list(position_examination),
                        "expected_net_value_by_position_vnd": [
                            probability
                            * acceptance_probability
                            * mutation_probability
                            * checkout_probability
                            * max(candidate["price_delta_vnd"], 0)
                            for probability in position_examination
                        ],
                        "common_random_draw": stable_unit(
                            config.outcome_seed,
                            journey_id,
                            current_placement.value,
                            candidate["candidate_id"],
                        ),
                    }
                )
                for candidate_policy in policy_names:
                    scores_by_policy.setdefault(candidate_policy, {})[
                        candidate["candidate_id"]
                    ] = _policy_score(
                        candidate_policy,
                        candidate,
                        cart_anchor,
                        store_count,
                        global_count,
                        config.logging_seed,
                    )

            eligible = [candidate for candidate in candidates if candidate["eligible"]]
            if not eligible:
                rows["policy_effects"].append(
                    {
                        "request_id": request_id,
                        "policy_id": "",
                        "effect": "snapshot_evaluated",
                        "candidate_id": "",
                        "detail": "no_eligible_candidates",
                    }
                )
                rows["decisions"].append(
                    {
                        "recommendation_id": f"recommendation:{request_id}",
                        "request_id": request_id,
                        "placement": current_placement.value,
                        "status": "empty",
                        "decision_source": "fallback",
                        "selected_candidate_ids": [],
                        "slate_size": 0,
                        "reason_code": "no_eligible_candidates",
                        "logging_policy": policy.value,
                        "joint_action_propensity": 0.0,
                        "policy_modified": False,
                    }
                )
                return []

            chosen_scores = scores_by_policy[policy]
            pre_ranked = sorted(
                eligible,
                key=lambda candidate: (
                    -chosen_scores[candidate["candidate_id"]],
                    candidate["candidate_id"],
                ),
            )
            for rank, candidate in enumerate(pre_ranked, 1):
                rows["pre_policy_rankings"].append(
                    {
                        "request_id": request_id,
                        "candidate_id": candidate["candidate_id"],
                        "rank": rank,
                        "logging_policy": policy.value,
                        "logging_score": chosen_scores[candidate["candidate_id"]],
                    }
                )

            policies = _applicable_policies(
                loaded, current_placement, store_id, occurred_at
            )
            rows["policy_effects"].append(
                {
                    "request_id": request_id,
                    "policy_id": "",
                    "effect": "snapshot_evaluated",
                    "candidate_id": "",
                    "detail": f"{len(policies)}_applicable",
                }
            )
            excluded = {
                target
                for applied in policies
                if applied["action"] == "exclude_target"
                for target in applied.get("targetIds", [])
            }
            for target in sorted(excluded):
                rows["policy_effects"].append(
                    {
                        "request_id": request_id,
                        "policy_id": next(
                            str(applied["policyId"])
                            for applied in policies
                            if applied["action"] == "exclude_target"
                            and target in applied.get("targetIds", [])
                        ),
                        "effect": "excluded",
                        "candidate_id": next(
                            (
                                candidate["candidate_id"]
                                for candidate in eligible
                                if candidate["target_id"] == target
                            ),
                            "",
                        ),
                        "detail": target,
                    }
                )
            eligible = [
                candidate
                for candidate in eligible
                if candidate["target_id"] not in excluded
            ]
            selected: list[dict[str, Any]] = []
            selection_probabilities: list[tuple[float, float]] = []
            source = "ranked"
            policy_modified = False
            for terminal in (
                applied
                for applied in policies
                if applied["action"] in {"suppress_placement", "replace_slate"}
            ):
                if terminal["action"] == "suppress_placement":
                    rows["policy_effects"].append(
                        {
                            "request_id": request_id,
                            "policy_id": str(terminal["policyId"]),
                            "effect": "suppressed",
                            "candidate_id": "",
                            "detail": "placement_suppressed",
                        }
                    )
                    rows["decisions"].append(
                        {
                            "recommendation_id": f"recommendation:{request_id}",
                            "request_id": request_id,
                            "placement": current_placement.value,
                            "status": "suppressed",
                            "decision_source": "suppressed",
                            "selected_candidate_ids": [],
                            "slate_size": 0,
                            "reason_code": "cms_suppressed",
                            "logging_policy": policy.value,
                            "joint_action_propensity": 0.0,
                            "policy_modified": True,
                        }
                    )
                    return []
                replacement_size = (
                    config.smart_cross_sell_max_size
                    if current_placement is Placement.SMART_CROSS_SELL
                    else 1
                )
                for target in terminal.get("targetIds", []):
                    replacement = next(
                        (
                            candidate
                            for candidate in eligible
                            if candidate["target_id"] == target
                            and _slate_compatible(
                                candidate, selected, len(selected) + 1
                            )
                        ),
                        None,
                    )
                    if replacement is not None:
                        selected.append(replacement)
                        selection_probabilities.append((1.0, 1.0))
                    if len(selected) >= replacement_size:
                        break
                if selected:
                    source = "merchandising_replacement"
                    policy_modified = True
                    rows["policy_effects"].append(
                        {
                            "request_id": request_id,
                            "policy_id": str(terminal["policyId"]),
                            "effect": "replaced",
                            "candidate_id": selected[0]["candidate_id"],
                            "detail": ",".join(
                                candidate["target_id"] for candidate in selected
                            ),
                        }
                    )
                    break

            pin = next(
                (applied for applied in policies if applied["action"] == "pin_target"),
                None,
            )
            if not selected and pin is not None:
                pinned = next(
                    (
                        candidate
                        for candidate in eligible
                        if candidate["target_id"] in pin.get("targetIds", [])
                    ),
                    None,
                )
                if pinned is not None:
                    selected.append(pinned)
                    selection_probabilities.append((1.0, 1.0))
                    policy_modified = True
                    rows["policy_effects"].append(
                        {
                            "request_id": request_id,
                            "policy_id": str(pin["policyId"]),
                            "effect": "pinned",
                            "candidate_id": pinned["candidate_id"],
                            "detail": "position_1",
                        }
                    )

            boosts: dict[str, float] = {}
            for applied in policies:
                if applied["action"] != "boost_target":
                    continue
                for target in applied.get("targetIds", []):
                    boosts[target] = max(
                        boosts.get(target, 0.0),
                        min(1.0, max(0.0, float(applied.get("boostWeight", 0.0)))),
                    )
            for candidate in eligible:
                if candidate["target_id"] in boosts:
                    policy_modified = True
                    rows["policy_effects"].append(
                        {
                            "request_id": request_id,
                            "policy_id": next(
                                str(applied["policyId"])
                                for applied in policies
                                if applied["action"] == "boost_target"
                                and candidate["target_id"]
                                in applied.get("targetIds", [])
                            ),
                            "effect": "boosted",
                            "candidate_id": candidate["candidate_id"],
                            "detail": str(boosts[candidate["target_id"]]),
                        }
                    )

            if source != "merchandising_replacement":
                target_size = (
                    config.smart_cross_sell_max_size
                    if current_placement is Placement.SMART_CROSS_SELL
                    else 1
                )
                prefix_likelihood = {
                    candidate_policy: 1.0 for candidate_policy in policy_names
                }
                joint_propensity = 1.0
                while len(selected) < target_size:
                    position = len(selected) + 1
                    pool = [
                        candidate
                        for candidate in eligible
                        if _slate_compatible(candidate, selected, position)
                        and (
                            position <= config.smart_cross_sell_default_size
                            or (
                                current_placement is Placement.SMART_CROSS_SELL
                                and candidate["category"]
                                not in {existing["category"] for existing in selected}
                                and candidate["price_delta_vnd"]
                                <= max(budget_vnd - cart_subtotal, 0)
                            )
                        )
                    ]
                    if not pool:
                        break
                    probabilities_by_policy: dict[LoggingPolicy, np.ndarray] = {}
                    for candidate_policy in policy_names:
                        values = np.asarray(
                            [
                                scores_by_policy[candidate_policy][
                                    candidate["candidate_id"]
                                ]
                                + boosts.get(candidate["target_id"], 0.0)
                                for candidate in pool
                            ],
                            dtype=np.float64,
                        )
                        probabilities_by_policy[candidate_policy] = _softmax(
                            values, config.logging_temperature
                        )
                    chosen_probabilities = probabilities_by_policy[policy]
                    selected_index = int(
                        logging_rng.choice(len(pool), p=chosen_probabilities)
                    )
                    selected_candidate = pool[selected_index]
                    denominator = sum(
                        config.logging_policy_weights[candidate_policy]
                        * prefix_likelihood[candidate_policy]
                        for candidate_policy in policy_names
                    )
                    numerator = sum(
                        config.logging_policy_weights[candidate_policy]
                        * prefix_likelihood[candidate_policy]
                        * float(
                            probabilities_by_policy[candidate_policy][selected_index]
                        )
                        for candidate_policy in policy_names
                    )
                    conditional_propensity = numerator / denominator
                    joint_propensity *= conditional_propensity
                    selected.append(selected_candidate)
                    selection_probabilities.append(
                        (conditional_propensity, joint_propensity)
                    )
                    for candidate_policy in policy_names:
                        prefix_likelihood[candidate_policy] *= float(
                            probabilities_by_policy[candidate_policy][selected_index]
                        )

            if not selected:
                rows["decisions"].append(
                    {
                        "recommendation_id": f"recommendation:{request_id}",
                        "request_id": request_id,
                        "placement": current_placement.value,
                        "status": "empty",
                        "decision_source": "fallback",
                        "selected_candidate_ids": [],
                        "slate_size": 0,
                        "reason_code": "no_candidate_after_policy",
                        "logging_policy": policy.value,
                        "joint_action_propensity": 0.0,
                        "policy_modified": policy_modified,
                    }
                )
                return []

            recommendation_id = f"recommendation:{request_id}"
            final_joint_propensity = selection_probabilities[-1][1]
            rows["decisions"].append(
                {
                    "recommendation_id": recommendation_id,
                    "request_id": request_id,
                    "placement": current_placement.value,
                    "status": "recommended",
                    "decision_source": source,
                    "selected_candidate_ids": [
                        candidate["candidate_id"] for candidate in selected
                    ],
                    "slate_size": len(selected),
                    "reason_code": f"{current_placement.value}_candidate",
                    "logging_policy": policy.value,
                    "joint_action_propensity": final_joint_propensity,
                    "policy_modified": policy_modified,
                }
            )
            exposure_probability = EXAMINATION_PROBABILITY[current_placement]
            rendered = (
                stable_unit(
                    config.outcome_seed,
                    journey_id,
                    current_placement.value,
                    "render",
                )
                < exposure_probability
            )
            if not rendered:
                return []
            slate_id = f"slate:{request_id}"
            examined_and_accepted: dict[str, tuple[bool, bool]] = {}
            for position, (
                selected_candidate,
                (conditional_propensity, joint_prefix_propensity),
            ) in enumerate(zip(selected, selection_probabilities, strict=True), 1):
                impression_id = f"impression:{request_id}:{position}"
                examination_probability = (
                    SMART_CROSS_POSITION_EXAMINATION[position - 1]
                    if current_placement is Placement.SMART_CROSS_SELL
                    else exposure_probability
                )
                rows["impressions"].append(
                    {
                        "impression_id": impression_id,
                        "slate_id": slate_id,
                        "recommendation_id": recommendation_id,
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": current_placement.value,
                        "candidate_id": selected_candidate["candidate_id"],
                        "position": position,
                        "slate_size": len(selected),
                        "logging_policy": policy.value,
                        "action_propensity": conditional_propensity,
                        "joint_prefix_propensity": joint_prefix_propensity,
                        "examination_probability": examination_probability,
                        "decision_source": source,
                        "policy_modified": policy_modified,
                    }
                )
                examined = (
                    stable_unit(
                        config.outcome_seed,
                        journey_id,
                        current_placement.value,
                        selected_candidate["candidate_id"],
                        "examine",
                    )
                    < examination_probability
                )
                hidden = hidden_by_candidate[selected_candidate["candidate_id"]]
                accepted = examined and (
                    stable_unit(
                        config.outcome_seed,
                        journey_id,
                        current_placement.value,
                        selected_candidate["candidate_id"],
                        "accept",
                    )
                    < _sigmoid(hidden["total_utility"] - 0.30)
                )
                examined_and_accepted[selected_candidate["candidate_id"]] = (
                    examined,
                    accepted,
                )

            any_accepted = any(
                accepted for _, accepted in examined_and_accepted.values()
            )
            dismissed = (
                not any_accepted
                and stable_unit(
                    config.outcome_seed,
                    journey_id,
                    current_placement.value,
                    "dismiss",
                )
                < 0.55
            )
            mutated: list[dict[str, Any]] = []
            for position, selected_candidate in enumerate(selected, 1):
                impression_id = f"impression:{request_id}:{position}"
                examined, accepted = examined_and_accepted[
                    selected_candidate["candidate_id"]
                ]
                mutation_succeeded = accepted and (
                    stable_unit(
                        config.outcome_seed,
                        journey_id,
                        current_placement.value,
                        selected_candidate["candidate_id"],
                        "mutation",
                    )
                    < 0.995
                )
                if accepted:
                    outcome_kind = (
                        "selected" if mutation_succeeded else "cart_mutation_failed"
                    )
                elif dismissed:
                    outcome_kind = "explicitly_dismissed"
                elif any_accepted:
                    outcome_kind = "not_selected"
                else:
                    outcome_kind = "ignored"
                gross_delta = (
                    max(0, int(selected_candidate["price_delta_vnd"]))
                    if mutation_succeeded
                    else 0
                )
                rows["outcomes"].append(
                    {
                        "outcome_id": f"outcome:{request_id}:{position}",
                        "impression_id": impression_id,
                        "slate_id": slate_id,
                        "recommendation_id": recommendation_id,
                        "request_id": request_id,
                        "journey_id": journey_id,
                        "placement": current_placement.value,
                        "candidate_id": selected_candidate["candidate_id"],
                        "position": position,
                        "outcome_kind": outcome_kind,
                        "was_examined": examined,
                        "customer_selected": accepted,
                        "basket_mutation_succeeded": mutation_succeeded,
                        "gross_incremental_value_vnd": gross_delta,
                        "checked_out": False,
                        "survived_checkout": False,
                        "net_incremental_value_vnd": 0,
                    }
                )
                if not mutation_succeeded:
                    continue
                mutated.append(selected_candidate)
                if selected_candidate["action_kind"] == "add_product":
                    cart_item_ids.append(selected_candidate["target_id"])
                    latest_cart_item_id = selected_candidate["target_id"]
                cart_subtotal += gross_delta
                rows["carts_checkouts"].append(
                    {
                        "journey_id": journey_id,
                        "event_kind": "recommendation_cart_mutation",
                        "placement": current_placement.value,
                        "candidate_id": selected_candidate["candidate_id"],
                        "cart_item_ids": list(cart_item_ids),
                        "cart_subtotal_vnd": cart_subtotal,
                        "checked_out": False,
                    }
                )
            return mutated

        starter = run_placement(
            placement,
            _product_candidates(loaded, store_id, set(cart_item_ids)),
            PLACEMENT_SEQUENCE[placement],
        )
        if not cart_item_ids:
            excluded = loaded.excluded_by_store.get(store_id, frozenset())
            organic_options = [
                item
                for item in loaded.menu
                if item["available"]
                and int(item["priceVnd"]) > 0
                and str(item["itemId"]) not in excluded
                and str(item["itemId"]) in loaded.modifiers_by_item
            ]
            organic = organic_options[
                int(traffic_rng.integers(0, len(organic_options)))
            ]
            latest_cart_item_id = str(organic["itemId"])
            cart_item_ids.append(latest_cart_item_id)
            cart_subtotal += int(organic["priceVnd"])
            rows["carts_checkouts"].append(
                {
                    "journey_id": journey_id,
                    "event_kind": "organic_cart_addition",
                    "placement": "",
                    "candidate_id": "",
                    "cart_item_ids": list(cart_item_ids),
                    "cart_subtotal_vnd": cart_subtotal,
                    "checked_out": False,
                }
            )
        elif starter:
            latest_cart_item_id = starter[0]["target_id"]

        run_placement(
            Placement.MODIFIER_UPSELL,
            _modifier_candidates(loaded, store_id, latest_cart_item_id),
            PLACEMENT_SEQUENCE[Placement.MODIFIER_UPSELL],
        )
        run_placement(
            Placement.SMART_CROSS_SELL,
            _product_candidates(loaded, store_id, set(cart_item_ids)),
            PLACEMENT_SEQUENCE[Placement.SMART_CROSS_SELL],
        )
        checkout_probability = min(
            0.94,
            max(
                0.30,
                0.82 - max(cart_subtotal - budget_vnd, 0) / max(budget_vnd, 1) * 0.35,
            ),
        )
        checked_out = (
            stable_unit(config.outcome_seed, journey_id, "final-checkout")
            < checkout_probability
        )
        rows["carts_checkouts"].append(
            {
                "journey_id": journey_id,
                "event_kind": "checkout_completed" if checked_out else "abandoned",
                "placement": "",
                "candidate_id": "",
                "cart_item_ids": list(cart_item_ids),
                "cart_subtotal_vnd": cart_subtotal,
                "checked_out": checked_out,
            }
        )
        for outcome in rows["outcomes"]:
            survived_checkout = bool(
                checked_out and outcome["basket_mutation_succeeded"]
            )
            outcome["checked_out"] = checked_out
            outcome["survived_checkout"] = survived_checkout
            outcome["net_incremental_value_vnd"] = (
                outcome["gross_incremental_value_vnd"] if survived_checkout else 0
            )
        if checked_out:
            for item_id in cart_item_ids:
                menu_item = loaded.menu_by_id[item_id]
                store_item_counts[(store_id, item_id)] += 1
                global_item_counts[item_id] += 1
                if customer_id:
                    history.item_counts[item_id] += 1
                    history.category_counts[str(menu_item["category"])] += 1
                    history.last_item_order_at[item_id] = occurred_at
            if customer_id:
                history.completed_orders += 1
        yield rows
