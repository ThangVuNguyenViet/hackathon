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


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_qualified_bundle(
    root: Path, *, expected_bundle_digest: str
) -> QualifiedBundle:
    try:
        manifest = json.loads(
            (root / "bundle-manifest.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError) as error:
        raise BundleUnavailable("qualified_bundle_unavailable") from error
    if not _SHA256.fullmatch(expected_bundle_digest):
        raise BundleUnavailable("expected_bundle_digest_invalid")
    if manifest.get("bundleDigest") != expected_bundle_digest:
        raise BundleUnavailable("qualified_bundle_digest_mismatch")
    if manifest.get("schemaVersion") != "kfc-qualified-model-bundle-v1":
        raise BundleUnavailable("qualified_bundle_schema_invalid")
    champions = manifest.get("champions")
    if not isinstance(champions, dict) or set(champions) != _TYPES:
        raise BundleUnavailable("qualified_bundle_not_atomic")
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
    return QualifiedBundle(root.resolve(), manifest)
