from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from pathlib import Path

from huggingface_hub import snapshot_download as download_snapshot

BINDING_PATH = Path("/app/model-binding.json")
MODEL_CACHE = Path("/tmp/kfc-shadow-model")
_REVISION_PATTERN = re.compile(r"^[a-f0-9]{40,64}$")
_MODEL_NAME = "kfc-vietnam-recommendation-shadow-20260727"


def resolve_model_path(
    *,
    snapshot_download: Callable[..., str] = download_snapshot,
) -> Path:
    local_path = os.environ.get("KFC_MODEL_LOCAL_PATH", "").strip()
    if local_path:
        return _verified_mlflow_model(Path(local_path))
    try:
        binding = json.loads(BINDING_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("pinned model binding is unreadable") from error
    if not isinstance(binding, dict):
        raise TypeError("pinned model binding must be an object")
    repository_id = binding.get("modelRepositoryId")
    revision = binding.get("modelRevision")
    model_path = binding.get("modelPath")
    if (
        not isinstance(repository_id, str)
        or "/" not in repository_id
        or repository_id.rsplit("/", maxsplit=1)[1] != _MODEL_NAME
        or not isinstance(revision, str)
        or not _REVISION_PATTERN.fullmatch(revision)
        or model_path != "model"
    ):
        raise RuntimeError("pinned model binding is invalid")
    snapshot = Path(
        snapshot_download(
            repo_id=repository_id,
            revision=revision,
            local_dir=MODEL_CACHE,
        )
    )
    return _verified_mlflow_model(snapshot / model_path)


def mlflow_command(model_path: Path) -> list[str]:
    return [
        "mlflow",
        "models",
        "serve",
        "--model-uri",
        str(model_path),
        "--host",
        "0.0.0.0",
        "--port",
        os.environ.get("PORT", "7860"),
        "--env-manager",
        "local",
    ]


def main() -> None:
    command = mlflow_command(resolve_model_path())
    os.execvp(command[0], command)


def _verified_mlflow_model(path: Path) -> Path:
    resolved = path.resolve()
    if not (resolved / "MLmodel").is_file():
        raise RuntimeError("resolved path is not an MLflow model")
    return resolved


if __name__ == "__main__":
    main()
