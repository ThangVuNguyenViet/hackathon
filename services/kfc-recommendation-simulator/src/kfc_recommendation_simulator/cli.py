from __future__ import annotations

import argparse
import json
from pathlib import Path

from .artifacts import audit_bundle, generate_bundle
from .benchmark import run_benchmark
from .modifier_benchmark import run_modifier_benchmark
from .publication import (
    build_public_provenance,
    prepare_model_publication,
    prepare_space_publication,
)
from .serving import save_qualified_shadow_model


def _package_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _repo_root() -> Path:
    return _package_root().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(prog="kfc-rec-sim")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate")
    generate.add_argument("--preset", choices=("smoke", "benchmark"), default="smoke")
    generate.add_argument("--config", type=Path)
    generate.add_argument("--output", type=Path)

    audit = subparsers.add_parser("audit")
    audit.add_argument("bundle", type=Path)

    benchmark = subparsers.add_parser("benchmark")
    benchmark.add_argument(
        "--profile",
        choices=("smoke", "qualification"),
        default="smoke",
    )
    benchmark.add_argument(
        "--placement",
        choices=("smart-cross-sell", "modifier-upsell"),
        default="smart-cross-sell",
    )
    benchmark.add_argument("--output", type=Path)
    benchmark.add_argument("--dataset-root", type=Path)

    package_shadow = subparsers.add_parser("package-shadow-models")
    package_shadow.add_argument(
        "--smart-cross-sell-qualification",
        type=Path,
        required=True,
    )
    package_shadow.add_argument(
        "--modifier-upsell-qualification",
        type=Path,
        required=True,
    )
    package_shadow.add_argument("--output", type=Path, required=True)

    prepare_model = subparsers.add_parser("prepare-model-publication")
    prepare_model.add_argument("--mlflow-model", type=Path, required=True)
    prepare_model.add_argument(
        "--smart-cross-sell-feature-schema",
        type=Path,
        required=True,
    )
    prepare_model.add_argument(
        "--modifier-upsell-feature-schema",
        type=Path,
        required=True,
    )
    prepare_model.add_argument("--source-commit", required=True)
    prepare_model.add_argument("--output", type=Path, required=True)

    prepare_space = subparsers.add_parser("prepare-space-publication")
    prepare_space.add_argument("--source", type=Path, required=True)
    prepare_space.add_argument("--source-commit", required=True)
    prepare_space.add_argument("--model-repository-id", required=True)
    prepare_space.add_argument("--model-revision", required=True)
    prepare_space.add_argument("--output", type=Path, required=True)

    provenance = subparsers.add_parser("write-public-provenance")
    provenance.add_argument("--source-commit", required=True)
    provenance.add_argument("--model-repository-id", required=True)
    provenance.add_argument("--model-revision", required=True)
    provenance.add_argument("--model-publication-digest", required=True)
    provenance.add_argument("--space-repository-id", required=True)
    provenance.add_argument("--space-revision", required=True)
    provenance.add_argument("--space-publication-digest", required=True)
    provenance.add_argument("--sanity-project-id", required=True)
    provenance.add_argument("--sanity-dataset", required=True)
    provenance.add_argument("--sanity-snapshot-digest", required=True)
    provenance.add_argument("--output", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "generate":
        config = args.config or _package_root() / "worlds" / f"{args.preset}.json"
        output = (
            args.output
            or _repo_root()
            / ".artifacts"
            / "kfc-recommendation-simulator"
            / args.preset
        )
        manifest = generate_bundle(
            config_path=config.resolve(),
            output_dir=output.resolve(),
            repo_root=_repo_root(),
        )
        print(manifest.model_dump_json(by_alias=True, indent=2))
    elif args.command == "audit":
        result = audit_bundle(args.bundle.resolve())
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.command == "benchmark":
        placement = args.placement.replace("-", "_")
        output = (
            args.output
            or _repo_root()
            / ".artifacts"
            / "kfc-recommendation-simulator"
            / f"{args.placement}-{args.profile}"
        )
        if placement == "modifier_upsell":
            result = run_modifier_benchmark(
                profile_name=args.profile,
                package_root=_package_root(),
                repo_root=_repo_root(),
                output_dir=output.resolve(),
                dataset_root=(
                    args.dataset_root.resolve()
                    if args.dataset_root is not None
                    else None
                ),
            )
        else:
            if args.dataset_root is not None:
                parser.error("--dataset-root is currently modifier-upsell only")
            result = run_benchmark(
                profile_name=args.profile,
                package_root=_package_root(),
                repo_root=_repo_root(),
                output_dir=output.resolve(),
            )
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.command == "package-shadow-models":
        manifest = save_qualified_shadow_model(
            smart_cross_sell_qualification=(
                args.smart_cross_sell_qualification.resolve()
            ),
            modifier_upsell_qualification=(
                args.modifier_upsell_qualification.resolve()
            ),
            output_directory=args.output.resolve(),
        )
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    elif args.command == "prepare-model-publication":
        manifest = prepare_model_publication(
            mlflow_model_path=args.mlflow_model.resolve(),
            output_directory=args.output.resolve(),
            source_commit=args.source_commit,
            smart_cross_sell_feature_schema=(
                args.smart_cross_sell_feature_schema.resolve()
            ),
            modifier_upsell_feature_schema=(
                args.modifier_upsell_feature_schema.resolve()
            ),
        )
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    elif args.command == "prepare-space-publication":
        manifest = prepare_space_publication(
            source_directory=args.source.resolve(),
            output_directory=args.output.resolve(),
            source_commit=args.source_commit,
            model_repository_id=args.model_repository_id,
            model_revision=args.model_revision,
        )
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    else:
        manifest = build_public_provenance(
            source_commit=args.source_commit,
            model_repository_id=args.model_repository_id,
            model_revision=args.model_revision,
            model_publication_digest=args.model_publication_digest,
            space_repository_id=args.space_repository_id,
            space_revision=args.space_revision,
            space_publication_digest=args.space_publication_digest,
            sanity_project_id=args.sanity_project_id,
            sanity_dataset=args.sanity_dataset,
            sanity_snapshot_digest=args.sanity_snapshot_digest,
        )
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
