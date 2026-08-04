from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

RECOMMENDATION_TYPES = frozenset(
    {
        "local_favorite",
        "for_you",
        "modifier_upsell",
        "smart_cross_sell",
    }
)


class AtomicBundleError(ValueError):
    """Raised when a four-type bundle is ineligible for atomic promotion."""


def _canonical_json(value: Any, *, pretty: bool = False) -> bytes:
    if pretty:
        return (
            json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        ).encode()
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def emit_qualified_bundle(
    output_path: Path | str,
    *,
    type_gate_results: Mapping[str, bool],
    combined_gate_result: bool,
    payload_files: Mapping[str, Path],
    manifest: Mapping[str, Any],
) -> Path:
    output = Path(output_path).resolve()
    if (
        set(type_gate_results) != RECOMMENDATION_TYPES
        or not all(type_gate_results.values())
        or not combined_gate_result
    ):
        raise AtomicBundleError(
            "atomic qualification requires every type and combined gate to pass"
        )
    if output.exists():
        raise AtomicBundleError("refusing to overwrite an existing model bundle")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=output.parent))
    try:
        for relative, source in payload_files.items():
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            target.chmod(source.stat().st_mode & 0o777)
        (temporary / "bundle-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.rename(output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return output


def emit_consistent_qualified_bundle(
    output_path: Path | str,
    *,
    evidence_path: Path | str,
    evidence: Mapping[str, Any],
    type_gate_results: Mapping[str, bool],
    combined_gate_result: bool,
    payload_files: Mapping[str, Path],
    manifest_binding: Mapping[str, Any],
) -> tuple[Path, dict[str, Any]]:
    """Emit one success evidence value and bind every copy to its digest."""

    external_evidence = Path(evidence_path).resolve()
    if external_evidence.exists():
        raise AtomicBundleError("refusing to overwrite qualification evidence")
    if evidence.get("status") != "qualified":
        raise AtomicBundleError("qualified bundle requires qualified evidence")
    finalized_evidence = dict(evidence)
    finalized_evidence["servingBundleEmitted"] = True
    external_evidence.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".qualification-evidence.",
        suffix=".json",
        dir=external_evidence.parent,
    )
    temporary_evidence = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(_canonical_json(finalized_evidence, pretty=True))
            output.flush()
            os.fsync(output.fileno())
        temporary_evidence.chmod(0o444)
        all_payload_files = dict(payload_files)
        all_payload_files["evidence/qualification-evidence.json"] = temporary_evidence
        evidence_digest = _sha256(temporary_evidence)
        payload_digests = {
            relative: _sha256(path)
            for relative, path in sorted(all_payload_files.items())
        }
        binding = dict(manifest_binding) | {
            "qualificationEvidenceDigest": evidence_digest,
            "payloadDigests": payload_digests,
        }
        manifest = binding | {
            "bundleDigest": hashlib.sha256(_canonical_json(binding)).hexdigest()
        }
        bundle = emit_qualified_bundle(
            output_path,
            type_gate_results=type_gate_results,
            combined_gate_result=combined_gate_result,
            payload_files=all_payload_files,
            manifest=manifest,
        )
        internal_evidence = bundle / "evidence" / "qualification-evidence.json"
        if _sha256(internal_evidence) != evidence_digest:
            raise AtomicBundleError("bundle evidence digest changed during emission")
        temporary_evidence.replace(external_evidence)
        if external_evidence.read_bytes() != internal_evidence.read_bytes():
            raise AtomicBundleError("external and bundle evidence values differ")
        return bundle, manifest
    finally:
        if temporary_evidence.exists():
            temporary_evidence.unlink()
