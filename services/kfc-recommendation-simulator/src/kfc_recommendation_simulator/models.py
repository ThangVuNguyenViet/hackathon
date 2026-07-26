from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Placement(StrEnum):
    LOCAL_FAVORITE = "local_favorite"
    FOR_YOU = "for_you"
    MODIFIER_UPSELL = "modifier_upsell"
    SMART_CROSS_SELL = "smart_cross_sell"


class LoggingPolicy(StrEnum):
    POPULARITY = "popularity"
    BASKET_ASSOCIATION = "basket_association"
    PROMOTION_BIASED = "promotion_biased"
    RANDOMIZED_EXPLORATION = "randomized_exploration"


class DriftPhase(StrictModel):
    starts_at_fraction: float = Field(alias="startsAtFraction", ge=0, lt=1)
    category_bias: str = Field(alias="categoryBias", min_length=1)
    promotion_response_delta: float = Field(alias="promotionResponseDelta")


class WorldConfig(StrictModel):
    schema_version: str = Field(alias="schemaVersion", pattern=r"^simulator-world-v3$")
    world_id: str = Field(alias="worldId", min_length=1)
    journey_count: int = Field(alias="journeyCount", ge=1, le=1_000_000)
    customer_pool_size: int = Field(alias="customerPoolSize", ge=1)
    identified_customer_fraction: float = Field(
        alias="identifiedCustomerFraction", gt=0, lt=1
    )
    world_seed: int = Field(alias="worldSeed", ge=0)
    traffic_seed: int = Field(alias="trafficSeed", ge=0)
    logging_seed: int = Field(alias="loggingSeed", ge=0)
    outcome_seed: int = Field(alias="outcomeSeed", ge=0)
    split_seed: int = Field(alias="splitSeed", ge=0)
    horizon_days: int = Field(alias="horizonDays", ge=1)
    batch_journeys: int = Field(alias="batchJourneys", ge=1, le=10_000)
    held_out_store_count: int = Field(alias="heldOutStoreCount", ge=1)
    cold_product_count: int = Field(alias="coldProductCount", ge=1)
    cold_modifier_count: int = Field(alias="coldModifierCount", ge=1)
    logging_temperature: float = Field(alias="loggingTemperature", gt=0)
    smart_cross_sell_default_size: int = Field(
        alias="smartCrossSellDefaultSize", ge=1, le=4
    )
    smart_cross_sell_max_size: int = Field(alias="smartCrossSellMaxSize", ge=1, le=4)
    logging_policy_weights: dict[LoggingPolicy, float] = Field(
        alias="loggingPolicyWeights"
    )
    drift_phases: tuple[DriftPhase, ...] = Field(alias="driftPhases", min_length=1)

    @model_validator(mode="after")
    def validate_world(self) -> WorldConfig:
        if set(self.logging_policy_weights) != set(LoggingPolicy):
            raise ValueError("loggingPolicyWeights must cover every logging policy")
        total = sum(self.logging_policy_weights.values())
        if any(weight <= 0 for weight in self.logging_policy_weights.values()):
            raise ValueError("logging policy weights must be positive")
        if abs(total - 1.0) > 1e-9:
            raise ValueError("logging policy weights must sum to 1")
        if self.smart_cross_sell_default_size > self.smart_cross_sell_max_size:
            raise ValueError(
                "smartCrossSellDefaultSize cannot exceed smartCrossSellMaxSize"
            )
        starts = [phase.starts_at_fraction for phase in self.drift_phases]
        if starts[0] != 0 or starts != sorted(set(starts)):
            raise ValueError(
                "driftPhases must start at zero and have unique ascending boundaries"
            )
        return self


class InputPaths(StrictModel):
    menu_items: Path
    stores: Path
    modifiers: Path
    store_availability: Path
    promotions: Path
    sanity_policies: Path
    catalog_manifest: Path


class BundleManifest(StrictModel):
    schema_version: str = Field(alias="schemaVersion")
    bundle_id: str = Field(alias="bundleId")
    generated_at: str = Field(alias="generatedAt")
    world_id: str = Field(alias="worldId")
    config_hash: str = Field(alias="configHash")
    content_digest: str = Field(alias="contentDigest")
    input_hashes: dict[str, str] = Field(alias="inputHashes")
    row_counts: dict[str, int] = Field(alias="rowCounts")
    artifact_hashes: dict[str, str] = Field(alias="artifactHashes")
    model_visible_directory: str = Field(alias="modelVisibleDirectory")
    evaluation_directory: str = Field(alias="evaluationDirectory")
    oracle_directory: str = Field(alias="oracleDirectory")
