from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import GenerationProfile
from kfc_recommendation_simulator.qualification.artifacts import (
    AtomicBundleError,
    emit_consistent_qualified_bundle,
    emit_qualified_bundle,
)
from kfc_recommendation_simulator.qualification.calibration import (
    CalibrationModel,
    enforce_joint_probability_bound,
    select_calibrator,
)
from kfc_recommendation_simulator.qualification.composer import (
    ScoredCandidate,
    compose_candidates,
)
from kfc_recommendation_simulator.qualification.freeze import (
    FrozenConfigurationError,
    freeze_configuration,
    precommit_qualification,
    verify_frozen_configuration,
)
from kfc_recommendation_simulator.qualification.metrics import probability_quantiles
from kfc_recommendation_simulator.qualification.weighting import (
    clipped_inverse_propensity_weights,
    effective_sample_size,
)


class CalibrationDiagnosticTest(unittest.TestCase):
    def test_probability_quantiles_are_stable_and_bounded(self) -> None:
        result = probability_quantiles(np.asarray([0.1, 0.2, 0.9]))

        self.assertEqual(result["p00"], 0.1)
        self.assertEqual(result["p50"], 0.2)
        self.assertEqual(result["p100"], 0.9)


class FrozenConfigurationTest(unittest.TestCase):
    def test_tampered_configuration_cannot_open_untouched_evaluation(self) -> None:
        """Catches evaluating a different configuration than validation froze."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("freeze", 8, (41,)),
                world_revision="freeze-v1",
            )
            configuration = root / "selected-configuration.json"
            precommit = precommit_qualification(world, configuration)
            configuration.write_text(
                json.dumps({"seed": 431, "champions": ["logistic"]}),
                encoding="utf-8",
            )
            frozen = freeze_configuration(
                configuration, root / "frozen.json", precommit=precommit
            )
            verify_frozen_configuration(configuration, frozen)

            configuration.write_text(
                json.dumps({"seed": 431, "champions": ["xgboost"]}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                FrozenConfigurationError, "configuration digest changed"
            ):
                verify_frozen_configuration(configuration, frozen)


class PropensityWeightingTest(unittest.TestCase):
    def test_weights_are_clipped_and_ess_uses_the_clipped_values(self) -> None:
        """Catches unbounded IPW variance and ESS computed from other weights."""

        weights = clipped_inverse_propensity_weights(
            np.asarray([1.0, 0.5, 0.1, 0.01]), maximum_weight=10.0
        )

        np.testing.assert_allclose(weights, [1.0, 2.0, 10.0, 10.0])
        self.assertAlmostEqual(effective_sample_size(weights), 529.0 / 205.0)

    def test_invalid_propensity_fails_closed(self) -> None:
        """Catches zero/negative/out-of-range exposure probabilities."""

        for value in (0.0, -0.1, 1.1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                clipped_inverse_propensity_weights(
                    np.asarray([value]), maximum_weight=10.0
                )


class CalibrationContractTest(unittest.TestCase):
    def test_isotonic_requires_support_and_material_brier_improvement(self) -> None:
        """Catches selecting flexible isotonic calibration on weak evidence."""

        sigmoid = CalibrationModel(
            method="sigmoid", parameters={"slope": 1.0, "intercept": 0.0}
        )
        isotonic = CalibrationModel(
            method="isotonic", parameters={"x": [0.0, 1.0], "y": [0.0, 1.0]}
        )
        self.assertEqual(
            select_calibrator(
                row_count=1_000,
                positive_count=100,
                negative_count=900,
                sigmoid_brier=0.151,
                isotonic_brier=0.149,
                sigmoid=sigmoid,
                isotonic=isotonic,
            ).method,
            "isotonic",
        )
        self.assertEqual(
            select_calibrator(
                row_count=999,
                positive_count=100,
                negative_count=899,
                sigmoid_brier=0.151,
                isotonic_brier=0.140,
                sigmoid=sigmoid,
                isotonic=isotonic,
            ).method,
            "sigmoid",
        )
        self.assertEqual(
            select_calibrator(
                row_count=1_000,
                positive_count=100,
                negative_count=900,
                sigmoid_brier=0.151,
                isotonic_brier=0.1491,
                sigmoid=sigmoid,
                isotonic=isotonic,
            ).method,
            "sigmoid",
        )

    def test_joint_probability_is_bounded_by_selection_probability(self) -> None:
        """Catches an impossible retained-through-checkout probability."""

        bounded = enforce_joint_probability_bound(
            np.asarray([0.2, 0.8]), np.asarray([0.3, 0.7])
        )
        np.testing.assert_allclose(bounded, [0.2, 0.7])


class ComposerContractTest(unittest.TestCase):
    def test_single_action_type_emits_exactly_one_above_threshold(self) -> None:
        """Catches accidental multi-action Local/For You/Modifier slates."""

        candidates = [
            ScoredCandidate("b", "drinks", 20_000, 0.50),
            ScoredCandidate("a", "sides", 10_000, 0.50),
        ]

        result = compose_candidates(
            recommendation_type="local_favorite",
            candidates=candidates,
            abstention_threshold=0.1,
            remaining_budget_vnd=250_000,
            desired_smart_size=3,
        )

        self.assertEqual([candidate.candidate_id for candidate in result], ["b"])

    def test_smart_composer_fails_closed_instead_of_padding(self) -> None:
        """Catches invalid one/two-member Smart serving output."""

        candidates = [
            ScoredCandidate("a", "sides", 10_000, 0.8),
            ScoredCandidate("b", "drinks", 10_000, 0.7),
            ScoredCandidate("c", "drinks", 10_000, 0.6),
        ]

        result = compose_candidates(
            recommendation_type="smart_cross_sell",
            candidates=candidates,
            abstention_threshold=0.1,
            remaining_budget_vnd=250_000,
            desired_smart_size=3,
        )

        self.assertEqual(result, ())


class AtomicBundleTest(unittest.TestCase):
    def test_any_failed_type_emits_no_serving_bundle(self) -> None:
        """Catches partial promotion when one recommendation type fails."""

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "qualified-model-bundle"
            with self.assertRaisesRegex(AtomicBundleError, "atomic qualification"):
                emit_qualified_bundle(
                    output,
                    type_gate_results={
                        "local_favorite": True,
                        "for_you": True,
                        "modifier_upsell": False,
                        "smart_cross_sell": True,
                    },
                    combined_gate_result=True,
                    payload_files={},
                    manifest={"syntheticOnly": True},
                )
            self.assertFalse(output.exists())

    def test_success_bundle_and_external_evidence_are_one_immutable_value(self) -> None:
        """Catches copying false evidence then mutating only the external file."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = root / "model.json"
            payload.write_text('{"model":"qualified"}\n', encoding="utf-8")
            external_evidence = root / "qualification-evidence.json"

            bundle, manifest = emit_consistent_qualified_bundle(
                root / "qualified-model-bundle",
                evidence_path=external_evidence,
                evidence={
                    "schemaVersion": "test-qualification-v1",
                    "status": "qualified",
                    "servingBundleEmitted": False,
                },
                type_gate_results={
                    "local_favorite": True,
                    "for_you": True,
                    "modifier_upsell": True,
                    "smart_cross_sell": True,
                },
                combined_gate_result=True,
                payload_files={"models/model.json": payload},
                manifest_binding={"schemaVersion": "test-bundle-v1"},
            )

            internal_evidence = bundle / "evidence/qualification-evidence.json"
            self.assertEqual(
                internal_evidence.read_bytes(), external_evidence.read_bytes()
            )
            self.assertEqual(internal_evidence.stat().st_mode & 0o222, 0)
            self.assertEqual(external_evidence.stat().st_mode & 0o222, 0)
            value = json.loads(internal_evidence.read_text(encoding="utf-8"))
            self.assertTrue(value["servingBundleEmitted"])
            evidence_digest = hashlib.sha256(internal_evidence.read_bytes()).hexdigest()
            self.assertEqual(manifest["qualificationEvidenceDigest"], evidence_digest)
            self.assertEqual(
                manifest["payloadDigests"]["evidence/qualification-evidence.json"],
                evidence_digest,
            )
            on_disk_manifest = json.loads(
                (bundle / "bundle-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(on_disk_manifest, manifest)


if __name__ == "__main__":
    unittest.main()
