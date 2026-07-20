import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_INVENTORY_VERSION,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  LIVE_QUALITY_V3_CANDIDATE_INVENTORY_DIGEST,
  LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION,
} from './scenarioCoverageLedgerV3Candidate.js';

const assetsRoot = join(
  process.cwd(),
  '../../docs/wayfinder/kfc-model-agnostic-agent-runtime/assets',
);

function readAsset(fileName: string): string {
  return readFileSync(join(assetsRoot, fileName), 'utf8');
}

describe('Wayfinder scenario coverage documentation', () => {
  it('tracks the executable v2 and local v3 identities', () => {
    const coverageMap = readAsset(
      'pr54-stategraph-scenario-replay-coverage-map.md',
    );

    expect(coverageMap).toContain(`Inventory: \`${LIVE_QUALITY_INVENTORY_VERSION}\``);
    expect(coverageMap).toContain(LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST);
    expect(coverageMap).toContain(
      `Inventory: \`${LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION}\``,
    );
    expect(coverageMap).toContain(LIVE_QUALITY_V3_CANDIDATE_INVENTORY_DIGEST);
    expect(coverageMap).toContain('The 19 reviewed v3 rows above');
  });

  it('resolves the stale 48/96 wording without changing the canonical corpus', () => {
    const manifest = readAsset('donor-adoption-manifest.md');
    const coverageMap = readAsset(
      'pr54-stategraph-scenario-replay-coverage-map.md',
    );

    for (const document of [manifest, coverageMap]) {
      expect(document).toContain('9 scenarios, 46 customer turns, 92 Text/GenUI cases');
      expect(document).toContain('48/96');
      expect(document).toContain('rejected');
    }
    expect(manifest).toContain(
      '46 × 2 modes × 3 repetitions = 276 turn evaluations per provider',
    );
    expect(manifest).toContain(
      '46 × 3 repetitions × 2 providers = 276 mandatory Text turn evaluations',
    );
    expect(manifest).not.toContain('repurpose scenario 03 for pickup then delivery');
    expect(manifest).not.toContain('The attested v1 case shape');
  });
});
