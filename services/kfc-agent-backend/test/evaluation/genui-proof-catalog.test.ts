import { describe, expect, it } from 'vitest';
import { selectLatestPassingRuns, type ProofRunSummary } from '../../src/evaluation/genUiProofCatalog.js';

function run(scenarioId: string, generatedAt: string): ProofRunSummary {
  return {
    runId: `${scenarioId}-${generatedAt}`,
    generatedAt,
    scenarioId,
    manifestPath: '/tmp/manifest.json',
    evaluationPath: '/tmp/evaluation.json',
    runtime: {
      deployment: {
        gitSha: 'abc123',
        deploymentId: 'worker-abc123',
        builtAt: '2026-07-10T00:00:00.000Z',
        dirty: false,
      },
      commerceEnvironment: 'sandbox',
      providerFingerprint: 'catalog-1',
      catalogObservation: {
        id: 'observation-1',
        sha256: 'catalog-sha',
        observedAt: '2026-07-10T00:00:00.000Z',
        expiresAt: null,
        itemCount: 10,
        modifierTreeCount: 2,
      },
      lifecycle: { provider: 'd1', controlsRegistered: true },
      graph: { runtime: 'langchain-create-agent-v1', checkpoint: 'd1-v1' },
      versions: {
        agent: {
          provider: 'google',
          model: 'gemini-3.1-flash-lite',
          profile: 'google-gemini-3.1-flash-lite-thinking-low',
        },
        toolCatalog: 'typed-commerce-tools-v1',
        ranker: 'deterministic-safety-rerank-v1',
        ledger: 'kfc-scenario-ledger-v1',
      },
    },
    screenshots: [],
  };
}

describe('GenUI consolidated proof catalog', () => {
  it('selects the latest passing run for every required scenario', () => {
    const selected = selectLatestPassingRuns(
      [run('01-ordering', '2026-07-10'), run('01-ordering', '2026-07-11'), run('02-menu', '2026-07-09')],
      ['01-ordering', '02-menu'],
    );

    expect(selected.map((entry) => entry.runId)).toEqual([
      '01-ordering-2026-07-11',
      '02-menu-2026-07-09',
    ]);
  });

  it('rejects an incomplete scenario set', () => {
    expect(() => selectLatestPassingRuns([run('01-ordering', '2026-07-11')], ['01-ordering', '02-menu'])).toThrow(
      'Missing passing evaluated GenUI proof for: 02-menu',
    );
  });

  it('rejects otherwise-passing runs produced by different agent identities', () => {
    const google = run('01-ordering', '2026-07-11');
    const openai = run('02-menu', '2026-07-11');
    openai.runtime.versions.agent = {
      provider: 'openai',
      model: 'gpt-5-mini-2025-08-07',
      profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
    };

    expect(() =>
      selectLatestPassingRuns([google, openai], ['01-ordering', '02-menu']),
    ).toThrow('Cannot consolidate mixed agent runtime identities');
  });

  it('allows fresh observation timestamps for the same pinned catalog and runtime', () => {
    const first = run('01-ordering', '2026-07-11');
    const second = run('02-menu', '2026-07-12');
    second.runtime.catalogObservation.observedAt = '2026-07-12T00:00:00.000Z';
    second.runtime.catalogObservation.expiresAt = '2026-07-12T00:05:00.000Z';

    expect(
      selectLatestPassingRuns([first, second], ['01-ordering', '02-menu']),
    ).toHaveLength(2);
  });
});
