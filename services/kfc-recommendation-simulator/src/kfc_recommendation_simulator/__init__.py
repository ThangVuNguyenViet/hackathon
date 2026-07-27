"""Throwaway KFC recommendation behavioral-world prototype."""

from __future__ import annotations

from importlib import import_module
from typing import Any

__all__ = ["audit_bundle", "generate_bundle"]


def __getattr__(name: str) -> Any:
    if name not in __all__:
        raise AttributeError(name)
    value = getattr(import_module(".artifacts", __name__), name)
    globals()[name] = value
    return value
