from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

SCORER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCORER_ROOT / "src"))

from kfc_recommendation_scorer.contract_digest import (  # noqa: E402
    AUTOMATIC_SCORER_SCHEMA_VERSION,
    AutomaticRecommendationType,
    automatic_recommendation_contract_digest,
)
from kfc_recommendation_scorer.contract import (  # noqa: E402
    ContractValidationError,
    parse_automatic_recommendation_impression,
    parse_automatic_recommendation_inspection,
    parse_automatic_recommendation_outcome,
    parse_automatic_recommendation_problem,
    parse_automatic_recommendation_request,
    parse_automatic_recommendation_response,
    parse_automatic_scorer_request,
    parse_automatic_scorer_response,
)


class ContractDigestTest(unittest.TestCase):
    def test_python_scorer_exposes_the_four_recommendation_types(self) -> None:
        self.assertEqual(AUTOMATIC_SCORER_SCHEMA_VERSION, "kfc-automatic-scorer-v1")
        self.assertEqual(
            [item.value for item in AutomaticRecommendationType],
            [
                "local_favorite",
                "for_you",
                "modifier_upsell",
                "smart_cross_sell",
            ],
        )

    def test_python_consumer_recomputes_the_canonical_manifest_digest(self) -> None:
        repository_root = SCORER_ROOT.parents[1]
        contract_root = (
            repository_root / "contracts" / "automatic-recommendations" / "v1"
        )

        manifest = json.loads((contract_root / "contract-manifest.json").read_text())
        self.assertEqual(
            automatic_recommendation_contract_digest(contract_root),
            manifest["canonicalDigest"],
        )

    def test_python_representations_parse_every_canonical_fixture(self) -> None:
        repository_root = SCORER_ROOT.parents[1]
        contract_root = repository_root / "contracts" / "automatic-recommendations" / "v1"
        manifest = json.loads((contract_root / "contract-manifest.json").read_text())
        parsers = {
            "local_favorite_request": lambda value: parse_automatic_recommendation_request("local_favorite", value),
            "for_you_request": lambda value: parse_automatic_recommendation_request("for_you", value),
            "modifier_upsell_request": lambda value: parse_automatic_recommendation_request("modifier_upsell", value),
            "smart_cross_sell_request": lambda value: parse_automatic_recommendation_request("smart_cross_sell", value),
            "recommendation_response": parse_automatic_recommendation_response,
            "impression_request": parse_automatic_recommendation_impression,
            "outcome_request": parse_automatic_recommendation_outcome,
            "problem_details": parse_automatic_recommendation_problem,
            "inspection_response": parse_automatic_recommendation_inspection,
            "scorer_request": parse_automatic_scorer_request,
            "scorer_response": parse_automatic_scorer_response,
        }

        for example in manifest["examples"]:
            value = json.loads((contract_root / example["file"]).read_text())
            parsed = parsers[example["kind"]](value)
            self.assertEqual(parsed.to_wire(), value)

    def test_python_representations_reject_every_negative_fixture(self) -> None:
        repository_root = SCORER_ROOT.parents[1]
        contract_root = repository_root / "contracts" / "automatic-recommendations" / "v1"
        negative_examples = (
            ("examples/negative/request-missing-journey-reference.json", lambda value: parse_automatic_recommendation_request("local_favorite", value)),
            ("examples/negative/outcome-generic-payload.json", parse_automatic_recommendation_outcome),
            ("examples/negative/scorer-missing-provenance.json", parse_automatic_scorer_request),
            ("examples/negative/problem-status-code-mismatch.json", parse_automatic_recommendation_problem),
        )
        for relative_path, parser in negative_examples:
            value = json.loads((contract_root / relative_path).read_text())
            with self.assertRaises(ContractValidationError):
                parser(value)


if __name__ == "__main__":
    unittest.main()
