from __future__ import annotations

import argparse
import json
from pathlib import Path

from .artifacts import audit_bundle, generate_bundle
from .benchmark import run_benchmark


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
    benchmark.add_argument("--output", type=Path)

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
    else:
        output = (
            args.output
            or _repo_root()
            / ".artifacts"
            / "kfc-recommendation-simulator"
            / f"smart-cross-sell-{args.profile}"
        )
        result = run_benchmark(
            profile_name=args.profile,
            package_root=_package_root(),
            repo_root=_repo_root(),
            output_dir=output.resolve(),
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
