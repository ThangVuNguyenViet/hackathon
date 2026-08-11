from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCORER_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SCORER_ROOT.parents[1]
sys.path.insert(0, str(SCORER_ROOT / "src"))
sys.path.insert(0, str(SCORER_ROOT / "tests"))

from qualified_bundle_fixture import build_test_qualified_bundle  # noqa: E402

from kfc_recommendation_scorer.bundle import BundleUnavailable  # noqa: E402
from kfc_recommendation_scorer.service import ScorerApplication  # noqa: E402

CONTRACT_DIGEST = json.loads(
    (
        REPOSITORY_ROOT
        / "contracts/automatic-recommendations/v1/contract-manifest.json"
    ).read_text()
)["canonicalDigest"]
FEATURE_DIGEST = "3" * 64
COMPOSER_DIGEST = "4" * 64


class NativeRuntimeTest(unittest.TestCase):
    def test_test_only_four_model_bundle_warms_and_scores_exact_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = build_test_qualified_bundle(
                root,
                contract_digest=CONTRACT_DIGEST,
                feature_digest=FEATURE_DIGEST,
                composer_digest=COMPOSER_DIGEST,
            )
            application = ScorerApplication(
                bundle_path=root,
                expected_bundle_digest=manifest["bundleDigest"],
                expected_contract_digest=CONTRACT_DIGEST,
                expected_feature_digest=FEATURE_DIGEST,
                expected_composer_digest=COMPOSER_DIGEST,
            )
            self.assertEqual(
                application.readiness(),
                {"ready": True, "bundleDigest": manifest["bundleDigest"]},
            )
            request = json.loads(
                (
                    REPOSITORY_ROOT
                    / "contracts/automatic-recommendations/v1/examples"
                    / "scorer-request.json"
                ).read_text()
            )
            request["model"] = application.model_binding("local_favorite")
            response = application.score(request)
            self.assertEqual(response["requestId"], request["requestId"])
            self.assertEqual(response["model"], request["model"])
            self.assertEqual(
                [score["candidateId"] for score in response["scores"]],
                [candidate["candidateId"] for candidate in request["candidates"]],
            )
            self.assertGreater(response["scores"][0]["jointProbability"], 0.5)

    def test_manifest_and_golden_tampering_never_reaches_readiness(self) -> None:
        for mutation in ("manifest", "golden", "contract"):
            with (
                self.subTest(mutation=mutation),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                manifest = build_test_qualified_bundle(
                    root,
                    contract_digest=CONTRACT_DIGEST,
                    feature_digest=FEATURE_DIGEST,
                    composer_digest=COMPOSER_DIGEST,
                )
                if mutation == "manifest":
                    value = json.loads((root / "bundle-manifest.json").read_text())
                    value["worldDigest"] = "f" * 64
                    (root / "bundle-manifest.json").write_text(json.dumps(value))
                elif mutation == "golden":
                    golden = (
                        root / "models/local_favorite/selection/golden-predictions.json"
                    )
                    value = json.loads(golden.read_text())
                    value["probabilities"] = [0.1]
                    golden.write_text(json.dumps(value))
                    digest = (
                        __import__("hashlib").sha256(golden.read_bytes()).hexdigest()
                    )
                    value = json.loads((root / "bundle-manifest.json").read_text())
                    value["payloadDigests"][
                        "models/local_favorite/selection/golden-predictions.json"
                    ] = digest
                    binding = copy.deepcopy(value)
                    binding.pop("bundleDigest")
                    value["bundleDigest"] = (
                        __import__("hashlib")
                        .sha256(
                            json.dumps(
                                binding, sort_keys=True, separators=(",", ":")
                            ).encode()
                        )
                        .hexdigest()
                    )
                    (root / "bundle-manifest.json").write_text(json.dumps(value))
                    manifest = value
                else:
                    value = json.loads((root / "bundle-manifest.json").read_text())
                    value["contractDigest"] = "f" * 64
                    binding = copy.deepcopy(value)
                    binding.pop("bundleDigest")
                    value["bundleDigest"] = (
                        __import__("hashlib")
                        .sha256(
                            json.dumps(
                                binding, sort_keys=True, separators=(",", ":")
                            ).encode()
                        )
                        .hexdigest()
                    )
                    (root / "bundle-manifest.json").write_text(json.dumps(value))
                    manifest = value
                application = ScorerApplication(
                    bundle_path=root,
                    expected_bundle_digest=manifest["bundleDigest"],
                    expected_contract_digest=CONTRACT_DIGEST,
                    expected_feature_digest=FEATURE_DIGEST,
                    expected_composer_digest=COMPOSER_DIGEST,
                )
                self.assertFalse(application.readiness()["ready"])
                with self.assertRaises(BundleUnavailable):
                    application.score({})


if __name__ == "__main__":
    unittest.main()
