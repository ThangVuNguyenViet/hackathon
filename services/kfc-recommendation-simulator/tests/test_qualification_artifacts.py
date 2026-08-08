from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

RETAINED_EVIDENCE_SHA256 = (
    "288e2afae94b5fd51b90f612d1bb2a9f40060766033a71a9c436fb93001c1b3c"
)
RETAINED_STATUS_SHA256 = (
    "8ecca52e81d55921b79f91ab54975268170a82b80d08867512d0bc0f6815d6cb"
)


class RetainedQualificationArtifactIntegrityTest(unittest.TestCase):
    def test_retained_task4_state_is_digest_bound_and_failed_closed(self) -> None:
        repository_root = Path(__file__).parents[3]
        evidence_path = (
            repository_root
            / ".superpowers/sdd/2026-08-04-kfc-automatic-recommendation-big-bang"
            / "task-4-development-failed-qualification.json"
        )
        status_path = evidence_path.with_name(
            "task-4-development-qualification-status.json"
        )

        evidence_bytes = evidence_path.read_bytes()
        status_bytes = status_path.read_bytes()
        evidence = json.loads(evidence_bytes)
        status = json.loads(status_bytes)

        self.assertEqual(
            hashlib.sha256(evidence_bytes).hexdigest(), RETAINED_EVIDENCE_SHA256
        )
        self.assertEqual(
            hashlib.sha256(status_bytes).hexdigest(), RETAINED_STATUS_SHA256
        )
        self.assertEqual(status["evidenceSha256"], RETAINED_EVIDENCE_SHA256)
        self.assertEqual(status["status"], "failed_selection")
        self.assertIsNone(status["bundlePath"])
        self.assertEqual(evidence["status"], "failed_selection")
        self.assertFalse(evidence["servingBundleEmitted"])
        self.assertFalse(evidence["freeze"]["selectedConfigurationWritten"])
        self.assertFalse(evidence["freeze"]["configurationFrozen"])
        self.assertFalse(evidence["freeze"]["untouchedTestOpened"])
        self.assertFalse(evidence["freeze"]["candidateRelevanceOpened"])
        self.assertFalse(evidence["gates"]["atomicAllFour"])
        self.assertTrue(
            all(
                type_evidence["champion"] is None
                for type_evidence in evidence["types"].values()
            )
        )

        artifact_root = evidence_path.parent
        for artifact_name in (
            "selected-configuration.json",
            "frozen-configuration.json",
            "qualified-model-bundle",
            "bundle-manifest.json",
        ):
            self.assertFalse((artifact_root / artifact_name).exists(), artifact_name)
        self.assertFalse(
            any(
                "selected" in artifact_name
                or "frozen" in artifact_name
                or "bundle" in artifact_name
                for artifact_name in evidence["artifactInventory"]
            )
        )


class TestOnlyFixtureGuardTest(unittest.TestCase):
    def test_fixture_advertises_non_release_evidence(self) -> None:
        repository_root = Path(__file__).parents[3]
        fixture_path = (
            repository_root
            / "services/kfc-recommendation-scorer/tests/qualified_bundle_fixture.py"
        )
        spec = importlib.util.spec_from_file_location(
            "qualified_bundle_fixture", fixture_path
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)

        with tempfile.TemporaryDirectory() as directory:
            manifest = fixture.build_test_qualified_bundle(
                Path(directory),
                contract_digest="a" * 64,
                feature_digest="b" * 64,
                composer_digest="c" * 64,
            )

        self.assertEqual(
            manifest["syntheticOnlyDisclaimer"],
            "TEST ONLY - not production qualification",
        )
        self.assertEqual(
            manifest["qualificationRunIds"], ["test-only-qualified-fixture"]
        )

if __name__ == "__main__":
    unittest.main()
