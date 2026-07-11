import { describe, expect, it } from 'vitest';
import { selectLatestPassingRuns, type ProofRunSummary } from '../../src/evaluation/genUiProofCatalog.js';

function run(scenarioId: string, generatedAt: string): ProofRunSummary {
  return {
    runId: `${scenarioId}-${generatedAt}`,
    generatedAt,
    scenarioId,
    manifestPath: '/tmp/manifest.json',
    evaluationPath: '/tmp/evaluation.json',
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
});
