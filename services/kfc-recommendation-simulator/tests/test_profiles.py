from __future__ import annotations

import unittest

from kfc_recommendation_simulator.profiles import PROFILES


class ProfileContractTest(unittest.TestCase):
    def test_profiles_have_the_exact_per_seed_sizes_and_seed_counts(self) -> None:
        self.assertEqual(
            {
                name: (profile.journeys_per_seed, len(profile.seeds))
                for name, profile in PROFILES.items()
            },
            {
                "smoke": (2_000, 1),
                "development": (20_000, 3),
                "qualification": (50_000, 10),
            },
        )


if __name__ == "__main__":
    unittest.main()
