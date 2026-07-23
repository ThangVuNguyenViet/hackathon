import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

describe('scenario narrative contract', () => {
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
});
