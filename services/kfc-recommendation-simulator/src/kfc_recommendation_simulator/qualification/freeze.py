from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class FrozenConfigurationError(ValueError):
    """Raised when untouched evaluation is not bound to its frozen inputs."""


@dataclass(frozen=True)
class QualificationPrecommit:
    world_root: Path
    configuration_path: Path
    evidence_path: Path
    evidence_sha256: str
    world_digest: str
    source_contract_sha256: str


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()


def _verified_world_manifest(world_root: Path) -> dict[str, Any]:
    manifest_path = world_root / "manifests" / "synthetic-world.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise FrozenConfigurationError("world manifest is unavailable") from error
    if not isinstance(manifest, dict):
        raise FrozenConfigurationError("world manifest must be an object")
    bound = dict(manifest)
    expected = bound.pop("worldDigest", None)
    if hashlib.sha256(_canonical_json(bound)).hexdigest() != expected:
        raise FrozenConfigurationError("world manifest digest does not match")
    return manifest


def _source_contract_sha256(manifest: dict[str, Any]) -> str:
    artifacts = manifest.get("artifacts", {})
    schema_digests = {
        path: evidence.get("schemaDigest")
        for path, evidence in artifacts.items()
        if isinstance(evidence, dict)
    }
    return hashlib.sha256(
        _canonical_json(
            {
                "manifestSchemaVersion": manifest.get("schemaVersion"),
                "generatorRevision": manifest.get("generatorRevision"),
                "candidateRelevanceDefinition": manifest.get(
                    "candidateRelevanceDefinition"
                ),
                "artifactSchemaDigests": schema_digests,
            }
        )
    ).hexdigest()


def precommit_qualification(
    world_root: Path | str,
    configuration_path: Path | str,
) -> QualificationPrecommit:
    """Consume the world-owned authorization before a selected config exists."""

    root = Path(world_root).resolve()
    configuration = Path(configuration_path).resolve()
    if configuration.exists():
        raise FrozenConfigurationError(
            "configuration already exists before qualification precommit"
        )
    manifest = _verified_world_manifest(root)
    descriptor = manifest.get("qualificationPrecommit")
    if not isinstance(descriptor, dict):
        raise FrozenConfigurationError(
            "world manifest lacks qualification precommit authority"
        )
    relative_path = descriptor.get("path")
    if relative_path != "manifests/qualification-precommit.json":
        raise FrozenConfigurationError(
            "world qualification precommit path is not canonical"
        )
    evidence = (root / relative_path).resolve()
    if not evidence.is_relative_to(root):
        raise FrozenConfigurationError(
            "world qualification precommit escapes world root"
        )
    try:
        encoded = evidence.read_bytes()
        payload = json.loads(encoded)
    except (json.JSONDecodeError, OSError) as error:
        raise FrozenConfigurationError(
            "world qualification precommit is unavailable"
        ) from error
    expected_token_digest = descriptor.get("sha256")
    if hashlib.sha256(encoded).hexdigest() != expected_token_digest:
        raise FrozenConfigurationError(
            "world qualification precommit digest does not match manifest"
        )
    if evidence.stat().st_mode & 0o222:
        raise FrozenConfigurationError(
            "world qualification precommit must be immutable"
        )
    world_digest = str(manifest["worldDigest"])
    source_contract_sha256 = _source_contract_sha256(manifest)
    expected_payload = {
        "schemaVersion": "kfc-world-qualification-precommit-v1",
        "stage": "world_generation_precommit",
        "worldRevision": manifest.get("worldRevision"),
        "generatorRevision": manifest.get("generatorRevision"),
        "sourceContractSha256": source_contract_sha256,
        "configurationFileName": "selected-configuration.json",
    }
    if payload != expected_payload:
        raise FrozenConfigurationError(
            "world qualification precommit payload does not match source contract"
        )
    if configuration.name != expected_payload["configurationFileName"]:
        raise FrozenConfigurationError(
            "configuration file name does not match world precommit"
        )
    return QualificationPrecommit(
        root,
        configuration,
        evidence,
        str(expected_token_digest),
        world_digest,
        source_contract_sha256,
    )


@dataclass(frozen=True)
class FrozenConfiguration:
    configuration_path: Path
    configuration_sha256: str
    evidence_path: Path
    precommit: QualificationPrecommit | None = None


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _birth_time_ns(path: Path) -> int:
    stat = path.stat()
    birth_time = getattr(stat, "st_birthtime", None)
    return (
        int(float(birth_time) * 1_000_000_000)
        if birth_time is not None
        else stat.st_ctime_ns
    )


def _verify_precommit(
    precommit: QualificationPrecommit,
    configuration: Path,
    world_root: Path | None = None,
) -> None:
    if configuration != precommit.configuration_path:
        raise FrozenConfigurationError(
            "configuration path does not match qualification precommit"
        )
    if not precommit.evidence_path.is_file():
        raise FrozenConfigurationError("qualification precommit evidence is missing")
    if _sha256(precommit.evidence_path) != precommit.evidence_sha256:
        raise FrozenConfigurationError("qualification precommit evidence was replaced")
    precommit_created_after_selection = (
        configuration.exists()
        and _birth_time_ns(precommit.evidence_path) > _birth_time_ns(configuration)
    )
    if precommit_created_after_selection:
        raise FrozenConfigurationError(
            "qualification precommit was created after configuration selection"
        )
    root = precommit.world_root
    if world_root is not None and world_root.resolve() != root:
        raise FrozenConfigurationError(
            "world path does not match qualification precommit"
        )
    manifest = _verified_world_manifest(root)
    descriptor = manifest.get("qualificationPrecommit")
    expected_path = (root / "manifests/qualification-precommit.json").resolve()
    if precommit.evidence_path != expected_path:
        raise FrozenConfigurationError(
            "qualification precommit is not world-owned"
        )
    if not isinstance(descriptor, dict) or descriptor.get(
        "sha256"
    ) != precommit.evidence_sha256:
        raise FrozenConfigurationError(
            "qualification precommit is not manifest-bound"
        )
    if manifest.get("worldDigest") != precommit.world_digest:
        raise FrozenConfigurationError(
            "world digest does not match qualification precommit"
        )
    if _source_contract_sha256(manifest) != precommit.source_contract_sha256:
        raise FrozenConfigurationError(
            "source contract does not match qualification precommit"
        )
    if configuration.name != "selected-configuration.json":
        raise FrozenConfigurationError(
            "configuration file name does not match world precommit"
        )


def freeze_configuration(
    configuration_path: Path | str,
    evidence_path: Path | str,
    *,
    precommit: QualificationPrecommit | None = None,
) -> FrozenConfiguration:
    configuration = Path(configuration_path).resolve()
    evidence = Path(evidence_path).resolve()
    if precommit is None:
        raise FrozenConfigurationError(
            "qualification precommit is required before configuration selection"
        )
    _verify_precommit(precommit, configuration, precommit.world_root)
    digest = _sha256(configuration)
    payload = {
        "schemaVersion": "kfc-model-qualification-freeze-v2",
        "stage": "configuration_frozen_before_evaluation",
        "configurationPath": configuration.as_posix(),
        "configurationSha256": digest,
        "precommitSha256": precommit.evidence_sha256,
        "worldDigest": precommit.world_digest,
        "sourceContractSha256": precommit.source_contract_sha256,
    }
    evidence.parent.mkdir(parents=True, exist_ok=True)
    encoded = _canonical_json(payload) + b"\n"
    try:
        descriptor = os.open(evidence, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    except FileExistsError as error:
        raise FrozenConfigurationError(
            "frozen configuration evidence already exists"
        ) from error
    with os.fdopen(descriptor, "wb") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    return FrozenConfiguration(configuration, digest, evidence, precommit)


def verify_frozen_configuration(
    configuration_path: Path | str,
    frozen: FrozenConfiguration,
    *,
    world_root: Path | str | None = None,
) -> None:
    configuration = Path(configuration_path).resolve()
    if configuration != frozen.configuration_path:
        raise FrozenConfigurationError("configuration path changed after freeze")
    if _sha256(configuration) != frozen.configuration_sha256:
        raise FrozenConfigurationError("configuration digest changed after freeze")
    if frozen.precommit is None:
        raise FrozenConfigurationError(
            "frozen configuration lacks qualification precommit"
        )
    _verify_precommit(
        frozen.precommit,
        configuration,
        Path(world_root) if world_root is not None else None,
    )
    if not frozen.evidence_path.is_file():
        raise FrozenConfigurationError("freeze evidence token is missing")
    try:
        evidence = json.loads(frozen.evidence_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise FrozenConfigurationError("freeze evidence token is invalid") from error
    expected = {
        "schemaVersion": "kfc-model-qualification-freeze-v2",
        "stage": "configuration_frozen_before_evaluation",
        "configurationPath": configuration.as_posix(),
        "configurationSha256": frozen.configuration_sha256,
        "precommitSha256": frozen.precommit.evidence_sha256,
        "worldDigest": frozen.precommit.world_digest,
        "sourceContractSha256": frozen.precommit.source_contract_sha256,
    }
    if evidence != expected:
        raise FrozenConfigurationError("freeze evidence token does not match")
