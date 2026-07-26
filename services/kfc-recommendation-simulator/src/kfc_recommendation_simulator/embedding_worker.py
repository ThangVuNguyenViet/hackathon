from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .benchmark_data import BundleData, load_catalog_rows
from .benchmark_orchestration import IsolatedStage, write_stage_checkpoint
from .embeddings import CatalogEmbeddingProjector


def main() -> None:
    parser = argparse.ArgumentParser(prog="kfc-rec-sim-embedding-worker")
    parser.add_argument("--stage", required=True)
    parser.add_argument("--input-digest", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.stage != "fit-embeddings":
        raise ValueError(f"unsupported embedding stage: {args.stage}")
    try:
        os.nice(10)
    except OSError:
        pass
    output_dir = args.output.resolve()
    config = json.loads(
        (output_dir / "configs" / "seed-01.json").read_text(encoding="utf-8")
    )
    bundle = BundleData(
        seed=1,
        bundle_dir=output_dir / "datasets" / "seed-01",
        journey_count=int(config["journeyCount"]),
    )
    projector = CatalogEmbeddingProjector.fit(load_catalog_rows(bundle))
    projector.save(output_dir / "models" / "lightgbm_embeddings")
    write_stage_checkpoint(
        IsolatedStage(
            name=args.stage,
            input_digest=args.input_digest,
            checkpoint=output_dir / ".stages" / f"{args.stage}.json",
        )
    )


if __name__ == "__main__":
    main()
