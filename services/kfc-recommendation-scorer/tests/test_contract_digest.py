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


if __name__ == "__main__":
    unittest.main()
