from __future__ import annotations

import json
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
        (temporary / "bundle-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.rename(output)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return output
