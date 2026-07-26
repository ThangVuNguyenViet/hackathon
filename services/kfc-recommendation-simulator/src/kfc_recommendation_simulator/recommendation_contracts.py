"""Pydantic projection of the KFC recommendation v1 transport contract."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    NonNegativeInt,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)

OpaqueId = Annotated[
    str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$")
]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
NonEmptyString = Annotated[str, StringConstraints(min_length=1)]
PositiveInt = Annotated[int, Field(gt=0)]
_INSTANT_ADAPTER = TypeAdapter(AwareDatetime)


def _parse_instant(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Instant must be an ISO date-time string")  # noqa: TRY004
    try:
        return _INSTANT_ADAPTER.validate_python(value)
    except ValidationError as error:
        raise ValueError("Instant must be an ISO date-time string") from error


Instant = Annotated[datetime, BeforeValidator(_parse_instant)]
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
    sanity_snapshot: OpaqueId = Field(alias="sanitySnapshot")
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

        if (
            self.primary_offer is not None
            and self.placement == "modifier_upsell"
            and (len(actions) != 1 or actions[0].type != "apply_modifier")
        ):
            raise ValueError("Modifier Upsell requires exactly one modifier action")
        if (
            self.primary_offer is not None
            and self.placement in {"local_favorite", "for_you"}
            and (len(actions) != 1 or actions[0].type != "add_product")
        ):
            raise ValueError(
                "Local Favorite and For You require exactly one product action"
            )
        if (
            self.primary_offer is not None
            and self.placement == "smart_cross_sell"
            and not (
                3 <= len(actions) <= 4
                and all(action.type == "add_product" for action in actions)
            )
        ):
            raise ValueError("Smart Cross-sell requires three or four product actions")
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
