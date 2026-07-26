from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from kfc_recommendation_simulator.recommendation_contracts import (
    RecommendationDecisionRequest,
    RecommendationDecisionResponse,
    RecommendationEvent,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES_DIRECTORY = REPO_ROOT / "contracts" / "recommendations" / "v1" / "examples"


def read_example(name: str) -> dict[str, Any]:
    with (EXAMPLES_DIRECTORY / name).open(encoding="utf-8") as example_file:
        return json.load(example_file)


def valid_request() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-decision-request.json"))


def valid_response() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-decision-response.json"))


def valid_event() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-recommendation-event.json"))


def modifier_action(action_id: str = "action-modifier-001") -> dict[str, Any]:
    return {
        "type": "apply_modifier",
        "actionId": action_id,
        "parentCartLineId": "cart-line-001",
        "parentSellableItemId": "cart-item-001",
        "optionId": "modifier-option-001",
        "groupPath": ["modifier-group-001"],
        "quantity": 1,
        "priceImpact": {"amount": 5000, "currency": "VND"},
        "cartRevision": "cart-revision-001",
    }


def product_action(action_id: str) -> dict[str, Any]:
    return {
        "type": "add_product",
        "actionId": action_id,
        "sellableItemId": f"item-{action_id}",
        "quantity": 1,
        "priceImpact": {"amount": 45000, "currency": "VND"},
        "cartRevision": "cart-revision-001",
    }


def replace_cart_line_action() -> dict[str, Any]:
    return {
        "type": "replace_cart_line",
        "actionId": "action-replace-001",
        "replacedCartLineId": "cart-line-001",
        "replacement": product_action("action-replacement-product-001"),
        "priceImpact": {"amount": 0, "currency": "VND"},
        "cartRevision": "cart-revision-001",
    }


def display_fact(action_id: str) -> dict[str, Any]:
    return {
        "actionId": action_id,
        "name": "Recommended item",
        "imageUrl": None,
        "priceImpact": {"amount": 45000, "currency": "VND"},
    }


class RecommendationContractsTest(unittest.TestCase):
    def assert_invalid_request(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationDecisionRequest.model_validate(value)

    def assert_invalid_response(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationDecisionResponse.model_validate(value)

    def assert_invalid_event(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationEvent.model_validate(value)

    def test_parses_canonical_decision_request(self) -> None:
        parsed = RecommendationDecisionRequest.model_validate(valid_request())

        self.assertEqual(parsed.request_id, "rec-request-001")
        self.assertTrue(parsed.commerce_snapshot_bindings.catalog.complete)

    def test_parses_canonical_decision_response_and_event(self) -> None:
        self.assertEqual(
            RecommendationDecisionResponse.model_validate(
                valid_response()
            ).recommendation_id,
            "recommendation-001",
        )
        self.assertEqual(
            RecommendationEvent.model_validate(valid_event()).event_id,
            "event-impression-001",
        )

    def test_parses_json_schema_accepted_instant_lexical_forms(self) -> None:
        for instant in (
            "2026-07-27t09:00:00z",
            "2026-07-27 09:00:00+00:00",
        ):
            with self.subTest(instant=instant):
                value = valid_request()
                value["decisionTime"] = instant

                parsed = RecommendationDecisionRequest.model_validate(value)
                self.assertIsNotNone(parsed.decision_time.tzinfo)
                self.assertIsNotNone(parsed.decision_time.utcoffset())

    def test_rejects_non_string_instants(self) -> None:
        request = valid_request()
        request["decisionTime"] = 1785142800
        self.assert_invalid_request(request)

        event = valid_event()
        event["occurredAt"] = 1785142805
        self.assert_invalid_event(event)

    def test_rejects_instants_without_a_timezone(self) -> None:
        value = valid_request()
        value["decisionTime"] = "2026-07-27T09:00:00"

        self.assert_invalid_request(value)

    def test_rejects_coerced_json_transport_primitives(self) -> None:
        request_cases: tuple[tuple[str, str, Any], ...] = (
            ("string opaque identifier", "requestId", 1),
            ("string money", "cart.subtotal.amount", "89000"),
            ("boolean quantity", "cart.lines.0.quantity", True),
            (
                "string boolean",
                "commerceSnapshotBindings.catalog.complete",
                "true",
            ),
        )
        for name, path, replacement in request_cases:
            with self.subTest(name=name):
                value = valid_request()
                target: dict[str, Any] = value
                segments = path.split(".")
                for segment in segments[:-1]:
                    target = target[segment] if not segment.isdigit() else target[int(segment)]
                target[segments[-1]] = replacement
                self.assert_invalid_request(value)

        response = valid_response()
        response["counts"]["potential"] = "8"
        self.assert_invalid_response(response)

    def test_rejects_unknown_properties(self) -> None:
        value = valid_request()
        value["unexpected"] = "forbidden"

        self.assert_invalid_request(value)

    def test_parsed_models_are_frozen(self) -> None:
        parsed = RecommendationDecisionRequest.model_validate(valid_request())

        with self.assertRaises(ValidationError):
            parsed.request_id = "rec-request-other"
        with self.assertRaises(ValidationError):
            parsed.cart.revision = "cart-revision-other"

    def test_rejects_mixed_commerce_environments(self) -> None:
        value = valid_request()
        value["commerceSnapshotBindings"]["availability"][
            "commerceEnvironment"
        ] = "other-environment"

        self.assert_invalid_request(value)

    def test_rejects_mismatched_cart_revision(self) -> None:
        value = valid_request()
        value["cart"]["revision"] = "cart-revision-other"

        self.assert_invalid_request(value)

    def test_rejects_snapshot_not_effective_at_decision_time(self) -> None:
        value = valid_request()
        value["commerceSnapshotBindings"]["catalog"]["effectiveAt"] = (
            "2026-07-27T09:01:00Z"
        )

        self.assert_invalid_request(value)

    def test_rejects_snapshot_expired_at_decision_time(self) -> None:
        value = valid_request()
        value["commerceSnapshotBindings"]["catalog"]["expiresAt"] = (
            "2026-07-27T09:00:00Z"
        )

        self.assert_invalid_request(value)

    def test_rejects_snapshot_observed_after_decision_time(self) -> None:
        value = valid_request()
        value["commerceSnapshotBindings"]["catalog"]["observedAt"] = (
            "2026-07-27T09:01:00Z"
        )

        self.assert_invalid_request(value)

    def test_requires_primary_offer_for_recommended_response(self) -> None:
        value = valid_response()
        value["primaryOffer"] = None
        value["displayFacts"] = []
        value["counts"]["displayed"] = 0

        self.assert_invalid_response(value)

    def test_parses_empty_response_without_primary_offer(self) -> None:
        value = valid_response()
        value["status"] = "empty"
        value["primaryOffer"] = None
        value["displayFacts"] = []
        value["counts"]["displayed"] = 0

        self.assertEqual(
            RecommendationDecisionResponse.model_validate(value).status, "empty"
        )

    def test_requires_non_recommended_statuses_to_have_no_primary_offer(self) -> None:
        value = valid_response()
        value["status"] = "suppressed"

        self.assert_invalid_response(value)

    def test_rejects_counts_that_do_not_sum_to_potential(self) -> None:
        value = valid_response()
        value["counts"]["potential"] = 9

        self.assert_invalid_response(value)

    def test_rejects_displayed_count_that_does_not_equal_offered_actions(self) -> None:
        value = valid_response()
        value["counts"]["displayed"] = 0

        self.assert_invalid_response(value)

    def test_rejects_display_facts_for_actions_outside_authoritative_offer(self) -> None:
        value = valid_response()
        value["displayFacts"][0]["actionId"] = "action-not-offered"

        self.assert_invalid_response(value)

    def test_parses_modifier_upsell_with_one_modifier_action(self) -> None:
        value = valid_response()
        value["placement"] = "modifier_upsell"
        value["primaryOffer"] = {"actions": [modifier_action()]}
        value["displayFacts"] = [display_fact("action-modifier-001")]

        self.assertEqual(
            RecommendationDecisionResponse.model_validate(value).placement,
            "modifier_upsell",
        )

    def test_modifier_upsell_requires_exactly_one_modifier_action(self) -> None:
        value = valid_response()
        value["placement"] = "modifier_upsell"
        value["primaryOffer"] = {
            "actions": [modifier_action(), modifier_action("action-modifier-002")]
        }
        value["displayFacts"] = [
            display_fact("action-modifier-001"),
            display_fact("action-modifier-002"),
        ]
        value["counts"]["displayed"] = 2

        self.assert_invalid_response(value)

    def test_modifier_upsell_rejects_a_product_action(self) -> None:
        value = valid_response()
        value["placement"] = "modifier_upsell"

        self.assert_invalid_response(value)

    def test_local_favorite_and_for_you_require_exactly_one_product_action(self) -> None:
        for placement in ("for_you", "local_favorite"):
            with self.subTest(placement=placement):
                value = valid_response()
                value["placement"] = placement
                value["primaryOffer"]["actions"].append(
                    product_action("action-product-002")
                )
                value["displayFacts"].append(display_fact("action-product-002"))
                value["counts"]["displayed"] = 2

                self.assert_invalid_response(value)

    def test_local_favorite_and_for_you_reject_non_product_actions(self) -> None:
        for placement in ("for_you", "local_favorite"):
            for action in (modifier_action(), replace_cart_line_action()):
                with self.subTest(placement=placement, action_type=action["type"]):
                    value = valid_response()
                    value["placement"] = placement
                    value["primaryOffer"] = {"actions": [action]}
                    value["displayFacts"] = [display_fact(action["actionId"])]

                    self.assert_invalid_response(value)

    def test_parses_smart_cross_sell_with_three_product_actions(self) -> None:
        value = valid_response()
        value["placement"] = "smart_cross_sell"
        value["primaryOffer"]["actions"].extend(
            [product_action("action-product-002"), product_action("action-product-003")]
        )
        value["displayFacts"].extend(
            [display_fact("action-product-002"), display_fact("action-product-003")]
        )
        value["counts"]["displayed"] = 3

        self.assertEqual(
            RecommendationDecisionResponse.model_validate(value).placement,
            "smart_cross_sell",
        )

    def test_smart_cross_sell_requires_three_or_four_product_actions(self) -> None:
        value = valid_response()
        value["placement"] = "smart_cross_sell"

        self.assert_invalid_response(value)

    def test_smart_cross_sell_rejects_non_product_action(self) -> None:
        modifier = modifier_action()
        value = valid_response()
        value["placement"] = "smart_cross_sell"
        value["primaryOffer"] = {
            "actions": [
                product_action("action-product-001"),
                product_action("action-product-002"),
                modifier,
            ]
        }
        value["displayFacts"] = [
            display_fact("action-product-001"),
            display_fact("action-product-002"),
            display_fact(modifier["actionId"]),
        ]
        value["counts"]["displayed"] = 3

        self.assert_invalid_response(value)
