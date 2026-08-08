from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GenerationProfile:
    name: str
    journeys_per_seed: int
    seeds: tuple[int, ...]

    @property
    def total_journeys(self) -> int:
        return self.journeys_per_seed * len(self.seeds)


PROFILES = {
    "smoke": GenerationProfile("smoke", 2_000, (101,)),
    "development": GenerationProfile("development", 20_000, (101, 211, 307)),
    "qualification": GenerationProfile(
        "qualification",
        50_000,
        (101, 211, 307, 401, 503, 601, 701, 809, 907, 1_009),
    ),
}
