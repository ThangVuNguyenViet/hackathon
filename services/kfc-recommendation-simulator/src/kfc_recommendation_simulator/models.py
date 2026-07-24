from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Placement(StrEnum):
    LOCAL_FAVORITES = "local_favorites"
    SMART_CROSS_SELL = "smart_cross_sell"
    MODIFIER_UPSELL = "modifier_upsell"
    SANITY_SINGLE_UPSELL = "sanity_single_upsell"


class LoggingPolicy(StrEnum):
    POPULARITY = "popularity"
    BASKET_ASSOCIATION = "basket_association"
    PROMOTION_BIASED = "promotion_biased"
    RANDOMIZED_EXPLORATION = "randomized_exploration"


class WorldConfig(StrictModel):
    schema_version: str = Field(alias="schemaVersion", pattern=r"^simulator-world-v1$")
    world_id: str = Field(alias="worldId", min_length=1)
    journey_count: int = Field(alias="journeyCount", ge=1, le=1_000_000)
    world_seed: int = Field(alias="worldSeed", ge=0)
    traffic_seed: int = Field(alias="trafficSeed", ge=0)
    logging_seed: int = Field(alias="loggingSeed", ge=0)
    outcome_seed: int = Field(alias="outcomeSeed", ge=0)
    horizon_days: int = Field(alias="horizonDays", ge=1)
    logging_policy_weights: dict[LoggingPolicy, float] = Field(
        alias="loggingPolicyWeights"
    )

    @model_validator(mode="after")
    def validate_policy_weights(self) -> "WorldConfig":
        if set(self.logging_policy_weights) != set(LoggingPolicy):
            raise ValueError("loggingPolicyWeights must cover every logging policy")
        total = sum(self.logging_policy_weights.values())
        if any(weight <= 0 for weight in self.logging_policy_weights.values()):
            raise ValueError("logging policy weights must be positive")
        if abs(total - 1.0) > 1e-9:
            raise ValueError("logging policy weights must sum to 1")
        return self


class InputPaths(StrictModel):
    menu_items: Path
    stores: Path
    modifiers: Path
    catalog_manifest: Path


class BundleManifest(StrictModel):
    schema_version: str = Field(alias="schemaVersion")
    bundle_id: str = Field(alias="bundleId")
    generated_at: str = Field(alias="generatedAt")
    world_id: str = Field(alias="worldId")
    config_hash: str = Field(alias="configHash")
    input_hashes: dict[str, str] = Field(alias="inputHashes")
    row_counts: dict[str, int] = Field(alias="rowCounts")
    artifact_hashes: dict[str, str] = Field(alias="artifactHashes")
    model_visible_directory: str = Field(alias="modelVisibleDirectory")
    oracle_directory: str = Field(alias="oracleDirectory")
