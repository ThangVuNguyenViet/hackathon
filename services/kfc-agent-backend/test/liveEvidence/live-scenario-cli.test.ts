import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLiveScenarioCliArgs } from '../../src/liveEvidence/liveScenarioCli.js';

describe('live scenario CLI arguments', () => {
  it('resolves a fixed candidate, scenario, attempt, and evidence directory', () => {
    expect(
      parseLiveScenarioCliArgs(
        [
          '--scenario',
          'ai-talent-tracks/fnb/conversations/02.json',
          '--candidate',
          'qwen3.7-max',
          '--run-id',
          'qwen-s02-a3',
          '--attempt',
          '3',
        ],
        '/repo',
      ),
    ).toEqual({
      scenarioPath: resolve(
        '/repo',
        'ai-talent-tracks/fnb/conversations/02.json',
      ),
      candidateId: 'qwen3.7-max',
      runId: 'qwen-s02-a3',
      attempt: 3,
      artifactsRoot: resolve('/repo', '.artifacts/kfc-live-scenarios'),
    });
  });

  it('rejects missing and unknown pinned candidates before live work', () => {
    expect(() =>
      parseLiveScenarioCliArgs(
        ['--scenario', 'scenario.json', '--run-id', 'run'],
        '/repo',
      ),
    ).toThrow('live_scenario_candidate_required');
    expect(() =>
      parseLiveScenarioCliArgs(
        [
          '--scenario',
          'scenario.json',
          '--candidate',
          'not-a-candidate',
          '--run-id',
          'run',
        ],
        '/repo',
      ),
    ).toThrow('Unknown KFC agent candidate');
  });
});
