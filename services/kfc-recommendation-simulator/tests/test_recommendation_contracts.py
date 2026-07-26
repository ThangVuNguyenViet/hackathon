from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError

from kfc_recommendation_simulator.recommendation_contracts import (
    Instant,
    RecommendationDecisionRequest,
    RecommendationDecisionResponse,
    RecommendationEvent,
    RecommendationImpressionRequest,
    RecommendationOutcomeRequest,
    RecommendationState,
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


def valid_state() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-recommendation-state.json"))


def valid_impression_request() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-impression-request.json"))


def valid_outcome_request() -> dict[str, Any]:
    return copy.deepcopy(read_example("valid-outcome-request.json"))


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


def sanity_snapshot_binding() -> dict[str, Any]:
    return {
        "snapshotId": "sanity-snapshot-001",
        "digest": "f" * 64,
        "contributingRevisions": ["sanity-policies-revision-001"],
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

    def assert_invalid_state(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationState.model_validate(value)

    def assert_invalid_impression_request(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationImpressionRequest.model_validate(value)

    def assert_invalid_outcome_request(self, value: dict[str, Any]) -> None:
        with self.assertRaises(ValidationError):
            RecommendationOutcomeRequest.model_validate(value)

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

    def test_parses_canonical_state_and_event_ingress_requests(self) -> None:
        self.assertEqual(
            RecommendationState.model_validate(valid_state()).next_eligible_placement,
            "starter",
        )
        self.assertEqual(
            RecommendationImpressionRequest.model_validate(
                valid_impression_request()
            ).assistant_turn_id,
            "assistant-turn-001",
        )
        self.assertEqual(
            RecommendationOutcomeRequest.model_validate(
                valid_outcome_request()
            ).event_type,
            "selected",
        )

    def test_state_stage_combinations(self) -> None:
        cases: tuple[tuple[str, str | None, str | None], ...] = (
            ("starter_eligible", "starter", None),
            ("starter_resolved", None, "for_you"),
            ("modifier_eligible", "modifier_upsell", "for_you"),
            ("modifier_pending", None, "modifier_upsell"),
            ("modifier_resolved", "smart_cross_sell", None),
            ("smart_cross_sell_eligible", "smart_cross_sell", None),
            ("smart_cross_sell_pending", None, "smart_cross_sell"),
            ("complete", None, None),
        )
        for stage, next_placement, pending_placement in cases:
            with self.subTest(stage=stage):
                value = valid_state()
                value["stage"] = stage
                value["nextEligiblePlacement"] = next_placement
                value["attemptedPlacements"] = (
                    [] if pending_placement is None else [pending_placement]
                )
                value["pendingRecommendation"] = (
                    None
                    if pending_placement is None
                    else {
                        "recommendationId": "recommendation-001",
                        "requestId": "rec-request-001",
                        "placement": pending_placement,
                        "actionIds": ["action-product-001"],
                        "cartRevision": "cart-revision-001",
                        "traceRef": "trace-001",
                        "decidedAt": "2026-07-27T09:00:00Z",
                    }
                )
                RecommendationState.model_validate(value)

    def test_rejects_duplicate_state_and_impression_action_ids(self) -> None:
        state = valid_state()
        state["shownActionIds"] = ["action-product-001", "action-product-001"]
        self.assert_invalid_state(state)

        impression = valid_impression_request()
        impression["renderedActions"].append(
            {"actionId": "action-product-001", "position": 2}
        )
        self.assert_invalid_impression_request(impression)

    def test_rejects_duplicate_impression_positions_and_invalid_action_digests(
        self,
    ) -> None:
        duplicate_position = valid_impression_request()
        duplicate_position["renderedActions"].append(
            {"actionId": "action-product-002", "position": 1}
        )
        self.assert_invalid_impression_request(duplicate_position)

        invalid_digest = valid_impression_request()
        invalid_digest["actionDigest"] = "A"
        self.assert_invalid_impression_request(invalid_digest)

    def test_rejects_strict_unknown_fields_in_state_and_event_ingress_requests(
        self,
    ) -> None:
        state = valid_state()
        state["unexpected"] = True
        self.assert_invalid_state(state)

        impression = valid_impression_request()
        impression["renderedActions"][0]["unexpected"] = True
        self.assert_invalid_impression_request(impression)

    def test_rejects_invalid_state_stage_and_next_placement_combinations(self) -> None:
        value = valid_state()
        value["nextEligiblePlacement"] = None
        self.assert_invalid_state(value)

    def test_rejects_pending_placement_outside_attempted_placements(self) -> None:
        value = valid_state()
        value["stage"] = "starter_resolved"
        value["nextEligiblePlacement"] = None
        value["pendingRecommendation"] = {
            "recommendationId": "recommendation-001",
            "requestId": "rec-request-001",
            "placement": "for_you",
            "actionIds": ["action-product-001"],
            "cartRevision": "cart-revision-001",
            "traceRef": "trace-001",
            "decidedAt": "2026-07-27T09:00:00Z",
        }
        self.assert_invalid_state(value)

    def test_outcome_action_id_refinements(self) -> None:
        rejected_cases: tuple[tuple[str, str | None], ...] = (
            ("selected", None),
            ("cart_mutation_succeeded", None),
            ("cart_mutation_failed", None),
            ("checkout_completed", "action-product-001"),
            ("order_abandoned", "action-product-001"),
            ("order_cancelled", "action-product-001"),
        )
        for event_type, action_id in rejected_cases:
            with self.subTest(event_type=event_type, action_id=action_id):
                value = valid_outcome_request()
                value["eventType"] = event_type
                value["actionId"] = action_id
                self.assert_invalid_outcome_request(value)

        for event_type in ("explicitly_dismissed", "ignored", "superseded"):
            with self.subTest(event_type=event_type):
                value = valid_outcome_request()
                value["eventType"] = event_type
                value["actionId"] = None
                RecommendationOutcomeRequest.model_validate(value)

    def test_instant_conformance_corpus(self) -> None:
        corpus = read_example("instant-conformance.json")
        adapter = TypeAdapter(Instant)

        for case in corpus["accepted"]:
            with self.subTest(category="accepted", name=case["name"]):
                parsed = adapter.validate_python(case["value"])
                self.assertIsNotNone(parsed.tzinfo)
                self.assertIsNotNone(parsed.utcoffset())

        for case in corpus["rejected"]:
            with (
                self.subTest(category="rejected", name=case["name"]),
                self.assertRaises(ValidationError),
            ):
                adapter.validate_python(case["value"])

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

    def test_accepts_integral_json_numbers_for_integer_fields(self) -> None:
        request = valid_request()
        request["cart"]["subtotal"]["amount"] = 89000.0
        request["cart"]["lines"][0]["quantity"] = 1.0
        parsed_request = RecommendationDecisionRequest.model_validate(request)
        self.assertEqual(parsed_request.cart.subtotal.amount, 89000)
        self.assertIsInstance(parsed_request.cart.subtotal.amount, int)
        self.assertEqual(parsed_request.cart.lines[0].quantity, 1)

        response = valid_response()
        for name in ("potential", "eligible", "ineligible", "scored", "displayed"):
            response["counts"][name] = float(response["counts"][name])
        parsed_response = RecommendationDecisionResponse.model_validate(response)
        self.assertEqual(parsed_response.counts.potential, 8)
        self.assertIsInstance(parsed_response.counts.potential, int)

    def test_rejects_non_json_integer_values(self) -> None:
        for value in (
            "89000",
            True,
            89000.5,
            float("nan"),
            float("inf"),
            float("-inf"),
        ):
            with self.subTest(value=value):
                request = valid_request()
                request["cart"]["subtotal"]["amount"] = value
                self.assert_invalid_request(request)

        request = valid_request()
        request["cart"]["lines"][0]["quantity"] = 0.0
        self.assert_invalid_request(request)

    def test_event_payload_rejects_nested_non_finite_numbers(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                event = valid_event()
                event["payload"] = {"outer": [{"inner": value}]}
                self.assert_invalid_event(event)

    def test_event_payload_accepts_recursive_json_values(self) -> None:
        event = valid_event()
        event["payload"] = {
            "null": None,
            "boolean": True,
            "integer": 1,
            "number": 1.5,
            "string": "value",
            "array": [None, False, 2, 2.5, "nested"],
            "object": {"nested": "value"},
        }

        parsed = RecommendationEvent.model_validate(event)

        self.assertEqual(parsed.payload["object"], {"nested": "value"})

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

    def test_parses_complete_sanity_merchandising_replacement_response(self) -> None:
        value = valid_response()
        action = replace_cart_line_action()
        value["decisionSource"] = "merchandising_replacement"
        value["primaryOffer"] = {"actions": [action]}
        value["displayFacts"] = [display_fact(action["actionId"])]

        parsed = RecommendationDecisionResponse.model_validate(value)

        self.assertEqual(parsed.decision_source, "merchandising_replacement")
        self.assertEqual(parsed.primary_offer.actions[0].type, "replace_cart_line")

    def test_replacement_action_requires_merchandising_replacement_source(self) -> None:
        for decision_source in ("ranked", "fallback", "suppressed"):
            with self.subTest(decision_source=decision_source):
                value = valid_response()
                action = replace_cart_line_action()
                value["decisionSource"] = decision_source
                value["primaryOffer"] = {"actions": [action]}
                value["displayFacts"] = [display_fact(action["actionId"])]

                self.assert_invalid_response(value)

    def test_merchandising_replacement_rejects_mixed_actions(self) -> None:
        value = valid_response()
        replacement = replace_cart_line_action()
        value["decisionSource"] = "merchandising_replacement"
        value["primaryOffer"] = {
            "actions": [replacement, product_action("action-product-002")]
        }
        value["displayFacts"] = [
            display_fact(replacement["actionId"]),
            display_fact("action-product-002"),
        ]
        value["counts"]["displayed"] = 2

        self.assert_invalid_response(value)

    def test_non_replacement_merchandising_response_uses_normal_placement_rules(
        self,
    ) -> None:
        value = valid_response()
        value["decisionSource"] = "merchandising_replacement"

        self.assertEqual(
            RecommendationDecisionResponse.model_validate(value).placement, "for_you"
        )

    def test_requires_strict_sanity_snapshot_binding(self) -> None:
        value = valid_response()
        value["versionBindings"]["sanitySnapshot"] = sanity_snapshot_binding()

        parsed = RecommendationDecisionResponse.model_validate(value)
        self.assertEqual(
            parsed.version_bindings.sanity_snapshot.snapshot_id,
            "sanity-snapshot-001",
        )

        value["versionBindings"]["sanitySnapshot"] = "sanity-snapshot-001"
        self.assert_invalid_response(value)

    def test_rejects_duplicate_sanity_snapshot_contributing_revisions(self) -> None:
        value = valid_response()
        binding = sanity_snapshot_binding()
        binding["contributingRevisions"].append("sanity-policies-revision-001")
        value["versionBindings"]["sanitySnapshot"] = binding

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
