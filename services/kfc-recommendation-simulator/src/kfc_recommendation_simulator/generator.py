from __future__ import annotations

import hashlib
import json
import math
import random
from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .profiles import GenerationProfile
from .schemas import ARTIFACT_SCHEMAS, FEATURE_FIELDS, schema_digest
from .validation import count_invalid_rows

WORLD_MANIFEST_VERSION = "kfc-synthetic-world-manifest-v1"
GENERATOR_REVISION = "kfc-synthetic-causal-generator-v1"
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
LOGGING_POLICIES = (
    "stochastic_popularity",
    "basket_association",
    "promotion_biased",
    "randomized_exploration",
)
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
FULFILMENT_MODES = ("pickup", "delivery")
FEATURE_KEYS = tuple(name for name, _, _ in FEATURE_FIELDS)


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
    for index in range(24):
        price = 29_000 + 5_000 * (index % 13)
        product = {
            "sellableItemId": f"item-{seed}-{index:02d}",
            "categoryId": categories[index % len(categories)],
            "unitPriceVnd": price,
            "priceImpactVnd": price - (5_000 if index % 5 == 0 else 0),
            "promotionActive": index % 5 == 0,
            "localDemandCount": 40 + rng.randrange(600),
            "basketAssociationCount": 5 + rng.randrange(250),
            "basketComplementarityScore": round(rng.uniform(-0.2, 1.0), 6),
            "coldCandidate": index >= 20,
        }
        products.append(product)
        rows.append(
            {
                "seed": seed,
                "recordType": "product",
                **product,
                "modifierOptionId": None,
            }
        )
    for index in range(8):
        parent = products[index]
        rows.append(
            {
                "seed": seed,
                "recordType": "modifier_option",
                "sellableItemId": parent["sellableItemId"],
                "modifierOptionId": f"modifier-{seed}-{index:02d}",
                "categoryId": "modifier",
                "unitPriceVnd": parent["unitPriceVnd"],
                "priceImpactVnd": 5_000 + 2_000 * index,
                "promotionActive": False,
                "localDemandCount": 10 + rng.randrange(100),
                "basketAssociationCount": 5 + rng.randrange(60),
                "basketComplementarityScore": round(rng.uniform(0.1, 0.9), 6),
                "coldCandidate": index >= 6,
            }
        )
    return rows, products


def _population(
    seed: int, rng: random.Random
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, float]]:
    visible: list[dict[str, Any]] = []
    customers: list[dict[str, Any]] = []
    latent: dict[str, float] = {}
    for index in range(160):
        cold = index >= 128
        customer_id = f"{'cold-' if cold else ''}customer-{seed}-{index:03d}"
        returning = not cold and index % 4 != 0
        completed = rng.randrange(1, 30) if returning else 0
        customer = {
            "seed": seed,
            "customerId": customer_id,
            "returningCustomer": returning,
            "completedOrderCount": completed,
            "coldCustomer": cold,
        }
        customers.append(customer)
        visible.append(dict(customer))
        latent[customer_id] = round(rng.betavariate(2.4, 2.0), 8)
    return visible, customers, latent


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


def _empty_reason(
    recommendation_type: str, index: int, returning_customer: bool
) -> str | None:
    if recommendation_type == "for_you" and (not returning_customer or index % 29 == 0):
        return "insufficient_history"
    if recommendation_type == "modifier_upsell" and index % 31 == 0:
        return "parent_cart_line_not_found"
    if recommendation_type == "smart_cross_sell" and index % 37 == 0:
        return "empty_cart"
    if recommendation_type == "local_favorite" and index % 53 == 0:
        return "no_eligible_candidates"
    return None


def _candidate_features(
    *,
    candidate: Mapping[str, Any],
    recommendation_type: str,
    journey: Mapping[str, Any],
    customer: Mapping[str, Any],
    index: int,
) -> dict[str, Any]:
    modifier = recommendation_type == "modifier_upsell"
    smart = recommendation_type == "smart_cross_sell"
    parent_line = f"line-{journey['journeyId']}" if modifier else None
    parent_item = candidate["sellableItemId"] if modifier else None
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
        "catalogRevision": f"synthetic-catalog-{journey['seed']}-v1",
        "cartSubtotalVnd": journey["cartSubtotalVnd"],
        "cartLineCount": 1 + index % 3,
        "cartDistinctCategoryCount": 1 + index % 2,
        "candidateSellableItemId": candidate["sellableItemId"],
        "candidateModifierOptionId": candidate.get("modifierOptionId")
        if modifier
        else None,
        "candidateCategoryId": candidate["categoryId"],
        "candidatePriceImpactVnd": price_impact,
        "candidateUnitPriceVnd": unit_price,
        "candidateDiscountAmountVnd": unit_price - price_impact,
        "candidateDiscountActive": price_impact < unit_price,
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
        "modifierParentCartLineId": parent_line,
        "modifierParentSellableItemId": parent_item,
        "modifierGroupPath": "meal/size" if modifier else None,
        "modifierSelectionMode": "single" if modifier else None,
        "modifierOptionAvailable": True if modifier else None,
        "modifierOptionSafe": True if modifier else None,
        "modifierPriceRatio": round(price_impact / unit_price, 8) if modifier else None,
        "remainingBudgetVnd": 250_000 - int(journey["cartSubtotalVnd"])
        if modifier or smart
        else None,
        "basketAssociationCount": int(candidate["basketAssociationCount"])
        if smart
        else None,
        "basketComplementarityScore": float(candidate["basketComplementarityScore"])
        if smart
        else None,
        "basketRedundancyCount": index % 2 if smart else None,
        "basketCategoryDiversityCount": 1 + index % 3 if smart else None,
    }
    if tuple(feature) != FEATURE_KEYS:
        raise AssertionError(
            "candidate feature shape drifted from the accepted scorer contract"
        )
    return feature


def _candidates(
    *,
    recommendation_type: str,
    journey: Mapping[str, Any],
    customer: Mapping[str, Any],
    products: list[dict[str, Any]],
    catalog_rows: list[dict[str, Any]],
    index: int,
) -> list[dict[str, Any]]:
    count = 2 + index % 4
    cold = bool(journey["coldCandidate"])
    candidates: list[dict[str, Any]] = []
    if recommendation_type == "modifier_upsell":
        option_rows = [
            row for row in catalog_rows if row["recordType"] == "modifier_option"
        ]
        pool = option_rows[6:] if cold else option_rows[:6]
    else:
        pool = products[20:] if cold else products[:20]
    for offset in range(count):
        candidate = dict(pool[(index + offset) % len(pool)])
        if recommendation_type == "modifier_upsell":
            candidate_id = f"modifier:{candidate['modifierOptionId']}"
        else:
            candidate_id = f"product:{candidate['sellableItemId']}"
        features = _candidate_features(
            candidate=candidate,
            recommendation_type=recommendation_type,
            journey=journey,
            customer=customer,
            index=index + offset,
        )
        candidates.append(
            {
                "candidateId": candidate_id,
                "eligibility": "eligible",
                "priceImpactVnd": candidate["priceImpactVnd"],
                "features": features,
                "policyFacts": candidate,
            }
        )
    return candidates


def _propensities(candidates: list[dict[str, Any]], policy: str) -> list[float]:
    if policy == "stochastic_popularity":
        weights = [
            1.0 + candidate["policyFacts"]["localDemandCount"]
            for candidate in candidates
        ]
    elif policy == "basket_association":
        weights = [
            1.0 + candidate["policyFacts"]["basketAssociationCount"]
            for candidate in candidates
        ]
    elif policy == "promotion_biased":
        weights = [
            4.0 if candidate["policyFacts"]["promotionActive"] else 1.0
            for candidate in candidates
        ]
    else:
        weights = [1.0] * len(candidates)
    total = math.fsum(weights)
    exploration = 0.20
    return [
        (1.0 - exploration) * weight / total + exploration / len(candidates)
        for weight in weights
    ]


def _choose_index(propensities: list[float], rng: random.Random) -> int:
    threshold = rng.random()
    cumulative = 0.0
    for index, propensity in enumerate(propensities):
        cumulative += propensity
        if threshold <= cumulative:
            return index
    return len(propensities) - 1


def _model_binding(recommendation_type: str) -> dict[str, str]:
    return {
        "bundleId": "synthetic-unqualified-shape-only",
        "bundleDigest": "0" * 64,
        "modelRevision": f"shape-{recommendation_type}-v1",
        "calibratorRevision": "shape-calibrator-v1",
        "featureSchemaDigest": "1" * 64,
        "thresholdRevision": "shape-threshold-v1",
        "composerContractDigest": "2" * 64,
        "qualificationRunId": "shape-export-only",
        "qualificationEvidenceDigest": "3" * 64,
    }


def _scorer_request(
    recommendation_type: str,
    candidates: list[dict[str, Any]],
    request_index: int,
) -> dict[str, Any]:
    return {
        "schemaVersion": "kfc-automatic-scorer-v1",
        "requestId": f"synthetic-shape-{recommendation_type}-{request_index}",
        "recommendationType": recommendation_type,
        "model": _model_binding(recommendation_type),
        "candidates": [
            {
                key: candidate[key]
                for key in ("candidateId", "eligibility", "priceImpactVnd", "features")
            }
            for candidate in candidates
        ],
    }


def _condition_effect(condition: str, recommendation_type: str) -> float:
    if condition == "no_recommendation":
        return -1.0
    if condition == "random_eligible":
        return 0.03
    if condition == "popularity":
        return 0.06
    if condition == f"ablate_{recommendation_type}":
        return -1.0
    if condition.startswith("ablate_"):
        return 0.11
    return 0.14


def _potential_outcomes(
    *,
    seed: int,
    journey: Mapping[str, Any],
    recommendation_type: str,
    affinity: float,
    candidate_price: int,
    has_candidate: bool,
    rng: random.Random,
) -> dict[str, dict[str, Any]]:
    selection_draw = rng.random()
    checkout_draw = rng.random()
    retention_draw = rng.random()
    base_subtotal = int(journey["cartSubtotalVnd"])
    paired_ref = f"pair:{journey['journeyId']}"
    outcomes: dict[str, dict[str, Any]] = {}
    for condition in CONDITIONS:
        effect = _condition_effect(condition, recommendation_type)
        selection_probability = max(0.0, min(0.92, 0.08 + 0.55 * affinity + effect))
        selected = (
            has_candidate and effect >= 0 and selection_draw < selection_probability
        )
        checkout_probability = max(
            0.05, min(0.98, 0.58 + 0.12 * affinity + (0.06 if selected else 0))
        )
        checkout = checkout_draw < checkout_probability
        retained = selected and retention_draw >= 0.08
        terminal = "checkout_completed" if checkout else "order_abandoned"
        subtotal = (
            base_subtotal + (candidate_price if checkout and retained else 0)
            if checkout
            else 0
        )
        outcomes[condition] = {
            "seed": seed,
            "journeyId": journey["journeyId"],
            "opportunityId": journey["opportunityId"],
            "pairedComparisonRef": paired_ref,
            "condition": condition,
            "latentAffinity": affinity,
            "potentialSelection": selected,
            "terminalState": terminal,
            "finalMerchandiseSubtotalVnd": subtotal,
        }
    return outcomes


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
            compression="NONE",
            use_dictionary=False,
            write_statistics=True,
            version="2.6",
            data_page_version="2.0",
        )
        writers[key] = writer
    writer.write_table(pa.Table.from_pylist(rows, schema=schema))


def generate_world(
    output_root: Path | str,
    *,
    profile: GenerationProfile,
    world_revision: str,
    stream_seed_overrides: Mapping[str, int] | None = None,
) -> Path:
    if not world_revision or "/" in world_revision or ".." in world_revision:
        raise ValueError("world revision must be one safe path segment")
    output = Path(output_root)
    world = output / world_revision
    if world.exists():
        raise FileExistsError(
            f"refusing to overwrite existing synthetic world: {world}"
        )
    overrides = dict(stream_seed_overrides or {})
    shape_requests: dict[tuple[str, int], dict[str, Any]] = {}
    stream_evidence: dict[str, dict[str, int]] = {}
    writers: dict[str, pq.ParquetWriter] = {}
    row_counts: Counter[str] = Counter()
    invalid_counters: Counter[str] = Counter()

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
            rush = daypart in {"lunch", "dinner"}
            recommendation_type = RECOMMENDATION_TYPES[
                index % len(RECOMMENDATION_TYPES)
            ]
            customer_pool = customers[128:] if untouched else customers[:128]
            customer = customer_pool[streams["traffic"].randrange(len(customer_pool))]
            journey_id = f"journey-{seed}-{index:06d}"
            opportunity_id = f"opportunity-{seed}-{index:06d}"
            cart_subtotal = 45_000 + 10_000 * streams["behavior"].randrange(12)
            journey = {
                "seed": seed,
                "journeyId": journey_id,
                "opportunityId": opportunity_id,
                "startedAt": started_at.isoformat(),
                "split": split,
                "storeId": f"held-out-store-{seed}"
                if untouched
                else f"store-{seed}-{index % 3}",
                "customerId": customer["customerId"],
                "returningCustomer": customer["returningCustomer"],
                "fulfilmentMode": FULFILMENT_MODES[streams["traffic"].randrange(2)],
                "daypart": daypart,
                "recommendationType": recommendation_type,
                "cartSubtotalVnd": cart_subtotal,
                "heldOutStore": untouched,
                "coldCustomer": untouched,
                "coldCandidate": untouched,
                "drift": untouched,
                "rush": rush,
            }
            rows["source/journeys.parquet"].append(journey)
            minute_counts[
                (started_at.isoformat(timespec="minutes"), daypart, rush)
            ] += 1

            empty_reason = _empty_reason(
                recommendation_type, index, bool(customer["returningCustomer"])
            )
            candidates = (
                []
                if empty_reason
                else _candidates(
                    recommendation_type=recommendation_type,
                    journey=journey,
                    customer=customer,
                    products=products,
                    catalog_rows=catalog_rows,
                    index=index,
                )
            )
            policy = LOGGING_POLICIES[(index // 4) % len(LOGGING_POLICIES)]
            assigned_condition = CONDITIONS[
                streams["splits"].randrange(len(CONDITIONS))
            ]
            active_condition = assigned_condition not in {
                "no_recommendation",
                f"ablate_{recommendation_type}",
            }
            shown_index: int | None = None
            propensities: list[float] = []
            if candidates:
                propensities = _propensities(candidates, policy)
                if active_condition:
                    shown_index = _choose_index(propensities, streams["logging_policy"])
                shape_requests.setdefault(
                    (recommendation_type, len(candidates)),
                    _scorer_request(recommendation_type, candidates, index),
                )

            candidate_price = (
                int(candidates[shown_index]["priceImpactVnd"])
                if shown_index is not None
                else 0
            )
            potentials = _potential_outcomes(
                seed=seed,
                journey=journey,
                recommendation_type=recommendation_type,
                affinity=latent_affinity[customer["customerId"]],
                candidate_price=candidate_price,
                has_candidate=bool(candidates),
                rng=streams["outcomes"],
            )
            rows["oracle/potential-outcomes.parquet"].extend(potentials.values())
            factual = potentials[assigned_condition]
            selected = bool(factual["potentialSelection"] and shown_index is not None)
            checkout = factual["terminalState"] == "checkout_completed"
            removed = (
                selected
                and checkout
                and (factual["finalMerchandiseSubtotalVnd"] == cart_subtotal)
            )
            shown_candidate_id = (
                candidates[shown_index]["candidateId"]
                if shown_index is not None
                else None
            )
            selected_candidate_id = shown_candidate_id if selected else None
            rows["evaluation/opportunities.parquet"].append(
                {
                    "seed": seed,
                    "journeyId": journey_id,
                    "opportunityId": opportunity_id,
                    "occurredAt": started_at.isoformat(),
                    "recommendationType": recommendation_type,
                    "placement": "starter"
                    if recommendation_type in {"local_favorite", "for_you"}
                    else "basket",
                    "status": "empty" if empty_reason else "ready",
                    "emptyReason": empty_reason,
                    "assignedCondition": assigned_condition,
                    "loggingPolicy": policy,
                    "candidateCount": len(candidates),
                    "shownCandidateId": shown_candidate_id,
                    "renderedPosition": 1 if shown_index is not None else None,
                    "exposurePropensity": (
                        propensities[shown_index] if shown_index is not None else None
                    ),
                    "dismissed": shown_index is not None and not selected,
                    "selectedCandidateId": selected_candidate_id,
                    "acceptedItemRemoved": removed,
                    "cartMutation": "removed_before_checkout"
                    if removed
                    else ("succeeded" if selected else "not_attempted"),
                    "checkout": checkout,
                    "abandonment": not checkout,
                    "finalMerchandiseSubtotalVnd": factual[
                        "finalMerchandiseSubtotalVnd"
                    ],
                }
            )
            rows["evaluation/journeys.parquet"].append(
                {
                    "seed": seed,
                    "journeyId": journey_id,
                    "opportunityId": opportunity_id,
                    "assignedCondition": assigned_condition,
                    "pairedComparisonRef": factual["pairedComparisonRef"],
                    "terminalState": factual["terminalState"],
                    "checkout": checkout,
                    "abandonment": not checkout,
                    "finalMerchandiseSubtotalVnd": factual[
                        "finalMerchandiseSubtotalVnd"
                    ],
                }
            )
            for candidate_index, candidate in enumerate(candidates):
                is_shown = candidate_index == shown_index
                training_row = {
                    "seed": seed,
                    "journeyId": journey_id,
                    "opportunityId": opportunity_id,
                    "split": split,
                    "loggingPolicy": policy,
                    "candidateId": candidate["candidateId"],
                    "eligibility": "eligible",
                    "priceImpactVnd": candidate["priceImpactVnd"],
                    **candidate["features"],
                    "shown": is_shown,
                    "exposurePropensity": propensities[candidate_index]
                    if is_shown
                    else None,
                    "selected": selected if is_shown else None,
                    "selectedThroughCheckout": (selected and checkout and not removed)
                    if is_shown
                    else None,
                }
                rows["model-visible/training-examples.parquet"].append(training_row)

        for (minute, daypart, rush), arrivals in sorted(minute_counts.items()):
            rows["traffic/arrivals-per-minute.parquet"].append(
                {
                    "seed": seed,
                    "minute": minute,
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
                world / relative_path,
                rows[relative_path],
                schema,
                writers,
            )
            row_counts[relative_path] += len(rows[relative_path])

    scorer_requests = [shape_requests[key] for key in sorted(shape_requests)]
    shape_rows = [
        {
            "recommendationType": request["recommendationType"],
            "candidateCount": len(request["candidates"]),
            "requestJson": _canonical_json(request).decode(),
        }
        for request in scorer_requests
    ]
    shape_invalid = count_invalid_rows(
        training_rows=(),
        journey_rows=(),
        scorer_requests=scorer_requests,
    )
    invalid_counters.update(shape_invalid)
    if any(shape_invalid.values()):
        raise ValueError(f"synthetic world validation failed: {shape_invalid}")
    shape_path = "traffic/scorer-candidate-shapes.parquet"
    _write_row_group(
        world / shape_path,
        shape_rows,
        ARTIFACT_SCHEMAS[shape_path],
        writers,
    )
    row_counts[shape_path] = len(shape_rows)
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

    manifest = {
        "schemaVersion": WORLD_MANIFEST_VERSION,
        "worldRevision": world_revision,
        "generatorRevision": GENERATOR_REVISION,
        "artifactEncoding": "parquet",
        "parquetContract": {
            "formatVersion": "2.6",
            "compression": "NONE",
            "dictionaryEncoding": False,
        },
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
            "source": "physical synthetic source adapter facts",
            "model-visible": (
                "pre-decision features plus factual shown-candidate labels"
            ),
            "evaluation": "condition assignments and observed terminal outcomes",
            "oracle": (
                "latent preferences and paired potential outcomes; evaluator only"
            ),
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
        "exposurePolicy": {
            "explorationRate": 0.20,
            "knownPositiveSupport": True,
            "policies": list(LOGGING_POLICIES),
        },
        "qualityCounters": dict(invalid_counters),
        "artifacts": artifact_evidence,
    }
    manifest["worldDigest"] = hashlib.sha256(_canonical_json(manifest)).hexdigest()
    manifest_path = world / "manifests" / "synthetic-world.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(_canonical_json(manifest, pretty=True))
    return world
