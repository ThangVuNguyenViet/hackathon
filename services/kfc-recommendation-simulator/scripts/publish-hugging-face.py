from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from huggingface_hub import HfApi
from huggingface_hub.errors import LocalTokenNotFoundError
from huggingface_hub.utils import HfHubHTTPError

from kfc_recommendation_simulator.publication import (
    MODEL_REPOSITORY_NAME,
    SPACE_REPOSITORY_NAME,
    prepare_space_publication,
    verify_file_manifest,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Publish the exact public KFC shadow model and Docker Space",
    )
    parser.add_argument("--model-publication", type=Path, required=True)
    parser.add_argument("--space-source", type=Path, required=True)
    parser.add_argument("--space-publication", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    api = HfApi()
    try:
        identity = api.whoami()
    except (HfHubHTTPError, LocalTokenNotFoundError) as error:
        raise SystemExit(
            "Hugging Face authentication is required. Run `hf auth login` "
            "and verify with `hf auth whoami`."
        ) from error
    namespace = _authenticated_namespace(identity)
    model_repository_id = f"{namespace}/{MODEL_REPOSITORY_NAME}"
    space_repository_id = f"{namespace}/{SPACE_REPOSITORY_NAME}"
    model_manifest = verify_file_manifest(
        args.model_publication.resolve() / "publication-manifest.json"
    )
    if model_manifest["metadata"].get("sourceCommit") != args.source_commit:
        raise SystemExit(
            "Model publication source commit does not match --source-commit."
        )

    api.create_repo(
        model_repository_id,
        repo_type="model",
        private=False,
        exist_ok=False,
    )
    model_commit = api.upload_folder(
        repo_id=model_repository_id,
        repo_type="model",
        folder_path=args.model_publication.resolve(),
        commit_message="Publish qualified KFC recommendation shadow model",
    )
    model_revision = _commit_oid(model_commit)

    space_manifest = prepare_space_publication(
        source_directory=args.space_source.resolve(),
        output_directory=args.space_publication.resolve(),
        source_commit=args.source_commit,
        model_repository_id=model_repository_id,
        model_revision=model_revision,
    )
    verify_file_manifest(
        args.space_publication.resolve() / "space-publication-manifest.json"
    )
    api.create_repo(
        space_repository_id,
        repo_type="space",
        private=False,
        exist_ok=False,
        space_sdk="docker",
    )
    space_commit = api.upload_folder(
        repo_id=space_repository_id,
        repo_type="space",
        folder_path=args.space_publication.resolve(),
        commit_message="Deploy pinned MLflow recommendation shadow service",
    )
    space_revision = _commit_oid(space_commit)
    space_info = api.space_info(space_repository_id, revision=space_revision)
    if not isinstance(space_info.host, str) or not space_info.host:
        raise RuntimeError("Hugging Face Space did not report its public host")

    output = {
        "schemaVersion": "kfc-hugging-face-publication-result-v1",
        "sourceCommit": args.source_commit,
        "model": {
            "repositoryId": model_repository_id,
            "revision": model_revision,
            "publicationDigest": model_manifest["contentDigest"],
            "url": f"https://huggingface.co/{model_repository_id}",
            "visibility": "public",
        },
        "space": {
            "repositoryId": space_repository_id,
            "revision": space_revision,
            "publicationDigest": space_manifest["contentDigest"],
            "url": f"https://huggingface.co/spaces/{space_repository_id}",
            "appUrl": f"https://{space_info.host}",
            "visibility": "public",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(output, ensure_ascii=False, indent=2))


def _authenticated_namespace(identity: Any) -> str:
    if not isinstance(identity, dict):
        raise SystemExit("Hugging Face identity response is invalid.")
    namespace = identity.get("name")
    if not isinstance(namespace, str) or not namespace.strip():
        raise SystemExit("Hugging Face identity has no namespace.")
    return namespace.strip()


def _commit_oid(commit: Any) -> str:
    oid = getattr(commit, "oid", None)
    if not isinstance(oid, str) or len(oid) < 40:
        raise RuntimeError("Hugging Face upload did not return an immutable revision")
    return oid


if __name__ == "__main__":
    main()
