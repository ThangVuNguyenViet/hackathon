from __future__ import annotations

import hashlib
import json
import platform
import random
import sys
from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .causal import CONDITIONS, simulate_conditions
from .profiles import GenerationProfile
from .schemas import ARTIFACT_SCHEMAS, FEATURE_FIELDS, schema_digest
from .validation import count_invalid_rows

WORLD_MANIFEST_VERSION = "kfc-synthetic-world-manifest-v5"
GENERATOR_REVISION = "kfc-stateful-synthetic-causal-generator-v5"
CANDIDATE_RELEVANCE_DEFINITION_VERSION = "candidate-singleton-value-v2"
CANDIDATE_RELEVANCE_DEFINITION = {
    "intervention": "render_only_this_eligible_candidate",
    "eligibility": (
        "automatic reference-path candidates plus deduplicated factual-state "
        "extensions required to retain observed support"
    ),
    "selection": (
        "bounded response to journey affinity, candidate desirability, promotion, "
        "basket fit, and contextual price burden"
    ),
    "checkout": (
        "bounded response to affinity, candidate desirability, fulfilment mode, "
        "and post-action price burden"
    ),
    "removal": (
        "bounded response to contextual price burden, candidate desirability, "
        "and promotion"
    ),
    "realizedValue": "price when selected, checked out, and not removed; else zero",
    "gradedRelevance": "expected retained incremental value in VND",
    "sharedExogenous": "sha256 candidate-keyed draws independent of ranking policy",
}
RANDOM_STREAM_NAMES = (
    "catalog",
    "population",
    "traffic",
    "behavior",
    "logging_policy",
    "outcomes",
    "splits",
)
RECOMMENDATION_TYPES = (
    "local_favorite",
    "for_you",
    "modifier_upsell",
    "smart_cross_sell",
)
FULFILMENT_MODES = ("pickup", "delivery")
FEATURE_KEYS = tuple(name for name, _, _ in FEATURE_FIELDS)
PARQUET_WRITER_SETTINGS = {
    "formatVersion": "2.6",
    "dataPageVersion": "2.0",
    "compression": "zstd",
    "compressionLevel": 3,
    "dictionaryEncoding": True,
    "writeStatistics": True,
}


def _canonical_json(value: Any, *, pretty: bool = False) -> bytes:
    if pretty:
        return (
            json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        ).encode()
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


CANDIDATE_RELEVANCE_DEFINITION_DIGEST = hashlib.sha256(
    _canonical_json(CANDIDATE_RELEVANCE_DEFINITION)
).hexdigest()


def _derived_stream_seed(
    world_revision: str,
    profile_name: str,
    seed: int,
    stream_name: str,
    override: int | None,
) -> int:
    material = (
        f"{GENERATOR_REVISION}\0{world_revision}\0{profile_name}\0{seed}"
        f"\0{stream_name}\0{override if override is not None else 'default'}"
    ).encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big")


def _streams(
    world_revision: str,
    profile: GenerationProfile,
    seed: int,
    overrides: Mapping[str, int],
) -> tuple[dict[str, random.Random], dict[str, int]]:
    unknown = set(overrides).difference(RANDOM_STREAM_NAMES)
    if unknown:
        raise ValueError(f"unknown random stream override(s): {sorted(unknown)}")
    seeds = {
        name: _derived_stream_seed(
            world_revision, profile.name, seed, name, overrides.get(name)
        )
        for name in RANDOM_STREAM_NAMES
    }
    return {name: random.Random(value) for name, value in seeds.items()}, seeds


def _catalog(
    seed: int, rng: random.Random
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    categories = ("chicken", "burger", "rice", "sides", "drinks", "dessert")
    products: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for index in range(48):
        unit_price = 29_000 + 5_000 * (index % 13)
        discount = 5_000 if index % 5 == 0 else 0
        product = {
            "sellableItemId": f"item-{seed}-{index:03d}",
            "modifierOptionId": None,
            "categoryId": categories[index % len(categories)],
            "unitPriceVnd": unit_price,
            "priceImpactVnd": unit_price - discount,
            "promotionActive": discount > 0,
            "localDemandCount": 40 + rng.randrange(600),
            "basketAssociationCount": 5 + rng.randrange(250),
            "basketComplementarityScore": round(rng.uniform(-0.2, 1.0), 6),
            "available": True,
            "coldCandidate": index >= 40,
        }
        products.append(product)
        rows.append({"seed": seed, "recordType": "product", **product})
    for product_index, parent in enumerate(products):
        for option_index in range(5):
            option = {
                "sellableItemId": parent["sellableItemId"],
                "modifierOptionId": (
                    f"modifier-{seed}-{product_index:03d}-{option_index:02d}"
                ),
                "categoryId": "modifier",
                "unitPriceVnd": parent["unitPriceVnd"],
                "priceImpactVnd": 5_000 + 2_000 * option_index,
                "promotionActive": False,
                "localDemandCount": 10 + rng.randrange(100),
                "basketAssociationCount": 5 + rng.randrange(60),
                "basketComplementarityScore": round(rng.uniform(0.1, 0.9), 6),
                "available": True,
                "coldCandidate": parent["coldCandidate"],
            }
            rows.append({"seed": seed, "recordType": "modifier_option", **option})
    return rows, products


def _population(
    seed: int, rng: random.Random
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, float]]:
    customers: list[dict[str, Any]] = []
    latent: dict[str, float] = {}
    for index in range(160):
        cold = index >= 128
        customer_id = f"{'cold-' if cold else ''}customer-{seed}-{index:03d}"
        returning = index % 4 != 0
        completed = rng.randrange(1, 30) if returning else 0
        customer = {
            "seed": seed,
            "customerId": customer_id,
            "returningCustomer": returning,
            "completedOrderCount": completed,
            "coldCustomer": cold,
        }
        customers.append(customer)
        latent[customer_id] = round(rng.betavariate(2.4, 2.0), 8)
    return [dict(customer) for customer in customers], customers, latent


def _split(index: int, size: int) -> str:
    fraction = index / size
    if fraction < 0.60:
        return "training"
    if fraction < 0.75:
        return "calibration"
    if fraction < 0.85:
        return "validation"
    return "untouched_test"


def _journey_time(index: int, seed_position: int) -> datetime:
    local = timezone(timedelta(hours=7))
    day = index // 200
    position = index % 200
    if position < 100:
        hour = 11
        minute = 30 + position // 20
    else:
        hour = 18
        minute = (position - 100) // 20
    return datetime(2020 + seed_position, 1, 1, hour, minute, tzinfo=local) + timedelta(
        days=day
    )


def _daypart(hour: int) -> str:
    if 10 <= hour < 14:
        return "lunch"
    if 17 <= hour < 22:
        return "dinner"
    if 5 <= hour < 10:
        return "breakfast"
    if 14 <= hour < 17:
        return "afternoon"
    return "late_night"


def _stable_fraction(*values: object) -> float:
    digest = hashlib.sha256("\0".join(map(str, values)).encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _candidate_relevance_row(
    *,
    seed: int,
    split: str,
    journey_id: str,
    opportunity_id: str,
    recommendation_type: str,
    candidate: Mapping[str, Any],
    affinity: float,
    placement: Mapping[str, Any],
    journey: Mapping[str, Any],
) -> dict[str, Any]:
    candidate_id = str(candidate["candidateId"])
    price_vnd = int(candidate["priceImpactVnd"])
    promotion = float(bool(candidate["promotionActive"]))
    complementarity = max(
        0.0, float(candidate["basketComplementarityScore"])
    )
    association = min(1.0, int(candidate["basketAssociationCount"]) / 250)
    candidate_desirability = min(
        1.0,
        0.68 * float(candidate["automaticScore"])
        + 0.14 * complementarity
        + 0.10 * association
        + 0.08 * promotion,
    )
    cart_subtotal = int(placement["cartSubtotalBeforeVnd"])
    contextual_price_burden = min(
        1.0, price_vnd / max(1, cart_subtotal + 100_000)
    )
    post_action_price_burden = min(
        1.0, price_vnd / max(1, cart_subtotal + price_vnd + 100_000)
    )
    selection_probability = min(
        0.94,
        max(
            0.04,
            0.08
            + 0.35 * affinity
            + 0.55 * candidate_desirability
            - 0.18 * contextual_price_burden,
        ),
    )
    checkout_probability = min(
        0.95,
        max(
            0.45,
            0.58
            + 0.10 * affinity
            + 0.08 * candidate_desirability
            + 0.03 * float(journey["fulfilmentMode"] == "pickup")
            - 0.12 * post_action_price_burden,
        ),
    )
    removal_probability = min(
        0.30,
        max(
            0.02,
            0.16
            + 0.12 * contextual_price_burden
            - 0.08 * candidate_desirability
            - 0.04 * promotion,
        ),
    )
    draw_key = (
        CANDIDATE_RELEVANCE_DEFINITION_VERSION,
        journey_id,
        opportunity_id,
        candidate_id,
    )
    selected = _stable_fraction(*draw_key, "selection") < selection_probability
    checkout = _stable_fraction(*draw_key, "checkout") < checkout_probability
    removed = (
        selected
        and checkout
        and _stable_fraction(*draw_key, "removal") < removal_probability
    )
    retained = selected and checkout and not removed
    expected_value = (
        price_vnd
        * selection_probability
        * checkout_probability
        * (1.0 - removal_probability)
    )
    outcome_ref_digest = hashlib.sha256(
        "\0".join(map(str, draw_key)).encode()
    ).hexdigest()[:24]
    return {
        "evaluationDefinitionVersion": CANDIDATE_RELEVANCE_DEFINITION_VERSION,
        "evaluationDefinitionDigest": CANDIDATE_RELEVANCE_DEFINITION_DIGEST,
        "intervention": CANDIDATE_RELEVANCE_DEFINITION["intervention"],
        "seed": seed,
        "split": split,
        "journeyId": journey_id,
        "opportunityId": opportunity_id,
        "recommendationType": recommendation_type,
        "candidateId": candidate_id,
        "potentialOutcomeRef": f"candidate-potential:{outcome_ref_digest}",
        "priceImpactVnd": price_vnd,
        "selectionProbability": selection_probability,
        "checkoutProbability": checkout_probability,
        "removalProbability": removal_probability,
        "potentialSelected": selected,
        "potentialCheckout": checkout,
        "potentialRemoved": removed,
        "potentialRetained": retained,
        "potentialIncrementalValueVnd": price_vnd if retained else 0,
        "expectedRetainedValueVnd": expected_value,
        "gradedRelevance": expected_value,
    }


def _actual_candidate(
    raw: Mapping[str, Any], *, drift: bool, journey_index: int
) -> dict[str, Any]:
    candidate = dict(raw)
    if not drift:
        return candidate
    category = str(candidate["categoryId"])
    multiplier = 1.65 if category in {"sides", "drinks"} else 0.72
    candidate["localDemandCount"] = max(
        1, int(int(candidate["localDemandCount"]) * multiplier)
    )
    candidate["basketComplementarityScore"] = round(
        max(
            -1.0,
            min(
                1.0,
                float(candidate["basketComplementarityScore"])
                + (0.18 if category in {"sides", "drinks"} else -0.08),
            ),
        ),
        6,
    )
    candidate["promotionActive"] = not bool(candidate["promotionActive"])
    candidate["available"] = (
        _stable_fraction(candidate["sellableItemId"], journey_index, "availability")
        < 0.78
    )
    return candidate


def _candidate(
    raw: Mapping[str, Any],
    *,
    recommendation_type: str,
    affinity: float,
    journey_index: int,
) -> dict[str, Any]:
    modifier = recommendation_type == "modifier_upsell"
    candidate_id = (
        f"modifier:{raw['modifierOptionId']}"
        if modifier
        else f"product:{raw['sellableItemId']}"
    )
    demand = int(raw["localDemandCount"])
    complement = float(raw["basketComplementarityScore"])
    promotion = 1.0 if raw["promotionActive"] else 0.0
    automatic_score = (
        0.42 * affinity
        + 0.28 * min(1.0, demand / 640)
        + 0.20 * max(0.0, complement)
        + 0.10 * promotion
        + 0.000001 * (journey_index % 17)
    )
    return {
        "candidateId": candidate_id,
        "sellableItemId": raw["sellableItemId"],
        "modifierOptionId": raw.get("modifierOptionId"),
        "categoryId": raw["categoryId"],
        "unitPriceVnd": int(raw["unitPriceVnd"]),
        "priceImpactVnd": int(raw["priceImpactVnd"]),
        "promotionActive": bool(raw["promotionActive"]),
        "localDemandCount": demand,
        "basketAssociationCount": int(raw["basketAssociationCount"]),
        "basketComplementarityScore": complement,
        "automaticScore": round(automatic_score, 9),
    }


def _products_for_categories(
    products: list[dict[str, Any]],
    categories: list[str],
    *,
    start: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for offset, category in enumerate(categories):
        matching = [item for item in products if item["categoryId"] == category]
        if not matching:
            matching = products
        selected.append(matching[(start + offset) % len(matching)])
    return selected


def _journey_candidates(
    *,
    products: list[dict[str, Any]],
    catalog_rows: list[dict[str, Any]],
    journey: Mapping[str, Any],
    affinity: float,
    index: int,
) -> tuple[
    list[dict[str, Any]],
    dict[str, list[dict[str, Any]]],
    list[dict[str, Any]],
]:
    drift = bool(journey["drift"])
    actual_products = [
        _actual_candidate(product, drift=drift, journey_index=index)
        for product in products
    ]
    pool = (
        [product for product in actual_products if product["coldCandidate"]]
        if journey["coldCandidate"]
        else [product for product in actual_products if not product["coldCandidate"]]
    )
    available = [product for product in pool if product["available"]]
    if not available:
        return [], {}, []
    starter_raw = [] if index % 19 == 0 else available[:4]
    starter_type = str(journey["starterRecommendationType"])
    starter = [
        _candidate(
            item,
            recommendation_type=starter_type,
            affinity=affinity,
            journey_index=index,
        )
        for item in starter_raw
    ]
    modifier_by_parent: dict[str, list[dict[str, Any]]] = {}
    option_rows = [
        row for row in catalog_rows if row["recordType"] == "modifier_option"
    ]
    for starter_candidate in starter:
        parent_id = str(starter_candidate["sellableItemId"])
        actual_options = [
            _actual_candidate(row, drift=drift, journey_index=index)
            for row in option_rows
            if row["sellableItemId"] == parent_id
        ]
        if index % 23 == 0:
            actual_options = []
        modifier_by_parent[parent_id] = [
            _candidate(
                option,
                recommendation_type="modifier_upsell",
                affinity=affinity,
                journey_index=index,
            )
            for option in actual_options
            if option["available"]
        ]
    smart_category_cases = (
        ["chicken", "sides"],
        ["chicken", "sides", "drinks"],
        ["chicken", "sides", "drinks", "dessert"],
        ["chicken", "chicken", "sides", "sides", "chicken"],
    )
    smart_raw = _products_for_categories(
        available,
        smart_category_cases[index % len(smart_category_cases)],
        start=index,
    )
    smart_by_id: dict[str, dict[str, Any]] = {}
    for item in smart_raw:
        candidate = _candidate(
            item,
            recommendation_type="smart_cross_sell",
            affinity=affinity,
            journey_index=index,
        )
        smart_by_id.setdefault(str(candidate["candidateId"]), candidate)
    smart = list(smart_by_id.values())
    return starter, modifier_by_parent, smart


def _exogenous(
    *,
    candidates: list[dict[str, Any]],
    outcome_rng: random.Random,
    policy_rng: random.Random,
) -> dict[str, Any]:
    return {
        "selectionDraws": {
            recommendation_type: outcome_rng.random()
            for recommendation_type in RECOMMENDATION_TYPES
        },
        "choiceDraws": {
            recommendation_type: outcome_rng.random()
            for recommendation_type in RECOMMENDATION_TYPES
        },
        "removalDraws": {
            recommendation_type: outcome_rng.random()
            for recommendation_type in RECOMMENDATION_TYPES
        },
        "checkoutDraw": outcome_rng.random(),
        "randomPriorities": {
            recommendation_type: {
                str(candidate["candidateId"]): policy_rng.random()
                for candidate in candidates
            }
            for recommendation_type in RECOMMENDATION_TYPES
        },
    }


def _candidate_features(
    *,
    candidate: Mapping[str, Any],
    recommendation_type: str,
    placement: Mapping[str, Any],
    journey: Mapping[str, Any],
    customer: Mapping[str, Any],
    index: int,
) -> dict[str, Any]:
    modifier = recommendation_type == "modifier_upsell"
    smart = recommendation_type == "smart_cross_sell"
    unit_price = int(candidate["unitPriceVnd"])
    price_impact = int(candidate["priceImpactVnd"])
    feature = {
        "featureSchemaVersion": "automatic-feature-v1",
        "recommendationType": recommendation_type,
        "storeId": journey["storeId"],
        "fulfilmentMode": journey["fulfilmentMode"],
        "locale": "vi-VN",
        "localHour": int(str(journey["startedAt"])[11:13]),
        "daypart": journey["daypart"],
        "catalogRevision": (
            f"synthetic-catalog-{journey['seed']}-drift-v2"
            if journey["drift"]
            else f"synthetic-catalog-{journey['seed']}-baseline-v1"
        ),
        "cartSubtotalVnd": placement["cartSubtotalBeforeVnd"],
        "cartLineCount": placement["cartLineCountBefore"],
        "cartDistinctCategoryCount": min(3, placement["cartLineCountBefore"]),
        "candidateSellableItemId": candidate["sellableItemId"],
        "candidateModifierOptionId": candidate["modifierOptionId"]
        if modifier
        else None,
        "candidateCategoryId": candidate["categoryId"],
        "candidatePriceImpactVnd": price_impact,
        "candidateUnitPriceVnd": unit_price,
        "candidateDiscountAmountVnd": 0
        if modifier
        else max(0, unit_price - price_impact),
        "candidateDiscountActive": False if modifier else price_impact < unit_price,
        "promotionActive": candidate["promotionActive"],
        "completedOrderCount": customer["completedOrderCount"],
        "priorItemOrderCount": (index + int(candidate["localDemandCount"])) % 8,
        "priorCategoryOrderCount": (index + 2) % 13,
        "historyRecencyDays": float(1 + index % 90)
        if recommendation_type == "for_you"
        else None,
        "localDemandCount": int(candidate["localDemandCount"])
        if recommendation_type == "local_favorite"
        else None,
        "modifierParentCartLineId": placement["parentCartLineId"] if modifier else None,
        "modifierParentSellableItemId": candidate["sellableItemId"]
        if modifier
        else None,
        "modifierGroupPath": "meal/size" if modifier else None,
        "modifierSelectionMode": "single" if modifier else None,
        "modifierOptionAvailable": True if modifier else None,
        "modifierOptionSafe": True if modifier else None,
        "modifierPriceRatio": round(price_impact / unit_price, 8) if modifier else None,
        "remainingBudgetVnd": max(0, 250_000 - int(placement["cartSubtotalBeforeVnd"]))
        if modifier or smart
        else None,
        "basketAssociationCount": int(candidate["basketAssociationCount"])
        if smart
        else None,
        "basketComplementarityScore": float(candidate["basketComplementarityScore"])
        if smart
        else None,
        "basketRedundancyCount": index % 2 if smart else None,
        "basketCategoryDiversityCount": min(3, int(placement["cartLineCountBefore"]))
        if smart
        else None,
    }
    if tuple(feature) != FEATURE_KEYS:
        raise AssertionError("candidate feature shape drifted from scorer contract")
    return feature


def _model_binding(recommendation_type: str) -> dict[str, str]:
    return {
        "bundleId": "synthetic-unqualified-shape-only",
        "bundleDigest": "0" * 64,
        "modelRevision": f"shape-{recommendation_type}-v2",
        "calibratorRevision": "shape-calibrator-v2",
        "featureSchemaDigest": "1" * 64,
        "thresholdRevision": "shape-threshold-v2",
        "composerContractDigest": "2" * 64,
        "qualificationRunId": "shape-export-only",
        "qualificationEvidenceDigest": "3" * 64,
    }


def _scorer_request(
    recommendation_type: str,
    candidates: list[dict[str, Any]],
    request_id: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": "kfc-automatic-scorer-v1",
        "requestId": request_id,
        "recommendationType": recommendation_type,
        "model": _model_binding(recommendation_type),
        "candidates": [
            {
                key: candidate[key]
                for key in (
                    "candidateId",
                    "eligibility",
                    "priceImpactVnd",
                    "features",
                )
            }
            for candidate in candidates
        ],
    }


def _clone_shape_candidates(
    template: Mapping[str, Any],
    recommendation_type: str,
    count: int,
    *,
    category_count: int | None = None,
) -> list[dict[str, Any]]:
    clones: list[dict[str, Any]] = []
    for index in range(count):
        features = dict(template["features"])
        sellable_id = f"shape-item-{recommendation_type}-{index:03d}"
        features["candidateSellableItemId"] = sellable_id
        features["candidateCategoryId"] = (
            f"shape-category-{index % (category_count or count)}"
        )
        if recommendation_type == "modifier_upsell":
            option_id = f"shape-option-{index:03d}"
            features["candidateModifierOptionId"] = option_id
            candidate_id = f"modifier:{option_id}"
        else:
            candidate_id = f"product:{sellable_id}"
        clones.append(
            {
                "candidateId": candidate_id,
                "eligibility": "eligible",
                "priceImpactVnd": template["priceImpactVnd"],
                "features": features,
            }
        )
    return clones


def _shape_rows(
    templates: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    declarations = [
        ("local_favorite_120", "local_favorite", 120, 3, 1, None),
        ("local_favorite_240_stress", "local_favorite", 240, 3, 1, None),
        ("for_you_120", "for_you", 120, 3, 1, None),
        ("for_you_240_stress", "for_you", 240, 3, 1, None),
        ("modifier_5", "modifier_upsell", 5, 3, 1, None),
        ("modifier_17", "modifier_upsell", 17, 3, 1, None),
        ("modifier_25", "modifier_upsell", 25, 3, 1, None),
        ("smart_insufficient_2", "smart_cross_sell", 2, 2, 2, 2),
        ("smart_default_3", "smart_cross_sell", 3, 3, 3, 3),
        ("smart_max_4", "smart_cross_sell", 4, 4, 4, 4),
        ("smart_no_padding", "smart_cross_sell", 5, 2, 2, 2),
        ("smart_120", "smart_cross_sell", 120, 3, 3, 120),
        ("smart_240_stress", "smart_cross_sell", 240, 3, 3, 240),
    ]
    rows: list[dict[str, Any]] = []
    requests: list[dict[str, Any]] = []
    for (
        shape_class,
        recommendation_type,
        count,
        rendered,
        diversity,
        categories,
    ) in declarations:
        candidates = _clone_shape_candidates(
            templates[recommendation_type],
            recommendation_type,
            count,
            category_count=categories,
        )
        request = _scorer_request(
            recommendation_type,
            candidates,
            f"synthetic-{shape_class}",
        )
        requests.append(request)
        rows.append(
            {
                "shapeClass": shape_class,
                "recommendationType": recommendation_type,
                "candidateCount": count,
                "expectedRenderedCount": rendered,
                "expectedMinimumCategoryDiversity": diversity,
                "requestJson": _canonical_json(request).decode(),
            }
        )
    return rows, requests


def _qualification_traffic_rows() -> list[dict[str, Any]]:
    rates: list[tuple[str, list[float], str]] = [
        ("warmup_5_rps", [5.0] * 5, "lunch"),
        ("ramp_to_50_rps", [9.5 + 4.5 * minute for minute in range(10)], "lunch"),
        ("peak_50_rps", [50.0] * 30, "lunch"),
        ("shock_100_rps", [100.0] * 2, "dinner"),
        ("recovery_25_rps", [25.0] * 15, "dinner"),
        ("drain_5_rps", [5.0] * 15, "dinner"),
    ]
    rows: list[dict[str, Any]] = []
    minute_offset = 0
    for phase, phase_rates, daypart in rates:
        for target_rps in phase_rates:
            rows.append(
                {
                    "trafficProfile": "aws_qualification_v1",
                    "phase": phase,
                    "seed": None,
                    "minute": None,
                    "minuteOffset": minute_offset,
                    "durationSeconds": 60,
                    "targetRps": target_rps,
                    "daypart": daypart,
                    "rush": phase in {"peak_50_rps", "shock_100_rps"},
                    "arrivals": int(target_rps * 60),
                }
            )
            minute_offset += 1
    return rows


def _write_row_group(
    path: Path,
    rows: list[dict[str, Any]],
    schema: pa.Schema,
    writers: dict[str, pq.ParquetWriter],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    key = str(path)
    writer = writers.get(key)
    if writer is None:
        writer = pq.ParquetWriter(
            path,
            schema,
            compression="zstd",
            compression_level=3,
            use_dictionary=True,
            write_statistics=True,
            version="2.6",
            data_page_version="2.0",
        )
        writers[key] = writer
    writer.write_table(pa.Table.from_pylist(rows, schema=schema))


def _environment_binding() -> dict[str, Any]:
    package_root = Path(__file__).resolve().parents[2]
    lock_path = package_root / "uv.lock"
    return {
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "pythonExecutableVersion": sys.version.split()[0],
        "pyarrowVersion": pa.__version__,
        "uvLockSha256": hashlib.sha256(lock_path.read_bytes()).hexdigest(),
        "parquetWriter": PARQUET_WRITER_SETTINGS,
    }


def generate_world(
    output_root: Path | str,
    *,
    profile: GenerationProfile,
    world_revision: str,
    stream_seed_overrides: Mapping[str, int] | None = None,
) -> Path:
    if not world_revision or "/" in world_revision or ".." in world_revision:
        raise ValueError("world revision must be one safe path segment")
    world = Path(output_root) / world_revision
    if world.exists():
        raise FileExistsError(f"refusing to overwrite existing world: {world}")
    overrides = dict(stream_seed_overrides or {})
    stream_evidence: dict[str, dict[str, int]] = {}
    writers: dict[str, pq.ParquetWriter] = {}
    row_counts: Counter[str] = Counter()
    invalid_counters: Counter[str] = Counter()
    shape_templates: dict[str, dict[str, Any]] = {}

    for seed_position, seed in enumerate(profile.seeds):
        rows: dict[str, list[dict[str, Any]]] = {path: [] for path in ARTIFACT_SCHEMAS}
        streams, stream_seeds = _streams(world_revision, profile, seed, overrides)
        stream_evidence[str(seed)] = stream_seeds
        catalog_rows, products = _catalog(seed, streams["catalog"])
        population_rows, customers, latent_affinity = _population(
            seed, streams["population"]
        )
        rows["source/catalog.parquet"].extend(catalog_rows)
        rows["source/population.parquet"].extend(population_rows)
        minute_counts: Counter[tuple[str, str, bool]] = Counter()

        for index in range(profile.journeys_per_seed):
            split = _split(index, profile.journeys_per_seed)
            untouched = split == "untouched_test"
            started_at = _journey_time(index, seed_position)
            daypart = _daypart(started_at.hour)
            customer_pool = customers[128:] if untouched else customers[:128]
            customer = customer_pool[streams["traffic"].randrange(len(customer_pool))]
            affinity = latent_affinity[str(customer["customerId"])]
            if untouched:
                affinity = round(min(1.0, 0.15 + 0.80 * affinity), 8)
            journey_id = f"journey-{seed}-{index:06d}"
            has_initial_cart = index % 5 != 0
            initial_item = products[(index + 7) % 40] if has_initial_cart else None
            cart_subtotal = int(initial_item["priceImpactVnd"]) if initial_item else 0
            starter_type = (
                "for_you"
                if int(customer["completedOrderCount"]) > 0
                else "local_favorite"
            )
            journey = {
                "seed": seed,
                "journeyId": journey_id,
                "admissionOpportunityId": f"opportunity:{journey_id}:1",
                "startedAt": started_at.isoformat(),
                "split": split,
                "storeId": (
                    f"held-out-store-{seed}"
                    if untouched
                    else f"store-{seed}-{index % 3}"
                ),
                "customerId": customer["customerId"],
                "returningCustomer": customer["returningCustomer"],
                "fulfilmentMode": FULFILMENT_MODES[streams["traffic"].randrange(2)],
                "daypart": daypart,
                "starterRecommendationType": starter_type,
                "cartSubtotalVnd": cart_subtotal,
                "initialCartLineCount": 1 if initial_item else 0,
                "initialCartLineId": f"line:{journey_id}:initial"
                if initial_item
                else None,
                "initialCartItemId": initial_item["sellableItemId"]
                if initial_item
                else None,
                "desiredSmartSlateSize": 4 if index % 4 in {1, 2} else 3,
                "heldOutStore": untouched,
                "coldCustomer": untouched,
                "coldCandidate": untouched,
                "drift": untouched,
                "demandMultiplier": 1.65 if untouched else 1.0,
                "preferenceRegime": "shifted_sides_and_drinks"
                if untouched
                else "baseline",
                "promotionRegime": "inverted" if untouched else "baseline",
                "availabilityRate": 0.78 if untouched else 1.0,
                "rush": daypart in {"lunch", "dinner"},
            }
            rows["source/journeys.parquet"].append(journey)
            minute_counts[
                (started_at.isoformat(timespec="minutes"), daypart, journey["rush"])
            ] += 1
            starter, modifiers_by_parent, smart = _journey_candidates(
                products=products,
                catalog_rows=catalog_rows,
                journey=journey,
                affinity=affinity,
                index=index,
            )
            all_candidates = (
                starter
                + smart
                + [
                    candidate
                    for candidates in modifiers_by_parent.values()
                    for candidate in candidates
                ]
            )
            exogenous = _exogenous(
                candidates=all_candidates,
                outcome_rng=streams["outcomes"],
                policy_rng=streams["logging_policy"],
            )
            potentials = simulate_conditions(
                journey=journey,
                customer=customer,
                affinity=affinity,
                starter_candidates=starter,
                modifier_candidates_by_parent=modifiers_by_parent,
                smart_candidates=smart,
                exogenous=exogenous,
            )
            for result in potentials.values():
                rows["oracle/potential-outcomes.parquet"].append(
                    {key: value for key, value in result.items() if key != "_path"}
                )
            assigned_condition = CONDITIONS[
                streams["splits"].randrange(len(CONDITIONS))
            ]
            factual = potentials[assigned_condition]
            rows["evaluation/journeys.parquet"].append(
                {
                    key: factual[key]
                    for key in (
                        "seed",
                        "journeyId",
                        "condition",
                        "pairedComparisonRef",
                        "starterRecommendationType",
                        "baseCartSubtotalVnd",
                        "selectedActionIdsJson",
                        "retainedActionIdsJson",
                        "removedActionIdsJson",
                        "treatmentRevenueVnd",
                        "terminalState",
                        "checkout",
                        "finalMerchandiseSubtotalVnd",
                    )
                }
                | {
                    "assignedCondition": factual["condition"],
                    "abandonment": not factual["checkout"],
                }
            )
            candidate_lookup = {
                str(candidate["candidateId"]): candidate for candidate in all_candidates
            }
            canonical_path = potentials["automatic"]["_path"]
            for placement, canonical_placement in zip(
                factual["_path"], canonical_path, strict=True
            ):
                canonical_candidate_ids = list(
                    canonical_placement["eligibleCandidateIds"]
                )
                canonical_candidate_set = set(canonical_candidate_ids)
                evaluation_candidate_ids = canonical_candidate_ids + [
                    candidate_id
                    for candidate_id in placement["eligibleCandidateIds"]
                    if candidate_id not in canonical_candidate_set
                ]
                members = placement["members"]
                rendered_ids = [member["actionId"] for member in members]
                selected_ids = [
                    member["actionId"] for member in members if member["selected"]
                ]
                rows["evaluation/opportunities.parquet"].append(
                    {
                        "seed": seed,
                        "journeyId": journey_id,
                        "opportunityId": placement["opportunityId"],
                        "occurredAt": (
                            started_at + timedelta(seconds=placement["sequence"])
                        ).isoformat(),
                        "sequence": placement["sequence"],
                        "recommendationType": placement["recommendationType"],
                        "placement": "starter"
                        if placement["sequence"] == 1
                        else "basket",
                        "status": placement["status"],
                        "emptyReason": placement["emptyReason"],
                        "assignedCondition": assigned_condition,
                        "treatmentPolicy": placement["policyName"],
                        "prerequisiteState": placement["prerequisiteState"],
                        "parentCartLineId": placement["parentCartLineId"],
                        "createdCartLineId": placement["createdCartLineId"],
                        "candidateCount": len(evaluation_candidate_ids),
                        "slateId": placement["slateId"],
                        "slateSize": len(members),
                        "slatePropensity": placement["slatePropensity"],
                        "outcomeClass": placement["outcomeClass"],
                        "renderedActionIdsJson": _canonical_json(rendered_ids).decode(),
                        "selectedActionIdsJson": _canonical_json(selected_ids).decode(),
                        "cartSubtotalBeforeVnd": placement["cartSubtotalBeforeVnd"],
                        "cartSubtotalAfterVnd": placement["cartSubtotalAfterVnd"],
                        "cartLineCountBefore": placement["cartLineCountBefore"],
                        "cartLineCountAfter": placement["cartLineCountAfter"],
                    }
                )
                member_by_candidate = {
                    str(member["candidateId"]): member for member in members
                }
                for member in members:
                    rows["evaluation/exposures.parquet"].append(
                        {
                            "seed": seed,
                            "journeyId": journey_id,
                            "opportunityId": placement["opportunityId"],
                            "assignedCondition": assigned_condition,
                            "recommendationType": placement["recommendationType"],
                            "slateId": placement["slateId"],
                            **{
                                key: member[key]
                                for key in (
                                    "actionId",
                                    "candidateId",
                                    "categoryId",
                                    "renderedPosition",
                                    "priceImpactVnd",
                                    "composerScore",
                                    "slatePropensity",
                                    "selectionPropensity",
                                    "behaviorSelectionProbability",
                                    "selected",
                                    "retained",
                                    "removed",
                                )
                            },
                        }
                    )
                for candidate_id in evaluation_candidate_ids:
                    candidate = candidate_lookup[candidate_id]
                    member = member_by_candidate.get(candidate_id)
                    shown = member is not None
                    candidate_placement = (
                        canonical_placement
                        if candidate_id in canonical_candidate_set
                        else placement
                    )
                    rows["evaluation/candidate-relevance.parquet"].append(
                        _candidate_relevance_row(
                            seed=seed,
                            split=split,
                            journey_id=journey_id,
                            opportunity_id=placement["opportunityId"],
                            recommendation_type=placement["recommendationType"],
                            candidate=candidate,
                            affinity=affinity,
                            placement=candidate_placement,
                            journey=journey,
                        )
                    )
                    features = _candidate_features(
                        candidate=candidate,
                        recommendation_type=placement["recommendationType"],
                        placement=candidate_placement,
                        journey=journey,
                        customer=customer,
                        index=index,
                    )
                    training_candidate = {
                        "candidateId": candidate_id,
                        "eligibility": "eligible",
                        "priceImpactVnd": candidate["priceImpactVnd"],
                        "features": features,
                    }
                    shape_templates.setdefault(
                        placement["recommendationType"], training_candidate
                    )
                    rows["model-visible/training-examples.parquet"].append(
                        {
                            "seed": seed,
                            "journeyId": journey_id,
                            "opportunityId": placement["opportunityId"],
                            "split": split,
                            "loggingPolicy": placement["policyName"],
                            "candidateId": candidate_id,
                            "eligibility": "eligible",
                            "priceImpactVnd": candidate["priceImpactVnd"],
                            **features,
                            "shown": shown,
                            "slateId": placement["slateId"] if shown else None,
                            "renderedPosition": member["renderedPosition"]
                            if shown
                            else None,
                            "slatePropensity": member["slatePropensity"]
                            if shown
                            else None,
                            "selectionPropensity": member["selectionPropensity"]
                            if shown
                            else None,
                            "exposurePropensity": member["selectionPropensity"]
                            if shown
                            else None,
                            "selected": member["selected"] if shown else None,
                            "selectedThroughCheckout": (
                                member["selected"]
                                and member["retained"]
                                and factual["checkout"]
                            )
                            if shown
                            else None,
                        }
                    )

        for minute_offset, ((minute, daypart, rush), arrivals) in enumerate(
            sorted(minute_counts.items())
        ):
            rows["traffic/arrivals-per-minute.parquet"].append(
                {
                    "trafficProfile": "synthetic_world_observed",
                    "phase": daypart,
                    "seed": seed,
                    "minute": minute,
                    "minuteOffset": minute_offset,
                    "durationSeconds": 60,
                    "targetRps": arrivals / 60,
                    "daypart": daypart,
                    "rush": rush,
                    "arrivals": arrivals,
                }
            )
        seed_invalid = count_invalid_rows(
            training_rows=rows["model-visible/training-examples.parquet"],
            journey_rows=rows["evaluation/journeys.parquet"],
            scorer_requests=(),
        )
        invalid_counters.update(seed_invalid)
        if any(seed_invalid.values()):
            raise ValueError(f"synthetic world validation failed: {seed_invalid}")
        for relative_path, schema in ARTIFACT_SCHEMAS.items():
            if relative_path == "traffic/scorer-candidate-shapes.parquet":
                continue
            _write_row_group(
                world / relative_path, rows[relative_path], schema, writers
            )
            row_counts[relative_path] += len(rows[relative_path])

    missing_templates = set(RECOMMENDATION_TYPES).difference(shape_templates)
    if missing_templates:
        raise ValueError(f"missing scorer shape templates: {sorted(missing_templates)}")
    shape_rows, scorer_requests = _shape_rows(shape_templates)
    shape_invalid = count_invalid_rows(
        training_rows=(), journey_rows=(), scorer_requests=scorer_requests
    )
    invalid_counters.update(shape_invalid)
    if any(shape_invalid.values()):
        raise ValueError(f"scorer shape validation failed: {shape_invalid}")
    shape_path = "traffic/scorer-candidate-shapes.parquet"
    _write_row_group(
        world / shape_path,
        shape_rows,
        ARTIFACT_SCHEMAS[shape_path],
        writers,
    )
    row_counts[shape_path] = len(shape_rows)
    qualification_rows = _qualification_traffic_rows()
    traffic_path = "traffic/arrivals-per-minute.parquet"
    _write_row_group(
        world / traffic_path,
        qualification_rows,
        ARTIFACT_SCHEMAS[traffic_path],
        writers,
    )
    row_counts[traffic_path] += len(qualification_rows)
    for writer in writers.values():
        writer.close()

    artifact_evidence: dict[str, dict[str, Any]] = {}
    for relative_path, schema in ARTIFACT_SCHEMAS.items():
        artifact_path = world / relative_path
        payload = artifact_path.read_bytes()
        artifact_evidence[relative_path] = {
            "byteSize": len(payload),
            "rowCount": row_counts[relative_path],
            "schemaDigest": schema_digest(schema),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    candidate_relevance_definition = {
        "version": CANDIDATE_RELEVANCE_DEFINITION_VERSION,
        "sha256": CANDIDATE_RELEVANCE_DEFINITION_DIGEST,
        **CANDIDATE_RELEVANCE_DEFINITION,
    }
    source_contract_sha256 = hashlib.sha256(
        _canonical_json(
            {
                "manifestSchemaVersion": WORLD_MANIFEST_VERSION,
                "generatorRevision": GENERATOR_REVISION,
                "candidateRelevanceDefinition": candidate_relevance_definition,
                "artifactSchemaDigests": {
                    path: evidence["schemaDigest"]
                    for path, evidence in artifact_evidence.items()
                },
            }
        )
    ).hexdigest()
    qualification_precommit_payload = {
        "schemaVersion": "kfc-world-qualification-precommit-v1",
        "stage": "world_generation_precommit",
        "worldRevision": world_revision,
        "generatorRevision": GENERATOR_REVISION,
        "sourceContractSha256": source_contract_sha256,
        "configurationFileName": "selected-configuration.json",
    }
    qualification_precommit_bytes = _canonical_json(
        qualification_precommit_payload, pretty=True
    )
    qualification_precommit_path = (
        world / "manifests" / "qualification-precommit.json"
    )
    qualification_precommit_path.parent.mkdir(parents=True, exist_ok=True)
    qualification_precommit_path.write_bytes(qualification_precommit_bytes)
    qualification_precommit_path.chmod(0o444)
    manifest = {
        "schemaVersion": WORLD_MANIFEST_VERSION,
        "worldRevision": world_revision,
        "generatorRevision": GENERATOR_REVISION,
        "artifactEncoding": "parquet",
        "environment": _environment_binding(),
        "syntheticOnlyDisclaimer": (
            "Synthetic qualification evidence only; this world does not claim "
            "compatibility with real KFC data."
        ),
        "profile": {
            "name": profile.name,
            "journeysPerSeed": profile.journeys_per_seed,
            "seeds": list(profile.seeds),
            "totalJourneys": profile.total_journeys,
        },
        "physicalSurfaces": {
            "source": "pre-opportunity synthetic commerce facts",
            "model-visible": "pre-decision features and factual shown labels only",
            "evaluation": (
                "factual lifecycle plus candidate-level potential value, physically "
                "separate from model-visible training data"
            ),
            "oracle": "paired treatment paths, latent facts, and potential outcomes",
        },
        "candidateRelevanceDefinition": candidate_relevance_definition,
        "qualificationPrecommit": {
            "path": "manifests/qualification-precommit.json",
            "sha256": hashlib.sha256(qualification_precommit_bytes).hexdigest(),
            "sourceContractSha256": source_contract_sha256,
        },
        "randomStreams": stream_evidence,
        "streamSeedOverrides": overrides,
        "splitStrategy": {
            "unit": "whole_journey",
            "order": ["training", "calibration", "validation", "untouched_test"],
            "fractions": [0.60, 0.15, 0.10, 0.15],
        },
        "conditionVocabulary": list(CONDITIONS),
        "fulfilmentVocabulary": list(FULFILMENT_MODES),
        "treatmentPolicies": {
            "automatic": "automatic_proxy_scorer_composer_v1",
            "random_eligible": "random_uniform_without_replacement",
            "popularity": "popularity_descending_v1",
            "ablations": "automatic proxy with exactly one named type suppressed",
            "no_recommendation": "no action or slate",
        },
        "placementComposer": {
            "order": ("condition-specific ranking then shared deterministic composer"),
            "singleActionTypes": [
                "local_favorite",
                "for_you",
                "modifier_upsell",
            ],
            "smartCrossSell": {
                "budgetCeilingVnd": 250_000,
                "defaultRenderedCount": 3,
                "maximumRenderedCount": 4,
                "minimumReadyCount": 3,
                "insufficientResult": "typed empty with no slate",
                "fourthMemberRule": (
                    "requested size is 4; score is positive; category is new; "
                    "composed total remains within remaining budget"
                ),
            },
        },
        "driftMechanism": {
            "window": "untouched_test",
            "demand": "sides/drinks x1.65; other categories x0.72",
            "preferences": "affinity transformed to 0.15 + 0.80 * baseline",
            "promotions": "baseline flags inverted",
            "availabilityRate": 0.78,
            "catalogRevision": "drift-v2",
        },
        "trafficProfiles": {
            "peak": {"phase": "peak_50_rps", "targetRps": 50, "minutes": 30},
            "shock": {"phase": "shock_100_rps", "targetRps": 100, "minutes": 2},
        },
        "qualityCounters": dict(invalid_counters),
        "artifacts": artifact_evidence,
    }
    manifest["worldDigest"] = hashlib.sha256(_canonical_json(manifest)).hexdigest()
    manifest_path = world / "manifests" / "synthetic-world.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(_canonical_json(manifest, pretty=True))
    return world
