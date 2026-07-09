import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

describe('loadScenarioScript', () => {
  it('loads metadata, turns, and expectations from scenario JSON', async () => {
    const script = await loadScenarioScript(
      join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.json'),
    );

    expect(script.id).toBe('08-thanh-toan-loi-va-don-bat-thuong');
    expect(script.channel).toBe('web_mock');
    expect(script.finalState).toBe('human_review_required');
    expect(script.useCases).toEqual(['UC-18', 'UC-39']);
    expect(script.userTurns).toHaveLength(4);
    expect(script.turns.some((turn) => turn.useCases.includes('Filler'))).toBe(true);
    expect(script.expectations).toContain('Đơn số lượng rất lớn kích hoạt `human_review_required`.');
  });
});
