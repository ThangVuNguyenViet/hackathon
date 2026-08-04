from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path


class FrozenConfigurationError(ValueError):
    """Raised when untouched evaluation is not bound to its frozen inputs."""


@dataclass(frozen=True)
class FrozenConfiguration:
    configuration_path: Path
    configuration_sha256: str
    evidence_path: Path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze_configuration(
    configuration_path: Path | str, evidence_path: Path | str
) -> FrozenConfiguration:
    configuration = Path(configuration_path).resolve()
    evidence = Path(evidence_path).resolve()
    digest = _sha256(configuration)
    payload = {
        "schemaVersion": "kfc-model-qualification-freeze-v1",
        "configurationPath": configuration.name,
        "configurationSha256": digest,
    }
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return FrozenConfiguration(configuration, digest, evidence)


def verify_frozen_configuration(
    configuration_path: Path | str, frozen: FrozenConfiguration
) -> None:
    configuration = Path(configuration_path).resolve()
    if configuration != frozen.configuration_path:
        raise FrozenConfigurationError("configuration path changed after freeze")
    if _sha256(configuration) != frozen.configuration_sha256:
        raise FrozenConfigurationError("configuration digest changed after freeze")
