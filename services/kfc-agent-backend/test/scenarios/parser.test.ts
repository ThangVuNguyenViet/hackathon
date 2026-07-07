import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from '../../src/scenarios/parser.js';

describe('parseScenarioFile', () => {
  it('parses metadata, turns, and expectations from scenario 08', async () => {
    const script = await parseScenarioFile(
      join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.md'),
    );

    expect(script.id).toBe('08-thanh-toan-loi-va-don-bat-thuong');
    expect(script.channel).toBe('web_mock');
    expect(script.finalState).toBe('human_review_required');
    expect(script.useCases).toEqual(['UC-24', 'UC-33', 'UC-50']);
    expect(script.userTurns).toHaveLength(4);
    expect(script.turns.some((turn) => turn.useCases.includes('Filler'))).toBe(true);
    expect(script.expectations).toContain('Đơn số lượng rất lớn kích hoạt `human_review_required`.');
  });
});
