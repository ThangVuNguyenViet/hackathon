from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from kfc_recommendation_simulator.publication import (
    MODEL_REPOSITORY_NAME,
    SHADOW_RUNTIME_PROFILE,
    build_file_manifest,
    build_model_binding,
    build_probe_request,
    build_public_provenance,
    prepare_local_runtime_publication,
    prepare_model_publication,
    verify_file_manifest,
)


class PublicationManifestTest(unittest.TestCase):
    def test_file_manifest_pins_every_publication_byte_and_its_own_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "MLmodel").write_text("model\n", encoding="utf-8")
            artifact = root / "artifacts"
            artifact.mkdir()
            (artifact / "ranker.txt").write_text("ranker\n", encoding="utf-8")

            manifest = build_file_manifest(
                root,
                schema_version="kfc-test-publication-v1",
                metadata={
                    "sourceCommit": "9fcf9da2f11ab1c9fcf9da2f11ab1c9fcf9da2f1",
                    "qualificationDigests": {
                        "smart_cross_sell": "a" * 64,
                        "modifier_upsell": "b" * 64,
                    },
                },
            )

            self.assertEqual(
                manifest["files"],
                [
                    {
                        "path": "MLmodel",
                        "sha256": (
                            "98ad61a25e3683b6adf2474b01bbe1c27de6aad2ce3a80ff4140fe473c14e691"
                        ),
                        "sizeBytes": 6,
                    },
                    {
                        "path": "artifacts/ranker.txt",
                        "sha256": (
                            "e3f94b89f892ae043c725479bd5c4184602c9d56aa2ddef5a2b7456c0b512950"
                        ),
                        "sizeBytes": 7,
                    },
                ],
            )
            self.assertRegex(manifest["contentDigest"], r"^[a-f0-9]{64}$")

    def test_file_manifest_rejects_secret_shaped_metadata_and_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "model").write_text("safe", encoding="utf-8")
            (root / "linked").symlink_to(root / "model")

            with self.assertRaisesRegex(ValueError, "symlink"):
                build_file_manifest(
                    root,
                    schema_version="kfc-test-publication-v1",
                    metadata={"sourceCommit": "a" * 40},
                )

            (root / "linked").unlink()
            with self.assertRaisesRegex(ValueError, "secret-shaped"):
                build_file_manifest(
                    root,
                    schema_version="kfc-test-publication-v1",
                    metadata={
                        "sourceCommit": "a" * 40,
                        "sanityWriteToken": "must-never-be-published",
                    },
                )

    def test_runtime_binding_requires_the_exact_public_model_name_and_revision(
        self,
    ) -> None:
        binding = build_model_binding(
            "verified-owner/kfc-vietnam-recommendation-shadow-20260727",
            "1234567890abcdef1234567890abcdef12345678",
        )

        self.assertEqual(
            binding,
            {
                "schemaVersion": "kfc-shadow-runtime-model-binding-v1",
                "runtimeProfile": "local_docker_cloudflare_tunnel",
                "modelRepositoryId": (
                    "verified-owner/kfc-vietnam-recommendation-shadow-20260727"
                ),
                "modelRevision": "1234567890abcdef1234567890abcdef12345678",
                "modelPath": "model",
            },
        )
        with self.assertRaisesRegex(ValueError, "exact model repository name"):
            build_model_binding(
                "verified-owner/not-the-qualified-model",
                "1234567890abcdef1234567890abcdef12345678",
            )
        with self.assertRaisesRegex(ValueError, "immutable hexadecimal"):
            build_model_binding(
                "verified-owner/kfc-vietnam-recommendation-shadow-20260727",
                "main",
            )

    def test_public_provenance_accepts_only_created_resource_ids_and_hashes(self) -> None:
        provenance = build_public_provenance(
            source_commit="9fcf9da2f11ab1c9fcf9da2f11ab1c9fcf9da2f1",
            model_repository_id=f"verified-owner/{MODEL_REPOSITORY_NAME}",
            model_revision="1" * 40,
            model_publication_digest="2" * 64,
            runtime_profile=SHADOW_RUNTIME_PROFILE,
            runtime_public_url="https://verified-shadow.trycloudflare.com",
            runtime_publication_digest="3" * 64,
            runtime_container_image_digest="4" * 64,
            runtime_served_model_revision="6" * 64,
            runtime_tunnel_kind="trycloudflare_quick_tunnel",
            sanity_project_id="abc123xy",
            sanity_dataset="production",
            sanity_snapshot_digest="5" * 64,
        )

        self.assertEqual(
            provenance["resources"]["sanity"],
            {
                "projectId": "abc123xy",
                "dataset": "production",
                "snapshotDigest": "5" * 64,
                "visibility": "public",
            },
        )
        self.assertEqual(
            provenance["resources"]["shadowRuntime"],
            {
                "profile": "local_docker_cloudflare_tunnel",
                "publicUrl": "https://verified-shadow.trycloudflare.com",
                "publicationDigest": "3" * 64,
                "containerImageDigest": "4" * 64,
                "servedModelRevision": "6" * 64,
                "tunnelKind": "trycloudflare_quick_tunnel",
                "healthPath": "/health",
                "inferencePath": "/invocations",
                "availability": "operator_managed_demo",
                "requiresLocalProcesses": True,
            },
        )
        self.assertRegex(provenance["contentDigest"], r"^[a-f0-9]{64}$")
        encoded = json.dumps(provenance, sort_keys=True)
        self.assertNotIn("token", encoded.lower())
        self.assertNotIn("<authenticated-namespace>", encoded)


class PublicationProbeTest(unittest.TestCase):
    def test_probe_request_contains_one_already_eligible_row_per_model(self) -> None:
        request = build_probe_request(
            {
                "smart_cross_sell": {
                    "schemaVersion": "smart-cross-sell-feature-schema-v1",
                    "categoricalFeatures": ["candidate_id", "product_code"],
                    "numericFeatures": ["feature_price_delta_vnd"],
                    "numericMeans": {"feature_price_delta_vnd": 12500.0},
                    "vocabularies": {
                        "candidate_id": ["item:41173"],
                        "product_code": ["41173"],
                    },
                },
                "modifier_upsell": {
                    "schemaVersion": "modifier-upsell-feature-schema-v1",
                    "categoricalFeatures": ["candidate_id", "modifier_path"],
                    "numericFeatures": ["feature_remaining_budget_vnd"],
                    "numericMeans": {"feature_remaining_budget_vnd": 50000.0},
                    "vocabularies": {
                        "candidate_id": ["modifier:20691:2:41056"],
                        "modifier_path": ["2:41056"],
                    },
                },
            },
        )

        rows = request["dataframe_records"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["placement"], "smart_cross_sell")
        self.assertEqual(rows[0]["action_id"], "item:41173")
        self.assertEqual(rows[0]["candidate_id"], "item:41173")
        self.assertEqual(rows[0]["eligible"], True)
        self.assertEqual(rows[0]["feature_price_delta_vnd"], 12500.0)
        self.assertEqual(rows[1]["placement"], "modifier_upsell")
        self.assertEqual(rows[1]["action_id"], "modifier:20691:2:41056")
        self.assertEqual(rows[1]["modifier_path"], "2:41056")
        self.assertEqual(rows[1]["feature_remaining_budget_vnd"], 50000.0)

    def test_model_publication_contains_loadable_model_probe_and_hash_manifest(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            model = root / "qualified-model"
            model.mkdir()
            (model / "MLmodel").write_text("qualified\n", encoding="utf-8")
            (model / "shadow-model-manifest.json").write_text(
                json.dumps(
                    {
                        "contentDigest": "1" * 64,
                        "qualificationResultDigests": {
                            "smart_cross_sell": "2" * 64,
                            "modifier_upsell": "3" * 64,
                        },
                        "mlflowSignature": {"inputs": "signature"},
                    }
                ),
                encoding="utf-8",
            )
            schemas = root / "schemas"
            schemas.mkdir()
            smart_schema = schemas / "smart.json"
            modifier_schema = schemas / "modifier.json"
            smart_schema.write_text(
                json.dumps(
                    {
                        "schemaVersion": "smart-v1",
                        "categoricalFeatures": ["candidate_id"],
                        "numericFeatures": ["feature_budget_vnd"],
                        "numericMeans": {"feature_budget_vnd": 100000},
                        "vocabularies": {"candidate_id": ["item:41173"]},
                    }
                ),
                encoding="utf-8",
            )
            modifier_schema.write_text(
                json.dumps(
                    {
                        "schemaVersion": "modifier-v1",
                        "categoricalFeatures": ["candidate_id"],
                        "numericFeatures": ["feature_remaining_budget_vnd"],
                        "numericMeans": {
                            "feature_remaining_budget_vnd": 50000
                        },
                        "vocabularies": {
                            "candidate_id": ["modifier:20691:2:41056"]
                        },
                    }
                ),
                encoding="utf-8",
            )
            output = root / "model-publication"

            manifest = prepare_model_publication(
                mlflow_model_path=model,
                output_directory=output,
                source_commit="a" * 40,
                smart_cross_sell_feature_schema=smart_schema,
                modifier_upsell_feature_schema=modifier_schema,
            )

            self.assertTrue((output / "model" / "MLmodel").is_file())
            probe = json.loads((output / "probe-request.json").read_text())
            self.assertEqual(
                [row["placement"] for row in probe["dataframe_records"]],
                ["smart_cross_sell", "modifier_upsell"],
            )
            self.assertEqual(
                manifest["metadata"]["modelBundleDigest"],
                "1" * 64,
            )
            self.assertIn(
                "model/MLmodel",
                [entry["path"] for entry in manifest["files"]],
            )
            self.assertNotIn(
                "publication-manifest.json",
                [entry["path"] for entry in manifest["files"]],
            )
            self.assertEqual(
                verify_file_manifest(output / "publication-manifest.json"),
                manifest,
            )
            (output / "model" / "MLmodel").write_text(
                "mutated\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "does not match"):
                verify_file_manifest(output / "publication-manifest.json")

    def test_local_runtime_publication_is_pinned_to_one_model_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "runtime-source"
            source.mkdir()
            (source / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
            (source / "serve.py").write_text("print('serve')\n", encoding="utf-8")
            (source / "README.md").write_text("space\n", encoding="utf-8")
            (source / "requirements.txt").write_text(
                "mlflow==3.14.0\n",
                encoding="utf-8",
            )
            (source / "local-only.txt").write_text(
                "must not be published\n",
                encoding="utf-8",
            )
            output = root / "runtime-publication"

            manifest = prepare_local_runtime_publication(
                source_directory=source,
                output_directory=output,
                source_commit="a" * 40,
                model_repository_id=f"verified-owner/{MODEL_REPOSITORY_NAME}",
                model_revision="b" * 40,
            )

            binding = json.loads((output / "model-binding.json").read_text())
            self.assertEqual(binding["modelRevision"], "b" * 40)
            self.assertEqual(binding["modelPath"], "model")
            self.assertEqual(
                binding["runtimeProfile"],
                "local_docker_cloudflare_tunnel",
            )
            self.assertEqual(
                manifest["metadata"]["modelBinding"],
                binding,
            )
            self.assertEqual(
                manifest["metadata"]["runtimeProfile"],
                "local_docker_cloudflare_tunnel",
            )
            self.assertIn(
                "Dockerfile",
                [entry["path"] for entry in manifest["files"]],
            )
            self.assertFalse((output / "local-only.txt").exists())
