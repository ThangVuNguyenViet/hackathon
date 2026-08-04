from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_TYPES = {"local_favorite", "for_you", "modifier_upsell", "smart_cross_sell"}


class BundleUnavailable(RuntimeError):
    """No digest-verified, atomically qualified four-model bundle is usable."""


@dataclass(frozen=True)
class QualifiedBundle:
    root: Path
    manifest: dict[str, Any]

    @property
    def digest(self) -> str:
        return str(self.manifest["bundleDigest"])

    def model_binding(self, recommendation_type: str) -> dict[str, str]:
        prefix = f"models/{recommendation_type}"
        payloads = self.manifest["payloadDigests"]
        champion = self.manifest["champions"][recommendation_type]
        suffix = "model.txt" if champion == "lightgbm" else "model.json"
        selection_model = payloads[f"{prefix}/selection/{suffix}"]
        joint_model = payloads[f"{prefix}/joint/{suffix}"]
        selection_calibrator = payloads[f"{prefix}/selection-calibrator.json"]
        joint_calibrator = payloads[f"{prefix}/joint-calibrator.json"]
        return {
            "bundleId": f"bundle:{self.digest}",
            "bundleDigest": self.digest,
            "modelRevision": _digest_value([selection_model, joint_model]),
            "calibratorRevision": _digest_value(
                [selection_calibrator, joint_calibrator]
            ),
            "featureSchemaDigest": str(self.manifest["featureContractDigest"]),
            "thresholdRevision": payloads[f"{prefix}/abstention-threshold.json"],
            "composerContractDigest": str(self.manifest["composerContractDigest"]),
            "qualificationRunId": (
                f"qualification:{self.manifest['configurationDigest']}"
            ),
            "qualificationEvidenceDigest": str(
                self.manifest["qualificationEvidenceDigest"]
            ),
        }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _digest_value(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def load_qualified_bundle(
    root: Path,
    *,
    expected_bundle_digest: str,
    expected_contract_digest: str,
    expected_feature_digest: str,
    expected_composer_digest: str,
) -> QualifiedBundle:
    try:
        manifest = json.loads(
            (root / "bundle-manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as error:
        raise BundleUnavailable("qualified_bundle_unavailable") from error
    if not _SHA256.fullmatch(expected_bundle_digest):
        raise BundleUnavailable("expected_bundle_digest_invalid")
    declared_digest = manifest.get("bundleDigest")
    binding = dict(manifest)
    binding.pop("bundleDigest", None)
    computed_digest = hashlib.sha256(_canonical_json(binding)).hexdigest()
    if declared_digest != computed_digest or computed_digest != expected_bundle_digest:
        raise BundleUnavailable("qualified_bundle_digest_mismatch")
    if manifest.get("schemaVersion") != "kfc-qualified-model-bundle-v1":
        raise BundleUnavailable("qualified_bundle_schema_invalid")
    champions = manifest.get("champions")
    if not isinstance(champions, dict) or set(champions) != _TYPES:
        raise BundleUnavailable("qualified_bundle_not_atomic")
    if manifest.get("contractDigest") != expected_contract_digest:
        raise BundleUnavailable("qualified_bundle_contract_digest_mismatch")
    if manifest.get("featureContractDigest") != expected_feature_digest:
        raise BundleUnavailable("qualified_bundle_feature_digest_mismatch")
    if manifest.get("composerContractDigest") != expected_composer_digest:
        raise BundleUnavailable("qualified_bundle_composer_digest_mismatch")
    payload_digests = manifest.get("payloadDigests")
    if not isinstance(payload_digests, dict) or not payload_digests:
        raise BundleUnavailable("qualified_bundle_payloads_missing")
    for relative, expected in payload_digests.items():
        path = (root / relative).resolve()
        if (
            root.resolve() not in path.parents
            or not path.is_file()
            or _sha256(path) != expected
        ):
            raise BundleUnavailable("qualified_bundle_payload_digest_mismatch")
    evidence_path = root / "evidence" / "qualification-evidence.json"
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BundleUnavailable("qualification_evidence_unavailable") from error
    if evidence.get("status") != "qualified" or not evidence.get(
        "servingBundleEmitted"
    ):
        raise BundleUnavailable("qualification_evidence_not_qualified")
    if _sha256(evidence_path) != manifest.get("qualificationEvidenceDigest"):
        raise BundleUnavailable("qualification_evidence_digest_mismatch")
    return QualifiedBundle(root.resolve(), manifest)
