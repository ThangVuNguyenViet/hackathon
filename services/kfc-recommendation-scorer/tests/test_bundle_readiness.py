from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCORER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCORER_ROOT / "src"))

from kfc_recommendation_scorer.bundle import (  # noqa: E402
    BundleUnavailable,
    load_qualified_bundle,
)
from kfc_recommendation_scorer.service import ScorerApplication  # noqa: E402


class BundleReadinessTest(unittest.TestCase):
    def test_missing_bundle_stays_unready_and_never_scores(self) -> None:
        missing = Path(tempfile.gettempdir()) / "definitely-missing-kfc-bundle"
        app = ScorerApplication(bundle_path=missing, expected_bundle_digest="a" * 64)
        self.assertEqual(
            app.readiness(), {"ready": False, "code": "qualified_bundle_unavailable"}
        )
        with self.assertRaises(BundleUnavailable):
            app.score({})

    def test_invalid_bundle_digest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bundle-manifest.json").write_text(
                json.dumps({"bundleDigest": "b" * 64})
            )
            with self.assertRaises(BundleUnavailable):
                load_qualified_bundle(
                    root,
                    expected_bundle_digest="a" * 64,
                    expected_contract_digest="c" * 64,
                    expected_feature_digest="d" * 64,
                    expected_composer_digest="e" * 64,
                )


if __name__ == "__main__":
    unittest.main()
