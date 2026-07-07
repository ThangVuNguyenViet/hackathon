import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from '../../src/scenarios/parser.js';
import { runScenario } from '../../src/scenarios/runner.js';

describe('scenario 08 replay', () => {
  it('routes payment failures and abnormal order to human review', async () => {
    const script = await parseScenarioFile(
      join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.md'),
    );
    const result = await runScenario(script);

    expect(result.finalState).toBe('human_review_required');
    expect(result.coveredUseCases).toEqual(['UC-24', 'UC-33', 'UC-50']);
    expect(result.dashboardEvents.some((event) => event.type === 'payment_failed')).toBe(true);
    expect(result.dashboardEvents.some((event) => event.type === 'handoff_required')).toBe(true);
    expect(result.escalationReasons).toContain('payment_failed');
    expect(result.escalationReasons).toContain('abnormal_large_order');
  });
});
