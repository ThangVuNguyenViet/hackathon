"""Strict Python representations for the automatic recommendation wire contract.

The canonical JSON Schema remains the authority. These dependency-free parsers
give the Python scorer a fail-closed runtime boundary for its request and
response payloads.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Iterable, Mapping, Type, TypeVar


_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_RECOMMENDATION_TYPES = {
    "local_favorite",
    "for_you",
    "modifier_upsell",
    "smart_cross_sell",
}
_CHANNELS = {"kiosk", "chat", "workbench", "other"}
_EMPTY_REASONS = {
    "no_qualified_model",
    "no_eligible_candidates",
    "insufficient_history",
    "parent_cart_line_not_found",
    "empty_cart",
    "no_candidate_above_threshold",
    "recommendation_serving_paused",
}


class ContractValidationError(ValueError):
    """Raised when a payload is not an exact canonical contract shape."""


@dataclass(frozen=True)
class AutomaticRecommendationPayload:
    _wire: Mapping[str, Any]

    def to_wire(self) -> Dict[str, Any]:
        return copy.deepcopy(dict(self._wire))


class AutomaticRecommendationRequestPayload(AutomaticRecommendationPayload):
    pass


class AutomaticRecommendationResponsePayload(AutomaticRecommendationPayload):
    pass


class AutomaticRecommendationImpressionPayload(AutomaticRecommendationPayload):
    pass


class AutomaticRecommendationOutcomePayload(AutomaticRecommendationPayload):
    pass


class AutomaticRecommendationProblemPayload(AutomaticRecommendationPayload):
    pass


class AutomaticRecommendationInspectionPayload(AutomaticRecommendationPayload):
    pass


class AutomaticScorerRequestPayload(AutomaticRecommendationPayload):
    pass


class AutomaticScorerResponsePayload(AutomaticRecommendationPayload):
    pass


Payload = TypeVar("Payload", bound=AutomaticRecommendationPayload)


def _fail(message: str) -> None:
    raise ContractValidationError(message)


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{path} must be an object")
    return value


def _exact_object(value: Any, keys: Iterable[str], path: str) -> Mapping[str, Any]:
    payload = _mapping(value, path)
    expected = set(keys)
    actual = set(payload)
    if actual != expected:
        _fail(f"{path} must contain exactly {sorted(expected)}")
    return payload


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{path} must be a non-empty string")
    return value


def _opaque_id(value: Any, path: str) -> str:
    text = _string(value, path)
    if len(text) > 256 or not _OPAQUE_ID.fullmatch(text):
        _fail(f"{path} must be an opaque identifier")
    return text


def _sha256(value: Any, path: str) -> str:
    text = _string(value, path)
    if not _SHA256.fullmatch(text):
        _fail(f"{path} must be a lowercase SHA-256 digest")
    return text


def _integer(value: Any, path: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        _fail(f"{path} must be an integer at least {minimum}")
    return value


def _number(value: Any, path: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(f"{path} must be a number")
    number = float(value)
    if number < minimum or number > maximum:
        _fail(f"{path} must be between {minimum} and {maximum}")
    return number


def _datetime(value: Any, path: str) -> str:
    text = _string(value, path)
    if not (text.endswith("Z") or "+" in text[10:] or "-" in text[10:]):
        _fail(f"{path} must include an offset")
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        _fail(f"{path} must be an ISO-8601 date-time")
    return text


def _money(value: Any, path: str) -> None:
    payload = _exact_object(value, ("amount", "currency"), path)
    _integer(payload["amount"], f"{path}.amount")
    if payload["currency"] != "VND":
        _fail(f"{path}.currency must be VND")


def _cart(value: Any, path: str, non_empty: bool = False) -> None:
    payload = _exact_object(value, ("cartId", "revision", "subtotal", "lines"), path)
    _opaque_id(payload["cartId"], f"{path}.cartId")
    _opaque_id(payload["revision"], f"{path}.revision")
    _money(payload["subtotal"], f"{path}.subtotal")
    lines = payload["lines"]
    if not isinstance(lines, list) or (non_empty and not lines):
        _fail(f"{path}.lines must be {'non-empty ' if non_empty else ''}an array")
    for index, line in enumerate(lines):
        line_path = f"{path}.lines[{index}]"
        item = _exact_object(
            line,
            ("lineId", "sellableItemId", "quantity", "unitPrice", "modifiers"),
            line_path,
        )
        _opaque_id(item["lineId"], f"{line_path}.lineId")
        _opaque_id(item["sellableItemId"], f"{line_path}.sellableItemId")
        _integer(item["quantity"], f"{line_path}.quantity", 1)
        _money(item["unitPrice"], f"{line_path}.unitPrice")
        if not isinstance(item["modifiers"], list):
            _fail(f"{line_path}.modifiers must be an array")
        for modifier_index, modifier in enumerate(item["modifiers"]):
            modifier_path = f"{line_path}.modifiers[{modifier_index}]"
            selection = _exact_object(
                modifier,
                ("groupPath", "optionId", "quantity", "priceImpact"),
                modifier_path,
            )
            if not isinstance(selection["groupPath"], list) or not selection["groupPath"]:
                _fail(f"{modifier_path}.groupPath must be non-empty")
            for path_index, identifier in enumerate(selection["groupPath"]):
                _opaque_id(identifier, f"{modifier_path}.groupPath[{path_index}]")
            _opaque_id(selection["optionId"], f"{modifier_path}.optionId")
            _integer(selection["quantity"], f"{modifier_path}.quantity", 1)
            _money(selection["priceImpact"], f"{modifier_path}.priceImpact")


def _model_binding(value: Any, path: str) -> None:
    payload = _exact_object(
        value,
        (
            "bundleId",
            "bundleDigest",
            "modelRevision",
            "calibratorRevision",
            "featureSchemaDigest",
            "thresholdRevision",
            "composerContractDigest",
            "qualificationRunId",
            "qualificationEvidenceDigest",
        ),
        path,
    )
    for name in ("bundleId", "modelRevision", "calibratorRevision", "thresholdRevision", "qualificationRunId"):
        _opaque_id(payload[name], f"{path}.{name}")
    for name in (
        "bundleDigest",
        "featureSchemaDigest",
        "composerContractDigest",
        "qualificationEvidenceDigest",
    ):
        _sha256(payload[name], f"{path}.{name}")


def parse_automatic_recommendation_request(
    recommendation_type: str, value: Any
) -> AutomaticRecommendationRequestPayload:
    if recommendation_type not in _RECOMMENDATION_TYPES:
        _fail("recommendation_type is unknown")
    type_fields = {
        "local_favorite": (),
        "for_you": ("verifiedCustomerRef",),
        "modifier_upsell": ("parentCartLineId",),
        "smart_cross_sell": (),
    }[recommendation_type]
    base_fields = (
        "schemaVersion", "requestId", "storeId", "fulfilmentMode", "locale",
        "orderingJourneyRef", "opportunityRef", "cart",
    )
    payload = _exact_object(value, base_fields + type_fields, "request")
    if payload["schemaVersion"] != "kfc-automatic-recommendation-v1":
        _fail("request.schemaVersion is invalid")
    for name in ("requestId", "storeId", "orderingJourneyRef", "opportunityRef"):
        _opaque_id(payload[name], f"request.{name}")
    if payload["fulfilmentMode"] not in {"pickup", "delivery"}:
        _fail("request.fulfilmentMode is invalid")
    locale = _string(payload["locale"], "request.locale")
    if not 2 <= len(locale) <= 35:
        _fail("request.locale has an invalid length")
    _cart(payload["cart"], "request.cart", recommendation_type == "smart_cross_sell")
    for name in type_fields:
        _opaque_id(payload[name], f"request.{name}")
    return AutomaticRecommendationRequestPayload(payload)


def parse_automatic_recommendation_response(value: Any) -> AutomaticRecommendationResponsePayload:
    payload = _exact_object(
        value,
        ("schemaVersion", "requestId", "recommendationId", "recommendationType", "status", "emptyReason", "cartRevision", "catalogRevision", "expiresAt", "model", "proposals", "counts"),
        "response",
    )
    if payload["schemaVersion"] != "kfc-automatic-recommendation-v1":
        _fail("response.schemaVersion is invalid")
    for name in ("requestId", "recommendationId", "cartRevision", "catalogRevision"):
        _opaque_id(payload[name], f"response.{name}")
    if payload["recommendationType"] not in _RECOMMENDATION_TYPES:
        _fail("response.recommendationType is invalid")
    if payload["status"] not in {"recommended", "empty", "paused"}:
        _fail("response.status is invalid")
    _datetime(payload["expiresAt"], "response.expiresAt")
    proposals = payload["proposals"]
    if not isinstance(proposals, list) or len(proposals) > (3 if payload["recommendationType"] == "modifier_upsell" else 4):
        _fail("response.proposals exceeds its type maximum")
    for index, proposal in enumerate(proposals):
        proposal_path = f"response.proposals[{index}]"
        item = _exact_object(proposal, ("actionId", "action", "display", "reasonCodes"), proposal_path)
        _opaque_id(item["actionId"], f"{proposal_path}.actionId")
        action = _mapping(item["action"], f"{proposal_path}.action")
        if action.get("type") == "add_product":
            product = _exact_object(action, ("type", "sellableItemId", "quantity", "priceImpact"), f"{proposal_path}.action")
            _opaque_id(product["sellableItemId"], f"{proposal_path}.action.sellableItemId")
            _integer(product["quantity"], f"{proposal_path}.action.quantity", 1)
            _money(product["priceImpact"], f"{proposal_path}.action.priceImpact")
        elif action.get("type") == "apply_modifier":
            modifier = _exact_object(action, ("type", "parentCartLineId", "parentSellableItemId", "optionId", "groupPath", "quantity", "priceImpact"), f"{proposal_path}.action")
            for name in ("parentCartLineId", "parentSellableItemId", "optionId"):
                _opaque_id(modifier[name], f"{proposal_path}.action.{name}")
            if not isinstance(modifier["groupPath"], list) or not modifier["groupPath"]:
                _fail(f"{proposal_path}.action.groupPath must be non-empty")
            _integer(modifier["quantity"], f"{proposal_path}.action.quantity", 1)
            _money(modifier["priceImpact"], f"{proposal_path}.action.priceImpact")
        else:
            _fail(f"{proposal_path}.action.type is invalid")
        display = _exact_object(item["display"], ("name", "imageUrl", "priceImpact"), f"{proposal_path}.display")
        _string(display["name"], f"{proposal_path}.display.name")
        if display["imageUrl"] is not None:
            _string(display["imageUrl"], f"{proposal_path}.display.imageUrl")
        _money(display["priceImpact"], f"{proposal_path}.display.priceImpact")
        if not isinstance(item["reasonCodes"], list) or not item["reasonCodes"]:
            _fail(f"{proposal_path}.reasonCodes must be non-empty")
    counts = _exact_object(payload["counts"], ("potential", "eligible", "scored", "displayed"), "response.counts")
    for name in counts:
        _integer(counts[name], f"response.counts.{name}")
    if counts["displayed"] != len(proposals):
        _fail("response.counts.displayed must equal proposal count")
    status = payload["status"]
    empty_reason = payload["emptyReason"]
    if status == "recommended":
        if payload["model"] is None or not proposals or empty_reason is not None:
            _fail("recommended response must contain a model and proposals only")
    else:
        if payload["model"] is not None or proposals or empty_reason not in _EMPTY_REASONS:
            _fail("empty or paused response shape is invalid")
        if status == "paused" and empty_reason != "recommendation_serving_paused":
            _fail("paused response must use recommendation_serving_paused")
        if status == "empty" and empty_reason == "recommendation_serving_paused":
            _fail("empty response cannot use the pause reason")
    if payload["model"] is not None:
        _model_binding(payload["model"], "response.model")
    return AutomaticRecommendationResponsePayload(payload)


def _event_base(value: Any, keys: Iterable[str], path: str) -> Mapping[str, Any]:
    payload = _exact_object(value, keys, path)
    if payload["schemaVersion"] != "kfc-automatic-recommendation-event-v1":
        _fail(f"{path}.schemaVersion is invalid")
    for name in ("eventId", "orderingJourneyRef", "opportunityRef", "cartRevision"):
        _opaque_id(payload[name], f"{path}.{name}")
    if payload["channel"] not in _CHANNELS:
        _fail(f"{path}.channel is invalid")
    _datetime(payload["occurredAt"], f"{path}.occurredAt")
    return payload


def parse_automatic_recommendation_impression(value: Any) -> AutomaticRecommendationImpressionPayload:
    payload = _event_base(value, ("schemaVersion", "eventId", "channel", "occurredAt", "orderingJourneyRef", "opportunityRef", "cartRevision", "renderedActions"), "impression")
    actions = payload["renderedActions"]
    if not isinstance(actions, list) or len(actions) > 4:
        _fail("impression.renderedActions is invalid")
    for index, action in enumerate(actions):
        item = _exact_object(action, ("actionId", "renderedPosition"), f"impression.renderedActions[{index}]")
        _opaque_id(item["actionId"], f"impression.renderedActions[{index}].actionId")
        _integer(item["renderedPosition"], f"impression.renderedActions[{index}].renderedPosition", 1)
    return AutomaticRecommendationImpressionPayload(payload)


def parse_automatic_recommendation_outcome(value: Any) -> AutomaticRecommendationOutcomePayload:
    candidate = _mapping(value, "outcome")
    event_type = candidate.get("eventType")
    base = ("schemaVersion", "eventId", "channel", "occurredAt", "orderingJourneyRef", "opportunityRef", "cartRevision", "eventType")
    if event_type in {"selected", "action_dismissed"}:
        payload = _event_base(value, base + ("actionId", "renderedPosition"), "outcome")
        _opaque_id(payload["actionId"], "outcome.actionId")
        _integer(payload["renderedPosition"], "outcome.renderedPosition", 1)
    elif event_type in {"cart_mutation_succeeded", "cart_mutation_failed"}:
        payload = _event_base(value, base + ("actionId", "cartMutationRef"), "outcome")
        _opaque_id(payload["actionId"], "outcome.actionId")
        _opaque_id(payload["cartMutationRef"], "outcome.cartMutationRef")
    elif event_type == "slate_dismissed" or event_type == "order_abandoned":
        payload = _event_base(value, base, "outcome")
    elif event_type == "checkout_completed":
        payload = _event_base(value, base + ("orderRef",), "outcome")
        _opaque_id(payload["orderRef"], "outcome.orderRef")
    else:
        _fail("outcome.eventType is invalid")
    return AutomaticRecommendationOutcomePayload(payload)


def parse_automatic_recommendation_problem(value: Any) -> AutomaticRecommendationProblemPayload:
    payload = _mapping(value, "problem")
    if set(payload) not in ({"type", "title", "status", "code", "retryable"}, {"type", "title", "status", "code", "retryable", "requestId"}):
        _fail("problem has invalid fields")
    _string(payload.get("type"), "problem.type")
    _string(payload.get("title"), "problem.title")
    status_codes = {400: {"invalid_request"}, 404: {"recommendation_not_found"}, 409: {"identity_conflict", "stale_or_invalid_action"}, 503: {"recommendation_infrastructure_unavailable"}}
    if payload.get("status") not in status_codes or payload.get("code") not in status_codes[payload["status"]]:
        _fail("problem status and code must agree")
    if payload.get("retryable") != (payload["status"] == 503):
        _fail("problem retryability must agree with status")
    if "requestId" in payload and payload["requestId"] is not None:
        _opaque_id(payload["requestId"], "problem.requestId")
    return AutomaticRecommendationProblemPayload(payload)


def parse_automatic_recommendation_inspection(value: Any) -> AutomaticRecommendationInspectionPayload:
    payload = _exact_object(value, ("schemaVersion", "recommendationId", "requestDigest", "cartDigest", "model", "candidateEvidence", "persistenceEvidence"), "inspection")
    if payload["schemaVersion"] != "kfc-automatic-inspection-v1":
        _fail("inspection.schemaVersion is invalid")
    _opaque_id(payload["recommendationId"], "inspection.recommendationId")
    _sha256(payload["requestDigest"], "inspection.requestDigest")
    _sha256(payload["cartDigest"], "inspection.cartDigest")
    if payload["model"] is not None:
        _model_binding(payload["model"], "inspection.model")
    if not isinstance(payload["candidateEvidence"], list) or not isinstance(payload["persistenceEvidence"], dict):
        _fail("inspection evidence fields are invalid")
    return AutomaticRecommendationInspectionPayload(payload)


def parse_automatic_scorer_request(value: Any) -> AutomaticScorerRequestPayload:
    payload = _exact_object(value, ("schemaVersion", "requestId", "recommendationType", "model", "candidates"), "scorer request")
    if payload["schemaVersion"] != "kfc-automatic-scorer-v1" or payload["recommendationType"] not in _RECOMMENDATION_TYPES:
        _fail("scorer request has an invalid schema version or recommendation type")
    _opaque_id(payload["requestId"], "scorer request.requestId")
    _model_binding(payload["model"], "scorer request.model")
    candidates = payload["candidates"]
    if not isinstance(candidates, list) or not candidates:
        _fail("scorer request.candidates must be non-empty")
    for index, candidate in enumerate(candidates):
        item = _exact_object(candidate, ("candidateId", "eligibility", "priceImpactVnd", "features"), f"scorer request.candidates[{index}]")
        _opaque_id(item["candidateId"], f"scorer request.candidates[{index}].candidateId")
        if item["eligibility"] != "eligible":
            _fail("scorer request accepts eligible candidates only")
        _integer(item["priceImpactVnd"], f"scorer request.candidates[{index}].priceImpactVnd")
        if not isinstance(item["features"], dict):
            _fail("scorer request candidate features must be an object")
    return AutomaticScorerRequestPayload(payload)


def parse_automatic_scorer_response(value: Any) -> AutomaticScorerResponsePayload:
    payload = _exact_object(value, ("schemaVersion", "requestId", "model", "scores"), "scorer response")
    if payload["schemaVersion"] != "kfc-automatic-scorer-v1":
        _fail("scorer response.schemaVersion is invalid")
    _opaque_id(payload["requestId"], "scorer response.requestId")
    _model_binding(payload["model"], "scorer response.model")
    if not isinstance(payload["scores"], list):
        _fail("scorer response.scores must be an array")
    for index, score in enumerate(payload["scores"]):
        item = _exact_object(score, ("candidateId", "selectionProbability", "jointProbability", "explanationValues"), f"scorer response.scores[{index}]")
        _opaque_id(item["candidateId"], f"scorer response.scores[{index}].candidateId")
        selection = _number(item["selectionProbability"], f"scorer response.scores[{index}].selectionProbability", 0, 1)
        joint = _number(item["jointProbability"], f"scorer response.scores[{index}].jointProbability", 0, 1)
        if joint > selection:
            _fail("scorer response joint probability cannot exceed selection probability")
        if not isinstance(item["explanationValues"], dict):
            _fail("scorer response explanation values must be an object")
        for name, explanation in item["explanationValues"].items():
            _string(name, "scorer response explanation key")
            _number(explanation, "scorer response explanation value", -1, 1)
    return AutomaticScorerResponsePayload(payload)
