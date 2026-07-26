"""Pydantic projection of the KFC recommendation v1 transport contract."""

from __future__ import annotations

import re
from datetime import datetime
from math import isfinite
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

# Models are shallow-frozen; callers must treat nested transport collections as read-only.
OpaqueId = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$")
]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
NonEmptyString = Annotated[str, StringConstraints(min_length=1)]
_CANONICAL_UTC_INSTANT_PATTERN = re.compile(
    r"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$"
)
_INSTANT_ADAPTER = TypeAdapter(AwareDatetime)


def _parse_instant(value: object) -> datetime:
    if (
        not isinstance(value, str)
        or _CANONICAL_UTC_INSTANT_PATTERN.fullmatch(value) is None
    ):
        raise ValueError("Instant must be an ISO date-time string")
    try:
        return _INSTANT_ADAPTER.validate_python(value)
    except ValidationError as error:
        raise ValueError("Instant must be an ISO date-time string") from error


Instant = Annotated[datetime, BeforeValidator(_parse_instant)]


def _parse_json_integer(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("Value must be a JSON integer")  # noqa: TRY004
    if isinstance(value, int):
        return value
    if isinstance(value, float) and isfinite(value) and value.is_integer():
        return int(value)
    raise ValueError("Value must be a JSON integer")


JsonInteger = Annotated[int, BeforeValidator(_parse_json_integer)]
NonNegativeInt = Annotated[JsonInteger, Field(ge=0)]
PositiveInt = Annotated[JsonInteger, Field(gt=0)]
Placement = Literal[
    "local_favorite", "for_you", "modifier_upsell", "smart_cross_sell"
]


class ContractModel(BaseModel):
    """Strict, immutable base for every model in this transport projection."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class Money(ContractModel):
    amount: NonNegativeInt
    currency: Literal["VND"]


class SnapshotProvenance(ContractModel):
    source: NonEmptyString
    reference: NonEmptyString


class SanitySnapshotBinding(ContractModel):
    snapshot_id: OpaqueId = Field(alias="snapshotId")
    digest: Sha256
    contributing_revisions: list[NonEmptyString] = Field(
        alias="contributingRevisions", min_length=1
    )

    @field_validator("contributing_revisions")
    @classmethod
    def validate_unique_contributing_revisions(
        cls, revisions: list[str]
    ) -> list[str]:
        if len(revisions) != len(set(revisions)):
            raise ValueError("Contributing revisions must be unique")
        return revisions


class SnapshotBinding(ContractModel):
    snapshot_id: OpaqueId = Field(alias="snapshotId")
    digest: Sha256
    source_revision: NonEmptyString = Field(alias="sourceRevision")
    observed_at: Instant = Field(alias="observedAt")
    effective_at: Instant = Field(alias="effectiveAt")
    expires_at: Instant = Field(alias="expiresAt")
    complete: bool
    commerce_environment: OpaqueId = Field(alias="commerceEnvironment")
    provenance: SnapshotProvenance


class CommerceSnapshotBindings(ContractModel):
    catalog: SnapshotBinding
    modifier_graph: SnapshotBinding = Field(alias="modifierGraph")
    store: SnapshotBinding
    availability: SnapshotBinding
    promotion: SnapshotBinding

    def all_bindings(self) -> tuple[tuple[str, SnapshotBinding], ...]:
        return (
            ("catalog", self.catalog),
            ("modifierGraph", self.modifier_graph),
            ("store", self.store),
            ("availability", self.availability),
            ("promotion", self.promotion),
        )


class ModifierSelection(ContractModel):
    group_path: list[OpaqueId] = Field(alias="groupPath", min_length=1)
    option_id: OpaqueId = Field(alias="optionId")
    quantity: PositiveInt
    price_impact: Money = Field(alias="priceImpact")


class CartLine(ContractModel):
    line_id: OpaqueId = Field(alias="lineId")
    sellable_item_id: OpaqueId = Field(alias="sellableItemId")
    quantity: PositiveInt
    unit_price: Money = Field(alias="unitPrice")
    modifiers: list[ModifierSelection]


class CartSnapshot(ContractModel):
    cart_id: OpaqueId = Field(alias="cartId")
    revision: OpaqueId
    subtotal: Money
    lines: list[CartLine]


class ExperimentProfile(ContractModel):
    profile_id: OpaqueId = Field(alias="profileId")
    output_mode: Literal["baseline", "learned_technical"] = Field(alias="outputMode")


class RecommendationDecisionRequest(ContractModel):
    schema_version: Literal["kfc-recommendation-v1"] = Field(alias="schemaVersion")
    request_id: OpaqueId = Field(alias="requestId")
    idempotency_key: OpaqueId = Field(alias="idempotencyKey")
    order_flow_id: OpaqueId = Field(alias="orderFlowId")
    session_id: OpaqueId = Field(alias="sessionId")
    placement: Placement
    verified_customer_ref: OpaqueId | None = Field(alias="verifiedCustomerRef")
    store_id: OpaqueId = Field(alias="storeId")
    fulfilment_mode: Literal["pickup", "delivery"] = Field(alias="fulfilmentMode")
    decision_time: Instant = Field(alias="decisionTime")
    cart: CartSnapshot
    cart_revision: OpaqueId = Field(alias="cartRevision")
    commerce_snapshot_bindings: CommerceSnapshotBindings = Field(
        alias="commerceSnapshotBindings"
    )
    eligibility_policy_version: Literal["kfc-recommendation-policy-v1"] = Field(
        alias="eligibilityPolicyVersion"
    )
    experiment_profile: ExperimentProfile = Field(alias="experimentProfile")

    @model_validator(mode="after")
    def validate_cross_field_invariants(self) -> Self:
        if self.cart.revision != self.cart_revision:
            raise ValueError("Cart revision must match the cart snapshot revision")

        bindings = self.commerce_snapshot_bindings.all_bindings()
        commerce_environment = bindings[0][1].commerce_environment
        if any(
            binding.commerce_environment != commerce_environment
            for _, binding in bindings[1:]
        ):
            raise ValueError("All snapshot bindings must share a commerce environment")

        for name, binding in bindings:
            if (
                binding.effective_at > self.decision_time
                or self.decision_time >= binding.expires_at
            ):
                raise ValueError(
                    f"Snapshot {name} must be effective at the decision time"
                )
            if binding.observed_at > self.decision_time:
                raise ValueError(
                    f"Snapshot {name} must be observed by the decision time"
                )
        return self


class AddProductAction(ContractModel):
    type: Literal["add_product"]
    action_id: OpaqueId = Field(alias="actionId")
    sellable_item_id: OpaqueId = Field(alias="sellableItemId")
    quantity: PositiveInt
    price_impact: Money = Field(alias="priceImpact")
    cart_revision: OpaqueId = Field(alias="cartRevision")


class ApplyModifierAction(ContractModel):
    type: Literal["apply_modifier"]
    action_id: OpaqueId = Field(alias="actionId")
    parent_cart_line_id: OpaqueId = Field(alias="parentCartLineId")
    parent_sellable_item_id: OpaqueId = Field(alias="parentSellableItemId")
    option_id: OpaqueId = Field(alias="optionId")
    group_path: list[OpaqueId] = Field(alias="groupPath", min_length=1)
    quantity: PositiveInt
    price_impact: Money = Field(alias="priceImpact")
    cart_revision: OpaqueId = Field(alias="cartRevision")


class ReplaceCartLineAction(ContractModel):
    type: Literal["replace_cart_line"]
    action_id: OpaqueId = Field(alias="actionId")
    replaced_cart_line_id: OpaqueId = Field(alias="replacedCartLineId")
    replacement: AddProductAction
    price_impact: Money = Field(alias="priceImpact")
    cart_revision: OpaqueId = Field(alias="cartRevision")


RecommendationAction = Annotated[
    AddProductAction | ApplyModifierAction | ReplaceCartLineAction,
    Field(discriminator="type"),
]


class PrimaryOffer(ContractModel):
    actions: list[RecommendationAction] = Field(min_length=1, max_length=4)


class DisplayFact(ContractModel):
    action_id: OpaqueId = Field(alias="actionId")
    name: str
    image_url: str | None = Field(alias="imageUrl")
    price_impact: Money = Field(alias="priceImpact")


class MerchandisingEffect(ContractModel):
    policy_id: OpaqueId = Field(alias="policyId")
    action: Literal[
        "exclude_target",
        "boost_target",
        "pin_target",
        "replace_slate",
        "suppress_placement",
    ]
    target_action_id: OpaqueId | None = Field(alias="targetActionId")
    detail: NonEmptyString


class VersionBindings(ContractModel):
    catalog: OpaqueId
    modifier_graph: OpaqueId = Field(alias="modifierGraph")
    store: OpaqueId
    availability: OpaqueId
    promotion: OpaqueId
    eligibility_policy: OpaqueId = Field(alias="eligibilityPolicy")
    sanity_snapshot: SanitySnapshotBinding = Field(alias="sanitySnapshot")
    feature_schema: OpaqueId = Field(alias="featureSchema")
    serving_ranker: OpaqueId = Field(alias="servingRanker")
    shadow_model: OpaqueId | None = Field(alias="shadowModel")
    calibration: OpaqueId | None
    experiment: OpaqueId
    logging_policy: OpaqueId = Field(alias="loggingPolicy")


class RecommendationCounts(ContractModel):
    potential: NonNegativeInt
    eligible: NonNegativeInt
    ineligible: NonNegativeInt
    scored: NonNegativeInt
    displayed: NonNegativeInt
    complete: bool


class RecommendationDecisionResponse(ContractModel):
    schema_version: Literal["kfc-recommendation-v1"] = Field(alias="schemaVersion")
    recommendation_id: OpaqueId = Field(alias="recommendationId")
    request_id: OpaqueId = Field(alias="requestId")
    order_flow_id: OpaqueId = Field(alias="orderFlowId")
    placement: Placement
    status: Literal[
        "recommended", "empty", "suppressed", "invalid_context", "ineligible_context"
    ]
    decision_source: Literal[
        "ranked", "merchandising_replacement", "fallback", "suppressed"
    ] = Field(alias="decisionSource")
    primary_offer: PrimaryOffer | None = Field(alias="primaryOffer")
    display_facts: list[DisplayFact] = Field(alias="displayFacts")
    reason_codes: list[
        Literal[
            "popular_here",
            "ordered_before",
            "matches_your_history",
            "completes_your_item",
            "completes_your_meal",
            "active_offer",
            "merchandising_selection",
        ]
    ] = Field(alias="reasonCodes")
    merchandising_effects: list[MerchandisingEffect] = Field(
        alias="merchandisingEffects"
    )
    version_bindings: VersionBindings = Field(alias="versionBindings")
    counts: RecommendationCounts
    trace_ref: OpaqueId = Field(alias="traceRef")

    @model_validator(mode="after")
    def validate_cross_field_invariants(self) -> Self:
        actions = self.primary_offer.actions if self.primary_offer is not None else []

        if self.status == "recommended" and self.primary_offer is None:
            raise ValueError("Recommended responses require a primary offer")
        if self.status != "recommended" and self.primary_offer is not None:
            raise ValueError("Non-recommended responses must not have a primary offer")
        if self.counts.eligible + self.counts.ineligible != self.counts.potential:
            raise ValueError("Eligible and ineligible counts must equal potential")
        if self.counts.displayed != len(actions):
            raise ValueError("Displayed count must equal the number of offered actions")

        action_ids = {action.action_id for action in actions}
        if any(fact.action_id not in action_ids for fact in self.display_facts):
            raise ValueError("Display facts must reference authoritative offer actions")

        has_replacement_action = any(
            action.type == "replace_cart_line" for action in actions
        )
        is_valid_sanity_replacement = (
            self.status == "recommended"
            and self.decision_source == "merchandising_replacement"
            and len(actions) == 1
            and actions[0].type == "replace_cart_line"
        )
        if has_replacement_action and not is_valid_sanity_replacement:
            raise ValueError(
                "A replacement requires one merchandising replacement action"
            )
        if (
            self.primary_offer is not None
            and not is_valid_sanity_replacement
            and self.placement == "modifier_upsell"
            and (len(actions) != 1 or actions[0].type != "apply_modifier")
        ):
            raise ValueError("Modifier Upsell requires exactly one modifier action")
        if (
            self.primary_offer is not None
            and not is_valid_sanity_replacement
            and self.placement in {"local_favorite", "for_you"}
            and (len(actions) != 1 or actions[0].type != "add_product")
        ):
            raise ValueError(
                "Local Favorite and For You require exactly one product action"
            )
        if (
            self.primary_offer is not None
            and not is_valid_sanity_replacement
            and self.placement == "smart_cross_sell"
            and not (
                3 <= len(actions) <= 4
                and all(action.type == "add_product" for action in actions)
            )
        ):
            raise ValueError("Smart Cross-sell requires three or four product actions")
        return self


def _validate_finite_json_value(value: object) -> None:
    if value is None or isinstance(value, (bool, int, str)):
        return
    if isinstance(value, float):
        if not isfinite(value):
            raise ValueError("Event payload numbers must be finite")
        return
    if isinstance(value, list):
        for item in value:
            _validate_finite_json_value(item)
        return
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("Event payload object keys must be strings")
        for item in value.values():
            _validate_finite_json_value(item)
        return
    raise ValueError("Event payload must contain only JSON values")


def _has_unique_values(values: list[str]) -> bool:
    return len(values) == len(set(values))


class PendingRecommendation(ContractModel):
    recommendation_id: OpaqueId = Field(alias="recommendationId")
    request_id: OpaqueId = Field(alias="requestId")
    placement: Placement
    action_ids: list[OpaqueId] = Field(alias="actionIds", min_length=1, max_length=4)
    cart_revision: OpaqueId = Field(alias="cartRevision")
    trace_ref: OpaqueId = Field(alias="traceRef")
    decided_at: Instant = Field(alias="decidedAt")

    @field_validator("action_ids")
    @classmethod
    def validate_unique_action_ids(cls, action_ids: list[str]) -> list[str]:
        if not _has_unique_values(action_ids):
            raise ValueError("Pending recommendation action IDs must be unique")
        return action_ids


class RecommendationState(ContractModel):
    schema_version: Literal["kfc-recommendation-state-v1"] = Field(
        alias="schemaVersion"
    )
    revision: NonNegativeInt
    order_flow_id: OpaqueId = Field(alias="orderFlowId")
    stage: Literal[
        "starter_eligible",
        "starter_resolved",
        "modifier_eligible",
        "modifier_pending",
        "modifier_resolved",
        "smart_cross_sell_eligible",
        "smart_cross_sell_pending",
        "complete",
    ]
    attempted_placements: list[Placement] = Field(alias="attemptedPlacements")
    shown_action_ids: list[OpaqueId] = Field(alias="shownActionIds")
    rejected_action_ids: list[OpaqueId] = Field(alias="rejectedActionIds")
    pending_recommendation: PendingRecommendation | None = Field(
        alias="pendingRecommendation"
    )
    recorded_outcome_event_ids: list[OpaqueId] = Field(alias="recordedOutcomeEventIds")
    next_eligible_placement: Literal[
        "starter", "modifier_upsell", "smart_cross_sell"
    ] | None = Field(alias="nextEligiblePlacement")

    @field_validator(
        "attempted_placements",
        "shown_action_ids",
        "rejected_action_ids",
        "recorded_outcome_event_ids",
    )
    @classmethod
    def validate_unique_values(cls, values: list[str]) -> list[str]:
        if not _has_unique_values(values):
            raise ValueError("Recommendation state arrays must be unique")
        return values

    @model_validator(mode="after")
    def validate_cross_field_invariants(self) -> Self:
        pending = self.pending_recommendation
        pending_is_starter = (
            pending is not None
            and pending.placement in {"local_favorite", "for_you"}
        )

        if self.stage == "starter_eligible":
            valid = self.next_eligible_placement == "starter" and pending is None
        elif self.stage == "starter_resolved":
            valid = self.next_eligible_placement is None and (
                pending is None or pending_is_starter
            )
        elif self.stage == "modifier_eligible":
            valid = self.next_eligible_placement == "modifier_upsell" and (
                pending is None or pending_is_starter
            )
        elif self.stage == "modifier_pending":
            valid = (
                self.next_eligible_placement is None
                and pending is not None
                and pending.placement == "modifier_upsell"
            )
        elif self.stage in {"modifier_resolved", "smart_cross_sell_eligible"}:
            valid = (
                self.next_eligible_placement == "smart_cross_sell" and pending is None
            )
        elif self.stage == "smart_cross_sell_pending":
            valid = (
                self.next_eligible_placement is None
                and pending is not None
                and pending.placement == "smart_cross_sell"
            )
        else:
            valid = self.next_eligible_placement is None and pending is None

        if not valid:
            raise ValueError("Recommendation state stage and pending fields conflict")
        if pending is not None and pending.placement not in self.attempted_placements:
            raise ValueError("Pending recommendation placement must already be attempted")
        return self


class RenderedRecommendationAction(ContractModel):
    action_id: OpaqueId = Field(alias="actionId")
    position: Annotated[JsonInteger, Field(ge=1, le=4)]


class RecommendationImpressionRequest(ContractModel):
    schema_version: Literal["kfc-recommendation-event-v1"] = Field(
        alias="schemaVersion"
    )
    event_id: OpaqueId = Field(alias="eventId")
    occurred_at: Instant = Field(alias="occurredAt")
    assistant_turn_id: OpaqueId = Field(alias="assistantTurnId")
    attachment_id: OpaqueId = Field(alias="attachmentId")
    rendered_actions: list[RenderedRecommendationAction] = Field(
        alias="renderedActions", min_length=1, max_length=4
    )
    cart_revision: OpaqueId = Field(alias="cartRevision")
    action_digest: Sha256 = Field(alias="actionDigest")

    @model_validator(mode="after")
    def validate_unique_rendered_actions(self) -> Self:
        action_ids = [action.action_id for action in self.rendered_actions]
        positions = [str(action.position) for action in self.rendered_actions]
        if not _has_unique_values(action_ids):
            raise ValueError("Rendered action IDs must be unique")
        if not _has_unique_values(positions):
            raise ValueError("Rendered action positions must be unique")
        return self


class RecommendationOutcomeRequest(ContractModel):
    schema_version: Literal["kfc-recommendation-event-v1"] = Field(
        alias="schemaVersion"
    )
    event_id: OpaqueId = Field(alias="eventId")
    event_type: Literal[
        "selected",
        "explicitly_dismissed",
        "ignored",
        "superseded",
        "cart_mutation_succeeded",
        "cart_mutation_failed",
        "checkout_completed",
        "order_abandoned",
        "order_cancelled",
    ] = Field(alias="eventType")
    occurred_at: Instant = Field(alias="occurredAt")
    actor: Literal["customer", "agent", "system", "client"]
    action_id: OpaqueId | None = Field(alias="actionId")
    cart_revision: OpaqueId | None = Field(alias="cartRevision")
    payload: dict[str, JsonValue]

    @field_validator("payload", mode="before")
    @classmethod
    def validate_finite_json_payload(cls, payload: object) -> object:
        _validate_finite_json_value(payload)
        return payload

    @model_validator(mode="after")
    def validate_action_id_invariants(self) -> Self:
        if self.event_type in {
            "selected",
            "cart_mutation_succeeded",
            "cart_mutation_failed",
        } and self.action_id is None:
            raise ValueError("Selected and mutation outcomes require an action ID")
        if self.event_type in {
            "checkout_completed",
            "order_abandoned",
            "order_cancelled",
        } and self.action_id is not None:
            raise ValueError("Terminal outcomes require a null action ID")
        return self


class RecommendationEvent(ContractModel):
    schema_version: Literal["kfc-recommendation-event-v1"] = Field(alias="schemaVersion")
    event_id: OpaqueId = Field(alias="eventId")
    event_type: Literal[
        "decision_requested",
        "decision_completed",
        "candidate_eligibility_summary",
        "impression_rendered",
        "selected",
        "explicitly_dismissed",
        "ignored",
        "superseded",
        "cart_mutation_succeeded",
        "cart_mutation_failed",
        "checkout_completed",
        "order_abandoned",
        "order_cancelled",
    ] = Field(alias="eventType")
    recommendation_id: OpaqueId | None = Field(alias="recommendationId")
    request_id: OpaqueId = Field(alias="requestId")
    order_flow_id: OpaqueId = Field(alias="orderFlowId")
    session_id: OpaqueId = Field(alias="sessionId")
    placement: Placement
    occurred_at: Instant = Field(alias="occurredAt")
    recorded_at: Instant = Field(alias="recordedAt")
    actor: Literal["customer", "agent", "system", "client"]
    action_id: OpaqueId | None = Field(alias="actionId")
    cart_revision: OpaqueId | None = Field(alias="cartRevision")
    version_bindings: VersionBindings = Field(alias="versionBindings")
    payload: dict[str, JsonValue]

    @field_validator("payload", mode="before")
    @classmethod
    def validate_finite_json_payload(cls, payload: object) -> object:
        _validate_finite_json_value(payload)
        return payload
