import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadScenarioScript,
  parseScenarioScript,
} from '../../src/scenarios/scenarioScript.js';

describe('scenario narrative contract', () => {
  it('accepts narrative preconditions and risks', () => {
    expect(
      parseScenarioScript({
        id: 'narrative-only',
        title: 'Narrative only',
        channel: 'kfc',
        goal: 'Explore a customer need',
        preconditions: ['A fresh session'],
        useCases: ['UC-01'],
        finalState: 'reviewer_judges_outcome',
        turns: [
          { index: 1, speaker: 'User', text: 'Help me', useCases: ['UC-01'] },
        ],
        risks: ['The answer may be ungrounded'],
      }).risks,
    ).toEqual(['The answer may be ungrounded']);
  });

  it('loads explicit narrative preconditions for every retained scenario', async () => {
    const scenarioRoot = resolve(
      process.cwd(),
      '../../ai-talent-tracks/fnb/conversations',
    );
    const files = (await readdir(scenarioRoot))
      .filter((name) => /^\d{2}-.*\.json$/u.test(name))
      .sort();

    expect(files).toHaveLength(11);
    for (const file of files) {
      const scenario = await loadScenarioScript(resolve(scenarioRoot, file));
      expect(scenario.preconditions.length, file).toBeGreaterThan(0);
      expect(
        scenario.preconditions.every((precondition) => precondition.trim()),
        file,
      ).toBe(true);
    }
  });

  it.each([
    'acceptanceCriteria',
    'expectations',
    'exactWords',
    'exactPhrases',
    'requiredToolSequence',
    'toolAssertions',
  ])('rejects deterministic top-level field %s', (field) => {
    expect(() =>
      parseScenarioScript({
        id: 'narrative-only',
        title: 'Narrative only',
        channel: 'kfc',
        goal: 'Explore a customer need',
        preconditions: ['A fresh session'],
        useCases: ['UC-01'],
        finalState: 'reviewer_judges_outcome',
        turns: [
          { index: 1, speaker: 'User', text: 'Help me', useCases: ['UC-01'] },
        ],
        risks: ['The answer may be ungrounded'],
        [field]: ['deterministic value'],
      }),
    ).toThrow();
  });

  it('rejects deterministic assertions attached to a turn', () => {
    expect(() =>
      parseScenarioScript({
        id: 'narrative-only',
        title: 'Narrative only',
        channel: 'kfc',
        goal: 'Explore a customer need',
        preconditions: ['A fresh session'],
        useCases: ['UC-01'],
        finalState: 'reviewer_judges_outcome',
        turns: [
          {
            index: 1,
            speaker: 'User',
            text: 'Help me',
            useCases: ['UC-01'],
            toolAssertions: ['must call searchMenu'],
          },
        ],
        risks: ['The answer may be ungrounded'],
      }),
    ).toThrow();
  });
});
