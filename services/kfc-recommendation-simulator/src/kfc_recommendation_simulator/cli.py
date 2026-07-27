from __future__ import annotations

import argparse
import json
from pathlib import Path

from .artifacts import audit_bundle, generate_bundle
from .benchmark import run_benchmark
from .modifier_benchmark import run_modifier_benchmark
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
    else:
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


if __name__ == "__main__":
    main()
