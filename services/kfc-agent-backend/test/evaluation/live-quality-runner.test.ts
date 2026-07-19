import { expect, it } from 'vitest';
import type { LiveQualityExperimentOutput } from '../../src/evaluation/liveQualityContracts.js';
import { runLiveQualityMatrix } from '../../src/evaluation/liveQualityRunner.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

function output(facts: Record<string, unknown> = {}): LiveQualityExperimentOutput {
  return {
    responseText: 'Provider-authored response.',
    effects: [],
    evidence: [],
    stateBefore: {},
    stateAfter: {},
    presentationFacts: facts,
    verifiedCollections: {},
    presentedCollections: {},
    durationMs: 1,
    persistence: {
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: 1,
      eventIdsBefore: [],
      eventIds: ['event-1'],
      eventIdsAfter: ['event-1'],
      checkpointId: 'checkpoint-1',
      checkpointNamespace: 'run:test',
    },
  };
}

it('builds 54 scenario-mode runs and 288 turn evaluations per provider across three repetitions', async () => {
  const result = await runLiveQualityMatrix({
    scenarios: liveScenarioCases,
    run: async ({ scenario }) => scenario.turnExpectations.map(() => output({ verified: true })),
  });
  expect(result.runs).toHaveLength(108);
  expect(result.evaluations).toHaveLength(576);
  expect(result.modeParity).toHaveLength(288);
  expect(result.providerParityIssues).toEqual([]);
  for (const provider of ['openai', 'gemini'] as const) {
    expect(result.runs.filter((run) => run.provider === provider)).toHaveLength(54);
    expect(result.evaluations.filter((evaluation) => evaluation.provider === provider))
      .toHaveLength(288);
  }
});

it('reports Text/GenUI and OpenAI/Gemini structured-fact drift', async () => {
  const result = await runLiveQualityMatrix({
    scenarios: liveScenarioCases,
    run: async ({ provider, scenario, mode }) => scenario.turnExpectations.map((_, index) => output({
      verified: true,
      ...(scenario.fileName === liveScenarioCases[0]!.fileName && index === 0
        ? { provider, mode }
        : {}),
    })),
  });
  expect(result.modeParity).toContainEqual(expect.objectContaining({
    provider: 'openai',
    scenarioFile: liveScenarioCases[0]!.fileName,
    turnIndex: 1,
    score: expect.objectContaining({ key: 'mode_parity', score: false }),
  }));
  expect(result.providerParityIssues).toContain(
    `${liveScenarioCases[0]!.fileName}#1:genui:r1 provider facts differ`,
  );
  expect(result.passed).toBe(false);
});

it('rejects scenario metadata drift before invoking a provider adapter', async () => {
  const scenarios = structuredClone(liveScenarioCases);
  scenarios[0]!.goal = `${scenarios[0]!.goal} changed`;
  let invocations = 0;
  await expect(runLiveQualityMatrix({
    scenarios,
    run: async ({ scenario }) => {
      invocations += 1;
      return scenario.turnExpectations.map(() => output());
    },
  })).rejects.toThrow('Refusing non-canonical live quality matrix');
  expect(invocations).toBe(0);
});
