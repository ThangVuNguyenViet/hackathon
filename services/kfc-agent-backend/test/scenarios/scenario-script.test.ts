import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIVE_QUALITY_EXPECTED_CASE_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
} from '../../src/evaluation/liveQualityContracts.js';
import { loadScenarioCorpus, loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');

describe('canonical scenario corpus', () => {
  it('loads nine validated JSON scenarios with 48 customer turns and no canned bot turns', async () => {
    const corpus = await loadScenarioCorpus(scenariosRoot);
    expect(corpus).toHaveLength(9);
    expect(corpus.reduce((total, scenario) => total + scenario.turnExpectations.length, 0))
      .toBe(LIVE_QUALITY_EXPECTED_TURN_COUNT);
    expect(LIVE_QUALITY_EXPECTED_CASE_COUNT).toBe(96);
    for (const scenario of corpus) {
      const script = await loadScenarioScript(join(scenariosRoot, scenario.fileName));
      expect(script.turns).toEqual(script.userTurns);
      expect(script.turns.every(({ speaker }) => speaker === 'User')).toBe(true);
      expect(script.turns.map(({ index }) => index))
        .toEqual(script.turns.map((_, index) => index * 2 + 1));
    }
  });

  it('fails closed on unsafe paths, contradictory state, incomplete GenUI, and use-case drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kfc-outcome-scenario-'));
    const path = join(root, '01-test.json');
    const valid = {
      schemaVersion: 'kfc-outcome-scenario-v2',
      id: '01-test',
      title: 'Test',
      channel: 'kfc',
      goal: 'Test strict validation',
      useCases: ['UC-01'],
      finalState: 'unchanged',
      turns: [{
        index: 1,
        speaker: 'User',
        text: 'Test input',
        useCases: ['UC-01'],
        outcome: {
          state: { facts: [{ source: 'state', path: 'cart', operator: 'absent' }] },
          effects: {},
        },
      }],
    };
    const attempts = [
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: { facts: [{ source: 'state', path: '__proto__.polluted', operator: 'present' }] },
          effects: {},
        } }],
      },
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: { mustChange: ['cart'], mustNotChange: ['cart'] },
          effects: {},
        } }],
      },
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: {},
          effects: {},
          presentation: { genUi: { required: true } },
        } }],
      },
      {
        ...valid,
        turns: [{ ...valid.turns[0], useCases: ['UC-02'] }],
      },
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: {
            facts: [{
              source: 'presentation',
              path: 'responseText',
              operator: 'equals',
              value: 'fixed_token',
            }],
          },
          effects: {},
        } }],
      },
      ...[
        'route.name',
        'tool.name',
        'classifier.label',
        'planner.output',
        'recommendation.responseText',
        'clarification.intentLabel',
      ].map((path) => ({
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: {
            facts: [{ source: 'presentation', path, operator: 'equals', value: 'fixed_token' }],
          },
          effects: {},
        } }],
      })),
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: {
            facts: [{
              source: 'presentation',
              path: 'paymentMethods.methodId',
              operator: 'equals',
              value: 'fixed customer phrase',
            }],
          },
          effects: {},
        } }],
      },
      {
        ...valid,
        turns: [{ ...valid.turns[0], outcome: {
          state: { mustNotChange: ['cart'] },
          effects: { forbidden: ['cart_mutated'] },
        } }],
      },
    ];
    try {
      for (const candidate of attempts) {
        await writeFile(path, JSON.stringify(candidate));
        await expect(loadScenarioScript(path)).rejects.toThrow();
      }
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
