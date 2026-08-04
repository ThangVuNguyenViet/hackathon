from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from .generator import generate_world
from .loader import load_training_table
from .profiles import PROFILES


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kfc-recommendation-simulator")
    subcommands = parser.add_subparsers(dest="command", required=True)
    generate = subcommands.add_parser("generate")
    generate.add_argument("--profile", choices=tuple(PROFILES), required=True)
    generate.add_argument("--output", type=Path, required=True)
    generate.add_argument("--world-revision", default="synthetic-causal-world-v1")
    summary = subcommands.add_parser("training-summary")
    summary.add_argument("--world", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    if arguments.command == "generate":
        world = generate_world(
            arguments.output,
            profile=PROFILES[arguments.profile],
            world_revision=arguments.world_revision,
        )
        print(json.dumps({"world": str(world)}, sort_keys=True))
        return 0
    table = load_training_table(arguments.world)
    print(
        json.dumps(
            {"columns": table.column_names, "rows": table.num_rows}, sort_keys=True
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
